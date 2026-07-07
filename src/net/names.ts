/**
 * Pilot-name rules, shared verbatim by the client (live validation) and the
 * server (authoritative validation in api/). Pure — no DOM, no Node APIs.
 */

export const NAME_MIN = 3;
export const NAME_MAX = 16;

const NAME_CHARS = /^[\p{L}\p{N} ._-]+$/u;

/** Small pt-BR blocklist, matched against the accent-stripped lowercase name. */
const BLOCKED = [
  'merda', 'bosta', 'caralho', 'porra', 'buceta', 'cacete', 'penis',
  'puta', 'puto', 'putinha', 'viado', 'boiola', 'foder', 'fodase', 'foda-se',
  'arrombad', 'desgraca', 'vagabund', 'corno', 'cuzao', 'fdp', 'krl', 'pqp',
  'hitler', 'nazi',
];

/** Trim and collapse internal whitespace. */
export function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export type NameError = 'short' | 'long' | 'invalid' | 'profane' | null;

export function nameError(name: string): NameError {
  if (name.length < NAME_MIN) return 'short';
  if (name.length > NAME_MAX) return 'long';
  if (!NAME_CHARS.test(name)) return 'invalid';
  const flat = stripAccents(name.toLowerCase()).replace(/[ ._-]/g, '');
  for (const bad of BLOCKED) {
    if (flat.includes(bad)) return 'profane';
  }
  return null;
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Public handle derived from the display name: lowercase, accent-free,
 * spaces become '-', restricted to [a-z0-9._-]. The server suffixes a number
 * on collision ('alan', 'alan-2', …).
 */
export function handleFromName(name: string): string {
  const base = stripAccents(sanitizeName(name).toLowerCase())
    .replace(/ /g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '');
  return base.slice(0, NAME_MAX) || 'piloto';
}
