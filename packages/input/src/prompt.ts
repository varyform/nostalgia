// "PRESS {start} TO PLAY" on a canvas, with each {action} drawn as the glyph of
// the device the player is using right now.
import { drawGlyph, glyphs, measureGlyph, type Glyph, type GlyphStyle } from './glyphs.ts';
import type { Input } from './input.ts';

export interface PromptOptions {
  /** Glyph height in px. Default: 1.3 × the text size in `font`. */
  size?: number;
  /** CSS font for the words (ignored when style.text is given). */
  font?: string;
  /** Colour of the words. */
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Space between words and glyphs, px. Default size × 0.3 (whole pixels in pixel mode). */
  gap?: number;
  /** Letter spacing of the words, px. */
  letterSpacing?: number;
  /** Show every binding of an action, joined by "/", not just the first. */
  all?: boolean;
  style?: GlyphStyle;
}

type Part = { text: string } | { glyph: Glyph } | { sep: true };

/**
 * Split a template into words and glyphs. Text glyphs (a touch label like "Tap")
 * come back as words, so they read in the prompt's own font and colour.
 */
export function parsePrompt(input: Input, template: string, all = false): Part[] {
  const parts: Part[] = [];
  for (const [i, chunk] of template.split(/\{([\w-]+)\}/).entries()) {
    if (i % 2 === 0) {
      if (chunk) parts.push({ text: chunk });
      continue;
    }
    glyphs(input, chunk, all).forEach((g, k) => {
      if (k) parts.push({ sep: true });
      if (g.kind === 'text') {
        // merge with neighbouring words: "PRESS {start}" → "PRESS TAP"
        const prev = parts[parts.length - 1];
        if (prev && 'text' in prev) prev.text += g.label.toUpperCase();
        else parts.push({ text: g.label.toUpperCase() });
      } else parts.push({ glyph: g });
    });
  }
  // merge text that follows a text glyph
  return parts.reduce<Part[]>((out, p) => {
    const prev = out[out.length - 1];
    if (prev && 'text' in prev && 'text' in p) prev.text += p.text;
    else out.push({ ...p });
    return out;
  }, []);
}

function fontPx(font?: string) {
  const m = font?.match(/(\d+(?:\.\d+)?)px/);
  return m ? +m[1] : 16;
}

interface Item {
  part: Part;
  w: number;
}

function layout(ctx: CanvasRenderingContext2D, input: Input, template: string, o: PromptOptions) {
  const st = o.style ?? {};
  const size = o.size ?? fontPx(o.font) * 1.3;
  const gap = o.gap ?? (st.pixel ? Math.round(size * 0.3) : size * 0.3);
  const words = (s: string) => {
    if (st.measure) return st.measure(s);
    if (o.font) ctx.font = o.font;
    if (o.letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${o.letterSpacing}px`;
    return ctx.measureText(s).width;
  };
  const parts = parsePrompt(input, template, o.all);
  // trim the spaces that touch glyphs: the gap stands in for them
  const items: Item[] = parts
    .map((part, i): Item => {
      if ('text' in part) {
        let t = part.text;
        if (i > 0) t = t.replace(/^\s+/, '');
        if (i < parts.length - 1) t = t.replace(/\s+$/, '');
        return { part: { text: t }, w: t ? words(t) : 0 };
      }
      if ('sep' in part) return { part, w: words('/') };
      return { part, w: measureGlyph(ctx, part.glyph, size, st) };
    })
    .filter(it => it.w > 0);
  const width = items.reduce((w, it, i) => w + it.w + (i ? gap : 0), 0);
  return { items, width, size, gap, st };
}

const keep = <T>(ctx: CanvasRenderingContext2D, fn: () => T): T => {
  ctx.save();
  try {
    return fn();
  } finally {
    ctx.restore();
  }
};

/** Width drawPrompt would use for the same arguments. */
export function measurePrompt(ctx: CanvasRenderingContext2D, input: Input, template: string, o: PromptOptions = {}) {
  return keep(ctx, () => layout(ctx, input, template, o).width);
}

/** Lay out and draw a prompt with its vertical centre at y. Returns its width. */
export function drawPrompt(
  ctx: CanvasRenderingContext2D,
  input: Input,
  template: string,
  x: number,
  y: number,
  o: PromptOptions = {},
): number {
  return keep(ctx, () => {
    const { items, width, size, gap, st } = layout(ctx, input, template, o);
    let cx = o.align === 'center' ? x - width / 2 : o.align === 'right' ? x - width : x;
    if (st.pixel) cx = Math.round(cx);
    const color = o.color ?? 'currentColor';
    for (const [i, it] of items.entries()) {
      if (i) cx += gap;
      const p = it.part;
      if ('glyph' in p) drawGlyph(ctx, p.glyph, cx, y, size, st);
      else {
        const s = 'sep' in p ? '/' : p.text;
        if (st.text) st.text(ctx, s, cx + it.w / 2, y, color);
        else {
          if (o.font) ctx.font = o.font;
          if (o.letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${o.letterSpacing}px`;
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(s, cx, y);
        }
      }
      cx += it.w;
    }
    return width;
  });
}
