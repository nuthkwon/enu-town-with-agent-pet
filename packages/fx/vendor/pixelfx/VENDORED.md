# Vendored: pixelfx

- Upstream: https://github.com/patch-gg/pixelfx (MIT, Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez)
- Commit: `fe7103c36d94e02f2d7df7d8f7a341e493837cde`
- Vendored on 2026-10-31 for ENU Den's effects toolkit (`@enu/fx`, ADR 0008).

## What is here

Copied byte for byte (`VENDORED.json` pins every file's sha256; a test checks them):

- `LICENSE`, `NOTICE.md`, `README.md`
- `src/core/*.js`: the effect runtime, painter, particles and simulation (dependency-free ESM)
- `tools/lib/fxlib.mjs`, `tools/lib/png.mjs`: frame rendering, contact sheets, GIF/MP4 previews
- `docs/AUTHORING.md`, `docs/CATALOG.md`: the contract, the quality bar, the catalog of library effects
- `skills/pixelfx/SKILL.md`: upstream's skill, for reference only (ours is `.claude/skills/den-fx`)

## What is not

- The 232 library effects (`src/fx`). `pnpm fx:library` clones the pinned commit into `records/.pixelfx/<sha>`
  (gitignored), and `pnpm fx:render lib:<category>/<name>` renders one. `pnpm fx:new <id> --from <category>/<name>`
  copies one into `packages/fx/effects` with a credit header.
- `gallery/` (its Patch Pixel font is not MIT-licensed), the tools' CLIs and the README GIF.

## Rules

- Never edit these files. ENU Den's effects live in `packages/fx/effects` and import the core through
  `effects/_core.js`.
- To update: `pnpm fx vendor <sha>`, which copies the same files from a clone at that commit and rewrites
  `VENDORED.json`. Read upstream's changes first, then re-render and check every effect.
