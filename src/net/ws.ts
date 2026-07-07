import { parseMsg, PROTO_VER, SIM_RATE, type ClientMsg, type ServerMsg } from './realtime';

/**
 * Client side of the realtime socket: typed send/receive, RTT sampling and a
 * server-tick estimate for interpolation clocks. One instance per co-op
 * session, from lobby to end screen.
 */
export class CoopSocket {
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  /** Smoothed round-trip time, ms. */
  rttMs = 0;
  /** Bytes received (bandwidth telemetry). */
  rxBytes = 0;

  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = { tick: 0, at: 0 };

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
        resolve();
      };
      ws.onerror = () => reject(new Error('ws connect failed'));
      ws.onclose = () => {
        this.dispose();
        this.onClose();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        this.rxBytes += ev.data.length;
        const msg = parseMsg<ServerMsg>(ev.data);
        if (!msg) return;
        if (msg.t === 'pong') {
          const rtt = performance.now() - msg.ts;
          this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.8 + rtt * 0.2;
          this.lastPong = { tick: msg.tick + ((rtt / 2) / 1000) * SIM_RATE, at: performance.now() };
        }
        this.onMessage(msg);
      };
    });
  }

  hello(name: string, token: string | null, meta: Record<string, number>): void {
    this.send({ t: 'hello', ver: PROTO_VER, name, ...(token ? { token } : {}), meta });
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  get open(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Estimated current server tick (drives the interpolation clock). */
  estimatedServerTick(): number {
    if (this.lastPong.at === 0) return 0;
    return this.lastPong.tick + ((performance.now() - this.lastPong.at) / 1000) * SIM_RATE;
  }

  close(): void {
    const ws = this.ws;
    this.dispose();
    ws?.close();
  }

  private dispose(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
    }
    this.ws = null;
  }
}
