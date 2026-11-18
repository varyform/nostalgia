/**
 * @nostalgia/input — one input layer for every game.
 *
 * A game registers ACTIONS with keyboard/mouse and gamepad bindings; this
 * module reads keyboard, mouse buttons and every connected pad, tracks the
 * device the player last touched, and draws the right key or button picture
 * (keyboard, Xbox, PlayStation, Switch, generic pad, touch) in prompts.
 *
 *   import { createInput, drawPrompt } from '@nostalgia/input';
 *
 *   const input = createInput({
 *     actions: {
 *       left:  { keys: ['ArrowLeft', 'KeyA'], pad: ['Left', 'LStickLeft'] },
 *       fire:  { keys: ['Space', 'KeyZ'],     pad: ['South', 'R2'] },
 *       pause: { keys: ['KeyP', 'Escape'],    pad: ['Start'] },
 *       start: { keys: ['Space', 'Enter'],    pad: ['South', 'Start'], touch: 'Tap' },
 *     },
 *     display: { fly: { keys: ['Arrows'], pad: ['LStick'] } },   // prompt-only
 *   });
 *
 *   // each fixed update step:
 *   input.update();
 *   if (input.held('fire')) …; if (input.pressed('pause')) …;
 *   const steer = input.axis('left', 'right');                    // analog on sticks
 *
 *   // canvas prompt, glyphs follow the active device:
 *   drawPrompt(ctx, input, 'PRESS {start} TO PLAY', W / 2, 160, { font: '700 20px sans-serif', align: 'center' });
 *
 *   // DOM: <input-glyph action="fire"></input-glyph>  (import '@nostalgia/input' registers it)
 *
 * Keys are KeyboardEvent.code values plus MouseLeft / MouseRight / MouseMiddle;
 * prompt-only clusters: Arrows, WASD, ArrowsH, ArrowsV, AD, WS, Mouse, Wheel.
 * Pad inputs are positional (W3C standard mapping): South East West North,
 * L1 R1 L2 R2, Select Start Home, L3 R3, Up Down Left Right (d-pad),
 * LStickUp/Down/Left/Right, RStick…; prompt-only: LStick RStick Dpad DpadH DpadV.
 *
 * Pixel-art canvases pass `style: { pixel: true, text, measure, cap, … }` so
 * glyphs are scanline-filled in the game's palette and labelled in its bitmap font.
 */
export { createInput, currentInput, type ActionDef, type Input, type InputOptions } from './input.ts';
export {
  familyOf,
  keyName,
  padName,
  KEY_CLUSTERS,
  PAD_BUTTONS,
  PAD_AXES,
  type Device,
  type DeviceKind,
  type Family,
} from './devices.ts';
export {
  glyphs,
  glyphsFor,
  padGlyph,
  describe,
  drawGlyph,
  drawGlyphs,
  measureGlyph,
  measureGlyphs,
  DEFAULT_STYLE,
  type Glyph,
  type GlyphStyle,
} from './glyphs.ts';
export { drawPrompt, measurePrompt, parsePrompt, type PromptOptions } from './prompt.ts';
export { InputGlyph, glyphHTML } from './element.ts';
export { menuNav, type MenuNav, type MenuNavOptions } from './menu.ts';
