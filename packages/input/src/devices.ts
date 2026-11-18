// Device families and the vocabulary of physical inputs bindings are written in.

export type Family = 'keyboard' | 'xbox' | 'playstation' | 'switch' | 'generic' | 'touch';
export type DeviceKind = 'keyboard' | 'gamepad' | 'touch';
export interface Device {
  kind: DeviceKind;
  family: Family;
  /** Gamepad.id of the pad, when kind is 'gamepad'. */
  id?: string;
}

export const KEYBOARD: Device = { kind: 'keyboard', family: 'keyboard' };
export const TOUCH: Device = { kind: 'touch', family: 'touch' };

/**
 * Pad buttons by position (W3C "standard" mapping), not by printed letter: the
 * South button is A on Xbox, ✕ on PlayStation and B on Switch.
 */
export const PAD_BUTTONS = {
  South: 0,
  East: 1,
  West: 2,
  North: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  Select: 8,
  Start: 9,
  L3: 10,
  R3: 11,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
  Home: 16,
} as const;
export type PadButton = keyof typeof PAD_BUTTONS;

/** Stick directions usable as digital (or analog 0..1) inputs: [axis, sign]. */
export const PAD_AXES = {
  LStickLeft: [0, -1],
  LStickRight: [0, 1],
  LStickUp: [1, -1],
  LStickDown: [1, 1],
  RStickLeft: [2, -1],
  RStickRight: [2, 1],
  RStickUp: [3, -1],
  RStickDown: [3, 1],
} as const;
export type PadAxis = keyof typeof PAD_AXES;

/** Display-only pad entries: a whole stick or d-pad shown as one glyph. */
export const PAD_CLUSTERS = ['LStick', 'RStick', 'Dpad', 'DpadH', 'DpadV'] as const;

/** Mouse buttons usable in `keys` bindings (MouseEvent.button). */
export const MOUSE_BUTTONS = { MouseLeft: 0, MouseMiddle: 1, MouseRight: 2 } as const;

/** Display-only keyboard entries: a key group shown as one glyph. */
export const KEY_CLUSTERS: Record<string, (string | null)[][]> = {
  Arrows: [
    [null, 'ArrowUp', null],
    ['ArrowLeft', 'ArrowDown', 'ArrowRight'],
  ],
  WASD: [
    [null, 'KeyW', null],
    ['KeyA', 'KeyS', 'KeyD'],
  ],
  ArrowsH: [['ArrowLeft', 'ArrowRight']],
  ArrowsV: [['ArrowUp', 'ArrowDown']],
  AD: [['KeyA', 'KeyD']],
  WS: [['KeyW', 'KeyS']],
};

export function familyOf(id: string): Family {
  const s = id.toLowerCase();
  if (/054c|playstation|dualshock|dualsense|sony|ps[345]\b/.test(s)) return 'playstation';
  if (/057e|nintendo|switch|joy-?con|pro controller/.test(s)) return 'switch';
  if (/045e|xbox|xinput|microsoft/.test(s)) return 'xbox';
  return 'generic';
}

/** Printed names of each positional button, per family. */
const PAD_NAMES: Record<Exclude<Family, 'keyboard' | 'touch'>, Partial<Record<PadButton, string>>> = {
  xbox: {
    South: 'A',
    East: 'B',
    West: 'X',
    North: 'Y',
    L1: 'LB',
    R1: 'RB',
    L2: 'LT',
    R2: 'RT',
    Select: 'View',
    Start: 'Menu',
    L3: 'LS',
    R3: 'RS',
    Home: 'Xbox',
  },
  playstation: {
    South: '✕',
    East: '○',
    West: '□',
    North: '△',
    L1: 'L1',
    R1: 'R1',
    L2: 'L2',
    R2: 'R2',
    Select: 'Create',
    Start: 'Options',
    L3: 'L3',
    R3: 'R3',
    Home: 'PS',
  },
  switch: {
    South: 'B',
    East: 'A',
    West: 'Y',
    North: 'X',
    L1: 'L',
    R1: 'R',
    L2: 'ZL',
    R2: 'ZR',
    Select: '−',
    Start: '+',
    L3: 'LS',
    R3: 'RS',
    Home: 'Home',
  },
  generic: {
    South: 'A',
    East: 'B',
    West: 'X',
    North: 'Y',
    L1: 'L1',
    R1: 'R1',
    L2: 'L2',
    R2: 'R2',
    Select: 'Select',
    Start: 'Start',
    L3: 'L3',
    R3: 'R3',
    Home: 'Home',
  },
};

export function padName(input: string, family: Family): string {
  const names = PAD_NAMES[family === 'keyboard' || family === 'touch' ? 'generic' : family];
  if (input in names) return names[input as PadButton]!;
  const dirs: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' };
  const m = input.match(/^([LR])Stick(Up|Down|Left|Right)?$/);
  if (m) return `${m[1]} stick${m[2] ? ' ' + dirs[m[2]] : ''}`;
  if (input.startsWith('Dpad')) return 'D-pad';
  return input;
}

// ---------- keyboard labels ----------

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Bksp',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  MetaLeft: 'Cmd',
  MetaRight: 'Cmd',
  CapsLock: 'Caps',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  MouseLeft: 'LMB',
  MouseRight: 'RMB',
  MouseMiddle: 'MMB',
  Mouse: 'Mouse',
  Wheel: 'Wheel',
};

let layout: Map<string, string> | null = null;
/** Ask the browser for the real keyboard layout (Chromium), so KeyQ reads "A" on AZERTY. */
// asked once per page: every input (and every launcher preview) shares the answer
let layoutQuery: Promise<void> | null = null;
export function loadKeyboardLayout(): Promise<void> {
  return (layoutQuery ??= (async () => {
    try {
      const kb = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
      if (kb?.getLayoutMap) layout = await kb.getLayoutMap();
    } catch {
      /* not allowed here (iframe, permissions): keep QWERTY names */
    }
  })());
}

export function keyName(code: string): string {
  const mapped = layout?.get(code);
  // only Latin layouts (AZERTY, QWERTZ…): Cyrillic or Greek letters would be missing from
  // bitmap fonts, and those players know the QWERTY legends too
  if (mapped && /^[\x21-\x7e]$/.test(mapped)) return mapped.toUpperCase();
  if (code in KEY_NAMES) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
