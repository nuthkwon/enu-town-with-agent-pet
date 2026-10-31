# ADR 0008 — The wizard office: spells, auras, familiars and quests, effects as code, synthesized sound

Status: accepted (2026-10-31). Go-live is blocked on the "Review before rollout" list in
[ADR 0004](0004-town-is-a-visualization.md#review-before-rollout), which this ADR extends.

## Context

ENU Den showed four small effects (an arrival sparkle, the wave's hearts, the DM paper plane and the work-log
sparkle) and made no sound. Town spec §11 row 6 kept "the log sparkle is the only event FX" on the map, and the only
human interactions in the town were the wave (public) and the ping (target only).

The owner asked on 2026-10-31 for:

- many effects made the way [pixelfx](https://github.com/patch-gg/pixelfx) (Patch, MIT) makes them: effects are code,
  drafted, rendered, looked at and refined;
- effects that borrow game combat skills and magic, comic and fun even though this is an office; where Den has no
  activity for them, new activities and interactions;
- wizard outfits: everyone holding a magic wand;
- good sound effects, and a demo video with sound;
- the repository set up so the same method applies to every future effect.

## Decision

1. **The wizard office.** Every avatar wears a robe and holds a wand; a pointy hat is on by default and can be taken
   off in the avatar editor. Pets are familiars. Only generic motifs: no Harry Potter or Hogwarts names, crests or
   colours, and no specific game's sprites, characters or logos.
2. **Spells: a new human-initiated, public interaction** on the wave model. Six friendly spells (응원 파이어볼, 커피
   메테오, 칭찬 번개, 힐링 포션, 하이파이브, 축하 폭죽) look like combat magic but mean encouragement. Rules:
   - Gate: the office is open and both people are shown; not oneself; the target accepts spells.
   - **`accept_spells`** (profile, default true, `마법 받지 않기` in `/me` settings): when off, nobody can cast at
     that person. Colleagues only learn that spells are not accepted (the menu says so; the server refuses with
     `NOT_ACCEPTED`).
   - **Shield**: when the target's projected state is focus or meeting (already public), the spell bounces off a
     shield (`blocked`); the target hears nothing.
   - **Combo**: a high-five returned within 10 s. **Raid** (단체 응원): three different casters on one person within
     60 s. Both are moments only: never counted, stored or shown later.
   - Limits per connection (4 per 20 s, 1 per target per 15 s) and per target across the room (6 per minute), so a
     person cannot be piled on.
   - Everyone in the town sees the spell, the caster and the target, like the wave. The server keeps only short-lived
     memory for limits, combos and raids; nothing is stored, audited or logged per person.
   - Floating text is ENU Den's own onomatopoeia from `ko.ts` ("화르륵!", "찌릿!", "짝!"). **No numbers, scores,
     rankings or tallies** of spells received, anywhere.
3. **Cast pose.** The caster's avatar raises its wand for about half a second when, and only when, the caster casts.
   It is the person's own action (spec P2 forbids invented motion, not this); the avatar never moves.
4. **Auras** draw state that is already projected, for everyone, in office hours only: a shield bubble on focus, mana
   motes on a break, a party circle when a meeting group first gathers (not for groups that already existed when the
   viewer joined), a warp-in beam on arrival and a blink-out on leaving (same footprint and at most 0.7 s, guarded
   against bursts), a rune sparkle when a colleague's Claude writes a company-visible log. Nothing new is revealed.
5. **Familiar play and quests are owner-only and stored nowhere.** In the pet room the owner can pat, feed a snack to,
   and ask a familiar to show a little spell; a new pet hatches from an egg the first time its room opens; a reply
   arrives through a summon circle. Pets never get invented text: these are pictures only. The pet room's to-do strip
   becomes "오늘의 퀘스트" with a done button, and completing a to-do anywhere plays a quest-complete effect **on the
   owner's own screen only**. Nothing about work is celebrated where colleagues can see it; a colleague's log write
   stays a neutral rune sparkle.
6. **The messenger receives what is addressed to me**: pings, waves and spells at me, my log's publication notice and
   social errors show as toasts there too, so a person with only the messenger open is not missed.
7. **Effects are code.** Effects follow the pixelfx contract (`packages/fx`, upstream vendored unchanged at
   `fe7103c` with its MIT licence and notices) and are baked by `pnpm sprites:build` into deterministic sprite strips.
   The method is pixelfx's: look for an existing effect first, say it in one line, draft (several takes when the
   direction is open), render and look at the contact sheet, fix the worst thing (three rounds minimum), check. No
   image or audio files are added to the repository.
8. **Sound is synthesized in code** (`packages/sfx`) and played only from `apps/web/src/sound`.
   - Sounds play only for my own actions and for events addressed to me. Third parties see spells and waves but never
     hear them; colleagues' arrivals, logs, meetings, statuses and room chat make no sound; pet bubbles make no sound
     (the shared room would learn a bubble is up). A blocked spell is silent for its target.
   - While the tab is hidden only a ping (once per 10 s) and a DM (once per 20 s) sound.
   - On by default at a low volume; a speaker button and a settings card turn it off at once. The setting stays in
     this browser (no server field, NOTIFY or audit). Nothing sounds before the first click or key press.
9. **Town spec amendments.** §11 row 6 becomes: the shared event effects on the map are the rune sparkle, the wave's
   landing, spells (with shield, combo and raid), arrival and leaving transitions, and auras of projected state. Still
   not on the map: task-done pops for colleagues, tickers, team counts, scores, rankings, and any sound for colleagues'
   activity (D13 stands for those). §3.1 and the privacy matrix (§3.3) gain the rows below.
10. **Privacy notice `2027-02`**: spells are public in office hours and never stored; `마법 받지 않기` shows colleagues
    only that spells are not accepted; sound settings stay on the device. Everyone accepts it again.

## Consequences

- `PROTOCOL_VERSION` 4 (new `social:cast` and `spell` messages); migration `0009` (`profiles.accept_spells`); sprite
  revision bump so cached avatar and companion sheets are fetched again; avatar sheets gain a 4-frame cast animation;
  the effects icon sheet gains a fourth row.
- Enforcement: `@enu/fx` and `@enu/sfx` checks run in `pnpm test`; ESLint keeps audio APIs inside
  `apps/web/src/sound`, keeps `<canvas>` out of components, and bans randomness, clocks and text inside effects;
  `scripts/verify-policy.sh` rejects audio files; the gate table is a pure function with tests; e2e asserts that third
  parties hear nothing and that the page keeps a single canvas.
- The `den-fx` project skill (`.claude/skills/den-fx`) and a post-edit hook make every future effect and sound go
  through the same method. [effects-spec](../design/effects-spec.md) is the living inventory and gate table.

### Rows added to the town spec

| Visual                                                                                | Data                                                                        | Gate                                                        | Seen by                               |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------- |
| **Spell** (마법) with the caster's cast pose                                          | a human click (`social:cast {toUserId, spell}`)                             | office open, caster and target shown, target accepts spells | all; sound for caster and target only |
| **Shield bounce**                                                                     | spell at a target whose projected activity is focus or meeting              | same                                                        | all; no sound for the target          |
| **Combo / raid**                                                                      | returned high-five within 10 s / 3 casters within 60 s (server memory only) | same                                                        | all; never counted                    |
| **Auras** (focus shield, break motes, party circle, warp-in, blink-out, rune sparkle) | the existing projection                                                     | office hours                                                | all (same projection)                 |
| **Ping on my avatar**                                                                 | `pinged` (target only)                                                      | target online                                               | target only                           |

| Data item                             | Owner           | Colleague (office hours)         | Anyone after hours | Admin       | Owner's Claude | Stored       |
| ------------------------------------- | --------------- | -------------------------------- | ------------------ | ----------- | -------------- | ------------ |
| Spell (caster, target, kind, outcome) | ✓               | ✓                                | ✗ (disabled)       | = colleague | ✗              | not stored   |
| `accept_spells`                       | ✓               | only "accepts / does not accept" | ✗                  | = colleague | ✗              | profile      |
| Sound settings                        | ✓ (this device) | ✗                                | ✗                  | ✗           | ✗              | browser only |
| Familiar play, quest-complete         | ✓               | ✗                                | ✓ (own screen)     | ✗           | ✗              | not stored   |

## Review before rollout (adds to ADR 0004)

- HR: spells and auras as workplace play; whether combo and raid could feel like a pile-on (limits, the setting and
  the shield are the mitigations); the louder arrival effect (kept to the old footprint and duration).
- Accessibility: reduced motion turns decorative effects off; sound is off with one click and never needed to
  understand anything.

## Not chosen

- Prank or attack spells (snowballs, water balloons): friendly spells only.
- Pet levels or experience: they would count the owner's activity.
- Spells seen only by the two people: the owner chose public, like the wave.
- Sounds for colleagues' activity, or a chime for pet bubbles.
- Stored spell history or statistics of any kind.
