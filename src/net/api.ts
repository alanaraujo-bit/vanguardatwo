import type {
  AuthRequest,
  AuthResponse,
  BoardKind,
  CloudSave,
  LeaderboardResponse,
  MeResponse,
  ProfileResponse,
  RunResponse,
  RunSubmission,
  SaveResponse,
} from './protocol';

/**
 * Typed fetch wrapper for the same-origin /api backend. Auth rides on an
 * HttpOnly session cookie; the X-Requested-With header is the CSRF token
 * every mutating endpoint requires.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly suggestion?: string,
  ) {
    super(`api ${status}: ${code}`);
  }

  /** Network failure or server error — worth retrying later. */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

interface RequestInitLite {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

async function request<T>(path: string, init: RequestInitLite = {}): Promise<T> {
  const controller = new AbortController();
  const timer = init.timeoutMs ? setTimeout(() => controller.abort(), init.timeoutMs) : null;
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        'X-Requested-With': 'vanguarda',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    let suggestion: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; suggestion?: string };
      if (body.error) code = body.error;
      suggestion = body.suggestion;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, code, suggestion);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  authGoogle: (body: AuthRequest) =>
    request<AuthResponse>('/api/auth/google', { method: 'POST', body, timeoutMs: 15_000 }),
  me: () => request<MeResponse>('/api/me', { timeoutMs: 5_000 }),
  logout: () => request<void>('/api/logout', { method: 'POST', timeoutMs: 5_000 }),
  putSave: (save: CloudSave) =>
    request<SaveResponse>('/api/save', { method: 'PUT', body: { save }, timeoutMs: 10_000 }),
  postRun: (run: RunSubmission) =>
    request<RunResponse>('/api/runs', { method: 'POST', body: run, timeoutMs: 10_000 }),
  leaderboard: (board: BoardKind) =>
    request<LeaderboardResponse>(`/api/leaderboard?board=${board}`, { timeoutMs: 10_000 }),
  profile: (handle: string) =>
    request<ProfileResponse>(`/api/profile?handle=${encodeURIComponent(handle)}`, { timeoutMs: 10_000 }),
  patchName: (name: string) =>
    request<MeResponse>('/api/profile', { method: 'PATCH', body: { name }, timeoutMs: 10_000 }),
  realtimeToken: () =>
    request<{ token: string }>('/api/realtime-token', { timeoutMs: 5_000 }),
};
