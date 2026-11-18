// Action-based input over keyboard, mouse buttons and gamepads, with fixed-step
// friendly edges and "last used device" tracking for prompts.
import {
  KEYBOARD,
  MOUSE_BUTTONS,
  PAD_AXES,
  PAD_BUTTONS,
  TOUCH,
  familyOf,
  keyName,
  loadKeyboardLayout,
  padName,
  type Device,
  type PadAxis,
  type PadButton,
} from './devices.ts';

export interface ActionDef {
  /** KeyboardEvent.code values and MouseLeft / MouseRight / MouseMiddle. First one is shown in prompts. */
  keys?: string[];
  /** Positional pad inputs (South, R2, Up, LStickLeft…). First one is shown in prompts. */
  pad?: string[];
  /** Prompt text for touch devices, e.g. "Tap". */
  touch?: string;
}

export interface InputOptions {
  /** Actions the game reads (held / pressed / value) and shows in prompts. */
  actions: Record<string, ActionDef>;
  /** Prompt-only entries, e.g. `move: { keys: ['Arrows'], pad: ['LStick'] }`. */
  display?: Record<string, ActionDef>;
  /** Stick radius ignored as noise. Default 0.2. */
  deadzone?: number;
  /** Analog value that counts as "held". Default 0.5. */
  threshold?: number;
  /** Where keyboard and blur events are heard. Default `window`. */
  target?: EventTarget;
  /** Where mouse-button bindings are heard (e.g. the game canvas). Default `target`. */
  mouseTarget?: EventTarget;
  /** preventDefault on bound keys (default), on none (false), or on the codes listed. */
  preventDefault?: boolean | string[];
  /** Poll pads on every animation frame instead of from the game loop (DOM menus). */
  autoUpdate?: boolean;
  /** Injected for tests. */
  getGamepads?: () => (Gamepad | null)[];
}

export type Listener = () => void;

export interface Input {
  /** Snapshot pads and edges. Call once per fixed update step, before reading. */
  update(): void;
  /** Currently down. */
  held(action: string): boolean;
  /** Went down since the previous update(). */
  pressed(action: string): boolean;
  /** Went up since the previous update(). */
  released(action: string): boolean;
  /** 0..1, analog for triggers and stick directions. */
  value(action: string): number;
  /** value(positive) − value(negative), -1..1. */
  axis(negative: string, positive: string): number;
  /** Raw stick with deadzone applied, -1..1 per axis. */
  stick(side: 'left' | 'right'): { x: number; y: number };
  /** Any key, mouse button or pad button went down since the previous update(). */
  anyPressed(): boolean;
  /** Last device the player touched. */
  readonly device: Device;
  /** Run on press. Keys fire inside the DOM event (fullscreen, audio unlock); pads during update(). */
  on(action: string, fn: Listener): () => void;
  /** Run when the active device (or pad family) changes. */
  onDevice(fn: (d: Device) => void): () => void;
  /** Raw pad button / stick direction presses, with auto-repeat for directions. For menus. */
  onPad(fn: (input: string) => void): () => void;
  /** Bindings of an action or display entry. */
  def(name: string): ActionDef | undefined;
  /** Plain-text name for the current device: "Space", "A", "✕", "Tap". */
  label(name: string): string;
  /** Short rumble on the last used pad. */
  rumble(ms?: number, strong?: number, weak?: number): void;
  /** Forget everything held (also done on window blur). */
  reset(): void;
  destroy(): void;
}

const BUTTON_NAMES = Object.keys(PAD_BUTTONS) as PadButton[];
const AXIS_NAMES = Object.keys(PAD_AXES) as PadAxis[];
const DIRECTIONS = new Set(['Up', 'Down', 'Left', 'Right', 'LStickUp', 'LStickDown', 'LStickLeft', 'LStickRight']);
const REPEAT_DELAY = 0.38,
  REPEAT_RATE = 0.11;

let current: Input | null = null;
const currentListeners = new Set<(i: Input) => void>();
/** The most recently created input: what <input-glyph> elements read. */
export const currentInput = () => current;
export function onCurrentInput(fn: (i: Input) => void) {
  currentListeners.add(fn);
  return () => currentListeners.delete(fn);
}

export function createInput(opts: InputOptions): Input {
  const actions = opts.actions,
    display = opts.display ?? {};
  const deadzone = opts.deadzone ?? 0.2,
    threshold = opts.threshold ?? 0.5;
  const target = opts.target ?? window,
    mouseTarget = opts.mouseTarget ?? target;
  const getPads =
    opts.getGamepads ??
    (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : []));
  const names = Object.keys(actions);

  const bound = new Set(names.flatMap(n => actions[n].keys ?? []));
  const prevent =
    opts.preventDefault === false
      ? new Set<string>()
      : Array.isArray(opts.preventDefault)
        ? new Set(opts.preventDefault)
        : bound;

  // keyboard + mouse state; `downs` collects presses between updates so a tap
  // shorter than one step still registers
  const live = new Set<string>(),
    downs = new Set<string>(),
    ups = new Set<string>();
  let held = new Set<string>(),
    pressed = new Set<string>(),
    released = new Set<string>();
  const values = new Map<string, number>();
  let padHeld = new Set<string>();
  let sticks = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  let anyDown = false,
    anyPad = false;
  let device: Device = KEYBOARD,
    activePad: Gamepad | null = null;
  const repeat = new Map<string, number>();
  let lastUpdate = 0;

  const actionListeners = new Map<string, Set<Listener>>();
  const deviceListeners = new Set<(d: Device) => void>();
  const padListeners = new Set<(input: string) => void>();
  const emit = (action: string) => actionListeners.get(action)?.forEach(fn => fn());
  const actionsFor = (code: string) => names.filter(n => actions[n].keys?.includes(code));

  function setDevice(d: Device) {
    if (d.kind === device.kind && d.family === device.family && d.id === device.id) return;
    device = d;
    deviceListeners.forEach(fn => fn(d));
  }

  function down(code: string) {
    if (!live.has(code)) {
      downs.add(code);
      actionsFor(code).forEach(emit);
    }
    live.add(code);
  }
  function up(code: string) {
    if (live.delete(code)) ups.add(code);
  }

  const onKeyDown = (e: Event) => {
    const k = e as KeyboardEvent;
    if (isTyping(k.target)) return;
    setDevice(KEYBOARD);
    // browser and OS shortcuts (Cmd+R, Ctrl+F…) are not game input
    if (k.ctrlKey || k.metaKey || k.altKey) return;
    if (prevent.has(k.code)) k.preventDefault();
    if (!k.repeat) down(k.code);
  };
  const onKeyUp = (e: Event) => up((e as KeyboardEvent).code);
  const mouseCode = (e: Event) =>
    Object.keys(MOUSE_BUTTONS).find(c => MOUSE_BUTTONS[c as keyof typeof MOUSE_BUTTONS] === (e as MouseEvent).button);
  // browsers follow a tap with compatibility mouse events: don't let those flip the device
  let lastTouch = -Infinity;
  const fromTouch = (e: Event) =>
    (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents ===
      true || e.timeStamp - lastTouch < 1000;
  const onMouseDown = (e: Event) => {
    if (fromTouch(e)) return;
    setDevice(KEYBOARD);
    const c = mouseCode(e);
    if (c) down(c);
  };
  const onMouseUp = (e: Event) => {
    const c = mouseCode(e);
    if (c) up(c);
  };
  let travel = 0,
    last: { x: number; y: number } | null = null;
  const onMouseMove = (e: Event) => {
    const m = e as MouseEvent;
    if (device.kind === 'keyboard' || fromTouch(e)) {
      last = null;
      return;
    }
    if (last) travel += Math.hypot(m.clientX - last.x, m.clientY - last.y);
    last = { x: m.clientX, y: m.clientY };
    if (travel > 60) {
      travel = 0;
      last = null;
      setDevice(KEYBOARD);
    }
  };
  const onTouch = (e: Event) => {
    lastTouch = e.timeStamp;
    setDevice(TOUCH);
  };
  const reset = () => {
    for (const c of live) ups.add(c);
    live.clear();
  };

  const on = (t: EventTarget, type: string, fn: (e: Event) => void) => {
    t.addEventListener(type, fn);
    return () => t.removeEventListener(type, fn);
  };
  const offs = [
    on(target, 'keydown', onKeyDown),
    on(target, 'keyup', onKeyUp),
    on(target, 'blur', reset),
    on(mouseTarget, 'mousedown', onMouseDown),
    on(target, 'mouseup', onMouseUp),
    on(target, 'mousemove', onMouseMove),
    on(target, 'touchstart', onTouch),
  ];

  function readPads() {
    const vals = new Map<string, number>();
    const L = { x: 0, y: 0 },
      R = { x: 0, y: 0 };
    let active: Gamepad | null = null,
      best = 0;
    for (const gp of getPads()) {
      if (!gp || !gp.connected) continue;
      const dz = (v: number) => (Math.abs(v) < deadzone ? 0 : (v - Math.sign(v) * deadzone) / (1 - deadzone));
      const ax = gp.axes.map(dz);
      let energy = 0;
      BUTTON_NAMES.forEach(n => {
        const b = gp.buttons[PAD_BUTTONS[n]];
        if (!b) return;
        const v = n === 'L2' || n === 'R2' ? b.value || (b.pressed ? 1 : 0) : b.pressed ? 1 : b.value;
        if (v > (vals.get(n) ?? 0)) vals.set(n, v);
        energy = Math.max(energy, v);
      });
      AXIS_NAMES.forEach(n => {
        const [i, sign] = PAD_AXES[n],
          v = Math.max(0, (ax[i] ?? 0) * sign);
        if (v > (vals.get(n) ?? 0)) vals.set(n, v);
        energy = Math.max(energy, v);
      });
      if (Math.hypot(ax[0] ?? 0, ax[1] ?? 0) > Math.hypot(L.x, L.y)) {
        L.x = ax[0] ?? 0;
        L.y = ax[1] ?? 0;
      }
      if (Math.hypot(ax[2] ?? 0, ax[3] ?? 0) > Math.hypot(R.x, R.y)) {
        R.x = ax[2] ?? 0;
        R.y = ax[3] ?? 0;
      }
      if (energy > best) {
        best = energy;
        active = gp;
      }
    }
    return { vals, L, R, active: best >= threshold ? active : null };
  }

  function update() {
    const now = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
    const dt = lastUpdate ? Math.min(0.1, now - lastUpdate) : 0;
    lastUpdate = now;

    const pads = readPads();
    const nowPadHeld = new Set([...pads.vals].filter(([, v]) => v >= threshold).map(([k]) => k));
    anyPad = [...nowPadHeld].some(k => !padHeld.has(k));
    if (pads.active) {
      activePad = pads.active;
      if (anyPad || device.kind !== 'gamepad')
        setDevice({ kind: 'gamepad', family: familyOf(pads.active.id), id: pads.active.id });
    }
    // raw pad presses (+ repeat on directions) for menus
    for (const k of nowPadHeld) {
      if (!padHeld.has(k)) {
        padListeners.forEach(fn => fn(k));
        repeat.set(k, REPEAT_DELAY);
        continue;
      }
      if (!DIRECTIONS.has(k)) continue;
      const left = (repeat.get(k) ?? REPEAT_DELAY) - dt;
      if (left <= 0) {
        padListeners.forEach(fn => fn(k));
        repeat.set(k, REPEAT_RATE);
      } else repeat.set(k, left);
    }
    for (const k of repeat.keys()) if (!nowPadHeld.has(k)) repeat.delete(k);

    const nextHeld = new Set<string>(),
      nextPressed = new Set<string>(),
      nextReleased = new Set<string>();
    for (const n of names) {
      const a = actions[n];
      const keyHeld = a.keys?.some(c => live.has(c)) ?? false;
      const keyDown = a.keys?.some(c => downs.has(c)) ?? false;
      const keyUp = a.keys?.some(c => ups.has(c)) ?? false;
      const pv = Math.max(0, ...(a.pad ?? []).map(p => pads.vals.get(p) ?? 0));
      const padOn = pv >= threshold,
        padWas = (a.pad ?? []).some(p => padHeld.has(p));
      const v = Math.max(keyHeld ? 1 : 0, pv);
      values.set(n, v);
      const isHeld = keyHeld || padOn;
      if (isHeld) nextHeld.add(n);
      if (keyDown || (padOn && !padWas)) nextPressed.add(n);
      if ((keyUp && !isHeld) || (!padOn && padWas && !keyHeld)) nextReleased.add(n);
      if (padOn && !padWas) emit(n);
    }
    held = nextHeld;
    pressed = nextPressed;
    released = nextReleased;
    anyDown = downs.size > 0 || anyPad;
    padHeld = nowPadHeld;
    sticks = { left: pads.L, right: pads.R };
    downs.clear();
    ups.clear();
  }

  let raf = 0;
  if (opts.autoUpdate && typeof requestAnimationFrame !== 'undefined') {
    const loop = () => {
      update();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  if (typeof navigator !== 'undefined') void loadKeyboardLayout().then(() => deviceListeners.forEach(fn => fn(device)));

  const input: Input = {
    update,
    held: a => held.has(a),
    pressed: a => pressed.has(a),
    released: a => released.has(a),
    value: a => values.get(a) ?? 0,
    axis: (n, p) => (values.get(p) ?? 0) - (values.get(n) ?? 0),
    stick: side => ({ ...sticks[side] }),
    anyPressed: () => anyDown,
    get device() {
      return device;
    },
    on(action, fn) {
      if (!actions[action]) throw new Error(`Unknown action "${action}"`);
      if (!actionListeners.has(action)) actionListeners.set(action, new Set());
      actionListeners.get(action)!.add(fn);
      return () => actionListeners.get(action)!.delete(fn);
    },
    onDevice(fn) {
      deviceListeners.add(fn);
      return () => deviceListeners.delete(fn);
    },
    onPad(fn) {
      padListeners.add(fn);
      return () => padListeners.delete(fn);
    },
    def: name => actions[name] ?? display[name],
    label(name) {
      const d = actions[name] ?? display[name];
      if (!d) return name;
      if (device.kind === 'gamepad' && d.pad?.length) return padName(d.pad[0], device.family);
      if (device.kind === 'touch' && d.touch) return d.touch;
      if (d.keys?.length) return keyName(d.keys[0]);
      return d.pad?.length ? padName(d.pad[0], 'generic') : name;
    },
    rumble(ms = 120, strong = 0.6, weak = 0.3) {
      const act = (
        activePad as
          | (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } })
          | null
      )?.vibrationActuator;
      act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    },
    reset,
    destroy() {
      offs.forEach(off => off());
      if (raf) cancelAnimationFrame(raf);
      actionListeners.clear();
      deviceListeners.clear();
      padListeners.clear();
      if (current === input) current = null;
    },
  };
  current = input;
  currentListeners.forEach(fn => fn(input));
  return input;
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    typeof el.closest === 'function' &&
    !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
  );
}
