// <input-glyph action="fire"></input-glyph>: an inline glyph for DOM text that
// follows the player's device. Colours come from CSS custom properties:
//   --glyph-cap, --glyph-edge, --glyph-cap-ink, --glyph-pad, --glyph-pad-ink, --glyph-ink, --glyph-dim
// and the font from the element's font-family. Attributes:
//   action="name"           a registered action or display entry
//   keys="KeyE MouseLeft"   or explicit bindings, space separated
//   pad="South"
//   all                     every binding, not just the first
//   size="1.4"              height in em (default 1.35)
import { describe, drawGlyphs, glyphsFor, measureGlyphs, type GlyphStyle } from './glyphs.ts';
import { currentInput, onCurrentInput, type ActionDef, type Input } from './input.ts';
import { KEYBOARD } from './devices.ts';

const live = new Set<InputGlyph>();
let unsub: (() => void) | null = null;
function watch(input: Input) {
  unsub?.();
  unsub = input.onDevice(() => live.forEach(el => el.render()));
  live.forEach(el => el.render());
}

const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

export class InputGlyph extends Base {
  static observedAttributes = ['action', 'keys', 'pad', 'all', 'size'];
  #canvas: HTMLCanvasElement | null = null;

  connectedCallback() {
    if (!this.#canvas) {
      this.#canvas = document.createElement('canvas');
      this.#canvas.setAttribute('aria-hidden', 'true');
      this.#canvas.style.cssText = 'display:block';
      this.setAttribute('role', 'img');
      this.append(this.#canvas);
    }
    live.add(this);
    this.render();
  }
  disconnectedCallback() {
    live.delete(this);
  }
  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const cv = this.#canvas;
    if (!cv) return;
    const input = currentInput();
    const name = this.getAttribute('action');
    const explicit: ActionDef | undefined =
      this.hasAttribute('keys') || this.hasAttribute('pad')
        ? {
            keys: this.getAttribute('keys')?.split(/\s+/).filter(Boolean),
            pad: this.getAttribute('pad')?.split(/\s+/).filter(Boolean),
          }
        : undefined;
    const def = explicit ?? (name ? input?.def(name) : undefined);
    const gs = glyphsFor(def, input?.device ?? KEYBOARD, this.hasAttribute('all'));
    const cs = getComputedStyle(this);
    const prop = (n: string) => cs.getPropertyValue(n).trim() || undefined;
    const style: GlyphStyle = {
      font: cs.fontFamily,
      cap: prop('--glyph-cap'),
      edge: prop('--glyph-edge'),
      capInk: prop('--glyph-cap-ink'),
      pad: prop('--glyph-pad'),
      padInk: prop('--glyph-pad-ink'),
      ink: prop('--glyph-ink') ?? cs.color,
      dim: prop('--glyph-dim'),
    };
    for (const k of Object.keys(style) as (keyof GlyphStyle)[]) if (style[k] === undefined) delete style[k];
    const h = (parseFloat(cs.fontSize) || 16) * (parseFloat(this.getAttribute('size') ?? '') || 1.35);
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const ctx = cv.getContext('2d')!;
    const w = Math.ceil(measureGlyphs(ctx, gs, h, style)) || 1;
    cv.width = Math.ceil(w * dpr);
    cv.height = Math.ceil(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGlyphs(ctx, gs, 0, h / 2, h, style);
    this.setAttribute('aria-label', gs.map(describe).join(' or ') || name || '');
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('input-glyph')) {
  customElements.define('input-glyph', InputGlyph);
  // defaults in their own cascade layer, declared before the page's CSS: any page rule
  // wins, layered or not (an unlayered default would beat every @layer rule)
  const css = document.createElement('style');
  css.textContent =
    '@layer input-glyph { input-glyph { display: inline-block; vertical-align: middle; line-height: 0; } }';
  document.head.prepend(css);
  onCurrentInput(watch);
  const now = currentInput();
  if (now) watch(now);
  void document.fonts?.ready.then(() => live.forEach(el => el.render()));
}

/** Markup for an inline glyph, for innerHTML hint strings. */
export const glyphHTML = (action: string, all = false) =>
  `<input-glyph action="${action}"${all ? ' all' : ''}></input-glyph>`;
