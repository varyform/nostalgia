// Key and button pictures for prompts, drawn on a 2D canvas.
// Two pens: vector (antialiased paths, any resolution) and pixel (scanline-filled
// integer rects, so a 4-colour CGA canvas stays 4-colour).
import { KEY_CLUSTERS, keyName, padName, type Device, type Family } from './devices.ts';
import type { ActionDef, Input } from './input.ts';

export type Dir = 'up' | 'down' | 'left' | 'right' | 'all' | 'h' | 'v' | 'press';
export type PadFamily = Exclude<Family, 'keyboard' | 'touch'>;
export type Glyph =
  | { kind: 'key'; code: string; label: string }
  | { kind: 'cluster'; rows: (string | null)[][] }
  | { kind: 'mouse'; button: 'left' | 'right' | 'middle' | 'move' | 'wheel' }
  | { kind: 'face'; family: PadFamily; pos: 'South' | 'East' | 'West' | 'North' }
  | { kind: 'shoulder'; family: PadFamily; input: 'L1' | 'R1' | 'L2' | 'R2' }
  | { kind: 'dpad'; dir: Dir }
  | { kind: 'stick'; side: 'L' | 'R'; dir: Dir }
  | { kind: 'menu'; family: PadFamily; input: 'Start' | 'Select' | 'Home' }
  | { kind: 'text'; label: string };

export interface GlyphStyle {
  /** Snap to whole pixels and never antialias (low-res palette canvases). */
  pixel?: boolean;
  /** CSS font family for labels (vector pen). */
  font?: string;
  /** Keycap face, keycap edge, label on keycaps. */
  cap?: string;
  edge?: string;
  capInk?: string;
  /** Pad button body and its label. */
  pad?: string;
  padInk?: string;
  /** Text glyphs ("Tap") and dimmed parts. */
  ink?: string;
  dim?: string;
  /** Colour face buttons the way the pad prints them. Default true. */
  brand?: boolean;
  /** Custom text renderer (bitmap fonts): draw `s` centred on cx,cy. */
  text?: (ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, color: string) => void;
  /** Width of `s` for the custom renderer. */
  measure?: (s: string) => number;
}

export const DEFAULT_STYLE: Required<Omit<GlyphStyle, 'text' | 'measure'>> = {
  pixel: false,
  font: 'system-ui, sans-serif',
  cap: 'oklch(0.94 0.01 260)',
  edge: 'oklch(0.6 0.02 260)',
  capInk: 'oklch(0.22 0.02 260)',
  pad: 'oklch(0.26 0.02 260)',
  padInk: 'oklch(0.97 0 0)',
  ink: 'oklch(0.97 0 0)',
  dim: 'oklch(0.55 0.02 260)',
  brand: true,
};

const BRAND: Record<string, Partial<Record<string, string>>> = {
  xbox: {
    South: 'oklch(0.74 0.19 145)',
    East: 'oklch(0.65 0.21 25)',
    West: 'oklch(0.66 0.16 250)',
    North: 'oklch(0.86 0.17 95)',
  },
  playstation: {
    South: 'oklch(0.72 0.12 250)',
    East: 'oklch(0.67 0.2 20)',
    West: 'oklch(0.75 0.13 345)',
    North: 'oklch(0.78 0.13 170)',
  },
};

// ---------- resolving ----------

function keyGlyph(code: string): Glyph {
  if (code in KEY_CLUSTERS) return { kind: 'cluster', rows: KEY_CLUSTERS[code] };
  if (code === 'MouseLeft') return { kind: 'mouse', button: 'left' };
  if (code === 'MouseRight') return { kind: 'mouse', button: 'right' };
  if (code === 'MouseMiddle') return { kind: 'mouse', button: 'middle' };
  if (code === 'Mouse') return { kind: 'mouse', button: 'move' };
  if (code === 'Wheel') return { kind: 'mouse', button: 'wheel' };
  return { kind: 'key', code, label: keyName(code) };
}

export function padGlyph(input: string, family: Family): Glyph {
  const fam: PadFamily = family === 'keyboard' || family === 'touch' ? 'generic' : family;
  if (input === 'South' || input === 'East' || input === 'West' || input === 'North')
    return { kind: 'face', family: fam, pos: input };
  if (input === 'L1' || input === 'R1' || input === 'L2' || input === 'R2')
    return { kind: 'shoulder', family: fam, input };
  if (input === 'Start' || input === 'Select' || input === 'Home') return { kind: 'menu', family: fam, input };
  const dir = (s?: string): Dir => (s ? (s.toLowerCase() as Dir) : 'all');
  if (input === 'Up' || input === 'Down' || input === 'Left' || input === 'Right')
    return { kind: 'dpad', dir: dir(input) };
  if (input === 'Dpad') return { kind: 'dpad', dir: 'all' };
  if (input === 'DpadH') return { kind: 'dpad', dir: 'h' };
  if (input === 'DpadV') return { kind: 'dpad', dir: 'v' };
  const m = input.match(/^([LR])Stick(Up|Down|Left|Right|H|V)?$/);
  if (m) return { kind: 'stick', side: m[1] as 'L' | 'R', dir: m[2] === 'H' ? 'h' : m[2] === 'V' ? 'v' : dir(m[2]) };
  if (input === 'L3' || input === 'R3') return { kind: 'stick', side: input[0] as 'L' | 'R', dir: 'press' };
  return { kind: 'text', label: padName(input, family) };
}

/** Glyphs for a binding on a device: the first binding, or every one with `all`. */
export function glyphsFor(def: ActionDef | undefined, device: Device, all = false): Glyph[] {
  if (!def) return [];
  const pick = (list: string[]) => (all ? list : list.slice(0, 1));
  if (device.kind === 'gamepad' && def.pad?.length) return pick(def.pad).map(p => padGlyph(p, device.family));
  if (device.kind === 'touch' && def.touch) return [{ kind: 'text', label: def.touch }];
  if (def.keys?.length) return pick(def.keys).map(keyGlyph);
  if (def.pad?.length) return pick(def.pad).map(p => padGlyph(p, 'generic'));
  return [];
}

export function glyphs(input: Input, name: string, all = false): Glyph[] {
  const d = input.def(name);
  return d ? glyphsFor(d, input.device, all) : [{ kind: 'text', label: name }];
}

/** Accessible name of a glyph: "Space key", "A button", "Left stick". */
export function describe(g: Glyph): string {
  switch (g.kind) {
    case 'key':
      return `${g.label === ' ' ? 'Space' : g.label} key`;
    case 'cluster':
      return g.rows.flat().every(c => !c || c.startsWith('Arrow'))
        ? 'Arrow keys'
        : `${g.rows
            .flat()
            .filter((c): c is string => !!c)
            .map(keyName)
            .join(' ')} keys`;
    case 'mouse':
      return g.button === 'move' ? 'Mouse' : `${g.button[0].toUpperCase()}${g.button.slice(1)} mouse button`;
    case 'face':
      return `${padName(g.pos, g.family)} button`;
    case 'shoulder':
      return padName(g.input, g.family);
    case 'menu':
      return `${padName(g.input, g.family)} button`;
    case 'dpad':
      return 'D-pad';
    case 'stick':
      return `${g.side === 'L' ? 'Left' : 'Right'} stick${g.dir === 'press' ? ' press' : ''}`;
    case 'text':
      return g.label;
  }
}

// ---------- pens ----------

type Contour = number[]; // x0,y0,x1,y1…
interface Pen {
  fill(contours: Contour[], color: string): void;
  text(s: string, cx: number, cy: number, px: number, color: string): void;
  textWidth(s: string, px: number): number;
}

function vectorPen(ctx: CanvasRenderingContext2D, st: GlyphStyle): Pen {
  const font = (px: number) => `700 ${px}px ${st.font ?? DEFAULT_STYLE.font}`;
  return {
    fill(cs, color) {
      ctx.beginPath();
      for (const c of cs) {
        ctx.moveTo(c[0], c[1]);
        for (let i = 2; i < c.length; i += 2) ctx.lineTo(c[i], c[i + 1]);
        ctx.closePath();
      }
      ctx.fillStyle = color;
      ctx.fill('evenodd');
    },
    text(s, cx, cy, px, color) {
      if (st.text) {
        st.text(ctx, s, cx, cy, color);
        return;
      }
      ctx.font = font(px);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s, cx, cy + px * 0.04);
    },
    textWidth(s, px) {
      if (st.measure) return st.measure(s);
      ctx.font = font(px);
      return ctx.measureText(s).width;
    },
  };
}

/** Even-odd scanline fill sampled at pixel centres: no antialiasing, no stray colours. */
function pixelPen(ctx: CanvasRenderingContext2D, st: GlyphStyle): Pen {
  const v = vectorPen(ctx, st);
  return {
    fill(cs, color) {
      let y0 = Infinity,
        y1 = -Infinity;
      for (const c of cs)
        for (let i = 1; i < c.length; i += 2) {
          y0 = Math.min(y0, c[i]);
          y1 = Math.max(y1, c[i]);
        }
      ctx.fillStyle = color;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const sy = y + 0.5,
          xs: number[] = [];
        for (const c of cs) {
          for (let i = 0; i < c.length; i += 2) {
            const ax = c[i],
              ay = c[i + 1],
              j = (i + 2) % c.length,
              bx = c[j],
              by = c[j + 1];
            if (ay <= sy !== by <= sy) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
          }
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const a = Math.round(xs[k]),
            b = Math.round(xs[k + 1]);
          if (b > a) ctx.fillRect(a, y, b - a, 1);
        }
      }
    },
    text: (s, cx, cy, px, color) => v.text(s, cx, cy, px, color),
    textWidth: (s, px) => v.textWidth(s, px),
  };
}

// ---------- shapes ----------

const rect = (x: number, y: number, w: number, h: number): Contour => [x, y, x + w, y, x + w, y + h, x, y + h];
function rrect(x: number, y: number, w: number, h: number, r: number): Contour {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return rect(x, y, w, h);
  const out: number[] = [],
    seg = 5;
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return out;
}
function circle(cx: number, cy: number, r: number, seg = 28): Contour {
  const out: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}
function tri(cx: number, cy: number, s: number, dir: 'up' | 'down' | 'left' | 'right'): Contour {
  const h = s * 0.5;
  switch (dir) {
    case 'up':
      return [cx, cy - h, cx + h, cy + h * 0.7, cx - h, cy + h * 0.7];
    case 'down':
      return [cx, cy + h, cx - h, cy - h * 0.7, cx + h, cy - h * 0.7];
    case 'left':
      return [cx - h, cy, cx + h * 0.7, cy - h, cx + h * 0.7, cy + h];
    case 'right':
      return [cx + h, cy, cx - h * 0.7, cy + h, cx - h * 0.7, cy - h];
  }
}
function bar(x0: number, y0: number, x1: number, y1: number, t: number): Contour {
  const dx = x1 - x0,
    dy = y1 - y0,
    l = Math.hypot(dx, dy) || 1,
    nx = ((-dy / l) * t) / 2,
    ny = ((dx / l) * t) / 2;
  return [x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny];
}
const ARROW: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

// ---------- drawing ----------

interface Ctx {
  pen: Pen;
  st: Required<Omit<GlyphStyle, 'text' | 'measure'>> & GlyphStyle;
  px: boolean;
}

function keycap(c: Ctx, x: number, y: number, w: number, h: number, code: string | null, label: string) {
  const { pen, st, px } = c;
  const r = px ? Math.min(1.5, h * 0.2) : h * 0.2,
    lip = px ? Math.max(1, Math.round(h * 0.14)) : h * 0.13;
  pen.fill([rrect(x, y, w, h, r)], st.edge);
  pen.fill([rrect(x, y, w, h - lip, r)], st.cap);
  const cx = x + w / 2,
    cy = y + (h - lip) / 2;
  if (code && ARROW[code]) pen.fill([tri(cx, cy, h * 0.42, ARROW[code])], st.capInk);
  else if (label) pen.text(label, cx, cy, label.length > 1 ? h * 0.42 : h * 0.56, st.capInk);
}

function keyWidth(c: Ctx, code: string, label: string, h: number) {
  if (ARROW[code]) return h;
  return Math.max(h, c.pen.textWidth(label, label.length > 1 ? h * 0.42 : h * 0.56) + h * 0.6);
}

function measureIn(c: Ctx, g: Glyph, s: number): number {
  const px = c.px,
    round = (n: number) => (px ? Math.round(n) : n);
  switch (g.kind) {
    case 'key':
      return round(keyWidth(c, g.code, g.label, s));
    case 'cluster': {
      const rows = g.rows.length,
        gap = px ? 1 : s * 0.05,
        k = (s - gap * (rows - 1)) / rows;
      const cols = Math.max(...g.rows.map(r => r.length));
      return round(cols * k + (cols - 1) * gap);
    }
    case 'mouse':
      return round(s * 0.68);
    case 'shoulder':
      return round(g.input === 'L1' || g.input === 'R1' ? s * 1.5 : s * 1.2);
    case 'menu': {
      if (g.family === 'playstation' || g.family === 'generic' || g.input === 'Home')
        return round(Math.max(s, c.pen.textWidth(padName(g.input, g.family).toUpperCase(), s * 0.34) + s * 0.6));
      return round(s);
    }
    case 'text':
      return round(c.pen.textWidth(g.label.toUpperCase(), s * 0.6));
    default:
      return round(s);
  }
}

function drawIn(c: Ctx, g: Glyph, x: number, y: number, s: number): number {
  const { pen, st, px } = c;
  if (px) {
    x = Math.round(x);
    y = Math.round(y);
    s = Math.round(s);
  }
  const w = measureIn(c, g, s),
    top = px ? Math.round(y - s / 2) : y - s / 2,
    cx = x + w / 2,
    cy = top + s / 2;

  switch (g.kind) {
    case 'key':
      keycap(c, x, top, w, s, g.code, g.label);
      break;

    case 'cluster': {
      const rows = g.rows.length,
        gap = px ? 1 : s * 0.05,
        k = (s - gap * (rows - 1)) / rows;
      const cols = Math.max(...g.rows.map(r => r.length));
      g.rows.forEach((row, ri) => {
        const off = (cols - row.length) / 2;
        row.forEach((code, ci) => {
          if (!code) return;
          const kx = x + (ci + off) * (k + gap),
            ky = top + ri * (k + gap);
          keycap(
            c,
            px ? Math.round(kx) : kx,
            px ? Math.round(ky) : ky,
            px ? Math.round(k) : k,
            px ? Math.round(k) : k,
            code,
            keyName(code),
          );
        });
      });
      break;
    }

    case 'mouse': {
      const t = px ? 1 : s * 0.07,
        r = w * 0.48;
      pen.fill([rrect(x, top, w, s, r)], st.cap);
      pen.fill([rrect(x, top, w, s, r), rrect(x + t, top + t, w - 2 * t, s - 2 * t, r - t)], st.edge);
      const split = top + s * 0.44;
      pen.fill([rect(x + t, split, w - 2 * t, t)], st.edge);
      pen.fill([rect(cx - t / 2, top + t, t, split - top - t)], st.edge);
      const hi = st.capInk;
      if (g.button === 'left') pen.fill([rrect(x + t, top + t, w / 2 - t * 1.5, split - top - t, r * 0.7)], hi);
      if (g.button === 'right') pen.fill([rrect(cx + t / 2, top + t, w / 2 - t * 1.5, split - top - t, r * 0.7)], hi);
      if (g.button === 'middle' || g.button === 'wheel')
        pen.fill([rrect(cx - w * 0.11, top + s * 0.14, w * 0.22, s * 0.22, w * 0.1)], hi);
      if (g.button === 'move') pen.fill([circle(cx, top + s * 0.7, s * 0.07, 10)], hi);
      break;
    }

    case 'face': {
      const r = s / 2,
        color = st.brand ? (BRAND[g.family]?.[g.pos] ?? st.padInk) : st.padInk;
      pen.fill([circle(cx, cy, r)], st.pad);
      if (g.family === 'playstation') {
        const k = s * 0.24,
          t = px ? 1 : s * 0.09;
        if (g.pos === 'South') {
          pen.fill([bar(cx - k, cy - k, cx + k, cy + k, t)], color);
          pen.fill([bar(cx - k, cy + k, cx + k, cy - k, t)], color);
        }
        if (g.pos === 'East') pen.fill([circle(cx, cy, k * 1.05), circle(cx, cy, k * 1.05 - t)], color);
        if (g.pos === 'West')
          pen.fill(
            [rect(cx - k, cy - k, 2 * k, 2 * k), rect(cx - k + t, cy - k + t, 2 * k - 2 * t, 2 * k - 2 * t)],
            color,
          );
        if (g.pos === 'North') {
          const o = [cx, cy - k * 1.15, cx + k * 1.15, cy + k * 0.8, cx - k * 1.15, cy + k * 0.8];
          const i = t * 1.7,
            inner = [
              cx,
              cy - k * 1.15 + i * 1.2,
              cx + k * 1.15 - i,
              cy + k * 0.8 - t,
              cx - k * 1.15 + i,
              cy + k * 0.8 - t,
            ];
          pen.fill([o, inner], color);
        }
      } else if (g.family === 'generic') {
        const d = s * 0.24,
          rr = s * 0.11;
        const spots = { North: [0, -d], East: [d, 0], South: [0, d], West: [-d, 0] } as const;
        for (const [pos, [dx, dy]] of Object.entries(spots))
          pen.fill([circle(cx + dx, cy + dy, rr, 12)], pos === g.pos ? st.padInk : st.dim);
      } else {
        pen.text(padName(g.pos, g.family), cx, cy, s * 0.6, color);
      }
      break;
    }

    case 'shoulder': {
      const bumper = g.input === 'L1' || g.input === 'R1';
      const h = bumper ? s * 0.7 : s,
        y0 = bumper ? cy - h / 2 : top;
      const shape = bumper ? rrect(x, y0, w, h, h * 0.45) : rrect(x, y0, w, h, w * 0.4);
      pen.fill([shape], st.pad);
      const label = padName(g.input, g.family);
      pen.text(label, cx, y0 + h / 2 + (bumper ? 0 : s * 0.06), s * (label.length > 2 ? 0.36 : 0.42), st.padInk);
      break;
    }

    case 'dpad': {
      const a = s * 0.36,
        h = s / 2,
        e = a / 2;
      const cross = [
        cx - e,
        top,
        cx + e,
        top,
        cx + e,
        cy - e,
        x + w,
        cy - e,
        x + w,
        cy + e,
        cx + e,
        cy + e,
        cx + e,
        top + s,
        cx - e,
        top + s,
        cx - e,
        cy + e,
        x,
        cy + e,
        x,
        cy - e,
        cx - e,
        cy - e,
      ];
      pen.fill([cross], st.pad);
      const lit = (d: 'up' | 'down' | 'left' | 'right') =>
        g.dir === d ||
        g.dir === 'all' ||
        (g.dir === 'h' && (d === 'left' || d === 'right')) ||
        (g.dir === 'v' && (d === 'up' || d === 'down'));
      const ts = a * 0.62,
        off = h - a * 0.55;
      if (lit('up')) pen.fill([tri(cx, cy - off, ts, 'up')], st.padInk);
      if (lit('down')) pen.fill([tri(cx, cy + off, ts, 'down')], st.padInk);
      if (lit('left')) pen.fill([tri(cx - off, cy, ts, 'left')], st.padInk);
      if (lit('right')) pen.fill([tri(cx + off, cy, ts, 'right')], st.padInk);
      break;
    }

    case 'stick': {
      const r = s / 2,
        t = px ? 1 : s * 0.07;
      pen.fill([circle(cx, cy, r)], st.pad);
      pen.fill([circle(cx, cy, r * 0.62), circle(cx, cy, r * 0.62 - t)], st.dim);
      pen.text(g.side + (g.dir === 'press' ? '3' : ''), cx, cy, s * (g.dir === 'press' ? 0.36 : 0.42), st.padInk);
      const ts = s * 0.16,
        off = r * 0.82;
      const lit = (d: 'up' | 'down' | 'left' | 'right') =>
        g.dir === d ||
        g.dir === 'all' ||
        (g.dir === 'h' && (d === 'left' || d === 'right')) ||
        (g.dir === 'v' && (d === 'up' || d === 'down'));
      if (lit('up')) pen.fill([tri(cx, cy - off, ts, 'up')], st.padInk);
      if (lit('down')) pen.fill([tri(cx, cy + off, ts, 'down')], st.padInk);
      if (lit('left')) pen.fill([tri(cx - off, cy, ts, 'left')], st.padInk);
      if (lit('right')) pen.fill([tri(cx + off, cy, ts, 'right')], st.padInk);
      break;
    }

    case 'menu': {
      const label = padName(g.input, g.family);
      if (g.family === 'playstation' || g.family === 'generic' || g.input === 'Home') {
        const h = s * 0.62;
        pen.fill([rrect(x, cy - h / 2, w, h, h / 2)], st.pad);
        pen.text(label.toUpperCase(), cx, cy, s * 0.34, st.padInk);
        break;
      }
      const r = s * 0.45,
        t = px ? 1 : s * 0.08;
      pen.fill([circle(cx, cy, r)], st.pad);
      if (g.family === 'switch') {
        const k = s * 0.2;
        pen.fill([rect(cx - k, cy - t / 2, 2 * k, t)], st.padInk);
        if (g.input === 'Start') pen.fill([rect(cx - t / 2, cy - k, t, 2 * k)], st.padInk);
      } else if (g.input === 'Start') {
        // Xbox Menu: three lines
        const k = s * 0.2;
        for (const dy of [-k * 0.75, 0, k * 0.75]) pen.fill([rect(cx - k, cy + dy - t / 2, 2 * k, t)], st.padInk);
      } else {
        // Xbox View: two overlapping windows
        const k = s * 0.15;
        pen.fill(
          [
            rect(cx - k * 1.4, cy - k * 1.2, k * 1.9, k * 1.6),
            rect(cx - k * 1.4 + t, cy - k * 1.2 + t, k * 1.9 - 2 * t, k * 1.6 - 2 * t),
          ],
          st.padInk,
        );
        pen.fill([rect(cx - k * 0.4, cy - k * 0.3, k * 1.9, k * 1.6)], st.padInk);
      }
      break;
    }

    case 'text':
      pen.text(g.label.toUpperCase(), cx, cy, s * 0.6, st.ink);
      break;
  }
  return w;
}

function prepare(ctx: CanvasRenderingContext2D, style: GlyphStyle = {}): Ctx {
  const st = { ...DEFAULT_STYLE, ...style };
  return { pen: st.pixel ? pixelPen(ctx, st) : vectorPen(ctx, st), st, px: !!st.pixel };
}

/** Width of a glyph `size` px tall. */
/** Run with the canvas state saved: glyphs set font, fill and text alignment. */
function kept<T>(ctx: CanvasRenderingContext2D, fn: () => T): T {
  ctx.save();
  try {
    return fn();
  } finally {
    ctx.restore();
  }
}

export function measureGlyph(ctx: CanvasRenderingContext2D, g: Glyph, size: number, style?: GlyphStyle): number {
  return kept(ctx, () => measureIn(prepare(ctx, style), g, size));
}

/** Draw a glyph with its left edge at x and vertical centre at y. Returns its width. */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  g: Glyph,
  x: number,
  y: number,
  size: number,
  style?: GlyphStyle,
): number {
  return kept(ctx, () => drawIn(prepare(ctx, style), g, x, y, size));
}

/** Draw several glyphs in a row, `gap` apart, joined by a separator if given. Returns total width. */
export function drawGlyphs(
  ctx: CanvasRenderingContext2D,
  gs: Glyph[],
  x: number,
  y: number,
  size: number,
  style?: GlyphStyle,
  gap = size * 0.2,
): number {
  return kept(ctx, () => {
    const c = prepare(ctx, style);
    let w = 0;
    gs.forEach((g, i) => {
      if (i) w += gap;
      w += drawIn(c, g, x + w, y, size);
    });
    return w;
  });
}

export function measureGlyphs(
  ctx: CanvasRenderingContext2D,
  gs: Glyph[],
  size: number,
  style?: GlyphStyle,
  gap = size * 0.2,
): number {
  return kept(ctx, () => {
    const c = prepare(ctx, style);
    return gs.reduce((w, g, i) => w + (i ? gap : 0) + measureIn(c, g, size), 0);
  });
}
