/**
 * `pnpm map:gen` — converts OFFICE_606_ASCII into the Tiled map served by the web app.
 * Once generated, the .tmj may be edited in Tiled; this script refuses to overwrite a file that
 * differs from its output unless `--force` is passed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { generateOfficeTmj, OFFICE_606_LAYOUT, serializeTmj } from '../src/index';
import { OFFICE_606_DIR, OFFICE_606_TMJ_PATH } from './paths';

function main(): number {
  const force = process.argv.includes('--force');
  const text = serializeTmj(generateOfficeTmj(OFFICE_606_LAYOUT));
  const shown = relative(process.cwd(), OFFICE_606_TMJ_PATH);

  if (existsSync(OFFICE_606_TMJ_PATH)) {
    const current = readFileSync(OFFICE_606_TMJ_PATH, 'utf8');
    if (current === text) {
      console.log(`map:gen ${shown} is already up to date`);
      return 0;
    }
    if (!force) {
      console.error(
        `map:gen ${shown} differs from the ASCII layout output (edited in Tiled?).\n` +
          '  Re-run with --force to overwrite it: pnpm --filter @enu/map gen --force',
      );
      return 1;
    }
  }

  mkdirSync(OFFICE_606_DIR, { recursive: true });
  writeFileSync(OFFICE_606_TMJ_PATH, text);
  console.log(`map:gen wrote ${shown} (${Buffer.byteLength(text)} bytes). Next: pnpm map:check`);
  return 0;
}

process.exitCode = main();
