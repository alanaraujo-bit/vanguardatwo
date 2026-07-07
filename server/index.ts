import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { normalizeRoomCode, parseMsg, PROTO_VER, type ClientMsg } from '../src/net/realtime';
import { verifyRealtimeToken } from './auth';
import { send, type Client } from './room';
import { Rooms } from './rooms';

/**
 * VANGUARDA realtime game server: one long-running Node process hosting the
 * authoritative co-op simulations. HTTP is only /healthz; everything else is
 * WebSocket. Deployed on Railway next to the Postgres.
 */

const PORT = Number(process.env.PORT ?? 8138);
/** Comma-separated allowed origins; unset = allow all (local dev). */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const rooms = new Rooms();
const sessions = new Set<Session>();

const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server: http,
  perMessageDeflate: true,
  maxPayload: 8 * 1024,
});

interface Session extends Client {
  helloDone: boolean;
  alive: boolean;
}

wss.on('connection', (ws: WebSocket, req) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length > 0 && (!origin || !ALLOWED_ORIGINS.includes(origin))) {
    ws.close(4003, 'origin');
    return;
  }

  const client: Session = {
    ws,
    name: 'PILOTO',
    guest: true,
    playerId: null,
    meta: {},
    room: null,
    slot: -1,
    lastSeq: 0,
    mx: 0,
    my: 0,
    helloDone: false,
    alive: true,
  };

  sessions.add(client);
  // Generous window: the client sends hello right after connecting (no more
  // async work in between as of the coopConnect reorder), but mobile
  // networks and TLS handshakes on a fresh connection can still be slow.
  const helloTimeout = setTimeout(() => {
    if (!client.helloDone) ws.close(4000, 'hello timeout');
  }, 10_000);

  ws.on('pong', () => {
    client.alive = true;
  });

  ws.on('message', (data) => {
    void handleMessage(client, data.toString());
  });

  ws.on('close', () => {
    clearTimeout(helloTimeout);
    sessions.delete(client);
    client.room?.leave(client);
  });

  ws.on('error', () => {
    ws.close();
  });
});

async function handleMessage(client: Session, raw: string): Promise<void> {
  const msg = parseMsg<ClientMsg>(raw);
  if (!msg) {
    send(client, { t: 'err', code: 'bad_msg' });
    return;
  }

  if (!client.helloDone) {
    if (msg.t !== 'hello') {
      send(client, { t: 'err', code: 'bad_msg' });
      client.ws.close(4000, 'hello first');
      return;
    }
    if (msg.ver !== PROTO_VER) {
      send(client, { t: 'err', code: 'version' });
      client.ws.close(4001, 'version');
      return;
    }
    if (msg.token) {
      const claims = await verifyRealtimeToken(msg.token);
      if (!claims) {
        send(client, { t: 'err', code: 'bad_token' });
        client.ws.close(4002, 'bad token');
        return;
      }
      client.guest = false;
      client.playerId = claims.playerId;
    }
    client.name = sanitizeName(msg.name);
    client.meta = sanitizeMeta(msg.meta);
    client.helloDone = true;
    return;
  }

  switch (msg.t) {
    case 'create': {
      if (client.room) client.room.leave(client);
      const room = rooms.create();
      room.join(client);
      break;
    }
    case 'join': {
      if (client.room) client.room.leave(client);
      const room = rooms.get(normalizeRoomCode(msg.code));
      if (!room) {
        send(client, { t: 'err', code: 'room_not_found' });
        return;
      }
      if (!room.join(client)) {
        send(client, { t: 'err', code: 'room_full' });
      }
      break;
    }
    case 'ready':
      client.room?.setReady(client, msg.ready === true);
      break;
    case 'start': {
      if (!client.room) {
        send(client, { t: 'err', code: 'not_in_room' });
        return;
      }
      const result = client.room.start(client);
      if (result !== 'ok') send(client, { t: 'err', code: result });
      break;
    }
    case 'input':
      client.room?.applyInput(client, msg.seq, msg.mx, msg.my);
      break;
    case 'pick':
      client.room?.applyPick(client, msg.offerId, msg.upgradeId);
      break;
    case 'ping':
      send(client, { t: 'pong', ts: msg.ts, tick: client.room?.simTick ?? 0 });
      break;
    case 'leave':
      client.room?.leave(client);
      break;
    default:
      send(client, { t: 'err', code: 'bad_msg' });
  }
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'PILOTO';
  const name = raw.trim().slice(0, 24);
  return name.length > 0 ? name : 'PILOTO';
}

/** Permanent-upgrade levels from the hello; clamped to sane bounds. */
function sanitizeMeta(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k.slice(0, 24)] = Math.max(0, Math.min(10, Math.floor(v)));
    }
  }
  return out;
}

// Reap dead connections (mobile tabs vanish without a close frame).
setInterval(() => {
  for (const s of sessions) {
    if (!s.alive) {
      s.ws.terminate();
      continue;
    }
    s.alive = false;
    s.ws.ping();
  }
}, 30_000).unref();

http.listen(PORT, () => {
  console.log(`[vanguarda-rt] listening on :${PORT}`);
});
