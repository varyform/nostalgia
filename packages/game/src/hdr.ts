/**
 * HDR colours over a game's canvases, through WebGPU: each frame the game's own canvases are
 * copied into one HDR canvas laid over them, widened to Display P3 and with their brightest
 * colours lifted past SDR white, as far as the level asks. The game keeps drawing as it always
 * has, and the hidden canvases still take the pointer.
 *
 *   import { createHdr } from '@nostalgia/game/hdr';
 *
 *   const hdr = createHdr([cv], { enabled: !demo });       // bottom first: [gl, hud] for 3D games
 *   fixedLoop({ dt, step, draw: () => { view.draw(app); hdr.present(); } });
 *   input.on('hdr', () => hdr.cycle());                    // L everywhere: off, low, mid, high
 *   hdr.supported && prompt(`{hdr} ${hdr.label}`);         // only on an HDR display with WebGPU
 *   hdr.destroy();
 *
 * Off (or where WebGPU, an HDR display or the device is missing) the game's canvases show as
 * they are and nothing is copied. The level is one setting for every game ('nostalgia:hdr').
 * Shipping as WebGPU's extended tone mapping (Chrome 129+, Safari 26); a 2D canvas can't yet.
 */
import { storage } from './runtime.ts';

export interface HdrLevel {
  name: string;
  /** How far past SDR white the brightest, most colourful pixels go (1: not at all). */
  peak: number;
  /** 0: sRGB colours exactly; 1: their numbers taken as Display P3, the most vivid. */
  vivid: number;
}

export const HDR_LEVELS: readonly HdrLevel[] = [
  { name: 'off', peak: 1, vivid: 0 },
  { name: 'low', peak: 1.6, vivid: 0.3 },
  { name: 'mid', peak: 2.4, vivid: 0.55 },
  { name: 'high', peak: 3.6, vivid: 0.8 },
];
const DEFAULT_LEVEL = 2;
/** The brightest channel (sRGB-encoded) where the lift starts. */
const KNEE = 0.6;
/** How much of the lift a colourless pixel gets: white text mustn't glare like a neon sign. */
const WHITE = 0.4;

// sRGB primaries in Display P3, linear light (rows sum to 1: greys stay grey)
const P3 = [
  [0.8225, 0.1774, 0],
  [0.0332, 0.9669, 0],
  [0.0171, 0.0724, 0.9108],
];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encode = (c: number) => {
  const a = Math.abs(c);
  return Math.sign(c) * (a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055);
};
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One sRGB colour (0..1) as the HDR canvas shows it: extended Display P3, encoded, where 1 is
 * SDR white. The shader below does exactly this per pixel; this twin is what the tests read.
 */
export function grade(rgb: readonly [number, number, number], level: HdrLevel): [number, number, number] {
  const l = rgb.map(toLinear),
    exact = P3.map(row => row[0] * l[0] + row[1] * l[1] + row[2] * l[2]),
    p3 = exact.map((e, i) => e + (l[i] - e) * level.vivid);
  const m = Math.max(...rgb),
    n = Math.min(...rgb),
    sat = (m - n) / Math.max(m, 1e-4),
    k = smoothstep(KNEE, 1, m),
    gain = 1 + (level.peak - 1) * k * k * (WHITE + (1 - WHITE) * sat);
  return p3.map(c => encode(c * gain)) as [number, number, number];
}

const SHADER = /* wgsl */ `
struct U { peak: f32, vivid: f32, knee: f32, white: f32 }
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> u: U;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

// one triangle over the whole canvas
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: V;
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}

fn lin(c: vec3f) -> vec3f {
  return select(c / 12.92, pow((c + 0.055) / 1.055, vec3f(2.4)), c > vec3f(0.04045));
}
fn enc(c: vec3f) -> vec3f {
  let a = abs(c);
  return sign(c) * select(a * 12.92, 1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a > vec3f(0.0031308));
}

// grade() in hdr.ts, per pixel; the layers come and go premultiplied
@fragment fn fs(v: V) -> @location(0) vec4f {
  let px = textureSample(tex, smp, v.uv);
  if (px.a <= 0.0) { return vec4f(0.0); }
  let c = px.rgb / px.a;
  let l = lin(c);
  let exact = vec3f(dot(vec3f(0.8225, 0.1774, 0.0), l), dot(vec3f(0.0332, 0.9669, 0.0), l),
    dot(vec3f(0.0171, 0.0724, 0.9108), l));
  let p3 = mix(exact, l, u.vivid);
  let m = max(c.r, max(c.g, c.b));
  let n = min(c.r, min(c.g, c.b));
  let sat = (m - n) / max(m, 1e-4);
  let k = smoothstep(u.knee, 1.0, m);
  let gain = 1.0 + (u.peak - 1.0) * k * k * mix(u.white, 1.0, sat);
  return vec4f(enc(p3 * gain) * px.a, px.a);
}
`;

export interface Hdr {
  /** WebGPU and an HDR display: worth offering the setting (and its key) at all. */
  readonly supported: boolean;
  readonly level: number;
  /** 'HDR MID', 'HDR OFF': for the game's key hints. */
  readonly label: string;
  /** Next level (off after high), saved for every game, shown in a brief note. */
  cycle(): void;
  /** Call right after the game draws its frame. */
  present(): void;
  destroy(): void;
}

interface Layer {
  src: HTMLCanvasElement;
  tex?: GPUTexture;
  bind?: GPUBindGroup;
}

export function createHdr(sources: HTMLCanvasElement[], { enabled = true }: { enabled?: boolean } = {}): Hdr {
  const saved = storage('nostalgia:hdr', { enabled });
  const stored = saved.load<number>(DEFAULT_LEVEL);
  let level = Number.isInteger(stored) && stored >= 0 && stored < HDR_LEVELS.length ? stored : DEFAULT_LEVEL;
  const hi = typeof matchMedia === 'function' ? matchMedia('(dynamic-range: high)') : null;
  const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
  const supported = enabled && !!gpu && !!hi?.matches;

  let device: GPUDevice | null = null,
    ctx: GPUCanvasContext | null = null,
    pipeline: GPURenderPipeline | null = null,
    uniforms: GPUBuffer | null = null,
    nearest: GPUSampler | null = null,
    smooth: GPUSampler | null = null,
    out: HTMLCanvasElement | null = null,
    note: HTMLElement | null = null,
    noteTimer = 0,
    dead = false,
    shown = false;
  const layers: Layer[] = sources.map(src => ({ src }));

  const writeLevel = () => {
    const L = HDR_LEVELS[level];
    if (device && uniforms) device.queue.writeBuffer(uniforms, 0, new Float32Array([L.peak, L.vivid, KNEE, WHITE]));
  };

  async function init() {
    const adapter = await gpu!.requestAdapter();
    if (!adapter || dead) return;
    const d = await adapter.requestDevice();
    if (dead) return d.destroy();
    out = document.createElement('canvas');
    out.setAttribute('aria-hidden', 'true');
    Object.assign(out.style, { position: 'fixed', pointerEvents: 'none', display: 'none', margin: '0' });
    layers[layers.length - 1].src.after(out);
    const c = out.getContext('webgpu');
    if (!c) return fail();
    c.configure({
      device: d,
      format: 'rgba16float',
      colorSpace: 'display-p3',
      toneMapping: { mode: 'extended' },
      alphaMode: 'opaque',
    });
    const module = d.createShaderModule({ code: SHADER });
    pipeline = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
    });
    uniforms = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    nearest = d.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
    smooth = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    void d.lost.then(() => fail());
    device = d;
    ctx = c;
    writeLevel();
  }

  // anything wrong: the game's own canvases, as if HDR were off
  function fail() {
    dead = true;
    show(false);
    out?.remove();
    out = null;
  }

  function show(on: boolean) {
    if (on === shown) return;
    shown = on;
    for (const l of layers) l.src.style.opacity = on ? '0' : '';
    if (out) out.style.display = on ? 'block' : 'none';
  }

  function render() {
    const d = device!,
      first = layers[0].src,
      r = first.getBoundingClientRect(),
      W = first.width,
      H = first.height;
    if (!W || !H) return;
    const o = out!;
    if (o.width !== W || o.height !== H) {
      o.width = W;
      o.height = H;
    }
    Object.assign(o.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: ctx!.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
      ],
    });
    pass.setPipeline(pipeline!);
    for (const l of layers) {
      const { src } = l;
      if (!src.width || !src.height) continue;
      if (!l.tex || l.tex.width !== src.width || l.tex.height !== src.height) {
        l.tex?.destroy();
        l.tex = d.createTexture({
          size: [src.width, src.height],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        // pixel for pixel when the sizes match (the CGA games' crisp pixels); smooth otherwise
        const sampler = src.width === W && src.height === H ? nearest! : smooth!;
        l.bind = d.createBindGroup({
          layout: pipeline!.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: l.tex.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: uniforms! } },
          ],
        });
      }
      d.queue.copyExternalImageToTexture({ source: src }, { texture: l.tex, premultipliedAlpha: true }, [
        src.width,
        src.height,
      ]);
      pass.setBindGroup(0, l.bind!);
      pass.draw(3);
    }
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  function flash(text: string) {
    if (!note) {
      note = document.createElement('div');
      note.setAttribute('role', 'status');
      Object.assign(note.style, {
        position: 'fixed',
        top: '16px',
        left: '50%',
        translate: '-50% 0',
        zIndex: '10',
        padding: '6px 14px',
        borderRadius: '999px',
        font: '600 13px/1.2 system-ui, sans-serif',
        letterSpacing: '0.12em',
        color: '#fff',
        background: 'rgba(0, 0, 0, 0.62)',
        pointerEvents: 'none',
        transition: 'opacity 0.3s',
      });
      document.body.append(note);
    }
    note.textContent = text;
    note.style.opacity = '1';
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      if (note) note.style.opacity = '0';
    }, 1200);
  }

  if (supported) void init().catch(() => fail());

  return {
    supported,
    get level() {
      return level;
    },
    get label() {
      return `HDR ${HDR_LEVELS[level].name.toUpperCase()}`;
    },
    cycle() {
      if (!supported) return;
      level = (level + 1) % HDR_LEVELS.length;
      saved.save(level);
      writeLevel();
      flash(this.label);
    },
    present() {
      const on = !dead && !!device && level > 0 && !!hi?.matches;
      show(on);
      if (!on) return;
      try {
        render();
      } catch {
        fail();
      }
    },
    destroy() {
      dead = true;
      clearTimeout(noteTimer);
      show(false);
      for (const l of layers) l.tex?.destroy();
      out?.remove();
      note?.remove();
      uniforms?.destroy();
      device?.destroy();
      device = null;
    },
  };
}
