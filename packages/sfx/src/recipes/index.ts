import type { SfxRecipe } from '../types';
import uiTap from './ui-tap';
import uiOn from './ui-on';
import uiNope from './ui-nope';
import msgSend from './msg-send';
import popupOpen from './popup-open';
import popupClose from './popup-close';
import waveOut from './wave-out';
import dmTick from './dm-tick';
import pingIn from './ping-in';
import dmIn from './dm-in';
import waveIn from './wave-in';
import logNotice from './log-notice';
import castFireball from './cast-fireball';
import castCoffee from './cast-coffee';
import castZap from './cast-zap';
import castPotion from './cast-potion';
import castHighfive from './cast-highfive';
import castFireworks from './cast-fireworks';
import hitFireball from './hit-fireball';
import hitCoffee from './hit-coffee';
import hitZap from './hit-zap';
import hitPotion from './hit-potion';
import hitHighfive from './hit-highfive';
import hitFireworks from './hit-fireworks';
import spellBlocked from './spell-blocked';
import spellCombo from './spell-combo';
import spellRaid from './spell-raid';
import petReply from './pet-reply';
import petPat from './pet-pat';
import petMunch from './pet-munch';
import petSpell from './pet-spell';
import petHatch from './pet-hatch';
import questDone from './quest-done';

/** Every sound, by id. One file per recipe so sounds are made and tuned one at a time (den-fx skill §8). */
export const RECIPES = {
  'ui.tap': uiTap,
  'ui.on': uiOn,
  'ui.nope': uiNope,
  'msg.send': msgSend,
  'popup.open': popupOpen,
  'popup.close': popupClose,
  'wave.out': waveOut,
  'dm.tick': dmTick,
  'ping.in': pingIn,
  'dm.in': dmIn,
  'wave.in': waveIn,
  'log.notice': logNotice,
  'cast.fireball': castFireball,
  'cast.coffee': castCoffee,
  'cast.zap': castZap,
  'cast.potion': castPotion,
  'cast.highfive': castHighfive,
  'cast.fireworks': castFireworks,
  'hit.fireball': hitFireball,
  'hit.coffee': hitCoffee,
  'hit.zap': hitZap,
  'hit.potion': hitPotion,
  'hit.highfive': hitHighfive,
  'hit.fireworks': hitFireworks,
  'spell.blocked': spellBlocked,
  'spell.combo': spellCombo,
  'spell.raid': spellRaid,
  'pet.reply': petReply,
  'pet.pat': petPat,
  'pet.munch': petMunch,
  'pet.spell': petSpell,
  'pet.hatch': petHatch,
  'quest.done': questDone,
} as const satisfies Record<string, SfxRecipe>;

export type SfxId = keyof typeof RECIPES;
export const SFX_IDS = Object.keys(RECIPES) as SfxId[];
