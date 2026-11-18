import { describe, expect, it } from 'vite-plus/test';
import { createInput, familyOf, glyphsFor, keyName, parsePrompt, type InputOptions } from './index.ts';

type Pad = { id: string; connected: boolean; buttons: { pressed: boolean; value: number }[]; axes: number[] };
const pad = (id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'): Pad => ({
  id,
  connected: true,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
});
const press = (p: Pad, i: number, on = true) => {
  p.buttons[i] = { pressed: on, value: on ? 1 : 0 };
};

function setup(extra: Partial<InputOptions> = {}) {
  const target = new EventTarget(),
    pads: Pad[] = [];
  const input = createInput({
    target,
    getGamepads: () => pads as unknown as Gamepad[],
    actions: {
      left: { keys: ['ArrowLeft', 'KeyA'], pad: ['Left', 'LStickLeft'] },
      right: { keys: ['ArrowRight', 'KeyD'], pad: ['Right', 'LStickRight'] },
      fire: { keys: ['Space', 'KeyZ'], pad: ['South', 'R2'] },
      start: { keys: ['Enter'], pad: ['Start'], touch: 'Tap' },
      shoot: { keys: ['MouseLeft'], pad: ['R2'] },
    },
    display: { move: { keys: ['Arrows'], pad: ['LStick'] } },
    ...extra,
  });
  const key = (type: 'keydown' | 'keyup', code: string, repeat = false) => {
    const e = Object.assign(new Event(type, { cancelable: true }), { code, repeat });
    target.dispatchEvent(e);
    return e;
  };
  return { input, target, pads, key };
}

describe('keyboard', () => {
  it('reports held, pressed once per update, and released', () => {
    const { input, key } = setup();
    key('keydown', 'Space');
    input.update();
    expect(input.held('fire')).toBe(true);
    expect(input.pressed('fire')).toBe(true);
    input.update();
    expect(input.pressed('fire')).toBe(false);
    expect(input.held('fire')).toBe(true);
    key('keyup', 'Space');
    input.update();
    expect(input.held('fire')).toBe(false);
    expect(input.released('fire')).toBe(true);
  });

  it('keeps a tap shorter than one step', () => {
    const { input, key } = setup();
    key('keydown', 'KeyZ');
    key('keyup', 'KeyZ');
    input.update();
    expect(input.pressed('fire')).toBe(true);
    expect(input.held('fire')).toBe(false);
  });

  it('ignores auto-repeat and fires listeners inside the event', () => {
    const { input, key } = setup();
    let n = 0;
    input.on('fire', () => n++);
    key('keydown', 'Space');
    key('keydown', 'Space', true);
    expect(n).toBe(1);
  });

  it('leaves browser shortcuts alone', () => {
    const { input, target } = setup();
    const e = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Space', metaKey: true });
    target.dispatchEvent(e);
    input.update();
    expect(e.defaultPrevented).toBe(false);
    expect(input.pressed('fire')).toBe(false);
  });

  it('ignores the mouse events that follow a tap', () => {
    const { input, target } = setup();
    target.dispatchEvent(new Event('touchstart'));
    target.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }));
    expect(input.device.kind).toBe('touch');
  });

  it('prevents default only on bound keys', () => {
    const { key } = setup();
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(key('keydown', 'KeyQ').defaultPrevented).toBe(false);
  });

  it('builds axes from two actions', () => {
    const { input, key } = setup();
    key('keydown', 'ArrowRight');
    input.update();
    expect(input.axis('left', 'right')).toBe(1);
  });

  it('mouse buttons bind like keys', () => {
    const { input, target } = setup();
    target.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }));
    input.update();
    expect(input.pressed('shoot')).toBe(true);
  });
});

describe('gamepad', () => {
  it('maps positional buttons and switches the device', () => {
    const { input, pads } = setup();
    const p = pad();
    pads.push(p);
    input.update();
    expect(input.device.kind).toBe('keyboard');
    press(p, 0);
    input.update();
    expect(input.pressed('fire')).toBe(true);
    expect(input.device).toMatchObject({ kind: 'gamepad', family: 'xbox' });
    expect(input.label('fire')).toBe('A');
    input.update();
    expect(input.pressed('fire')).toBe(false);
    expect(input.held('fire')).toBe(true);
  });

  it('reads sticks as analog values past the deadzone', () => {
    const { input, pads } = setup();
    const p = pad();
    pads.push(p);
    p.axes[0] = -0.1;
    input.update();
    expect(input.value('left')).toBe(0);
    p.axes[0] = -0.8;
    input.update();
    expect(input.value('left')).toBeCloseTo(0.75);
    expect(input.held('left')).toBe(true);
    expect(input.axis('left', 'right')).toBeCloseTo(-0.75);
  });

  it('goes back to the keyboard on a key press', () => {
    const { input, pads, key } = setup();
    const p = pad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
    pads.push(p);
    press(p, 9);
    input.update();
    expect(input.device.family).toBe('playstation');
    key('keydown', 'Enter');
    expect(input.device.kind).toBe('keyboard');
  });

  it('auto-repeats held directions for menus', () => {
    const { input, pads } = setup();
    const p = pad();
    pads.push(p);
    const seen: string[] = [];
    input.onPad(k => seen.push(k));
    press(p, 13);
    input.update();
    press(p, 0);
    input.update();
    expect(seen).toEqual(['Down', 'South']);
  });
});

describe('glyphs', () => {
  it('detects pad families', () => {
    expect(familyOf('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('switch');
    expect(familyOf('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(familyOf('8BitDo SN30 Pro')).toBe('generic');
  });

  it('names keys', () => {
    expect(keyName('KeyQ')).toBe('Q');
    expect(keyName('Digit3')).toBe('3');
    expect(keyName('Escape')).toBe('Esc');
  });

  it('picks the binding for the device', () => {
    const def = { keys: ['Space', 'KeyZ'], pad: ['South', 'R2'], touch: 'Tap' };
    expect(glyphsFor(def, { kind: 'keyboard', family: 'keyboard' })).toEqual([
      { kind: 'key', code: 'Space', label: 'Space' },
    ]);
    expect(glyphsFor(def, { kind: 'gamepad', family: 'playstation' })).toEqual([
      { kind: 'face', family: 'playstation', pos: 'South' },
    ]);
    expect(glyphsFor(def, { kind: 'touch', family: 'touch' })).toEqual([{ kind: 'text', label: 'Tap' }]);
    expect(glyphsFor(def, { kind: 'gamepad', family: 'xbox' }, true)).toHaveLength(2);
    expect(glyphsFor({ keys: ['Arrows'] }, { kind: 'keyboard', family: 'keyboard' })[0].kind).toBe('cluster');
  });

  it('parses prompts into words and glyphs', () => {
    const { input } = setup();
    const parts = parsePrompt(input, 'PRESS {start} TO {move}');
    expect(parts.map(p => Object.keys(p)[0])).toEqual(['text', 'glyph', 'text', 'glyph']);
  });

  it('reads touch labels as words', () => {
    const { input, target } = setup();
    target.dispatchEvent(new Event('touchstart'));
    expect(parsePrompt(input, 'PRESS {start} TO PLAY')).toEqual([{ text: 'PRESS TAP TO PLAY' }]);
  });
});
