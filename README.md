# BALUARTE — Resista à Ruína

Arena survival roguelite premium para navegador, mobile-first, construído inteiramente do zero — sem engine, sem frameworks, sem assets externos. HTML5 + CSS3 + TypeScript + Canvas 2D + Web Audio, empacotado como PWA offline.

## O jogo

Você é o Baluarte: a última linha de defesa contra a Ruína, um enxame geométrico corrompido. Arraste o polegar para mover — o ataque é automático. Colete fragmentos, suba de nível e escolha melhorias aleatórias durante a partida. A cada cinco ondas, um Colosso aparece. Ao morrer, as moedas coletadas ficam com você e podem ser gastas no **Hangar** em melhorias permanentes.

- Sessões de 2–5 minutos, dificuldade crescente por ondas
- 13 melhorias de partida (perfurante, ricochete, lâminas orbitais, pulso nova, fragmentação...)
- 6 melhorias permanentes compradas com moedas
- Combo de abates multiplica o XP; recordes e progresso salvos localmente
- 6 tipos de inimigos + chefe com padrões de ataque próprios
- **CO-OP online 2P**: sala por código, servidor autoritativo, level-up sem pausa, revive por onda, moedas divididas 50/50
- Trilha sonora synthwave e efeitos 100% sintetizados em tempo real (nenhum arquivo de áudio)
- Toda a arte é vetorial-neon procedural, pré-renderizada em atlas na inicialização

## Rodando

```bash
npm install
npm run dev           # servidor local em http://127.0.0.1:8137
npm run dev:server    # game server de co-op em ws://127.0.0.1:8138
npm run build         # build de produção em dist/
npm run build:server  # bundle do game server em server/dist/
npm run typecheck     # verificação de tipos (cliente + api + server)
npm run icons         # regenera os ícones PWA (PNG codificado à mão, sem deps)

node scripts/smoke-sim.mjs     # smoke: simulação co-op headless (3 min simulados)
node scripts/smoke-server.mjs  # smoke: lobby + snapshots do game server
```

Publique o conteúdo de `dist/` em qualquer host estático (HTTPS habilita o modo offline/instalável). O game server de co-op (`server/`) é um processo Node long-running — deploy via `Dockerfile` na Railway, com `JWT_SECRET` (o mesmo da Vercel), `DATABASE_URL` e `ALLOWED_ORIGINS`; a Vercel builda o cliente com `WS_URL=wss://<serviço>.up.railway.app`.

## Arquitetura

```
src/
  core/    game loop (hit-stop, time scale), viewport (DPR/safe-area),
           input (joystick virtual + teclado), save (localStorage), pools
  fx/      sprites neon pré-renderizados, partículas aditivas,
           números flutuantes, fundo parallax infinito (hash determinístico)
  audio/   sintetizador de SFX (Web Audio) e sequenciador musical com lookahead
  game/    balance (todos os números de tuning), player, inimigos (spatial hash),
           projéteis, armas, coletáveis, ondas, upgrades, meta-progressão, HUD,
           GameScene (orquestração via interface World),
           sim.ts (CoopSim: o mesmo gameplay rodando headless no servidor),
           coop/ (CoopScene: predição local + interpolação + réplicas visuais)
  net/     api (fetch tipado), protocol (tipos HTTP compartilhados),
           realtime (protocolo WebSocket compartilhado), ws (socket do cliente)
  ui/      telas DOM (menu, hangar, ajustes, level-up, pausa, fim de jogo, co-op)
  i18n/    todo o texto do jogador em pt-BR
server/    game server autoritativo de co-op (Node + ws, 30Hz de sim,
           snapshots 15Hz, salas por código) — deploy na Railway
scripts/   build (esbuild), build-server, smokes de sim/servidor, ícones
public/    index.html, styles.css, manifest, service worker, ícones
```

Princípios: dependências de runtime **zero** (esbuild/tsc apenas em dev), zero alocação em hot paths (pools + spatial hash com buckets carimbados), sistemas comunicam-se pela interface `World` com a `GameScene` no centro. Código e comentários em inglês; toda a experiência do jogador em português brasileiro.
