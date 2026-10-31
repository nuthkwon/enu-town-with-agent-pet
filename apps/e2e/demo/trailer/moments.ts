/** What the trailer's capture logs for every moment it films (demo/trailer.demo.ts → demo/trailer/build.ts). */

export interface Point {
  x: number;
  y: number;
}

export interface Moment {
  /** Which recording it is in: the town (960×540, zoom 1) or the pet room (1920×1080 device px). */
  source: 'town' | 'pet';
  /** One of the storyboard's moments (several takes may share a name; the editor uses them in order). */
  name: string;
  /** Video seconds when the action starts (a click, a call). */
  t: number;
  /** Video seconds when its effect landed on screen (the frame a cut or a hit-stop lands on). */
  impact?: number;
  /** Video seconds when it is over. */
  end: number;
  /** Its subject on screen (pixels of its recording). */
  at: Point;
  /** The other end (the caster of a spell), when there is one. */
  from?: Point;
  /** When a menu for it opened on screen, before `t` (the shot before it stops short of that). */
  ui?: number;
}
