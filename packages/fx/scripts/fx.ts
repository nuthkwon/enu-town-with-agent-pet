/**
 * The effects CLI (pixelfx's method, in ENU Den): look for an existing effect, start one, render it and LOOK at the
 * contact sheet, check it, bake every effect into strips.
 *
 *   pnpm fx:list [words]                  our effects + matching pixelfx library effects
 *   pnpm fx:library                       clone the pinned pixelfx library into records/.pixelfx (once)
 *   pnpm fx:new <group>/<name> [--loop] [--from <category>/<name>]
 *   pnpm fx:render <id|group|glob|lib:<category>/<name>> [--gif] [--mp4] [--all] [--zoom N] [--variant V]
 *   pnpm fx:check [ids]                   every effect when no id is given
 *   pnpm fx bake                          strips + catalog (also part of `pnpm sprites:build`)
 *   pnpm fx vendor <sha>                  re-vendor pixelfx at another commit
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  EFFECTS_DIR,
  LIBRARY_DIR,
  LIBRARY_FX_DIR,
  PIXELFX_COMMIT,
  RECORDS_DIR,
  REPO_ROOT,
  VENDOR_DIR,
  bakeAll,
  checkEffect,
  contactSheet,
  denOf,
  effectIds,
  fxlib,
  loadEffect,
  loadLibraryEffect,
  previewFrames,
  resolveEffectIds,
  writeBake,
} from '../src/index';

const args = process.argv.slice(2);
const cmd = args.shift();
const flags = new Map<string, string | true>();
const rest: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (!a.startsWith('--')) rest.push(a);
  else if (['gif', 'mp4', 'all', 'loop'].includes(a.slice(2))) flags.set(a.slice(2), true);
  else flags.set(a.slice(2), args[++i] ?? '');
}
const flag = (k: string) => flags.get(k);
const rel = (p: string) => relative(REPO_ROOT, p);

async function list(): Promise<void> {
  const words = rest.map((w) => w.toLowerCase());
  const match = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  console.log('ENU Den effects (packages/fx/effects):');
  for (const id of effectIds()) {
    const fx = await loadEffect(id);
    const m = fx.meta;
    const line = `  ${id.padEnd(26)} ${`${m.size[0]}x${m.size[1]}`.padEnd(8)} ${String(m.duration).padEnd(5)}s ${m.loop ? 'loop    ' : 'one-shot'}  ${m.desc}`;
    if (match(`${id} ${m.name} ${m.desc} ${m.tags.join(' ')}`)) console.log(line);
  }
  const catalog = readFileSync(join(VENDOR_DIR, 'docs', 'CATALOG.md'), 'utf8');
  const rows = catalog.split('\n').filter((l) => /^\| .* \| `[a-z-]+\/[a-z0-9-]+` \|/.test(l));
  const hits = rows.filter((l) => match(l)).slice(0, words.length ? 40 : 0);
  if (hits.length) {
    console.log('\npixelfx library (render with `pnpm fx:render lib:<id>` after `pnpm fx:library`):');
    for (const l of hits) {
      const cells = l.split('|').map((c) => c.trim());
      console.log(`  lib:${cells[2]!.replace(/`/g, '').padEnd(28)} ${cells[3]!.padEnd(14)} ${cells[5]}`);
    }
  }
}

function library(): void {
  if (existsSync(join(LIBRARY_DIR, '.git'))) {
    console.log(`library already at ${rel(LIBRARY_DIR)}`);
    return;
  }
  mkdirSync(LIBRARY_DIR, { recursive: true });
  const git = (...a: string[]) => {
    const r = spawnSync('git', a, { cwd: LIBRARY_DIR, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')} failed`);
  };
  git('init', '-q');
  git('fetch', '-q', '--depth', '1', 'https://github.com/patch-gg/pixelfx', PIXELFX_COMMIT);
  git('checkout', '-q', 'FETCH_HEAD');
  console.log(`pixelfx library @ ${PIXELFX_COMMIT.slice(0, 7)} in ${rel(LIBRARY_DIR)}`);
}

const TEMPLATE_ONE_SHOT = (
  name: string,
  group: string,
  surface: string,
) => `import { DEN, Lights, P, Particles, Rng, TAU, fit, sparkle } from '../_core.js';

export const meta = {
  name: '${name}',
  desc: 'One line: what it is, how it moves, its palette and timing.',
  tags: ['${group}'],
  size: [48, 48],
  origin: [24, 40],
  duration: 0.8,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.lavender, seed: 1 },
  den: { surface: '${surface}', anchor: 'feet', depth: 'over' },
};

export function create(o) {
  const C = fit(o.palette, 7);
  const R = new Rng(o.seed);
  const ps = new Particles({ rng: R, ground: () => 0, sparks: [C[6], C[4], C[2]] });
  const lights = new Lights();
  lights.add(0, -14, 16, C[4], 0.3, 0.3);
  for (let i = 0; i < 16; i++) {
    const a = R.range(0, TAU);
    const sp = R.range(30, 90);
    ps.spawn(P.SPARK, 0, -14, Math.cos(a) * sp, Math.sin(a) * sp - 30, R.range(0.2, 0.5));
  }
  let t = 0;
  return {
    update(dt) {
      t += dt;
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      if (t < 0.1) sparkle(p, 0, -14, 6 * (1 - t / 0.1), C[6], C[4]);
      ps.draw(p);
      lights.draw(p);
    },
  };
}
`;

const TEMPLATE_LOOP = (
  name: string,
  group: string,
  surface: string,
) => `import { DEN, TAU, at, cycle, fit } from '../_core.js';

export const meta = {
  name: '${name}',
  desc: 'One line: what it is, how it moves, its palette and timing.',
  tags: ['${group}'],
  size: [48, 48],
  origin: [24, 40],
  duration: 1.2,
  loop: true,
  fps: 15,
  bg: 'ground',
  options: { palette: DEN.lavender, seed: 1 },
  den: { surface: '${surface}', anchor: 'feet', depth: 'over' },
};

// a loop: everything is a function of the phase, so t = 0 and t = duration match
export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const ph = t / meta.duration;
  cycle(t, meta.duration, 10, o.seed, 0.8, (age, life, r) => {
    const k = age / life;
    const a = r.range(0, TAU) + ph * TAU;
    const rad = 6 + k * 10;
    p.px(Math.cos(a) * rad, Math.sin(a) * rad * 0.5 - 14, at(C.slice(2), 1 - k));
  });
  p.glow(0, -14, 14, C[4], 0.25);
}
`;

const SURFACE_OF_GROUP: Record<string, string> = {
  spell: 'town',
  aura: 'town',
  town: 'town',
  pet: 'pet',
  ui: 'ui',
};

function newEffect(): void {
  const id = rest[0];
  if (!id || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(id))
    throw new Error('usage: fx new <group>/<name> [--loop] [--from <category>/<name>]');
  const file = join(EFFECTS_DIR, `${id}.js`);
  if (existsSync(file)) throw new Error(`${rel(file)} already exists`);
  const [group, base] = id.split('/') as [string, string];
  const surface = SURFACE_OF_GROUP[group] ?? 'ui';
  const name = base.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  mkdirSync(dirname(file), { recursive: true });
  const from = flag('from');
  if (typeof from === 'string' && from) {
    const src = join(LIBRARY_FX_DIR, `${from}.js`);
    if (!existsSync(src)) throw new Error(`no library effect ${from}: run \`pnpm fx:library\` first`);
    let code = readFileSync(src, 'utf8');
    // a category's shared helpers come along under effects/_lib/<category>.js
    if (code.includes('./_lib.js')) {
      const cat = from.split('/')[0]!;
      const libOut = join(EFFECTS_DIR, '_lib', `${cat}.js`);
      if (!existsSync(libOut)) {
        mkdirSync(dirname(libOut), { recursive: true });
        const lib = readFileSync(join(LIBRARY_FX_DIR, cat, '_lib.js'), 'utf8').replace(
          /from\s+["']\.\.\/\.\.\/core\/index\.js["']/g,
          "from '../_core.js'",
        );
        writeFileSync(
          libOut,
          `// Adapted from pixelfx ${cat}/_lib (https://github.com/patch-gg/pixelfx @ ${PIXELFX_COMMIT.slice(0, 7)}), MIT License, Copyright (c) 2026 Patch.\n${lib}`,
        );
      }
      code = code.replace(/from\s+["']\.\/_lib\.js["']/g, `from '../_lib/${cat}.js'`);
    }
    code = code.replace(/from\s+["']\.\.\/\.\.\/core\/index\.js["']/g, "from '../_core.js'");
    code = code.replace(
      /export const meta = \{/,
      `export const meta = {\n  den: { surface: '${surface}', from: '${from}' },`,
    );
    const header = `// Adapted from pixelfx ${from} (https://github.com/patch-gg/pixelfx @ ${PIXELFX_COMMIT.slice(0, 7)}), MIT License, Copyright (c) 2026 Patch.\n`;
    writeFileSync(file, header + code);
    console.log(
      `copied ${from} to ${rel(file)}\nnext: recolor with DEN ramps, fit our scale (32 px avatar), fps 12-24, then render and look`,
    );
    return;
  }
  writeFileSync(file, (flag('loop') ? TEMPLATE_LOOP : TEMPLATE_ONE_SHOT)(name, group, surface));
  console.log(`wrote ${rel(file)}\nnext: pnpm fx:render ${id}   then open records/fx/${id}/contact.png`);
}

async function render(): Promise<number> {
  let failed = 0;
  const lib = rest.filter((p) => p.startsWith('lib:')).map((p) => p.slice(4));
  const ours = rest.filter((p) => !p.startsWith('lib:'));
  for (const id of lib) {
    const fx = await loadLibraryEffect(id);
    const r = fxlib.renderFrames(fx, {});
    const dir = join(RECORDS_DIR, 'lib', id);
    const made = [
      fxlib.save(join(dir, 'contact.png'), fxlib.contactSheet(fx, r, { max: flag('all') ? 400 : 16 })),
    ];
    const bare = fxlib.renderFrames(fx, { bg: 'none', actor: false });
    const den = { ...denOf({ ...fx, id: `town/${id.split('/')[1]}` }) };
    made.push(fxlib.save(join(dir, 'contact-den.png'), contactSheet(fx, den, bare, { all: !!flag('all') })));
    if (flag('gif') && fxlib.writeVideo(join(dir, 'anim.gif'), r, 3)) made.push(join(dir, 'anim.gif'));
    console.log(`lib:${id}  ${r.n} frames  ->  ${made.map(rel).join('  ')}`);
  }
  for (const id of ours.length ? resolveEffectIds(ours) : []) {
    try {
      const fx = await loadEffect(id);
      const den = denOf(fx);
      const variant = typeof flag('variant') === 'string' ? (flag('variant') as string) : undefined;
      const r = fxlib.renderFrames(fx, { bg: 'none', options: variant ? den.variants[variant] : undefined });
      const dir = join(RECORDS_DIR, variant ? `${id}--${variant}` : id);
      const zoom = typeof flag('zoom') === 'string' ? Number(flag('zoom')) : undefined;
      const made = [
        fxlib.save(join(dir, 'contact.png'), contactSheet(fx, den, r, { all: !!flag('all'), zoom })),
      ];
      const preview = previewFrames(fx, den, r);
      const k = Math.max(2, Math.min(8, Math.floor(360 / Math.max(r.w, r.h))));
      const loops = fx.meta.loop ? 3 : 1;
      if (flag('gif') && fxlib.writeVideo(join(dir, 'anim.gif'), preview, k, { loops }))
        made.push(join(dir, 'anim.gif'));
      if (flag('mp4') && fxlib.writeVideo(join(dir, 'anim.mp4'), preview, k, { loops }))
        made.push(join(dir, 'anim.mp4'));
      const c = checkEffect(fx);
      console.log(`${id}  ${r.n} frames  ->  ${made.map(rel).join('  ')}`);
      for (const e of c.errors) console.log(`  FAIL ${e}`);
      for (const n of c.notes) console.log(`  note ${n}`);
      if (c.errors.length) failed++;
    } catch (e) {
      failed++;
      console.error(`${id}  FAILED: ${(e as Error).stack ?? e}`);
    }
  }
  return failed;
}

async function check(): Promise<number> {
  const ids = rest.length ? resolveEffectIds(rest) : effectIds();
  if (ids.length === 0) {
    console.log(`no effect matches ${rest.join(' ')} (try \`pnpm fx:list\`)`);
    return 1;
  }
  let fails = 0;
  for (const id of ids) {
    const c = checkEffect(await loadEffect(id));
    const tag = c.errors.length ? 'FAIL' : c.notes.length ? 'note' : 'ok  ';
    console.log(`${tag}  ${id}${[...c.errors, ...c.notes].map((s) => `\n      ${s}`).join('')}`);
    if (c.errors.length) fails++;
  }
  console.log(`\n${ids.length} effects: ${ids.length - fails} pass, ${fails} fail`);
  return fails;
}

async function bake(): Promise<void> {
  const strips = await bakeAll();
  const total = writeBake(strips);
  console.log(
    `baked ${strips.length} strips (${(total / 1024).toFixed(1)} KB) + packages/fx/src/catalog.gen.ts`,
  );
}

function vendor(): void {
  const sha = rest[0];
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('usage: fx vendor <full 40-hex commit>');
  const dir = join(REPO_ROOT, 'records', '.pixelfx', sha);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true });
    for (const a of [
      ['init', '-q'],
      ['fetch', '-q', '--depth', '1', 'https://github.com/patch-gg/pixelfx', sha],
      ['checkout', '-q', 'FETCH_HEAD'],
    ])
      if (spawnSync('git', a, { cwd: dir, stdio: 'inherit' }).status !== 0) throw new Error('git failed');
  }
  const pinned = JSON.parse(readFileSync(join(VENDOR_DIR, 'VENDORED.json'), 'utf8')) as {
    files: Record<string, string>;
  };
  const files: Record<string, string> = {};
  for (const f of Object.keys(pinned.files)) {
    mkdirSync(dirname(join(VENDOR_DIR, f)), { recursive: true });
    copyFileSync(join(dir, f), join(VENDOR_DIR, f));
    files[f] = createHash('sha256')
      .update(readFileSync(join(VENDOR_DIR, f)))
      .digest('hex');
  }
  const out = { upstream: 'https://github.com/patch-gg/pixelfx', commit: sha, license: 'MIT', files };
  writeFileSync(join(VENDOR_DIR, 'VENDORED.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    `vendored pixelfx @ ${sha.slice(0, 7)}: update PIXELFX_COMMIT in src/effects.ts and VENDORED.md, then pnpm fx:check`,
  );
}

const run: Record<string, () => Promise<number | void> | number | void> = {
  list,
  library,
  new: newEffect,
  render,
  check,
  bake,
  vendor,
};
const fn = cmd ? run[cmd] : undefined;
if (!fn) {
  console.error('usage: fx <list|library|new|render|check|bake|vendor> ... (see scripts/fx.ts)');
  process.exit(1);
}
Promise.resolve(fn())
  .then((code) => process.exit(typeof code === 'number' && code > 0 ? 1 : 0))
  .catch((e: unknown) => {
    console.error((e as Error).message ?? e);
    process.exit(1);
  });
