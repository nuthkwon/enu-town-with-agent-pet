---
name: den-fx
description: Make or change any visual effect, animation, transition, spell or sound effect in ENU Den — the town (Phaser), the messenger UI (React/CSS) or the pet-room companion. Pixel effects are pixelfx-contract code in packages/fx/effects baked to sprite strips; sounds are synthesized in packages/sfx. Use for "add an effect", "make it pop / juicier", "a spell", "a sound when …", sparkles, hatching, chimes, game feel, or when an effect looks or sounds wrong.
---

# den-fx: effects and sounds the pixelfx way

ENU Den's effects follow [pixelfx](https://github.com/patch-gg/pixelfx)'s method (Hugo Duprez's, MIT): **code is
clay, trust your eyes, feed your references.** One-shot prompts make mediocre effects; drafts you render, look at and
refine make good ones. The rules are [ADR 0008](../../../docs/adr/0008-wizard-office-effects-and-sound.md); the
inventory and gates are [effects-spec](../../../docs/design/effects-spec.md).

## 0. Before anything

1. Read ADR 0008 and `docs/design/effects-spec.md`.
2. Check the toolkit runs: `pnpm fx:render <any existing id>` and open `records/fx/<id>/contact.png` with your image
   reading tool (Read). That contact sheet is how you see every effect from now on: rows over the carpet, wood and
   night floors (town) or the white card and lavender page (messenger), our own 32 px avatar, 24 px pet or companion
   standing on the anchor, zoomed, then the same frames at their **actual size** — judge it there too.
3. `pnpm fx:library` once: it clones the pinned pixelfx library (232 reference effects) into `records/.pixelfx`.

## 1. Gate first: who sees it, who hears it

Add the row to `docs/design/effects-spec.md` before writing code. The rules:

- An effect follows the gate of the data it reacts to: office hours for shared state, owner-only for pets and quests,
  the two participants for DMs, the target for pings. **It never shows activity that didn't happen**, and the
  avatar is never moved (a caster's wand-raise is their own action).
- Spells and waves are public (office open, both shown). Third parties see them and **never hear** them.
- Sound only for **my own actions** and **events addressed to me**. Never for colleagues' arrivals, logs, meetings,
  statuses or room chat; never for pet bubbles; never for a spell blocked by the target's shield.
- **No numbers, scores, rankings or tallies**, and nothing that celebrates work where colleagues can see it (a
  colleague's log write is a neutral rune sparkle; quest-complete plays on the owner's screen only). Floating text
  is onomatopoeia from `apps/web/src/i18n/ko.ts`, drawn outside the effect. **No text inside an effect.**
- Pets never get invented text: familiar effects are pictures only.
- Reduced motion: decorative effects are skipped, loops show a still frame. Sound is unaffected.

If no rule fits, write an ADR note before coding.

## 2. Look for an existing effect first

- `pnpm fx:list <words>` searches ours and the pixelfx library catalog.
- `pnpm fx:render lib:<category>/<name>` renders a library effect twice: upstream's view (`contact.png`) and on our
  floor with our avatar (`contact-den.png`), so you see how big it really is next to us.
- Most requests are an existing effect with another palette, size or timing, or a variant (`meta.den.variants`).

## 3. Say it in one line

What it is, how it moves, its ramp, its timing, where it sits. Examples:

- "Cheer fireball hit: the fireball pops into a ring of heart-shaped embers and a white flash at the chest, sparks
  fall and bounce once, ember ramp, 0.9 s, 64×64 anchored on the chest."
- "Focus shield: a thin lavender bubble round the avatar with a slow sheen and two winking glints, very low alpha so
  the person stays readable, 2 s loop, 40×44 on the feet."

## 4. Draft

- `pnpm fx:new <group>/<name> [--loop]` writes a working start in `packages/fx/effects/<group>/<name>.js`. Groups:
  `spell`, `aura`, `town` (Phaser), `pet` (pet room, CSS at 4×), `ui` (messenger, CSS at 2×).
- `pnpm fx:new <group>/<name> --from <category>/<name>` copies a library effect with the credit header
  `// Adapted from pixelfx <id> (...), MIT License, Copyright (c) 2026 Patch.` (keep any Hugo Duprez credit lines)
  and sets `meta.den.from`. Then make it ours: DEN ramps, our scale, our timing. Never ship a library effect as is.
- When the direction is open, write 3–5 takes (`<name>-a.js` … `-e.js`), render them all, keep one, delete the rest.
- Import only from `../_core.js` (pixelfx core + `DEN` ramps, `TINT_RAMP`, `HEART`, `GLINT`, `ANCHOR_ABOVE_FEET`).
- The contract (`packages/fx/vendor/pixelfx/docs/AUTHORING.md`): `meta` + `draw(p, t, o)` (pure) or `create(o)`
  (simulated, seeded `Rng(o.seed)`); local coordinates with (0,0) on the anchor; one-shots end empty; loops are
  seamless; honour `o.palette` with `fit(o.palette, n)`.
- ENU Den's `meta.den`: `surface`, `depth` (`over` | `under`, a strip has one depth: no `drawBack`), `anchor`
  (`feet` | `chest` | `head` | `free`), `stand`, `scale`, `variants`, `from`.

## 5. Render and LOOK, fix the worst thing, repeat

`pnpm fx:render <id>` (`--gif` / `--mp4` for motion, `--all` for every frame). Open the contact sheet. Judge it like
a picky pixel artist, fix the single worst thing, render again. **Three rounds minimum**; a showpiece takes more.

pixelfx's fix table, plus ENU Den's house rows:

| you see                             | fix                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| mush at 1×                          | fewer colours, a clear silhouette, one focal point, bigger shapes                |
| speckle inside shapes               | less noise, quantize with `at()`, no noise on small shapes                       |
| floaty, no punch                    | fast in, slow out (`ease.outQuart`), a 1–2 frame white hero frame, shorter       |
| stiff                               | vary every particle (size, speed, delay, life), secondary motion (sparks, puffs) |
| a one-shot pops off                 | let it shrink, dither out or fall away before t = duration                       |
| loop seam                           | `cycle`, `loopNoise(phase)`, `sin(phase * TAU * n)`                              |
| **dark smudge on the pastel floor** | lighter mid-tones; ink only on silhouette rims; translucent puffs use `DEN.puff` |
| **glow lost on the white card**     | carry brightness in colour steps, keep glow k ≤ 0.35                             |
| **too big at the town's fit zoom**  | smaller canvas, 1 px detail; compare with the avatar in "ACTUAL SIZE"            |
| **covers the person for long**      | keep the face readable; under-depth or low alpha for anything that lingers       |
| **reads as a reward for work**      | no gold coins, trophies, confetti or level-ups on work events                    |

Budgets (the check enforces them): town frames ≤ 96×96, UI/pet ≤ 128×128; ≤ 36 frames; fps 10/12/15/20/24;
one-shots ≤ 2.4 s, loops ≤ 4 s; one strip ≤ 48 KB, all strips ≤ 900 KB.

## 6. Check and bake

- `pnpm fx:check <id>` until it passes clean (spills, ends empty, seams, short palette, determinism, budgets, no
  randomness/clocks/text/drawBack, credit header).
- `pnpm sprites:build` bakes every effect into `apps/web/public/assets/sprites/fx/*.png` and
  `packages/fx/src/catalog.gen.ts`. Commit both with the effect. Never edit `packages/fx/vendor/pixelfx` (update
  with `pnpm fx vendor <sha>`).
- Art in `packages/sprites` (avatars, pets, companions, effect icons) is cached `immutable` at stable URLs: bump
  `SPRITE_REVISION` in `packages/sprites/src/spec.ts` and `apps/web/src/game/spriteSpec.ts` when it changes, and
  look at it with `pnpm --filter @enu/sprites exec tsx scripts/preview.ts <dir outside the repo>`.

## 7. Wire it

- Town (Phaser): `FxPlayer` in `apps/web/src/game/fx/FxPlayer.ts`, owned by `WorldScene` as `this.player`:
  - `player.play(id, spotOn(id, feet), { groundY, flipX, delayMs, onDone })` — one pass, origin on the effect's
    baked anchor (`spotOn` reads it from the catalog);
  - `player.loop(id, at)` → `{ move, stop }` for auras that follow someone (move it every frame);
  - `player.fly(id, from, to, { rotate | mirrorLeft, lift, onArrive })` for projectiles (strips drawn flying right);
  - `player.shout(ko.magic…, at, colour)` for a floating word in the overlay layer;
  - `player.chain(a, b, seed)` for a lightning link.

  It registers every sprite with `stage.world()` (never a bare `scene.add`), caps the count, creates nothing in a
  hidden tab and drops projectiles and loops with reduced motion. Add the id to `TOWN_FX`
  (`apps/web/src/game/fx/strips.ts`, preloaded; a unit test checks it is baked) and choreograph spells in
  `game/fx/spells.ts`. The debug hook counts strips (`fxStrips()`) and spells (`fxDrawn().spell`) for e2e.

- Messenger and pet room: `<FxSprite id at scale />` or `useFxLayer().play(id, at, scale)`
  (`apps/web/src/components/fx/FxSprite.tsx`, CSS `steps()` over the strip, put `layer` in a positioned box); the pet
  room draws at the companion's 4×. `useQuestCelebration` is the quest seal + jingle. Never a `<canvas>` (ESLint).
- Floating words come from `ko.ts` (`ko.magic`), never from the effect.

## 8. Sounds

- Say it in one line: character, pitch contour, length, category (`ui` −24 LUFS, `spell` −22, `notify` −20, `pet`
  −21; the synth normalises to it).
- One file per sound: `packages/sfx/src/recipes/<group>-<name>.ts` (id `<group>.<name>`), listed in
  `recipes/index.ts`. A recipe is data: voices (sine, triangle, square, pulse, saw, noise) with envelopes, glides,
  vibrato and filter sweeps, plus echo and master filters.
- `pnpm sfx:render <id|prefix.*|all>` writes `records/sfx/<id>.wav` and `<id>.png` (waveform with the peak ceiling,
  log-frequency spectrogram with a C-note grid and the 120 Hz / 10 kHz limits, pitch track, metrics, the notes
  heard). You cannot listen: open the PNG, read the contour, the attack, the tail and the notes; fix the worst thing,
  three rounds. `_sheet.png` puts every sound side by side so a family stays coherent.
- Fix table: harsh → lowpass, triangle instead of square; muddy or boomy → highpass 150 Hz; drags → shorter decay;
  the release does not finish → shorten the last voice's decay or quieten it; a late start → nothing before 30 ms;
  two sounds alike → another key, contour or timbre (the quest jingle is C major, the heal A major).
- `pnpm sfx:check` (silent ends, an immediate start, no chopped tail, a finished release, band shares, length,
  loudness, peak, determinism at 44.1 and 48 kHz). Then wire it through the gate table `decideSfx`
  (`apps/web/src/sound/policy.ts`, with a test row) or, for something I did myself, `playMine(id)`. Only
  `apps/web/src/sound` touches the Web Audio API (ESLint); there are no audio files (`scripts/verify-policy.sh`).

## 8½. The hook does the render for you

`.claude/settings.json` runs `.claude/hooks/fx-after-edit.mjs` after every edit of an effect
(`packages/fx/effects/<group>/<name>.js`) or a recipe (`packages/sfx/src/recipes/*.ts`): it renders it, runs its
check and tells you which PNG to open. Open it and look before the next edit. It never blocks an edit.

## 9. Test checklist

- The gate row in `effects-spec.md`; a `decideSfx` test row for every sound.
- Unit: `pnpm --filter @enu/fx test`, `pnpm --filter @enu/sfx test`, the web unit tests.
- e2e: a counter for the new effect (`fxStrips()` / `fxDrawn()`) and for its sound (`sfxPlayed(page)`, after
  `wakeSound(page)`), including **a third party who must see the public effect and hear nothing**
  (`apps/e2e/tests/spells.spec.ts` is the model); still exactly one `<canvas>`.

## 10. Demo

Add a scene to `apps/e2e/demo/effects.demo.ts` when the effect is a highlight.

## 11. Never

Scores, rankings or tallies; sounds for colleagues; text inside effects or invented pet text; image or audio files;
`Math.random`/`Date` in effects or synths; editing `vendor/pixelfx`; effects that imply activity that didn't happen;
a specific game's (or franchise's) sprites, characters, names or logos.
