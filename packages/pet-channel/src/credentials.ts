import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as z from 'zod';

/**
 * The machine token on disk (`~/.claude/channels/enu-den/credentials.json`, 0600 in a 0700 directory). Only the
 * pairing command writes it; the server reads it only when the session was started for the pets. The token is
 * never printed, logged or put in a tool result. Managed settings deny Claude reading or editing this directory.
 */
export const storedCredentials = z.object({
  v: z.literal(1),
  base_url: z.string(),
  token: z.string(),
  token_id: z.string(),
  link_id: z.string(),
  owner_display_name: z.string(),
  expires_at: z.string(),
  paired_at: z.string(),
});
export type StoredCredentials = z.infer<typeof storedCredentials>;

/**
 * The stored credentials for `baseUrl`, or null (missing, unreadable, or paired with another ENU Den, so a
 * production token never goes to a development server).
 */
export function loadCredentials(path: string, baseUrl: string): StoredCredentials | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows, or a read-only home: reading still works.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = storedCredentials.safeParse(parsed);
  return r.success && r.data.base_url === baseUrl ? r.data : null;
}

/** Writes atomically (temp file + rename) with owner-only permissions. */
export function saveCredentials(path: string, creds: StoredCredentials): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows.
  }
}

export function removeCredentials(path: string): void {
  rmSync(path, { force: true });
}
