import { spawn } from 'node:child_process';
import WebSocket from 'ws';

/**
 * E2E do servidor de tempo real: sobe o processo, dois clientes fazem
 * hello → create/join por código → ready → start, jogam ~20s simulados
 * trocando inputs e recebendo snapshots, e o teste valida a forma de tudo.
 */

const PORT = 8151;
const server = spawn(process.execPath, ['server/dist/index.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => {
    if (String(d).includes('listening')) resolve();
  });
  server.on('exit', (code) => reject(new Error(`server saiu cedo (${code})`)));
  setTimeout(() => reject(new Error('server não subiu em 10s')), 10_000);
});

function connect(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { perMessageDeflate: true });
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  const api = {
    ws,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next: (type, timeout = 8000) =>
      new Promise((resolve, reject) => {
        const match = (m) => m.t === type;
        const hit = inbox.findIndex(match);
        if (hit >= 0) return resolve(inbox.splice(hit, 1)[0]);
        const w = { match, resolve };
        waiters.push(w);
        setTimeout(() => {
          const idx = waiters.indexOf(w);
          if (idx >= 0) {
            waiters.splice(idx, 1);
            reject(new Error(`${name}: timeout esperando '${type}'`));
          }
        }, timeout);
      }),
    collect: (type) => inbox.filter((m) => m.t === type),
  };
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(api));
    ws.on('error', reject);
  });
}

const fail = (msg) => {
  console.error(`SERVER SMOKE FAIL: ${msg}`);
  server.kill();
  process.exit(1);
};

try {
  const a = await connect('A');
  const b = await connect('B');

  a.send({ t: 'hello', ver: 1, name: 'Piloto A', meta: { hull: 2 } });
  b.send({ t: 'hello', ver: 1, name: 'Piloto B' });

  a.send({ t: 'create' });
  const welcomeA = await a.next('welcome');
  const roomA = await a.next('room');
  if (welcomeA.slot !== 0) fail(`host deveria ser slot 0, veio ${welcomeA.slot}`);
  console.log(`sala criada: ${roomA.code}`);

  b.send({ t: 'join', code: roomA.code.toLowerCase() }); // normalização de código
  const welcomeB = await b.next('welcome');
  if (welcomeB.slot !== 1) fail(`convidado deveria ser slot 1, veio ${welcomeB.slot}`);
  const roomB = await b.next('room');
  if (roomB.players.length !== 2) fail('room não mostra 2 jogadores');

  // Código inexistente é recusado educadamente.
  const c = await connect('C');
  c.send({ t: 'hello', ver: 1, name: 'Penetra' });
  c.send({ t: 'join', code: 'ZZZZZ' });
  const err = await c.next('err');
  if (err.code !== 'room_not_found') fail(`esperava room_not_found, veio ${err.code}`);
  c.ws.close();

  b.send({ t: 'ready', ready: true });
  await a.next('room'); // eco do ready
  a.send({ t: 'start' });
  await a.next('start');
  await b.next('start');
  console.log('partida iniciada');

  // ~6s de jogo: A circula, B fica parado; ambos devem receber snapshots.
  let seq = 0;
  const drive = setInterval(() => {
    const ang = Date.now() / 800;
    a.send({ t: 'input', seq: ++seq, mx: Math.cos(ang), my: Math.sin(ang) });
  }, 50);
  await new Promise((r) => setTimeout(r, 6000));
  clearInterval(drive);

  const snapA = await a.next('snap');
  const snapB = await b.next('snap');
  const snapsA = a.collect('snap').length;
  if (snapsA < 60) fail(`poucos snapshots em 6s: ${snapsA}`);
  if (snapA.s.players.length !== 2) fail('snapshot sem 2 players');
  if (snapA.s.ack <= 0) fail('ack de input não avançou');
  if (snapB.s.ack !== 0) fail('ack de B deveria ser 0 (não enviou input)');
  const pA = snapA.s.players[0];
  const moved = Math.abs(pA.x) + Math.abs(pA.y);
  if (moved < 30) fail(`player A não se moveu com os inputs (|x|+|y|=${moved})`);
  if (snapA.s.enemies.length % 6 !== 0) fail('stride de enemies inválido');
  if (snapA.s.enemies.length === 0) fail('nenhum inimigo no snapshot');
  if (snapA.s.tick <= 0) fail('tick não avança');

  const pings = a.collect('pong').length;
  a.send({ t: 'ping', ts: 123 });
  const pong = await a.next('pong');
  if (pong.ts !== 123) fail('pong não ecoou ts');
  void pings;

  const evCount = a.collect('snap').reduce((n, m) => n + m.s.ev.length, 0);
  console.log(`snapshots A: ${snapsA} | tick ${snapA.s.tick} | inimigos ${snapA.s.enemies.length / 6} | eventos acumulados ${evCount}`);
  console.log(`player A pos (${pA.x},${pA.y}) hp ${pA.hp}/${pA.maxHp} | ack ${snapA.s.ack}/${seq}`);

  a.ws.close();
  b.ws.close();
  console.log('SERVER SMOKE OK');
} catch (e) {
  fail(e.message);
} finally {
  server.kill();
}
