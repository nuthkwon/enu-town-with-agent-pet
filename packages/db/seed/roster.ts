import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rosterSchema, type Roster } from '@enu/shared';
import { assertDistinctPetSpecies } from '../src/seed-seats';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../..');

export type { Roster };

/**
 * Loads the real roster (config/seats.local.json, gitignored) or, if missing,
 * the pseudonymous example. Never logs names. Fails if two seats share a pet species.
 */
export function loadRoster(): { roster: Roster; source: 'local' | 'example' | 'env' } {
  const fromEnv = process.env.SEATS_FILE;
  const local = path.join(repoRoot, 'config/seats.local.json');
  const example = path.join(repoRoot, 'config/seats.example.json');
  const file = fromEnv ?? (fs.existsSync(local) ? local : example);
  const source = fromEnv ? 'env' : file === local ? 'local' : 'example';
  const roster = rosterSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  assertDistinctPetSpecies(roster);
  return { roster, source };
}
