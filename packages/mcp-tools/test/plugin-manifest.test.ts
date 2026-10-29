import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTRUCTIONS_VERSION, MCP_TOOL_NAMES } from '@enu/shared';
import { describe, expect, it } from 'vitest';

/**
 * The Claude org plugin under claude/ is published as a marketplace. These are invariants rather than
 * exact lists, so adding a plugin or a skill never breaks them: every entry points at a real plugin
 * with the same name and version, every skill's frontmatter name equals its directory, and the
 * check-in skill pins the server's instructions version.
 */
const CLAUDE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../claude');

interface MarketplaceEntry {
  name: string;
  source: string;
  version: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function frontmatterName(file: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'));
  const line = m?.[1]?.split('\n').find((l) => l.startsWith('name:'));
  return line ? line.slice('name:'.length).trim() : null;
}

const marketplace = readJson<{ name: string; plugins: MarketplaceEntry[] }>(
  path.join(CLAUDE_DIR, '.claude-plugin/marketplace.json'),
);

describe('Claude plugin marketplace', () => {
  it('lists at least one plugin', () => {
    expect(marketplace.plugins.length).toBeGreaterThan(0);
  });

  for (const entry of marketplace.plugins) {
    describe(entry.name, () => {
      const root = path.join(CLAUDE_DIR, entry.source);

      it('points at a plugin with the same name and version', () => {
        const manifest = readJson<{ name: string; version: string }>(
          path.join(root, '.claude-plugin/plugin.json'),
        );
        expect(manifest.name).toBe(entry.name);
        expect(manifest.version).toBe(entry.version);
      });

      it('names every skill after its directory', () => {
        const skillsDir = path.join(root, 'skills');
        if (!existsSync(skillsDir)) return;
        for (const dir of readdirSync(skillsDir)) {
          expect(frontmatterName(path.join(skillsDir, dir, 'SKILL.md'))).toBe(dir);
        }
      });
    });
  }
});

describe('check-in skill', () => {
  const skillDir = path.join(CLAUDE_DIR, 'plugins/enu-den/skills/enu-den-checkin');

  it('pins the instructions version the server reports', () => {
    expect(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toContain(`\`${INSTRUCTIONS_VERSION}\``);
    expect(readFileSync(path.join(skillDir, 'references/tool-guide.md'), 'utf8')).toContain(
      `\`${INSTRUCTIONS_VERSION}\``,
    );
  });
});

describe('managed settings example', () => {
  it('pre-approves the read-only context tool', () => {
    const settings = readJson<{ permissions: { allow: string[] } }>(
      path.join(CLAUDE_DIR, 'managed-settings/claude-code.managed.example.json'),
    );
    expect(settings.permissions.allow.some((p) => p.endsWith(`__${MCP_TOOL_NAMES.getMyContext}`))).toBe(true);
  });
});
