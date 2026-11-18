// Gamepad navigation for DOM menus: the d-pad or left stick moves focus to the
// nearest control in that direction, South activates it, East goes back.
// Keyboard and mouse keep working natively.
import type { Input } from './input.ts';

export interface MenuNavOptions {
  /** Only controls inside this element (or the first match, when a function). Default document.body. */
  root?: Element | (() => Element | null);
  /** Focusable controls. */
  selector?: string;
  /** Navigation is ignored while this returns false (e.g. during play). */
  enabled?: () => boolean;
  /** East / Back pressed. */
  onBack?: () => void;
  /** Focus moved by the pad. */
  onMove?: (el: HTMLElement) => void;
}

const SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const DIRS: Record<string, [number, number]> = {
  Up: [0, -1],
  Down: [0, 1],
  Left: [-1, 0],
  Right: [1, 0],
  LStickUp: [0, -1],
  LStickDown: [0, 1],
  LStickLeft: [-1, 0],
  LStickRight: [1, 0],
};

export interface MenuNav {
  /** Put pad focus on a control (null clears it), e.g. the default button when a screen opens. */
  focus(el: HTMLElement | null): void;
  destroy(): void;
}

export function menuNav(input: Input, o: MenuNavOptions = {}): MenuNav {
  const sel = o.selector ?? SELECTOR;
  const rootOf = () => (typeof o.root === 'function' ? o.root() : (o.root ?? document.body));
  const visible = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const items = () => {
    const root = rootOf();
    return root ? [...root.querySelectorAll<HTMLElement>(sel)].filter(visible) : [];
  };
  const focus = (el: HTMLElement) => {
    document.querySelectorAll('.pad-focus').forEach(e => e.classList.remove('pad-focus'));
    el.classList.add('pad-focus');
    el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    el.scrollIntoView?.({ block: 'nearest' });
    o.onMove?.(el);
  };
  const clear = () => document.querySelectorAll('.pad-focus').forEach(e => e.classList.remove('pad-focus'));

  function move(dx: number, dy: number) {
    const list = items();
    if (!list.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !list.includes(cur)) {
      focus(
        list.find(el => el.matches('[autofocus], .primary, [aria-selected="true"], [aria-checked="true"]')) ?? list[0],
      );
      return;
    }
    const a = cur.getBoundingClientRect(),
      ax = a.left + a.width / 2,
      ay = a.top + a.height / 2;
    let best: HTMLElement | null = null,
      score = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect(),
        bx = b.left + b.width / 2,
        by = b.top + b.height / 2;
      const along = (bx - ax) * dx + (by - ay) * dy;
      // a quarter of the current control's size: hover lifts and other small transforms
      // must not turn "down" into a sideways step
      if (along <= (dx ? a.width : a.height) / 4) continue;
      const across = Math.abs((bx - ax) * dy) + Math.abs((by - ay) * dx);
      const s = along + across * 2.5;
      if (s < score) {
        score = s;
        best = el;
      }
    }
    if (best) focus(best);
  }

  const off = input.onPad(k => {
    if (o.enabled && !o.enabled()) return;
    if (k in DIRS) {
      move(...DIRS[k]);
      return;
    }
    if (k === 'South') {
      const cur = document.activeElement as HTMLElement | null;
      if (cur && items().includes(cur)) cur.click();
      else move(0, 1);
    }
    if (k === 'East') o.onBack?.();
  });
  const offPointer = () => clear();
  addEventListener('pointerdown', offPointer);
  return {
    focus: el => (el ? focus(el) : clear()),
    destroy() {
      off();
      removeEventListener('pointerdown', offPointer);
      clear();
    },
  };
}
