#!/usr/bin/env node
// PostToolUse hook (den-fx skill, ADR 0008): after an effect (packages/fx/effects/<group>/<name>.js) or a sound recipe
// (packages/sfx/src/recipes/<group>-<name>.ts) is written, render it and run its check, then hand Claude the
// picture to LOOK at before the next edit. It never blocks an edit: whatever happens, it exits 0.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const done = (context) => {
  if (context) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }),
    );
  }
  process.exit(0);
};

let input;
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  done(null);
}
const file = input?.tool_input?.file_path ?? input?.tool_response?.filePath;
if (typeof file !== 'string') done(null);

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const rel = relative(root, file).split(sep).join('/');

let job = null;
const fx = rel.match(/^packages\/fx\/effects\/([a-z0-9-]+)\/([a-z0-9-]+)\.js$/);
if (fx && !fx[1].startsWith('_')) {
  const id = `${fx[1]}/${fx[2]}`;
  job = {
    kind: 'effect',
    id,
    render: ['fx:render', id],
    check: ['fx:check', id],
    png: `records/fx/${id}/contact.png`,
  };
}
const sfx = rel.match(/^packages\/sfx\/src\/recipes\/([a-z0-9]+)-([a-z0-9-]+)\.ts$/);
if (sfx) {
  const id = `${sfx[1]}.${sfx[2]}`;
  job = {
    kind: 'sound',
    id,
    render: ['sfx:render', id],
    check: ['sfx:check', id],
    png: `records/sfx/${id}.png`,
  };
}
if (!job) done(null);

const run = (args) => {
  const r = spawnSync('pnpm', ['--silent', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 150_000,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
  return { ok: r.status === 0, out: out || (r.error ? String(r.error) : '') };
};

// Only a picture this render made is worth looking at: drop the last one first, so a failed render never sends
// Claude to a stale one. One that cannot be removed is not offered either.
const png = join(root, job.png);
try {
  rmSync(png, { force: true });
} catch {
  // still there: `stale` below keeps it from being offered
}
const stale = existsSync(png);
const render = run(job.render);
const check = run(job.check);
const picture = !stale && existsSync(png) ? job.png : null;
done(
  [
    `den-fx hook: the ${job.kind} ${job.id} was rendered and checked after this edit.`,
    picture
      ? `Open ${picture} with Read and LOOK at it before editing again: judge it at actual size, fix the single worst thing, three rounds at least (.claude/skills/den-fx).`
      : `${job.render.join(' ')} made no picture, so there is nothing to look at yet:\n${render.out || '(no output)'}`,
    `${job.check.join(' ')}: ${check.ok ? 'pass' : 'FAIL'}`,
    check.ok ? '' : check.out,
  ]
    .filter(Boolean)
    .join('\n'),
);
