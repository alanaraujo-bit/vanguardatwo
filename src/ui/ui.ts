import type { SaveSystem } from '../core/save';
import { fmtTime } from '../core/utils';
import type { AudioEngine } from '../audio/audio';
import { S } from '../i18n/strings';
import { CAMPAIGN } from '../game/campaign';
import { CODEX, CODEX_INTRO, type CodexCategoryId, type CodexEntry } from '../game/codex';
import { META_DEFS, metaCost, metaLevel } from '../game/meta';
import { SHIP_SHAPE } from '../game/player';
import { paintIcon, type UpgradeDef } from '../game/upgrades';
import { drawSprite, shapeSprite } from '../fx/sprites';
import { api, ApiError } from '../net/api';
import { nameError, sanitizeName, NAME_MAX } from '../net/names';
import type { BoardKind, LeaderboardEntry, ProfileResponse } from '../net/protocol';
import { normalizeRoomCode, ROOM_CODE_LEN, type EndResult, type RoomPlayer } from '../net/realtime';
import { session } from '../net/session';

export interface RunStats {
  wave: number;
  kills: number;
  time: number;
  score: number;
  coins: number;
  records: { wave: boolean; score: boolean; time: boolean; coins: boolean };
}

export interface LevelStats {
  levelIndex: number;
  kills: number;
  time: number;
  coins: number;
  cleared: boolean;
}

export interface UiActions {
  startRun(): void;
  startTutorial(): void;
  startCoop(): void;
  startCampaign(levelIndex: number): void;
  pauseRun(): void;
  resumeRun(): void;
  restartRun(): void;
  quitToMenu(): void;
  applySettings(): void;
}

export interface CoopMenuOpts {
  onCreate(): void;
  onJoin(code: string): void;
  onBack(): void;
}

export interface CoopLobbyView {
  code: string;
  players: RoomPlayer[];
  hostSlot: number;
  localSlot: number;
  ready: boolean;
  onReady(ready: boolean): void;
  onStart(): void;
  onLeave(): void;
}

interface NamePromptOpts {
  initial?: string;
  /** Resolve to an error message to keep the screen open, or null to proceed. */
  onDone(name: string): Promise<string | null>;
  onCancel?: () => void;
}

interface LoginOpts {
  onDone(): void;
  /** Present = onboarding: show "continue without account" instead of back. */
  onSkip?: () => void;
}

/** Inline line-icons for the menu's compact quick-action row (viewBox 0 0 24 24). */
const ICON_HANGAR = '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>';
const ICON_TROPHY = '<path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 5H4.5A2.5 2.5 0 0 0 7 7.5"/><path d="M17 5h2.5A2.5 2.5 0 0 1 17 7.5"/><path d="M12 13v4"/><path d="M9 20h6"/>';
const ICON_BOOK = '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>';
const ICON_GEAR = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * DOM screen layer. Menus and modals are HTML/CSS (for typography, blur and
 * spring animations the canvas can't match); the game world stays on canvas.
 */
export class UI {
  private readonly root: HTMLElement;
  private readonly screens = new Map<string, HTMLElement>();
  private pauseBtn: HTMLElement | null = null;
  private tutorial: HTMLElement | null = null;
  private tutBubble: HTMLElement | null = null;
  private tutBubbleTitle: HTMLElement | null = null;
  private tutBubbleSub: HTMLElement | null = null;
  private tutSkipBtn: HTMLElement | null = null;
  private codexTab: CodexCategoryId = CODEX[0].id;
  private lbTab: BoardKind = 'wave';
  private current: string | null = null;

  constructor(
    private readonly save: SaveSystem,
    private readonly audio: AudioEngine,
    private readonly actions: UiActions,
  ) {
    const root = document.getElementById('ui');
    if (!root) throw new Error('#ui não encontrado');
    this.root = root;
  }

  // ————— infrastructure —————

  private btn(label: string, cls: string, onTap: () => void): HTMLButtonElement {
    const b = el('button', `btn ${cls}`, label);
    b.addEventListener('pointerdown', () => this.audio.play('tap'));
    b.addEventListener('click', onTap);
    return b;
  }

  /** Compact icon-over-label button for the menu's secondary-actions row. */
  private quickBtn(iconSvg: string, label: string, onTap: () => void): HTMLButtonElement {
    const b = el('button', 'quickbtn');
    b.innerHTML = `<svg class="quickbtn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>`;
    b.appendChild(el('span', 'quickbtn-label', label));
    b.addEventListener('pointerdown', () => this.audio.play('tap'));
    b.addEventListener('click', onTap);
    return b;
  }

  private screen(name: string): HTMLElement {
    let s = this.screens.get(name);
    if (!s) {
      s = el('div', `screen s-${name}`);
      this.root.appendChild(s);
      this.screens.set(name, s);
    }
    s.innerHTML = '';
    return s;
  }

  private open(name: string): void {
    const s = this.screens.get(name);
    if (!s) return;
    this.current = name;
    requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add('on')));
  }

  private close(name: string): void {
    this.screens.get(name)?.classList.remove('on');
    if (this.current === name) this.current = null;
  }

  hideAll(): void {
    for (const s of this.screens.values()) s.classList.remove('on');
    this.current = null;
  }

  /** Re-render the main menu if it is what's on screen (login state changed). */
  refreshMenu(): void {
    if (this.current === 'menu') this.showMenu();
  }

  /** Paints one or two of the player's actual ship sprite into an icon canvas — used on the mode-select cards. */
  private shipIcon(size: number, colors: string[]): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = size * dpr;
    canvas.style.width = canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.scale(dpr, dpr);
    const solo = colors.length === 1;
    colors.forEach((color, i) => {
      const sprite = shapeSprite({ ...SHIP_SHAPE, color });
      const scale = (size * (solo ? 0.36 : 0.24)) / sprite.half;
      const offset = solo ? 0 : (i - (colors.length - 1) / 2) * size * 0.34;
      drawSprite(ctx, sprite, size / 2 + offset, size / 2, 0, scale);
    });
    return canvas;
  }

  private coinChip(value: number): HTMLElement {
    const chip = el('span', 'chip chip-coins');
    chip.appendChild(el('span', 'coin-dot'));
    chip.appendChild(el('span', 'chip-value', String(value)));
    return chip;
  }

  private countUp(target: HTMLElement, value: number, duration = 0.9, prefix = ''): void {
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      const eased = 1 - Math.pow(1 - t, 3);
      target.textContent = prefix + String(Math.round(value * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private pips(current: number, max: number, highlightNext = false): HTMLElement {
    const wrap = el('div', 'pips');
    for (let i = 0; i < max; i++) {
      const pip = el('span', 'pip');
      if (i < current) pip.classList.add('full');
      else if (highlightNext && i === current) pip.classList.add('next');
      wrap.appendChild(pip);
    }
    return wrap;
  }

  // ————— main menu —————

  showMenu(): void {
    this.hideAll();
    const s = this.screen('menu');

    const top = el('div', 'row header menu-top');
    top.appendChild(el('div', 'grow'));
    if (session.authed && session.player) {
      const acct = this.btn(session.player.name, 'ghost small acct-chip', () => this.showProfile());
      acct.prepend(el('span', 'acct-dot'));
      top.appendChild(acct);
    } else {
      top.appendChild(this.btn(S.login, 'ghost small', () => {
        this.showLogin({ onDone: () => this.showMenu() });
      }));
    }
    s.appendChild(top);

    s.appendChild(el('div', 'spacer'));
    s.appendChild(el('h1', 'logo', S.title));
    s.appendChild(el('div', 'tagline', S.tagline));

    const chips = el('div', 'row chips');
    const best = el('span', 'chip', `${S.bestWave}: ${this.save.data.bestWave || '—'}`);
    chips.appendChild(best);
    chips.appendChild(this.coinChip(this.save.data.coins));
    s.appendChild(chips);

    s.appendChild(el('div', 'spacer'));

    const col = el('div', 'col actions');
    col.appendChild(this.btn(S.play, 'primary big pulse', () => {
      this.audio.play('confirm');
      this.showModeSelect();
    }));
    s.appendChild(col);

    const quick = el('div', 'quickrow');
    quick.appendChild(this.quickBtn(ICON_HANGAR, S.upgrades, () => this.showShop()));
    quick.appendChild(this.quickBtn(ICON_TROPHY, S.ranking, () => this.showLeaderboard()));
    quick.appendChild(this.quickBtn(ICON_BOOK, S.codex, () => this.showCodex()));
    quick.appendChild(this.quickBtn(ICON_GEAR, S.settings, () => this.showSettings()));
    s.appendChild(quick);

    s.appendChild(el('div', 'version', S.version));
    this.open('menu');
  }

  // ————— mode select —————

  showModeSelect(): void {
    this.hideAll();
    const s = this.screen('modeselect');

    const header = el('div', 'row header');
    header.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', () => this.showMenu()));
    s.appendChild(header);

    s.appendChild(el('div', 'spacer'));
    s.appendChild(el('h2', 'heading', S.chooseMode));
    s.appendChild(el('div', 'subheading', S.chooseModeSub));

    const modes: { icon: HTMLCanvasElement; accent: string; title: string; desc: string; onSelect(): void }[] = [
      {
        icon: this.shipIcon(44, ['#35f0ff']),
        accent: 'var(--cyan)',
        title: S.modeSoloTitle,
        desc: S.modeSoloDesc,
        onSelect: () => this.actions.startRun(),
      },
      {
        icon: this.shipIcon(44, ['#35f0ff', '#ff2e8a']),
        accent: 'var(--magenta)',
        title: S.modeCoopTitle,
        desc: S.modeCoopDesc,
        onSelect: () => this.actions.startCoop(),
      },
      {
        icon: this.shipIcon(44, ['#ffc857']),
        accent: 'var(--amber)',
        title: S.modeCampaignTitle,
        desc: S.modeCampaignDesc,
        onSelect: () => this.showCampaignSelect(),
      },
    ];

    const list = el('div', 'col cards mode-list');
    modes.forEach((m, i) => {
      const card = el('button', 'card mode-card');
      card.style.setProperty('--i', String(i));
      card.style.setProperty('--accent', m.accent);

      const icon = el('div', 'icon-wrap');
      icon.appendChild(m.icon);
      card.appendChild(icon);

      const body = el('div', 'grow');
      body.appendChild(el('div', 'item-name', m.title));
      body.appendChild(el('div', 'item-desc', m.desc));
      card.appendChild(body);

      card.appendChild(el('span', 'mode-chevron', '›'));

      card.addEventListener('pointerdown', () => this.audio.play('tap'));
      card.addEventListener('click', () => {
        this.audio.play('confirm');
        m.onSelect();
      });
      list.appendChild(card);
    });
    s.appendChild(list);

    s.appendChild(el('div', 'spacer'));
    this.open('modeselect');
  }

  // ————— campaign (level select) —————

  showCampaignSelect(): void {
    this.hideAll();
    const s = this.screen('campaignselect');

    const header = el('div', 'row header');
    header.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', () => this.showModeSelect()));
    s.appendChild(header);

    s.appendChild(el('h2', 'heading', S.campaignTitle));
    s.appendChild(el('div', 'subheading', S.campaignSub));

    const list = el('div', 'col cards mode-list');
    CAMPAIGN.forEach((level, i) => {
      const unlocked = i < this.save.data.campaignLevel;
      const card = el('button', `card mode-card${unlocked ? '' : ' locked'}`);
      card.style.setProperty('--i', String(i));
      card.style.setProperty('--accent', level.sector.accent);

      const icon = el('div', 'icon-wrap');
      icon.appendChild(this.shipIcon(40, [level.sector.accent]));
      card.appendChild(icon);

      const body = el('div', 'grow');
      body.appendChild(el('div', 'item-name', `${i + 1}. ${level.name}`));
      body.appendChild(el('div', 'item-desc', unlocked ? level.subtitle : S.campaignLocked));
      card.appendChild(body);

      card.appendChild(el('span', 'mode-chevron', unlocked ? '›' : '🔒'));

      card.addEventListener('pointerdown', () => this.audio.play('tap'));
      card.addEventListener('click', () => {
        if (!unlocked) {
          this.audio.play('deny');
          return;
        }
        this.audio.play('confirm');
        this.actions.startCampaign(i);
      });
      list.appendChild(card);
    });
    s.appendChild(list);
    s.appendChild(el('div', 'spacer'));
    this.open('campaignselect');
  }

  // ————— shop (hangar) —————

  showShop(): void {
    this.hideAll();
    const s = this.screen('shop');

    const header = el('div', 'row header');
    header.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', () => this.showMenu()));
    header.appendChild(el('div', 'grow'));
    header.appendChild(this.coinChip(this.save.data.coins));
    s.appendChild(header);

    s.appendChild(el('h2', 'heading', S.shopTitle));
    s.appendChild(el('div', 'subheading', S.shopSub));

    const list = el('div', 'scroll list');
    for (const def of META_DEFS) {
      const lvl = metaLevel(this.save.data, def.id);
      const row = el('div', 'panel shop-row');
      row.style.setProperty('--i', String(META_DEFS.indexOf(def)));

      const icon = el('div', 'icon-wrap');
      icon.appendChild(paintIcon(def.icon, '#35f0ff', 38));
      row.appendChild(icon);

      const body = el('div', 'grow');
      body.appendChild(el('div', 'item-name', def.name));
      body.appendChild(el('div', 'item-desc', def.desc));
      body.appendChild(this.pips(lvl, def.max));
      row.appendChild(body);

      if (lvl >= def.max) {
        row.appendChild(el('span', 'maxed', S.max));
      } else {
        const cost = metaCost(def, lvl);
        const afford = this.save.data.coins >= cost;
        const buy = this.btn(String(cost), `buy small${afford ? '' : ' locked'}`, () => {
          if (this.save.data.coins < cost) {
            this.audio.play('deny');
            return;
          }
          this.save.data.coins -= cost;
          this.save.data.meta[def.id] = lvl + 1;
          this.save.persist();
          this.audio.play('buy');
          this.showShop();
        });
        buy.prepend(el('span', 'coin-dot'));
        row.appendChild(buy);
      }
      list.appendChild(row);
    }
    s.appendChild(list);
    this.open('shop');
  }

  // ————— codex (in-game encyclopedia) —————

  showCodex(): void {
    this.hideAll();
    const s = this.screen('codex');

    const header = el('div', 'row header');
    header.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', () => this.showMenu()));
    s.appendChild(header);

    s.appendChild(el('h2', 'heading', S.codex));
    s.appendChild(el('div', 'subheading', CODEX_INTRO));

    const tabs = el('div', 'row codex-tabs');
    for (const cat of CODEX) {
      tabs.appendChild(this.codexTabBtn(cat.label, cat.id === this.codexTab, () => {
        if (this.codexTab === cat.id) return;
        this.codexTab = cat.id;
        this.showCodex();
      }));
    }
    s.appendChild(tabs);
    this.scrollActiveTabIntoView(tabs);

    const active = CODEX.find((c) => c.id === this.codexTab) ?? CODEX[0];
    const list = el('div', 'scroll list codex-list');
    list.appendChild(el('div', 'codex-cat-intro', active.intro));
    active.entries.forEach((entry, i) => list.appendChild(this.codexCard(entry, i)));
    s.appendChild(list);
    this.open('codex');
  }

  /** Tabs overflow horizontally; without this the active one can scroll out
   * of sight and the bar looks like nothing is selected. */
  private scrollActiveTabIntoView(tabs: HTMLElement): void {
    tabs.querySelector('.tab.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  private codexTabBtn(label: string, active: boolean, onTap: () => void): HTMLButtonElement {
    const b = el('button', `tab${active ? ' active' : ''}`, label);
    b.addEventListener('pointerdown', () => this.audio.play('tap'));
    b.addEventListener('click', onTap);
    return b;
  }

  private codexCard(entry: CodexEntry, i: number): HTMLElement {
    const card = el('div', 'panel codex-card');
    card.style.setProperty('--i', String(i));
    card.style.setProperty('--accent', entry.accent);

    const head = el('button', 'codex-card-head');
    const icon = el('div', 'icon-wrap');
    icon.appendChild(entry.icon);
    head.appendChild(icon);

    const body = el('div', 'grow');
    body.appendChild(el('div', 'item-name', entry.name));
    body.appendChild(el('div', 'item-desc', entry.tagline));
    head.appendChild(body);
    head.appendChild(el('span', 'codex-chevron', '›'));
    head.addEventListener('click', () => {
      this.audio.play('tap');
      card.classList.toggle('open');
    });
    card.appendChild(head);

    const details = el('div', 'codex-card-body');
    details.appendChild(el('p', 'codex-lore', entry.lore));
    if (entry.tactic) {
      const tactic = el('div', 'codex-tactic');
      tactic.appendChild(el('span', 'codex-tactic-label', 'TÁTICA'));
      tactic.appendChild(el('p', 'codex-tactic-text', entry.tactic));
      details.appendChild(tactic);
    }
    const grid = el('div', 'codex-stat-grid');
    for (const stat of entry.stats) {
      const row = el('div', 'codex-stat');
      row.appendChild(el('span', 'codex-stat-label', stat.label));
      row.appendChild(el('span', 'codex-stat-value', stat.value));
      grid.appendChild(row);
    }
    details.appendChild(grid);
    card.appendChild(details);

    return card;
  }

  // ————— settings —————

  showSettings(): void {
    this.hideAll();
    const s = this.screen('settings');

    const header = el('div', 'row header');
    header.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', () => this.showMenu()));
    s.appendChild(header);

    s.appendChild(el('h2', 'heading', S.settings));

    const cfg = this.save.data.settings;
    const list = el('div', 'col list');
    const toggles: Array<[string, () => boolean, (v: boolean) => void]> = [
      [S.sound, () => cfg.sfx, (v) => { cfg.sfx = v; }],
      [S.music, () => cfg.music, (v) => { cfg.music = v; }],
      [S.haptics, () => cfg.haptics, (v) => { cfg.haptics = v; }],
      [S.lowFx, () => cfg.lowFx, (v) => { cfg.lowFx = v; }],
    ];
    for (const [label, get, set] of toggles) {
      list.appendChild(this.toggleRow(label, get, set));
    }
    s.appendChild(list);

    const info = el('div', 'subheading stats-line',
      `${S.runs}: ${this.save.data.runs} · ${S.totalKills}: ${this.save.data.totalKills}`);
    s.appendChild(info);

    s.appendChild(this.btn(S.tutReplay, 'ghost', () => this.actions.startTutorial()));

    s.appendChild(this.btn(S.resetData, 'danger', () => {
      this.confirm(S.resetConfirm, () => {
        this.save.reset();
        this.actions.applySettings();
        this.showSettings();
      });
    }));

    s.appendChild(el('div', 'version', S.version));
    this.open('settings');
  }

  private toggleRow(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const row = el('div', 'panel toggle-row');
    row.appendChild(el('span', 'grow item-name', label));
    const toggle = el('button', `toggle${get() ? ' on' : ''}`);
    toggle.setAttribute('role', 'switch');
    toggle.appendChild(el('span', 'knob'));
    toggle.addEventListener('click', () => {
      set(!get());
      toggle.classList.toggle('on', get());
      this.save.persist();
      this.actions.applySettings();
      this.audio.play('tap');
    });
    row.appendChild(toggle);
    return row;
  }

  // ————— confirm dialog —————

  confirm(message: string, onYes: () => void, yesLabel: string = S.resetYes): void {
    const s = this.screen('confirm');
    const panel = el('div', 'panel dialog');
    panel.appendChild(el('p', 'dialog-text', message));
    const row = el('div', 'row gap');
    row.appendChild(this.btn(S.cancel, 'ghost small grow', () => this.close('confirm')));
    row.appendChild(this.btn(yesLabel, 'danger small grow', () => {
      this.close('confirm');
      onYes();
    }));
    panel.appendChild(row);
    s.appendChild(panel);
    this.open('confirm');
  }

  // ————— in-game overlay —————

  showGameOverlay(): void {
    if (!this.pauseBtn) {
      const b = el('button', 'pausebtn');
      b.appendChild(el('span', 'pause-bar'));
      b.appendChild(el('span', 'pause-bar'));
      b.addEventListener('click', () => {
        this.audio.play('tap');
        this.actions.pauseRun();
      });
      this.root.appendChild(b);
      this.pauseBtn = b;
    }
    this.pauseBtn.classList.add('on');
  }

  hideGameOverlay(): void {
    this.pauseBtn?.classList.remove('on');
  }

  // ————— pause —————

  showPause(): void {
    const s = this.screen('pause');
    s.appendChild(el('h2', 'heading big', S.paused));
    const col = el('div', 'col actions');
    col.appendChild(this.btn(S.resume, 'primary', () => {
      this.close('pause');
      this.actions.resumeRun();
    }));
    col.appendChild(this.btn(S.restart, 'ghost', () => {
      this.close('pause');
      this.actions.restartRun();
    }));
    col.appendChild(this.btn(S.menu, 'ghost', () => {
      this.close('pause');
      this.actions.quitToMenu();
    }));
    s.appendChild(col);

    const cfg = this.save.data.settings;
    const quick = el('div', 'col list narrow');
    quick.appendChild(this.toggleRow(S.sound, () => cfg.sfx, (v) => { cfg.sfx = v; }));
    quick.appendChild(this.toggleRow(S.music, () => cfg.music, (v) => { cfg.music = v; }));
    s.appendChild(quick);
    this.open('pause');
  }

  // ————— level up —————

  showLevelUp(
    choices: UpgradeDef[],
    levelOf: (id: string) => number,
    onPick: (def: UpgradeDef) => void,
  ): void {
    const s = this.screen('levelup');
    s.appendChild(el('h2', 'heading glow', S.levelUpTitle));
    s.appendChild(el('div', 'subheading', S.levelUpSub));

    const cards = el('div', 'col cards');
    choices.forEach((def, i) => {
      const lvl = levelOf(def.id);
      const card = el('button', 'card');
      card.style.setProperty('--i', String(i));
      card.style.setProperty('--accent', def.color);

      const icon = el('div', 'icon-wrap');
      icon.appendChild(paintIcon(def.icon, def.color, 44));
      card.appendChild(icon);

      const body = el('div', 'grow');
      const nameRow = el('div', 'row');
      nameRow.appendChild(el('span', 'item-name', def.name));
      body.appendChild(nameRow);
      body.appendChild(this.pips(lvl, def.max, true));
      body.appendChild(el('div', 'item-desc', def.desc(lvl + 1)));
      card.appendChild(body);

      card.addEventListener('pointerdown', () => this.audio.play('tap'));
      card.addEventListener('click', () => {
        card.classList.add('picked');
        setTimeout(() => {
          this.close('levelup');
          onPick(def);
        }, 150);
      }, { once: true });
      cards.appendChild(card);
    });
    s.appendChild(cards);
    this.open('levelup');
  }

  // ————— co-op: menu, lobby, level-up não-bloqueante, relatório —————

  showCoopMenu(opts: CoopMenuOpts): void {
    this.hideAll();
    const s = this.screen('coopmenu');

    const header = el('div', 'row header');
    header.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', opts.onBack));
    s.appendChild(header);

    s.appendChild(el('div', 'spacer'));
    s.appendChild(el('h2', 'heading glow', S.coopTitle));
    s.appendChild(el('div', 'subheading', S.coopSub));

    const col = el('div', 'col actions coop-actions');
    col.appendChild(this.btn(S.coopCreate, 'primary big', () => {
      this.audio.play('confirm');
      opts.onCreate();
    }));

    const joinRow = el('div', 'row gap coop-join-row');
    const input = el('input', 'input coop-code');
    input.type = 'text';
    input.maxLength = ROOM_CODE_LEN;
    input.placeholder = S.coopCodePlaceholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', () => {
      input.value = normalizeRoomCode(input.value);
    });
    const join = this.btn(S.coopJoin, 'primary', () => {
      if (input.value.length === ROOM_CODE_LEN) opts.onJoin(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.length === ROOM_CODE_LEN) opts.onJoin(input.value);
    });
    joinRow.appendChild(input);
    joinRow.appendChild(join);
    col.appendChild(joinRow);
    s.appendChild(col);

    const status = el('div', 'subheading coop-status');
    s.appendChild(status);
    s.appendChild(el('div', 'spacer'));
    this.open('coopmenu');
  }

  /** Update the status line on the co-op menu (connecting / errors). */
  coopStatus(text: string): void {
    const s = this.screens.get('coopmenu');
    const status = s?.querySelector('.coop-status');
    if (status) status.textContent = text;
  }

  showCoopLobby(view: CoopLobbyView): void {
    this.hideAll();
    const s = this.screen('cooplobby');

    const header = el('div', 'row header');
    header.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', view.onLeave));
    s.appendChild(header);

    s.appendChild(el('div', 'spacer'));
    s.appendChild(el('h2', 'heading', S.coopLobbyTitle));

    const codeBox = el('div', 'panel coop-code-panel');
    codeBox.appendChild(el('div', 'subheading', S.coopLobbyShare));
    codeBox.appendChild(el('div', 'coop-code-big', view.code));
    s.appendChild(codeBox);

    const list = el('div', 'col list narrow coop-slots');
    for (let slot = 0; slot < 2; slot++) {
      const p = view.players.find((x) => x.slot === slot);
      const row = el('div', `panel coop-slot${p ? '' : ' empty'}`);
      if (p) {
        row.appendChild(el('span', 'item-name grow', p.name));
        const tags = el('span', 'coop-tags');
        if (slot === view.localSlot) tags.appendChild(el('span', 'chip small', S.coopSlotYou));
        if (slot === view.hostSlot) tags.appendChild(el('span', 'chip small', S.coopSlotHost));
        if (p.ready && slot !== view.hostSlot) tags.appendChild(el('span', 'chip small ready', S.coopReady));
        row.appendChild(tags);
      } else {
        row.appendChild(el('span', 'item-desc grow', S.coopWaitingPartner));
      }
      list.appendChild(row);
    }
    s.appendChild(list);

    const col = el('div', 'col actions');
    const isHost = view.localSlot === view.hostSlot;
    if (isHost) {
      const others = view.players.filter((p) => p.slot !== view.hostSlot);
      const allReady = others.every((p) => p.ready);
      const start = this.btn(S.coopStart, `primary big${allReady ? '' : ' locked'}`, () => {
        if (allReady) view.onStart();
      });
      col.appendChild(start);
      if (others.length === 0) col.appendChild(el('div', 'subheading', S.coopWaitingPartner));
    } else {
      col.appendChild(this.btn(view.ready ? S.coopUnready : S.coopReady, view.ready ? 'ghost' : 'primary big', () => {
        view.onReady(!view.ready);
      }));
      col.appendChild(el('div', 'subheading', S.coopWaitingHost));
    }
    s.appendChild(col);
    s.appendChild(el('div', 'spacer'));
    this.open('cooplobby');
  }

  private coopLevelUpTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Non-blocking level-up sheet: the match keeps running behind it. If the
   * pilot dawdles past the server deadline, the first option is auto-picked
   * (matching the server's own timeout behavior).
   */
  showLevelUpCoop(
    choices: UpgradeDef[],
    levelOf: (id: string) => number,
    seconds: number,
    onPick: (def: UpgradeDef) => void,
  ): void {
    this.hideLevelUpCoop();
    const s = this.screen('levelupcoop');
    s.appendChild(el('div', 'grow'));

    const sheet = el('div', 'coop-sheet');
    sheet.appendChild(el('div', 'coop-sheet-title', S.coopChooseUpgrade));

    const timerBar = el('div', 'coop-timer');
    const timerFill = el('div', 'coop-timer-fill');
    timerBar.appendChild(timerFill);
    sheet.appendChild(timerBar);

    const pick = (def: UpgradeDef): void => {
      this.hideLevelUpCoop();
      onPick(def);
    };

    const cards = el('div', 'row coop-cards');
    for (const def of choices) {
      const lvl = levelOf(def.id);
      const card = el('button', 'card coop-card');
      card.style.setProperty('--accent', def.color);
      const icon = el('div', 'icon-wrap');
      icon.appendChild(paintIcon(def.icon, def.color, 34));
      card.appendChild(icon);
      const body = el('div', 'grow');
      body.appendChild(el('div', 'item-name', def.name));
      body.appendChild(this.pips(lvl, def.max, true));
      body.appendChild(el('div', 'item-desc', def.desc(lvl + 1)));
      card.appendChild(body);
      card.addEventListener('pointerdown', () => this.audio.play('tap'));
      card.addEventListener('click', () => pick(def), { once: true });
      cards.appendChild(card);
    }
    sheet.appendChild(cards);
    s.appendChild(sheet);

    const deadline = performance.now() + seconds * 1000;
    this.coopLevelUpTimer = setInterval(() => {
      const left = deadline - performance.now();
      timerFill.style.width = `${Math.max(0, (left / (seconds * 1000)) * 100)}%`;
      if (left <= 0) pick(choices[0]);
    }, 100);

    this.open('levelupcoop');
  }

  hideLevelUpCoop(): void {
    if (this.coopLevelUpTimer) clearInterval(this.coopLevelUpTimer);
    this.coopLevelUpTimer = null;
    this.close('levelupcoop');
  }

  showCoopGameOver(results: EndResult[], localSlot: number, onMenu: () => void): void {
    this.hideGameOverlay();
    this.hideLevelUpCoop();
    const s = this.screen('gameover');
    s.appendChild(el('h2', 'heading gameover-title', S.coopEndTitle));

    const mine = results.find((r) => r.slot === localSlot);
    const pot = results.reduce((sum, r) => sum + r.coinsEarned, 0);

    for (const r of results.slice().sort((a, b) => a.slot - b.slot)) {
      const panel = el('div', 'panel results coop-result');
      const title = el('div', 'row result-row');
      title.appendChild(el('span', 'grow item-name', r.slot === localSlot ? `${r.name} · ${S.coopSlotYou}` : r.name));
      panel.appendChild(title);
      const addRow = (label: string, value: string): void => {
        const row = el('div', 'row result-row');
        row.appendChild(el('span', 'grow item-desc', label));
        row.appendChild(el('span', 'result-value', value));
        panel.appendChild(row);
      };
      addRow(S.score, String(r.score));
      addRow(S.kills, String(r.kills));
      s.appendChild(panel);
    }

    const shared = el('div', 'panel results');
    const potRow = el('div', 'row result-row');
    potRow.appendChild(el('span', 'grow item-desc', `${S.waveReached}: ${results[0]?.wave ?? 1} · ${S.timeSurvived}: ${fmtTime(results[0]?.time ?? 0)}`));
    shared.appendChild(potRow);
    const coinsRow = el('div', 'row result-row coins-row');
    coinsRow.appendChild(el('span', 'grow item-desc', `${S.coopPot}: ${pot} · ${S.coopYourShare}`));
    coinsRow.appendChild(el('span', 'coin-dot'));
    const coinsEl = el('span', 'result-value amber', '0');
    coinsRow.appendChild(coinsEl);
    shared.appendChild(coinsRow);
    this.countUp(coinsEl, mine?.coinsEarned ?? 0, 1.2, '+');
    s.appendChild(shared);

    const col = el('div', 'col actions');
    col.appendChild(this.btn(S.menu, 'primary', onMenu));
    s.appendChild(col);
    this.open('gameover');
  }

  // ————— game over —————

  showGameOver(stats: RunStats): void {
    this.hideGameOverlay();
    const s = this.screen('gameover');
    s.appendChild(el('h2', 'heading gameover-title', S.gameOver));
    const recordNames: string[] = [];
    if (stats.records.wave) recordNames.push(S.recordWave);
    if (stats.records.score) recordNames.push(S.recordScore);
    if (stats.records.time) recordNames.push(S.recordTime);
    if (stats.records.coins) recordNames.push(S.recordCoins);
    if (recordNames.length > 0) {
      s.appendChild(el('div', 'record-badge', `${S.newRecord} ${recordNames.join(' · ')}`));
    }

    const panel = el('div', 'panel results');
    const addRow = (label: string, value: string): HTMLElement => {
      const row = el('div', 'row result-row');
      row.appendChild(el('span', 'grow item-desc', label));
      const v = el('span', 'result-value', value);
      row.appendChild(v);
      panel.appendChild(row);
      return v;
    };
    addRow(S.waveReached, String(stats.wave));
    addRow(S.kills, String(stats.kills));
    addRow(S.timeSurvived, fmtTime(stats.time));
    const scoreEl = addRow(S.score, '0');
    this.countUp(scoreEl, stats.score, 1);

    const coinsRow = el('div', 'row result-row coins-row');
    coinsRow.appendChild(el('span', 'grow item-desc', S.coinsEarned));
    coinsRow.appendChild(el('span', 'coin-dot'));
    const coinsEl = el('span', 'result-value amber', '0');
    coinsRow.appendChild(coinsEl);
    panel.appendChild(coinsRow);
    this.countUp(coinsEl, stats.coins, 1.2, '+');

    s.appendChild(panel);

    const col = el('div', 'col actions');
    col.appendChild(this.btn(S.playAgain, 'primary', () => this.actions.restartRun()));
    if (session.authed) {
      col.appendChild(this.btn(S.viewRanking, 'ghost', () => this.showLeaderboard()));
    }
    col.appendChild(this.btn(S.menu, 'ghost', () => this.actions.quitToMenu()));
    s.appendChild(col);
    this.open('gameover');
  }

  showLevelComplete(stats: LevelStats): void {
    this.hideGameOverlay();
    const s = this.screen('levelcomplete');
    const level = CAMPAIGN[stats.levelIndex];
    s.appendChild(el('h2', 'heading gameover-title', stats.cleared ? S.levelClearTitle : S.levelFailedTitle));
    s.appendChild(el('div', 'subheading', level.name));

    const panel = el('div', 'panel results');
    const addRow = (label: string, value: string): HTMLElement => {
      const row = el('div', 'row result-row');
      row.appendChild(el('span', 'grow item-desc', label));
      const v = el('span', 'result-value', value);
      row.appendChild(v);
      panel.appendChild(row);
      return v;
    };
    addRow(S.kills, String(stats.kills));
    addRow(S.timeSurvived, fmtTime(stats.time));

    const coinsRow = el('div', 'row result-row coins-row');
    coinsRow.appendChild(el('span', 'grow item-desc', S.coinsEarned));
    coinsRow.appendChild(el('span', 'coin-dot'));
    const coinsEl = el('span', 'result-value amber', '0');
    coinsRow.appendChild(coinsEl);
    panel.appendChild(coinsRow);
    this.countUp(coinsEl, stats.coins, 1.2, '+');
    s.appendChild(panel);

    const col = el('div', 'col actions');
    const hasNext = stats.cleared && stats.levelIndex + 1 < CAMPAIGN.length;
    if (hasNext) {
      col.appendChild(this.btn(S.nextLevel, 'primary', () => this.actions.startCampaign(stats.levelIndex + 1)));
    }
    col.appendChild(this.btn(
      stats.cleared ? S.playAgain : S.tryAgain,
      hasNext ? 'ghost' : 'primary',
      () => this.actions.startCampaign(stats.levelIndex),
    ));
    col.appendChild(this.btn(S.menu, 'ghost', () => this.actions.quitToMenu()));
    s.appendChild(col);
    this.open('levelcomplete');
  }

  // ————— pilot name —————

  showNamePrompt(opts: NamePromptOpts): void {
    this.hideAll();
    const s = this.screen('name');

    const panel = el('div', 'panel dialog name-panel');
    panel.appendChild(el('h2', 'heading', S.nameTitle));
    panel.appendChild(el('div', 'subheading', S.nameSub));

    const input = el('input', 'input');
    input.type = 'text';
    input.maxLength = NAME_MAX;
    input.placeholder = S.namePlaceholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = opts.initial ?? '';
    panel.appendChild(input);

    const error = el('div', 'input-error');
    panel.appendChild(error);

    const confirm = this.btn(S.confirmYes, 'primary', () => void submit());
    const validate = (): string | null => {
      const err = nameError(sanitizeName(input.value));
      switch (err) {
        case 'short': return S.nameTooShort;
        case 'long': return S.nameTooLong;
        case 'invalid': return S.nameInvalid;
        case 'profane': return S.nameProfane;
        default: return null;
      }
    };
    const refresh = (): void => {
      const msg = input.value.trim() === '' ? S.nameTooShort : validate();
      error.textContent = msg && input.value !== '' ? msg : '';
      confirm.disabled = msg !== null;
      confirm.classList.toggle('locked', msg !== null);
    };
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !confirm.disabled) void submit();
    });

    let busy = false;
    const submit = async (): Promise<void> => {
      if (busy || validate() !== null) return;
      busy = true;
      confirm.classList.add('locked');
      const result = await opts.onDone(sanitizeName(input.value));
      busy = false;
      confirm.classList.remove('locked');
      if (result !== null) error.textContent = result;
    };

    const row = el('div', 'row gap name-actions');
    if (opts.onCancel) {
      row.appendChild(this.btn(S.cancel, 'ghost small grow', opts.onCancel));
    }
    confirm.classList.add('grow');
    row.appendChild(confirm);
    panel.appendChild(row);

    s.appendChild(panel);
    refresh();
    this.open('name');
    setTimeout(() => input.focus(), 350);
  }

  // ————— login —————

  showLogin(opts: LoginOpts): void {
    this.hideAll();
    const s = this.screen('login');

    const panel = el('div', 'panel dialog login-panel');
    panel.appendChild(el('h2', 'heading', S.loginTitle));
    panel.appendChild(el('div', 'subheading', S.loginSub));

    const status = el('div', 'login-status');
    const wrap = el('div', 'gsi-wrap');
    this.renderGoogleButton(wrap, status, opts.onDone);
    panel.appendChild(wrap);
    panel.appendChild(status);

    const col = el('div', 'col login-actions');
    if (opts.onSkip) {
      col.appendChild(this.btn(S.continueGuest, 'ghost', opts.onSkip));
      panel.appendChild(col);
      panel.appendChild(el('div', 'subheading login-note', S.loginGuestNote));
    } else {
      col.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', () => this.showMenu()));
      panel.appendChild(col);
    }

    s.appendChild(panel);
    this.open('login');
  }

  private renderGoogleButton(wrap: HTMLElement, status: HTMLElement, onDone: () => void): void {
    const gsi = window.google?.accounts.id;
    if (!gsi || typeof __GOOGLE_CLIENT_ID__ === 'undefined' || !__GOOGLE_CLIENT_ID__) {
      wrap.appendChild(el('div', 'login-unavailable', S.loginUnavailable));
      return;
    }
    gsi.initialize({
      client_id: __GOOGLE_CLIENT_ID__,
      callback: (resp) => {
        status.textContent = S.loginLoading;
        session.loginWithGoogle(resp.credential)
          .then(() => {
            this.audio.play('confirm');
            status.textContent = '';
            onDone();
          })
          .catch(() => {
            status.textContent = S.loginError;
          });
      },
    });
    gsi.renderButton(wrap, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      locale: 'pt-BR',
      width: 280,
    });
  }

  // ————— leaderboard —————

  showLeaderboard(): void {
    this.hideAll();
    const s = this.screen('leaderboard');

    const header = el('div', 'row header');
    header.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', () => this.showMenu()));
    s.appendChild(header);

    s.appendChild(el('h2', 'heading', S.rankTitle));

    const tabs = el('div', 'row codex-tabs lb-tabs');
    const boards: Array<[BoardKind, string]> = [
      ['wave', S.rankWave],
      ['coins', S.rankCoins],
      ['time', S.rankTime],
    ];
    for (const [id, label] of boards) {
      tabs.appendChild(this.codexTabBtn(label, id === this.lbTab, () => {
        if (this.lbTab === id) return;
        this.lbTab = id;
        this.showLeaderboard();
      }));
    }
    s.appendChild(tabs);
    this.scrollActiveTabIntoView(tabs);

    const list = el('div', 'scroll list lb-list');
    s.appendChild(list);
    this.open('leaderboard');
    void this.loadLeaderboard(list);
  }

  private async loadLeaderboard(list: HTMLElement): Promise<void> {
    const board = this.lbTab;
    list.innerHTML = '';
    list.appendChild(el('div', 'subheading', S.loading));
    try {
      const res = await api.leaderboard(board);
      if (this.lbTab !== board || !list.isConnected) return;
      list.innerHTML = '';
      if (res.entries.length === 0) {
        list.appendChild(el('div', 'subheading', S.rankEmpty));
      }
      const myHandle = session.player?.handle;
      let meListed = false;
      res.entries.forEach((entry, i) => {
        const mine = entry.handle === myHandle;
        meListed = meListed || mine;
        list.appendChild(this.lbRow(entry, board, mine, i));
      });
      if (session.authed && session.player && res.me && !meListed) {
        list.appendChild(this.lbRow({
          rank: res.me.rank,
          handle: session.player.handle,
          name: session.player.name,
          value: res.me.value,
        }, board, true, res.entries.length));
      }
      if (!session.authed) {
        list.appendChild(this.btn(S.rankGuestCta, 'ghost', () => {
          this.showLogin({ onDone: () => this.showLeaderboard() });
        }));
      }
    } catch {
      if (this.lbTab !== board || !list.isConnected) return;
      list.innerHTML = '';
      list.appendChild(el('div', 'subheading', S.netError));
      list.appendChild(this.btn(S.retry, 'ghost small', () => void this.loadLeaderboard(list)));
    }
  }

  private lbRow(entry: LeaderboardEntry, board: BoardKind, mine: boolean, i: number): HTMLElement {
    const row = el('button', `panel lb-row${mine ? ' lb-me' : ''}`);
    row.style.setProperty('--i', String(Math.min(i, 12)));
    row.appendChild(el('span', `lb-rank${entry.rank <= 3 ? ' top' : ''}`, `#${entry.rank}`));
    row.appendChild(el('span', 'grow lb-name', entry.name));
    if (mine) row.appendChild(el('span', 'chip lb-you', S.rankYou));
    row.appendChild(el('span', 'lb-value', board === 'time' ? fmtTime(entry.value) : String(entry.value)));
    row.addEventListener('pointerdown', () => this.audio.play('tap'));
    row.addEventListener('click', () => this.showProfile(entry.handle, 'leaderboard'));
    return row;
  }

  // ————— profile —————

  showProfile(handle?: string, backTo: 'menu' | 'leaderboard' = 'menu'): void {
    this.hideAll();
    const s = this.screen('profile');
    const own = handle === undefined || handle === session.player?.handle;
    const target = handle ?? session.player?.handle;

    const goBack = (): void => {
      if (backTo === 'leaderboard') this.showLeaderboard();
      else this.showMenu();
    };
    const header = el('div', 'row header');
    header.appendChild(this.btn(`‹ ${S.back}`, 'ghost small', goBack));
    s.appendChild(header);

    s.appendChild(el('h2', 'heading', S.profileTitle));

    const body = el('div', 'scroll list profile-body');
    s.appendChild(body);
    this.open('profile');

    if (!target) {
      body.appendChild(el('div', 'subheading', S.profileNotFound));
      return;
    }
    void this.loadProfile(body, target, own);
  }

  private async loadProfile(body: HTMLElement, handle: string, own: boolean): Promise<void> {
    body.appendChild(el('div', 'subheading', S.loading));
    let profile: ProfileResponse;
    try {
      profile = await api.profile(handle);
    } catch (e) {
      if (!body.isConnected) return;
      body.innerHTML = '';
      const missing = e instanceof ApiError && e.status === 404;
      body.appendChild(el('div', 'subheading', missing ? S.profileNotFound : S.netError));
      if (!missing) {
        body.appendChild(this.btn(S.retry, 'ghost small', () => {
          body.innerHTML = '';
          void this.loadProfile(body, handle, own);
        }));
      }
      return;
    }
    if (!body.isConnected) return;
    body.innerHTML = '';

    const head = el('div', 'panel profile-head');
    head.appendChild(el('div', 'profile-name', profile.name));
    head.appendChild(el('div', 'profile-handle', `@${profile.handle}`));
    head.appendChild(el('div', 'profile-since', `${S.memberSince} ${fmtMonthYear(profile.createdAt)}`));
    body.appendChild(head);

    const ranks = el('div', 'row chips profile-ranks');
    const rankChip = (label: string, rank: number | null): HTMLElement =>
      el('span', `chip${rank !== null && rank <= 3 ? ' chip-coins' : ''}`,
        `${label} ${rank !== null ? `#${rank}` : '—'}`);
    ranks.appendChild(rankChip(S.rankWave, profile.ranks.wave));
    ranks.appendChild(rankChip(S.rankCoins, profile.ranks.coins));
    ranks.appendChild(rankChip(S.rankTime, profile.ranks.time));
    body.appendChild(ranks);

    const grid = el('div', 'panel results profile-grid');
    const addRow = (label: string, value: string): void => {
      const row = el('div', 'row result-row');
      row.appendChild(el('span', 'grow item-desc', label));
      row.appendChild(el('span', 'result-value', value));
      grid.appendChild(row);
    };
    addRow(S.bestWave, profile.stats.bestWave > 0 ? String(profile.stats.bestWave) : '—');
    addRow(S.bestScoreL, String(profile.stats.bestScore));
    addRow(S.bestTimeL, fmtTime(profile.stats.bestTime));
    addRow(S.bestCoinsL, String(profile.stats.bestCoins));
    addRow(S.runs, String(profile.stats.runs));
    addRow(S.totalKills, String(profile.stats.totalKills));
    addRow(S.totalTimeL, fmtLongTime(profile.stats.totalTime));
    body.appendChild(grid);

    if (own && session.authed) {
      const col = el('div', 'col profile-actions');
      col.appendChild(this.btn(S.editName, 'ghost', () => this.editOwnName()));
      col.appendChild(this.btn(S.logoutBtn, 'danger', () => {
        this.confirm(S.logoutConfirm, () => {
          void session.logout().then(() => this.showMenu());
        }, S.logoutYes);
      }));
      body.appendChild(col);
    }
  }

  private editOwnName(): void {
    this.showNamePrompt({
      initial: session.player?.name ?? this.save.data.name,
      onCancel: () => this.showProfile(),
      onDone: async (name) => {
        try {
          await session.rename(name);
          this.audio.play('confirm');
          this.showProfile();
          return null;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            return e.suggestion ? `${S.nameTaken} → ${e.suggestion}` : S.nameTaken;
          }
          return S.netError;
        }
      },
    });
  }

  // ————— transient elements —————

  banner(text: string, sub?: string, danger = false): void {
    const b = el('div', `banner${danger ? ' danger' : ''}`);
    b.appendChild(el('div', 'banner-text', text));
    if (sub) b.appendChild(el('div', 'banner-sub', sub));
    this.root.appendChild(b);
    setTimeout(() => b.remove(), 2200);
  }

  showTutorial(): void {
    if (this.tutorial) return;
    const t = el('div', 'tutorial');
    const hand = el('div', 'tutorial-hand');
    hand.appendChild(el('span', 'tutorial-dot'));
    t.appendChild(hand);
    t.appendChild(el('div', 'tutorial-text', S.tutorialMove));
    t.appendChild(el('div', 'tutorial-sub', S.tutorialAuto));
    this.root.appendChild(t);
    this.tutorial = t;
  }

  hideTutorial(): void {
    if (!this.tutorial) return;
    const t = this.tutorial;
    this.tutorial = null;
    t.classList.add('off');
    setTimeout(() => t.remove(), 500);
  }

  // ————— guided tutorial overlay —————

  /** Show/update the instructor bubble (guided tutorial steps). */
  tutorialSay(title: string, sub?: string): void {
    if (!this.tutBubble) {
      const b = el('div', 'tut-bubble');
      this.tutBubbleTitle = el('div', 'tut-bubble-title');
      this.tutBubbleSub = el('div', 'tut-bubble-sub');
      b.appendChild(this.tutBubbleTitle);
      b.appendChild(this.tutBubbleSub);
      this.root.appendChild(b);
      this.tutBubble = b;
    }
    this.tutBubbleTitle!.textContent = title;
    this.tutBubbleSub!.textContent = sub ?? '';
    this.tutBubbleSub!.style.display = sub ? '' : 'none';
    // Retrigger the pop-in so each step visibly announces itself.
    this.tutBubble.classList.remove('pop');
    void this.tutBubble.offsetWidth;
    this.tutBubble.classList.add('pop');
    this.audio.play('tap');
  }

  /** Update only the bubble's sub line (trial countdown). */
  tutorialSub(text: string): void {
    if (!this.tutBubbleSub) return;
    this.tutBubbleSub.textContent = text;
    this.tutBubbleSub.style.display = '';
  }

  hideTutorialBubble(): void {
    this.tutBubble?.remove();
    this.tutBubble = null;
    this.tutBubbleTitle = null;
    this.tutBubbleSub = null;
  }

  showTutorialSkip(onSkip: () => void): void {
    this.hideTutorialSkip();
    const b = this.btn(S.tutSkip, 'ghost small tut-skip', () => {
      this.confirm(S.tutSkipConfirm, onSkip, S.tutSkipYes);
    });
    this.root.appendChild(b);
    this.tutSkipBtn = b;
  }

  hideTutorialSkip(): void {
    this.tutSkipBtn?.remove();
    this.tutSkipBtn = null;
  }
}

// ————— formatting helpers —————

function fmtMonthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(d);
}

function fmtLongTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return fmtTime(s);
}
