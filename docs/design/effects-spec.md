# Effects and sound: inventory and gates

The living list of every effect and sound in ENU Den and who sees or hears it. The rules are in
[ADR 0008](../adr/0008-wizard-office-effects-and-sound.md); the method is the `den-fx` skill
(`.claude/skills/den-fx/SKILL.md`). Add a row here **before** wiring a new effect or sound.

## Gate rules (summary)

- An effect follows the gate of the data it reacts to: office hours for shared state, owner-only for pets and quests,
  the two participants for DMs, the target for pings. It never invents activity.
- Spells and waves are public (office open, both shown). Third parties see them and **never hear** them.
- Sound only for **my own actions** and **events addressed to me**. Never for colleagues' arrivals, logs, meetings,
  statuses or room chat; never for pet bubbles; never for a spell blocked by the target's shield (for the target).
- Hidden tab: only `ping.in` (once per 10 s) and `dm.in` (once per 20 s). Nothing before the first click or key.
- Reduced motion: decorative effects are skipped, loops show a still frame, information keeps a short static cue.
  Sound is not affected.
- No numbers, scores, rankings or tallies. Floating text is onomatopoeia from `ko.ts`. No text inside baked effects.

## House style (pixel effects)

- Pastel scenes: light is baked into the strip with a low glow (k ≤ 0.35); no additive blend.
- Ramps run dark to bright and start at the plum ink `#3b2a52` (`packages/fx/effects/_den.js`).
- Size relative to a 32 px avatar (about 22 px tall on screen at zoom 1) and a 24 px pet.
- Budgets: town frames ≤ 96×96, UI frames ≤ 128×128, ≤ 36 frames, fps 12–24, one PNG ≤ 48 KB, all ≤ 900 KB.

## Effects

| id                                         | surface         | trigger                                   | gate                      | seen by               | from pixelfx                                      |
| ------------------------------------------ | --------------- | ----------------------------------------- | ------------------------- | --------------------- | ------------------------------------------------- |
| `spell/charge`                             | town            | I cast a spell                            | office open, both shown   | all                   | `arcane/spell-charge`                             |
| `spell/fireball-fly`, `spell/fireball-hit` | town            | 응원 파이어볼                             | spell gate                | all                   | `fire/fireball`, `explosions/firework-burst`      |
| `spell/coffee-fall`, `spell/coffee-splash` | town            | 커피 메테오                               | spell gate                | all                   | `fire/meteor`, `water/splash`                     |
| `spell/zap-strike`, `spell/zap-sparks`     | town            | 칭찬 번개                                 | spell gate                | all                   | `lightning/lightning-strike`, `lightning/zap-hit` |
| `spell/potion-fly`, `spell/heal`           | town            | 힐링 포션                                 | spell gate                | all                   | `pickups/potion`, `holy/heal`                     |
| `spell/highfive-hit`                       | town            | 하이파이브                                | spell gate                | all                   | `impacts/parry`, `impacts/hit-spark`              |
| `spell/fireworks`                          | town            | 축하 폭죽                                 | spell gate                | all                   | `explosions/firework-rocket`                      |
| `spell/combo-burst`                        | town            | returned high-five within 10 s            | spell gate                | all                   | `impacts/crit-hit`                                |
| `spell/raid-pillar`                        | town            | 3 casters on one person within 60 s       | spell gate                | all                   | `holy/holy-pillar`, `holy/feather-burst`          |
| `spell/shield-block`                       | town            | spell at a target in focus or meeting     | spell gate                | all                   | `impacts/shield-block`                            |
| `aura/focus-shield` (loop)                 | town            | projected activity focus                  | office hours, shown       | all                   | `holy/divine-shield`                              |
| `aura/mana-rest` (loop)                    | town            | projected activity break                  | office hours, shown       | all                   | fresh                                             |
| `aura/party-cast`, `aura/rune-ring` (loop) | town            | a meeting group gathers                   | office hours              | all                   | `arcane/magic-circle-cast`, `arcane/rune-circle`  |
| `town/warp-in`, `town/blink-out`           | town            | arrival, leaving                          | office hours, burst guard | all                   | `scifi/warp-in`, `arcane/blink-out`               |
| `town/rune-spark`                          | town            | a colleague's Claude writes a company log | existing log-sparkle gate | all                   | `arcane/mana-burst`                               |
| `town/heart-burst`                         | town            | a wave lands                              | office open, both shown   | all                   | `pickups/collect-burst`                           |
| `town/plane-puff`                          | town            | DM plane takes off and lands              | —                         | the two participants  | `spawn/poof`                                      |
| `town/ping-bang`                           | town            | someone pings me                          | target online             | me                    | `ui/exclamation`                                  |
| `town/bubble-pop`                          | town            | my pet's bubble appears                   | owner                     | me                    | fresh                                             |
| `pet/hatch` (per tint)                     | pet room        | first open of a new pet's room            | owner                     | me                    | `spawn/egg-hatch`                                 |
| `pet/zzz` (loop)                           | pet room        | companion asleep                          | —                         | whoever sees the room | `status/sleep`                                    |
| `pet/munch`                                | pet room        | 간식 주기                                 | owner                     | me                    | fresh                                             |
| `pet/mini-*`                               | pet room        | 마법 보여 줘                              | owner                     | me                    | fresh                                             |
| `pet/summon-reply`                         | pet room        | my pet's reply arrives                    | owner                     | me                    | `arcane/rune-circle`                              |
| `pet/heart-rise`                           | pet room        | my pet's reply arrives                    | owner                     | me                    | `status/charmed`                                  |
| `pet/pat-heart`                            | pet room        | 쓰다듬기                                  | owner                     | me                    | `pickups/heart-pickup`                            |
| `ui/send-sparkle`                          | messenger       | I send a message                          | me                        | me                    | fresh                                             |
| `ui/quest-done`                            | messenger, town | I complete a to-do                        | owner                     | me                    | `ui/quest-complete` (no text)                     |

## Sprite-sheet pieces

Pictures drawn in `packages/sprites` (part of the regular sheets, not `packages/fx` strips). They follow the gate of
whatever shows them; the art itself never implies activity. Bump `SPRITE_REVISION` (both spec copies) whenever this
art changes, so cached sheets are fetched again.

| piece                                                        | sheet     | shown when                              | gate                | seen by                 |
| ------------------------------------------------------------ | --------- | --------------------------------------- | ------------------- | ----------------------- |
| robe, wand and pointy hat (`hat`, on by default)             | avatar    | always                                  | the avatar is shown | whoever sees the avatar |
| wand-tip twinkle (idle frames 1 and 3)                       | avatar    | always, as part of idle                 | the avatar is shown | whoever sees the avatar |
| `cast` (raise, star flash at `AVATAR_WAND_TIP`, hold, lower) | avatar    | I cast a spell (cast pose, ADR 0008 §3) | spell gate          | all                     |
| companion `eat` (munching a snack)                           | companion | 간식 주기                               | owner               | me                      |
| companion `cast` (paws up with a sparkle)                    | companion | 마법 보여 줘                            | owner               | me                      |
| `fireball` … `firework` (effects row 3, 24–29)               | effects   | the spell menu, spell toasts            | spell gate          | caster; target          |
| `shield` (30), `scroll` (31)                                 | effects   | a blocked spell; 오늘의 퀘스트          | spell gate; owner   | caster; me              |

## Sounds

| id                                                                    | category    | plays when                                        | who hears                             |
| --------------------------------------------------------------------- | ----------- | ------------------------------------------------- | ------------------------------------- |
| `cast.<spell>` (6)                                                    | ui          | I cast a spell                                    | caster                                |
| `hit.<spell>` (6)                                                     | notify      | a spell lands on me                               | target                                |
| `spell.blocked`                                                       | ui          | my spell bounces off a shield                     | caster                                |
| `spell.combo`                                                         | notify      | a combo                                           | the two people                        |
| `spell.raid`                                                          | notify      | a raid on me                                      | target                                |
| `ping.in`                                                             | notify      | someone pings me                                  | target (hidden tab: once per 10 s)    |
| `dm.in` / `dm.tick`                                                   | notify / ui | a DM to me / a new line in the thread I'm reading | recipient (hidden tab: once per 20 s) |
| `wave.out` / `wave.in`                                                | ui / notify | I wave / someone waves at me                      | sender / target                       |
| `log.notice`                                                          | notify      | my Claude published my work log                   | owner                                 |
| `pet.reply`, `pet.pat`, `pet.munch`, `pet.spell`, `pet.hatch`         | pet         | my pet's reply; pat; snack; spell show; hatch     | owner                                 |
| `quest.done`                                                          | pet         | I complete a to-do                                | owner                                 |
| `ui.tap`, `ui.on`, `ui.nope`, `msg.send`, `popup.open`, `popup.close` | ui          | my own clicks                                     | me                                    |

Loudness targets: ui −24 LUFS (peak −6 dBFS), notify −20 LUFS (peak −3 dBFS), pet −21 LUFS (peak −3 dBFS).
