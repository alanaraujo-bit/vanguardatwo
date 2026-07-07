import type { SaveSystem } from '../core/save';
import { fmtTime } from '../core/utils';
import type { AudioEngine } from '../audio/audio';
import { S } from '../i18n/strings';
import { CODEX, CODEX_INTRO, type CodexCategoryId, type CodexEntry } from '../game/codex';
import { META_DEFS, metaCost, metaLevel } from '../game/meta';
import { paintIcon, type UpgradeDef } from '../game/upgrades';
import { api, ApiError } from '../net/api';
import { nameError, sanitizeName, NAME_MAX } from '../net/names';
import type { BoardKind, LeaderboardEntry, ProfileResponse } from '../net/protocol';
import { session } from '../net/session';

export interface RunStats {
  wave: number;
  kills: number;
  time: number;
  score: number;
  coins: number;
  records: { wave: boolean; score: boolean; time: boolean; coins: boolean };
}

export interface UiActions {
  startRun(): void;
  startTutorial(): void;
  pauseRun(): void;
  resumeRun(): void;
  restartRun(): void;
  quitToMenu(): void;
  applySettings(): void;
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
      this.actions.startRun();
    }));
    col.appendChild(this.btn(S.upgrades, 'ghost', () => this.showShop()));
    col.appendChild(this.btn(S.ranking, 'ghost', () => this.showLeaderboard()));
    col.appendChild(this.btn(S.codex, 'ghost', () => this.showCodex()));
    col.appendChild(this.btn(S.settings, 'ghost', () => this.showSettings()));
    s.appendChild(col);

    s.appendChild(el('div', 'version', S.version));
    this.open('menu');
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

    const active = CODEX.find((c) => c.id === this.codexTab) ?? CODEX[0];
    const list = el('div', 'scroll list codex-list');
    list.appendChild(el('div', 'codex-cat-intro', active.intro));
    active.entries.forEach((entry, i) => list.appendChild(this.codexCard(entry, i)));
    s.appendChild(list);
    this.open('codex');
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
