// Dev gallery: `mise run dev`, then /packages/input/demo.html
import {
  createInput,
  drawGlyph,
  keyName,
  measureGlyph,
  padGlyph,
  type Family,
  type Glyph,
  type GlyphStyle,
} from './src/index.ts';

const input = createInput({
  actions: {
    fire: { keys: ['Space', 'KeyZ'], pad: ['South', 'R2'] },
    bomb: { keys: ['KeyX'], pad: ['West'] },
    map: { keys: ['Tab'], pad: ['Select'] },
    pause: { keys: ['Escape'], pad: ['Start'] },
  },
  display: { fly: { keys: ['Arrows'], pad: ['LStick'] }, aim: { keys: ['Mouse'], pad: ['RStick'] } },
  autoUpdate: true,
});
const show = () => (document.querySelector('#device')!.textContent = `${input.device.kind} · ${input.device.family}`);
input.onDevice(show);
show();

const keyRow: Glyph[] = [
  ...['Space', 'Enter', 'Escape', 'ShiftLeft', 'KeyQ', 'Digit1', 'ArrowUp', 'F10'].map(code => ({
    kind: 'key' as const,
    code,
    label: '',
  })),
  {
    kind: 'cluster',
    rows: [
      [null, 'ArrowUp', null],
      ['ArrowLeft', 'ArrowDown', 'ArrowRight'],
    ],
  },
  {
    kind: 'cluster',
    rows: [
      [null, 'KeyW', null],
      ['KeyA', 'KeyS', 'KeyD'],
    ],
  },
  { kind: 'mouse', button: 'left' },
  { kind: 'mouse', button: 'right' },
  { kind: 'mouse', button: 'move' },
  { kind: 'text', label: 'Tap' },
];
const PAD = [
  'South',
  'East',
  'West',
  'North',
  'L1',
  'R1',
  'L2',
  'R2',
  'Select',
  'Start',
  'Home',
  'Dpad',
  'Up',
  'DpadH',
  'LStick',
  'RStickUp',
  'L3',
];
const FAMILIES: Family[] = ['xbox', 'playstation', 'switch', 'generic'];
// keycap labels come from keyName at resolve time; fill them in for the demo row
keyRow.forEach(g => {
  if (g.kind === 'key') g.label = keyName(g.code);
});

function sheet(
  cv: HTMLCanvasElement,
  size: number,
  scale: number,
  style: GlyphStyle,
  label: (ctx: CanvasRenderingContext2D, s: string, x: number, y: number) => void,
) {
  const rows: [string, Glyph[]][] = [
    ['Keyboard', keyRow],
    ...FAMILIES.map(f => [f, PAD.map(p => padGlyph(p, f))] as [string, Glyph[]]),
  ];
  const ctx = cv.getContext('2d')!;
  const gap = Math.round(size * 0.45),
    lh = Math.round(size * 1.7),
    left = Math.round(size * 5.5);
  const width = Math.max(
    ...rows.map(([, gs]) => gs.reduce((w, g) => w + measureGlyph(ctx, g, size, style) + gap, left)),
  );
  cv.width = Math.ceil(width * scale);
  cv.height = Math.ceil(rows.length * lh * scale);
  cv.style.width = width + 'px';
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  rows.forEach(([name, gs], r) => {
    const y = r * lh + lh / 2;
    label(ctx, name, 0, y);
    let x = left;
    for (const g of gs) x += drawGlyph(ctx, g, x, y, size, style) + gap;
  });
}

const dpr = Math.min(devicePixelRatio || 1, 2);
sheet(document.querySelector<HTMLCanvasElement>('#vector')!, 30, dpr, {}, (ctx, s, x, y) => {
  ctx.font = '600 13px system-ui';
  ctx.fillStyle = 'oklch(0.65 0.02 260)';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
});

// pixel pen: draw at 1× on a small canvas, then scale up with hard pixels
const CGA = ['#000000', '#55ffff', '#ff55ff', '#ffffff'];
const small = document.createElement('canvas');
const cgaStyle: GlyphStyle = {
  pixel: true,
  brand: false,
  cap: CGA[3],
  edge: CGA[1],
  capInk: CGA[0],
  pad: CGA[2],
  padInk: CGA[3],
  ink: CGA[3],
  dim: CGA[1],
  font: 'monospace',
};
sheet(small, 11, 1, cgaStyle, (ctx, s, x, y) => {
  ctx.font = '8px monospace';
  ctx.fillStyle = CGA[1];
  ctx.textBaseline = 'middle';
  ctx.fillText(s.slice(0, 7), x, y);
});
const out = document.querySelector<HTMLCanvasElement>('#pixel')!;
out.width = small.width * 3;
out.height = small.height * 3;
const o = out.getContext('2d')!;
o.fillStyle = CGA[0];
o.fillRect(0, 0, out.width, out.height);
o.imageSmoothingEnabled = false;
o.drawImage(small, 0, 0, out.width, out.height);
