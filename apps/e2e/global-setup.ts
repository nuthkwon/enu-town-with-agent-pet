import { execSync } from 'node:child_process';
import path from 'node:path';
import { E2E_DB, ROOT } from './env';

/** Fresh, deterministic e2e database: migrate, example roster (pseudonyms), demo users and data. */
export default function globalSetup(): void {
  const env = {
    ...process.env,
    DATABASE_URL: E2E_DB,
    SEATS_FILE: path.join(ROOT, 'config/seats.example.json'),
    NODE_ENV: 'development',
  };
  const run = (cmd: string) => execSync(cmd, { cwd: ROOT, env, stdio: 'inherit' });
  run('pnpm --filter @enu/db migrate');
  run('pnpm --filter @enu/db seed:seats');
  run('pnpm --filter @enu/db seed:dev');
}
