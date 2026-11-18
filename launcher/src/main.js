import { createInput } from '@nostalgia/input';
import { PAGES } from '../../pages.config.js';

// ---------- catalogue: add a page to pages.config.js, then an entry here ----------
// controls: [keys, action, pad inputs], space separated; shown as keycaps, or pad buttons once a pad is in use
const GAMES = [
  {
    id: 'skyhook',
    dir: 'skyhook',
    exe: 'SKYHOOK.EXE',
    title: 'Skyhook',
    after: 'Striker',
    year: 1985,
    genre: 'Helicopter rescue shooter',
    tags: ['Action', 'Side-scroller', 'Rescue'],
    blurb:
      'Fly a gunship through hills, caverns, an occupied city and an iron fortress. Land beside agents to pick them up, bomb prison huts to free the rest, and get them home before the fuel runs dry.',
    facts: [
      ['Missions', '5, then the tour repeats harder'],
      ['Input', 'Keyboard, gamepad, touch (HD)'],
    ],
    controls: [
      ['Arrows', 'Fly', 'LStick'],
      ['Space', 'Fire', 'South'],
      ['KeyX', 'Bomb', 'West'],
      ['KeyP', 'Pause', 'Start'],
      ['KeyF', 'Fullscreen'],
    ],
    versions: [
      {
        key: 'cga',
        label: 'CGA',
        page: 'skyhook-cga',
        scene: 'skyhookCGA',
        mode: 'cga',
        tag: 'CGA · 320×200 · 4 colours',
        note: 'The original look: four colours, shown at 4:3.',
      },
      {
        key: 'hd',
        label: 'HD',
        page: 'skyhook-hd',
        scene: 'skyhookHD',
        mode: 'hd',
        tag: 'HD · 16:9 · vector',
        note: 'Widescreen remaster: lighting, parallax, route map, touch.',
      },
    ],
    source: 'https://github.com/varyform/skyhook',
  },
  {
    id: 'dropzone',
    dir: 'dropzone',
    exe: 'DROPZONE.EXE',
    title: 'Dropzone',
    after: 'Airborne Ranger',
    year: 1988,
    genre: 'Paratrooper stealth',
    tags: ['Stealth', 'Top-down', 'Tactical'],
    blurb:
      'Jump from a transport plane, drop your supply pods and steer the canopy down behind the lines. Slip past vision cones and minefields, hit the objective, then make the helicopter before extraction closes.',
    facts: [
      ['Operations', 'Glass Ear, Paper Lantern, Dry Thunder'],
      ['Difficulty', 'Recruit, Veteran, Elite'],
    ],
    controls: [
      ['WASD', 'Move', 'LStick'],
      ['Mouse MouseLeft', 'Aim / fire', 'RStick R2'],
      ['KeyC KeyZ', 'Crouch / prone', 'East North'],
      ['KeyG', 'Grenade', 'R1'],
      ['KeyF', 'Charge', 'L1'],
    ],
    versions: [
      {
        key: 'hd',
        label: 'HD',
        page: 'dropzone',
        scene: 'dropzoneHD',
        mode: 'hd',
        tag: 'HD · procedural world',
        note: 'Keyboard and mouse, or a gamepad. Best scores are saved in the browser.',
      },
    ],
    source: 'https://github.com/varyform/dropzone',
  },
  { id: 'empty', empty: true, exe: 'A:\\', title: 'Drive A:' },
];

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const narrow = matchMedia('(max-width: 860px)');
const mod = (a, b) => ((a % b) + b) % b;
const hash = n => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
// 8.3 short name, the way DOS showed long folder names
const dos = s => {
  const n = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length > 8 || n.length !== s.length ? n.slice(0, 6) + '~1' : n;
};

// ---------- prefs ----------
const STORE = 'nostalgia:v1';
const prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
})();
prefs.sound ??= true;
prefs.crt ??= true;
prefs.versions ??= {};
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(prefs));
  } catch {}
};

// ---------- PC speaker ----------
let ac = null,
  activated = false;
const activate = () => {
  activated = true;
};
addEventListener('pointerdown', activate, { capture: true });
addEventListener('keydown', activate, { capture: true });
function audio() {
  if (!prefs.sound || !activated) return null;
  try {
    ac ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch {
    return null;
  }
  return ac;
}
function beep(freq = 880, dur = 0.03, vol = 0.03, when = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + when,
    o = a.createOscillator(),
    g = a.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function seek() {
  // floppy drive head stepping
  const a = audio();
  if (!a) return;
  const buf = a.createBuffer(1, a.sampleRate * 0.018, a.sampleRate),
    d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  for (let k = 0; k < 7; k++) {
    const s = a.createBufferSource(),
      f = a.createBiquadFilter(),
      g = a.createGain();
    s.buffer = buf;
    f.type = 'bandpass';
    f.frequency.value = 900 + (k % 2) * 500;
    g.gain.value = 0.25;
    s.connect(f).connect(g).connect(a.destination);
    s.start(a.currentTime + k * 0.07 + (k > 3 ? 0.12 : 0));
  }
}
const click = () => beep(1800 + Math.random() * 400, 0.006, 0.012);
const error = () => {
  beep(196, 0.22, 0.05);
  beep(147, 0.3, 0.05, 0.2);
};

// ---------- list ----------
const list = $('#games'),
  bar = $('#bar');
let index = Math.max(
  0,
  GAMES.findIndex(g => g.id === prefs.game),
);
list.innerHTML = GAMES.map(
  (g, i) => `
  <li class="game${g.empty ? ' game--empty' : ''}" id="game-${g.id}" role="option" aria-selected="false" data-index="${i}">
    <span class="game__key">${i + 1}</span>
    <span class="game__name">${g.exe}</span>
    <span class="game__year">${g.year ?? ''}</span>
    <span class="game__sub">${g.empty ? 'no disk in drive' : `${g.title} · ${g.versions.map(v => v.label).join(' + ')}`}</span>
  </li>`,
).join('');
const rows = [...list.children];
const games = GAMES.filter(g => !g.empty).length;
$('#count').textContent = `${games} game(s)`;

function moveBar() {
  const r = rows[index];
  bar.style.height = r.offsetHeight + 'px';
  bar.style.translate = `0 ${r.offsetTop}px`;
}
const version = g => g.versions.find(v => v.key === prefs.versions[g.id]) ?? g.versions[0];

function select(i) {
  index = mod(i, GAMES.length);
  rows.forEach((r, k) => r.setAttribute('aria-selected', String(k === index)));
  list.setAttribute('aria-activedescendant', rows[index].id);
  moveBar();
  renderDetail();
  prefs.game = GAMES[index].id;
  save();
}

function setVersion(key, focus = false) {
  const g = GAMES[index];
  if (g.empty || !g.versions.some(v => v.key === key)) return;
  prefs.versions[g.id] = key;
  save();
  renderDetail();
  if (focus) $(`[data-version="${key}"]`)?.focus();
}
function stepVersion(d) {
  const g = GAMES[index];
  if (g.empty || g.versions.length < 2) return;
  const i = g.versions.indexOf(version(g));
  setVersion(g.versions[mod(i + d, g.versions.length)].key);
  beep(1320, 0.025);
}

// ---------- detail ----------
const controlGlyphs = (keys, pad) => `<input-glyph keys="${keys}"${pad ? ` pad="${pad}"` : ''} all></input-glyph>`;
const pairs = items => `<dl class="pairs">${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

function renderDetail() {
  const g = GAMES[index],
    info = $('#info');
  if (g.empty) {
    $('#detail-title').textContent = 'A:\\';
    $('#preview-tag').textContent = 'NO SIGNAL';
    preview.set((g, t) => SCENES.noDisk(g, t), 'cga');
    info.innerHTML = `
      <div class="info__main">
        <h3 class="info__title">Drive A:</h3>
        <p class="info__meta">No disk in drive</p>
        <p class="info__blurb">The next remake goes in this slot.</p>
      </div>
      <div class="info__side">
        <p class="info__error">Not ready reading drive A\nAbort, Retry, Fail?</p>
        <div class="actions"><button class="btn btn--run" data-action="run">Retry</button></div>
      </div>`;
    return;
  }
  const v = version(g);
  $('#detail-title').textContent = `${dos(g.dir)}\\${g.exe}`;
  $('#preview-tag').textContent = v.tag;
  preview.set(SCENES[v.scene], v.mode);
  info.innerHTML = `
    <div class="info__main">
      <h3 class="info__title">${g.title}</h3>
      <p class="info__meta">${g.genre} · in the spirit of ${g.after} (${g.year})</p>
      <ul class="chips">${g.tags.map(t => `<li class="chip">${t}</li>`).join('')}</ul>
      <p class="info__blurb">${g.blurb}</p>
      ${pairs(g.facts)}
    </div>
    <div class="info__side">
      <div>
        <p class="label">Controls</p>
        ${pairs(g.controls.map(([k, v, pad]) => [controlGlyphs(k, pad), v]))}
      </div>
      <div>
        <p class="label" id="version-label">Version</p>
        <div class="seg" role="radiogroup" aria-labelledby="version-label">
          ${g.versions.map(x => `<button class="seg__btn" role="radio" aria-checked="${x === v}" data-version="${x.key}">${x.label}</button>`).join('')}
        </div>
        <p class="seg__note">${v.note}</p>
      </div>
      <div class="actions">
        <button class="btn btn--run" data-action="run">▶ Run ${g.exe}</button>
        <a class="btn btn--ghost" href="${g.source}" target="_blank" rel="noopener">Source</a>
      </div>
    </div>`;
}

// ---------- DOS prompt ----------
const term = {
  el: $('#term'),
  out: $('#term-out'),
  hint: $('#term-hint'),
  mode: null,
  skipping: false,
  idle: false,
  get open() {
    return !this.el.hidden;
  },
  show(mode, hint = '') {
    this.mode = mode;
    this.skipping = false;
    this.idle = false;
    this.out.textContent = '';
    this.hint.textContent = hint;
    this.el.hidden = false;
  },
  close() {
    this.el.hidden = true;
    this.mode = null;
  },
  key() {
    if (this.idle) this.close();
    else this.skipping = true;
  },
  wait(ms) {
    return this.skipping ? Promise.resolve() : new Promise(r => setTimeout(r, ms));
  },
  line(text = '\u00a0') {
    const d = document.createElement('div');
    d.textContent = text;
    this.out.append(d);
    return d;
  },
  async type(prompt, cmd) {
    const d = this.line(prompt);
    await this.wait(150);
    for (const ch of cmd) {
      d.textContent += ch;
      if (!this.skipping) {
        click();
        await this.wait(30 + Math.random() * 45);
      }
    }
    await this.wait(120);
    return d;
  },
};
term.el.addEventListener('pointerdown', () => term.key());

async function boot() {
  term.show('boot', 'Press any key to skip');
  term.line('NOSTALGIA BIOS v1.00   (C) 1985-2026');
  await term.wait(200);
  term.line();
  term.line('Processor   : 80286 @ 12 MHz');
  await term.wait(120);
  const mem = term.line();
  for (let k = 0; k <= 640; k += 32) {
    mem.textContent = `Memory Test : ${String(k).padStart(3)}K`;
    await term.wait(22);
  }
  mem.textContent += ' OK';
  await term.wait(140);
  term.line('Display     : VGA, CGA compatible');
  await term.wait(90);
  term.line('Drive C:    : 20 MB fixed disk');
  await term.wait(90);
  term.line('Drive A:    : not ready');
  await term.wait(260);
  term.line();
  term.line('Starting DOS...');
  await term.wait(420);
  term.line();
  await term.type('C:\\> ', 'cd nostalgia');
  await term.type('C:\\NOSTALGIA> ', 'menu');
  await term.wait(200);
  term.close();
  powerOn();
}

function powerOn() {
  if (reduceMotion.matches) return;
  const s = $('.screen');
  s.classList.add('is-powering');
  s.addEventListener('animationend', () => s.classList.remove('is-powering'), { once: true });
}

// dev serves page sources; the build links the compiled files next to the launcher
const pageUrl = name => (import.meta.env.DEV ? '/' + PAGES[name].entry : PAGES[name].out.replace(/^dist\//, ''));

async function run() {
  if (term.open) return;
  const g = GAMES[index];
  if (g.empty) {
    error();
    const d = $('#detail');
    d.classList.remove('is-shaking');
    void d.offsetWidth;
    d.classList.add('is-shaking');
    return;
  }
  const v = version(g),
    url = pageUrl(v.page),
    D = dos(g.dir);
  if (reduceMotion.matches) {
    location.href = url;
    return;
  }
  term.show('launch');
  await term.type('C:\\NOSTALGIA> ', `cd ${D.toLowerCase()}`);
  await term.type(
    `C:\\NOSTALGIA\\${D}> `,
    `${g.exe.split('.')[0].toLowerCase()}${g.versions.length > 1 ? ' /' + v.key : ''}`,
  );
  seek();
  term.line(`Loading ${g.title}${g.versions.length > 1 ? ` (${v.label})` : ''}...`);
  await term.wait(520);
  location.href = url;
}

async function quit() {
  if (term.open) return;
  term.show('quit', 'Press any key to return');
  await term.type('C:\\NOSTALGIA> ', 'exit');
  term.line();
  term.line('C:\\> ');
  term.idle = true;
}

// came back with the browser's Back button: drop the stale prompt
addEventListener('pageshow', e => {
  if (e.persisted) term.close();
});

// ---------- previews ----------
const css = getComputedStyle(document.documentElement);
const CGA = [0, 1, 2, 3].map(i => css.getPropertyValue(`--cga-${i}`).trim());

const preview = (() => {
  const cv = $('#preview'),
    ctx = cv.getContext('2d');
  const low = document.createElement('canvas');
  low.width = 320;
  low.height = 200;
  const lg = low.getContext('2d');
  let scene = null,
    mode = 'hd',
    raf = 0,
    w = 0,
    h = 0;
  function draw(now) {
    if (!scene || !w) return;
    const t = reduceMotion.matches ? 4 : now / 1000;
    if (mode === 'cga') {
      scene(lg, t);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(low, 0, 0, w, h);
    } else {
      ctx.setTransform(w / 320, 0, 0, h / 200, 0, 0);
      scene(ctx, t);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  const loop = now => {
    draw(now);
    raf = requestAnimationFrame(loop);
  };
  function start() {
    cancelAnimationFrame(raf);
    if (reduceMotion.matches || document.hidden) draw(performance.now());
    else raf = requestAnimationFrame(loop);
  }
  new ResizeObserver(() => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = cv.width = Math.round(cv.clientWidth * dpr);
    h = cv.height = Math.round(cv.clientHeight * dpr);
    draw(performance.now());
  }).observe(cv);
  document.addEventListener('visibilitychange', start);
  reduceMotion.addEventListener('change', start);
  return {
    set(fn, m) {
      scene = fn;
      mode = m;
      start();
    },
  };
})();

const ground = x => 158 + 16 * Math.sin(x * 0.021) + 9 * Math.sin(x * 0.057 + 1.3) + 4 * Math.sin(x * 0.13);

let dither = null,
  noise = null;
const SCENES = {
  // ---- Skyhook, CGA: true 320×200, four colours, scaled up with hard pixels ----
  skyhookCGA(g, t) {
    const [K, C, M, W] = CGA,
      sx = t * 48;
    if (!dither) {
      const p = document.createElement('canvas');
      p.width = p.height = 4;
      const pg = p.getContext('2d');
      pg.fillStyle = C;
      pg.fillRect(0, 0, 4, 4);
      pg.fillStyle = K;
      pg.fillRect(0, 0, 1, 1);
      pg.fillRect(2, 2, 1, 1);
      dither = g.createPattern(p, 'repeat');
    }
    g.fillStyle = K;
    g.fillRect(0, 0, 320, 200);
    g.fillStyle = W;
    for (let i = 0; i < 36; i++)
      if ((i + Math.floor(t * 3)) % 9)
        g.fillRect(Math.floor(mod(i * 89.7 - sx * 0.15, 320)), 14 + ((i * 37) % 80), 1, 1);
    g.fillStyle = M;
    for (let x = 0; x < 320; x++) {
      const wx = x + sx * 0.45;
      g.fillRect(x, Math.floor(112 + 18 * Math.sin(wx * 0.015) + 8 * Math.sin(wx * 0.047 + 2)), 1, 1);
    }
    dither.setTransform?.(new DOMMatrix().translateSelf(-mod(Math.floor(sx), 4), 0));
    let prev = Math.floor(ground(sx));
    for (let x = 0; x < 320; x++) {
      const y = Math.floor(ground(x + sx)),
        top = Math.min(y, prev);
      g.fillStyle = W;
      g.fillRect(x, top, 1, Math.max(1, y - top + 1));
      g.fillStyle = C;
      g.fillRect(x, y + 1, 1, 2);
      g.fillStyle = dither;
      g.fillRect(x, y + 3, 1, 200 - y - 3);
      prev = y;
    }
    for (let n = Math.floor(sx / 150) - 1; n <= Math.floor((sx + 320) / 150) + 1; n++) {
      const wx = n * 150 + 40,
        x = Math.floor(wx - sx),
        y = Math.floor(ground(wx));
      const k = mod(n, 3);
      if (k === 0) {
        // prison hut
        g.fillStyle = W;
        g.fillRect(x - 9, y - 11, 18, 1);
        g.fillStyle = M;
        g.fillRect(x - 8, y - 10, 16, 10);
        g.fillStyle = K;
        for (let b = -5; b <= 4; b += 3) g.fillRect(x + b, y - 8, 1, 5);
      } else if (k === 1) {
        // agent, waving
        g.fillStyle = W;
        g.fillRect(x, y - 8, 2, 2);
        g.fillRect(x, y - 6, 2, 4);
        g.fillRect(x - 1, y - 2, 1, 2);
        g.fillRect(x + 2, y - 2, 1, 2);
        if (Math.floor(t * 4) % 2) g.fillRect(x + 2, y - 9, 1, 3);
        else g.fillRect(x + 2, y - 6, 2, 1);
      } else {
        // palms
        g.fillStyle = M;
        g.fillRect(x, y - 9, 1, 9);
        g.fillRect(x - 3, y - 10, 7, 1);
        g.fillRect(x - 4, y - 9, 2, 1);
        g.fillRect(x + 3, y - 9, 2, 1);
      }
    }
    const hx = Math.floor(96 + 10 * Math.sin(t * 0.6)),
      hy = Math.floor(78 + 5 * Math.sin(t * 1.7));
    const R = (x, y, w, h, c) => {
      g.fillStyle = c;
      g.fillRect(hx + x, hy + y, w, h);
    };
    const f = Math.floor(t * 24) % 3,
      len = [34, 20, 8][f];
    R(-1 - (len >> 1), -8, len, 1, W);
    R(-2, -7, 3, 2, W);
    R(-12, -5, 20, 8, M);
    R(-14, -3, 2, 5, M);
    R(4, -4, 6, 5, C);
    R(8, -1, 3, 3, M);
    R(-30, -3, 18, 2, M);
    R(-32, -7, 3, 6, M);
    if (f % 2) R(-33, -8, 1, 5, W);
    else R(-35, -6, 5, 1, W);
    R(-10, 3, 1, 4, W);
    R(4, 3, 1, 4, W);
    R(-13, 7, 22, 1, W);
    if (mod(t, 2.4) < 1.3)
      for (let i = 0; i < 5; i++) {
        const bx = hx + 12 + mod(t * 2.2 + i * 0.2, 1) * 230;
        if (bx < 320) {
          g.fillStyle = W;
          g.fillRect(Math.floor(bx), hy + 1, 5, 1);
        }
      }
    g.fillStyle = K;
    g.fillRect(0, 0, 320, 11);
    g.fillStyle = C;
    g.fillRect(0, 11, 320, 1);
    g.fillRect(6, 2, 64, 1);
    g.fillRect(6, 8, 64, 1);
    g.fillRect(6, 2, 1, 7);
    g.fillRect(69, 2, 1, 7);
    g.fillStyle = W;
    g.fillRect(8, 4, Math.floor(60 * (0.3 + 0.65 * (1 - mod(t * 0.05, 1)))), 3);
    const aboard = Math.floor(t / 3) % 5;
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i < aboard ? M : C;
      g.fillRect(286 + i * 7, 3, 3, i < aboard ? 6 : 1);
      if (i >= aboard) g.fillRect(286 + i * 7, 8, 3, 1);
    }
  },

  // ---- Skyhook, HD: same world in vectors at native resolution ----
  skyhookHD(g, t) {
    const sx = t * 48;
    let gr = g.createLinearGradient(0, 0, 0, 200);
    gr.addColorStop(0, 'oklch(0.2 0.07 285)');
    gr.addColorStop(0.55, 'oklch(0.42 0.14 330)');
    gr.addColorStop(0.85, 'oklch(0.72 0.16 50)');
    gr.addColorStop(1, 'oklch(0.82 0.13 75)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 320, 200);
    gr = g.createRadialGradient(236, 138, 0, 236, 138, 80);
    gr.addColorStop(0, 'oklch(0.97 0.08 90)');
    gr.addColorStop(0.12, 'oklch(0.9 0.14 75 / .9)');
    gr.addColorStop(0.4, 'oklch(0.8 0.16 50 / .25)');
    gr.addColorStop(1, 'oklch(0.8 0.16 50 / 0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 320, 200);
    g.fillStyle = 'oklch(1 0 0 / .55)';
    for (let i = 0; i < 30; i++) g.fillRect(mod(i * 89.7 - sx * 0.05, 320), 6 + ((i * 37) % 60), 0.7, 0.7);
    const ridge = (off, base, a1, a2, f, col) => {
      g.beginPath();
      g.moveTo(0, 200);
      for (let x = 0; x <= 320; x += 4) {
        const wx = x + off;
        g.lineTo(x, base + a1 * Math.sin(wx * f) + a2 * Math.sin(wx * f * 2.7 + 1.7));
      }
      g.lineTo(320, 200);
      g.closePath();
      g.fillStyle = col;
      g.fill();
    };
    ridge(sx * 0.15, 116, 22, 9, 0.011, 'oklch(0.38 0.09 320)');
    ridge(sx * 0.4, 136, 16, 8, 0.019, 'oklch(0.27 0.08 300)');
    gr = g.createLinearGradient(0, 120, 0, 175);
    gr.addColorStop(0, 'oklch(0.75 0.14 55 / 0)');
    gr.addColorStop(1, 'oklch(0.75 0.14 55 / .22)');
    g.fillStyle = gr;
    g.fillRect(0, 120, 320, 80);
    const surf = new Path2D();
    surf.moveTo(-2, ground(sx - 2));
    for (let x = 0; x <= 322; x += 2) surf.lineTo(x, ground(x + sx));
    const fill = new Path2D(surf);
    fill.lineTo(322, 200);
    fill.lineTo(-2, 200);
    fill.closePath();
    gr = g.createLinearGradient(0, 130, 0, 200);
    gr.addColorStop(0, 'oklch(0.2 0.05 285)');
    gr.addColorStop(1, 'oklch(0.11 0.03 280)');
    g.fillStyle = gr;
    g.fill(fill);
    g.strokeStyle = 'oklch(0.8 0.14 60 / .55)';
    g.lineWidth = 0.8;
    g.stroke(surf);
    const sil = 'oklch(0.13 0.03 280)';
    for (let n = Math.floor(sx / 150) - 1; n <= Math.floor((sx + 320) / 150) + 1; n++) {
      const wx = n * 150 + 40,
        x = wx - sx,
        y = ground(wx) + 1.5,
        k = mod(n, 3);
      g.fillStyle = sil;
      if (k === 0) {
        g.fillRect(x - 9, y - 10, 18, 11);
        g.beginPath();
        g.moveTo(x - 11, y - 10);
        g.lineTo(x, y - 15);
        g.lineTo(x + 11, y - 10);
        g.fill();
        g.fillStyle = 'oklch(0.82 0.15 70)';
        g.fillRect(x - 4, y - 8, 8, 4);
        g.fillStyle = sil;
        for (let b = -2.5; b < 4; b += 2.5) g.fillRect(x + b - 0.4, y - 8, 0.8, 4);
      } else if (k === 1) {
        g.beginPath();
        g.arc(x, y - 7.5, 1.3, 0, 7);
        g.fill();
        g.fillRect(x - 1, y - 6, 2, 5);
        g.strokeStyle = sil;
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(x + 0.8, y - 5.5);
        g.lineTo(x + 3, y - 8 + Math.sin(t * 8) * 1.5);
        g.stroke();
        if (Math.floor(t * 2) % 2) {
          g.save();
          g.shadowColor = 'oklch(0.85 0.22 145)';
          g.shadowBlur = 10;
          g.fillStyle = 'oklch(0.9 0.2 145)';
          g.beginPath();
          g.arc(x, y - 11.5, 1, 0, 7);
          g.fill();
          g.restore();
        }
      } else {
        for (const [dx, hgt] of [
          [-6, 11],
          [0, 15],
          [5, 10],
        ]) {
          g.beginPath();
          g.moveTo(x + dx - 3.5, y);
          g.lineTo(x + dx, y - hgt);
          g.lineTo(x + dx + 3.5, y);
          g.fill();
        }
      }
    }
    const hx = 96 + 10 * Math.sin(t * 0.6),
      hy = 78 + 5 * Math.sin(t * 1.7);
    gunship(g, hx, hy, t);
    if (mod(t, 2.4) < 1.3) {
      g.save();
      g.shadowColor = 'oklch(0.85 0.17 70)';
      g.shadowBlur = 8;
      g.strokeStyle = 'oklch(0.95 0.12 90)';
      g.lineWidth = 1.1;
      g.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const p = mod(t * 2.2 + i * 0.2, 1),
          bx = hx + 24 + p * 230,
          by = hy + 4.5 + p * 6;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + 8, by + 0.2);
        g.stroke();
      }
      g.restore();
    }
    g.fillStyle = 'oklch(0.85 0.15 60 / .5)';
    for (let i = 0; i < 24; i++) {
      g.beginPath();
      g.arc(
        mod(i * 53.3 - sx * 0.8 + Math.sin(t + i) * 6, 320),
        mod(190 - t * (6 + (i % 5) * 2) - i * 17, 200),
        0.5,
        0,
        7,
      );
      g.fill();
    }
  },

  // ---- Dropzone, HD: top-down, the ground slides south as the canopy drifts down ----
  dropzoneHD(g, t) {
    const cam = t * 16;
    const riverX = wy => 205 + 45 * Math.sin(wy * 0.0105) + 14 * Math.sin(wy * 0.031 + 1);
    const roadX = wy => 58 + 18 * Math.sin(wy * 0.009);
    g.fillStyle = 'oklch(0.37 0.055 128)';
    g.fillRect(0, 0, 320, 200);
    for (let r = Math.floor(-cam / 40) - 1; r <= Math.floor((200 - cam) / 40) + 1; r++) {
      for (let k = 0; k < 2; k++) {
        const x = hash(r * 7 + k) * 320,
          y = r * 40 + cam + hash(r * 13 + k) * 40;
        const gr = g.createRadialGradient(x, y, 0, x, y, 34);
        gr.addColorStop(0, `oklch(${k ? 0.45 : 0.31} 0.07 ${k ? 115 : 135} / .55)`);
        gr.addColorStop(1, 'oklch(0.4 0.06 125 / 0)');
        g.fillStyle = gr;
        g.fillRect(x - 34, y - 34, 68, 68);
      }
    }
    const line = fx => {
      const p = new Path2D();
      for (let y = -12; y <= 212; y += 6) {
        const x = fx(y - cam);
        if (y === -12) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      return p;
    };
    const road = line(roadX),
      river = line(riverX);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'oklch(0.52 0.04 80)';
    g.lineWidth = 6;
    g.stroke(road);
    g.strokeStyle = 'oklch(0.6 0.04 85)';
    g.lineWidth = 3.5;
    g.stroke(road);
    g.strokeStyle = 'oklch(0.58 0.05 85)';
    g.lineWidth = 27;
    g.stroke(river);
    g.strokeStyle = 'oklch(0.3 0.06 225)';
    g.lineWidth = 21;
    g.stroke(river);
    g.strokeStyle = 'oklch(0.4 0.07 222)';
    g.lineWidth = 12;
    g.stroke(river);
    g.setLineDash([2, 14]);
    g.lineDashOffset = -t * 22;
    g.strokeStyle = 'oklch(0.82 0.05 220 / .4)';
    g.lineWidth = 1;
    g.stroke(river);
    g.setLineDash([]);
    for (let n = Math.floor((-cam - 80) / 520); n <= Math.floor((280 - cam) / 520); n++) {
      const wy = n * 520 + 260,
        y = wy + cam,
        x = 118 + 24 * hash(n);
      g.save();
      g.translate(x, y);
      g.setLineDash([3, 1.4]);
      g.strokeStyle = 'oklch(0.56 0.05 80)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, 17, 0, 7);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'oklch(0.42 0.05 105)';
      g.save();
      g.rotate(0.3);
      g.fillRect(-9, -6, 9, 6);
      g.restore();
      g.save();
      g.rotate(-0.4);
      g.fillRect(1, 1, 8, 6);
      g.restore();
      const gx = 22,
        ang = Math.PI * 0.5 + Math.sin(t * 0.8 + n) * 1.1;
      const gr = g.createRadialGradient(gx, 0, 0, gx, 0, 56);
      gr.addColorStop(0, 'oklch(0.92 0.14 95 / .32)');
      gr.addColorStop(1, 'oklch(0.92 0.14 95 / 0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(gx, 0);
      g.arc(gx, 0, 56, ang - 0.42, ang + 0.42);
      g.closePath();
      g.fill();
      g.fillStyle = 'oklch(0.2 0.03 120)';
      g.beginPath();
      g.arc(gx, 0, 1.8, 0, 7);
      g.fill();
      g.restore();
    }
    const trees = [];
    for (let r = Math.floor((-cam - 20) / 14); r <= Math.floor((220 - cam) / 14); r++) {
      for (let i = 0; i < 4; i++) {
        const s = r * 4 + i,
          x = hash(s) * 340 - 10,
          wy = r * 14 + hash(s + 0.5) * 14;
        if (Math.abs(x - riverX(wy)) < 22 || Math.abs(x - roadX(wy)) < 9) continue;
        if (Math.sin(wy * 0.013 + x * 0.02) + Math.sin(x * 0.011 - wy * 0.004) < -0.2) continue;
        trees.push([x, wy + cam, 4 + hash(s + 0.25) * 4.5]);
      }
    }
    g.fillStyle = 'oklch(0.17 0.04 130 / .45)';
    for (const [x, y, r] of trees) {
      g.beginPath();
      g.arc(x + 2.5, y + 2, r, 0, 7);
      g.fill();
    }
    g.fillStyle = 'oklch(0.29 0.075 142)';
    for (const [x, y, r] of trees) {
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    }
    g.fillStyle = 'oklch(0.42 0.09 130)';
    for (const [x, y, r] of trees) {
      g.beginPath();
      g.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, 7);
      g.fill();
    }

    const alt = 1 - mod(t * 0.06, 1),
      px = 150 + 24 * Math.sin(t * 0.45),
      py = 100 + 10 * Math.sin(t * 0.33);
    const R = 11 + 7 * alt,
      off = 4 + 26 * alt;
    g.fillStyle = 'oklch(0.1 0.02 130 / .35)';
    g.beginPath();
    g.ellipse(px + off, py + off * 0.7, R * 0.9, R * 0.85, 0, 0, 7);
    g.fill();
    const spin = t * 0.15;
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.moveTo(px, py);
      g.arc(px, py, R, spin + (i * Math.PI) / 4, spin + ((i + 1) * Math.PI) / 4);
      g.closePath();
      g.fillStyle = i % 2 ? 'oklch(0.66 0.06 95)' : 'oklch(0.54 0.06 100)';
      g.fill();
    }
    g.strokeStyle = 'oklch(0.3 0.03 100)';
    g.lineWidth = 0.6;
    g.beginPath();
    g.arc(px, py, R, 0, 7);
    g.stroke();
    g.fillStyle = 'oklch(0.24 0.03 110)';
    g.beginPath();
    g.arc(px, py, R * 0.16, 0, 7);
    g.fill();

    const pt = mod(t, 11);
    if (pt < 3.4) {
      const x = 252,
        y = 236 - pt * (300 / 3.4);
      const plane = new Path2D(
        'M0 -15 Q2.4 -13 2.4 -7 L2.4 12 L0 16 L-2.4 12 L-2.4 -7 Q-2.4 -13 0 -15Z M-22 -3 L22 -3 L22 .5 L-22 .5Z M-8 11 L8 11 L8 13.5 L-8 13.5Z',
      );
      g.save();
      g.translate(x + 34, y + 24);
      g.scale(1.3, 1.3);
      g.fillStyle = 'oklch(0.1 0.02 130 / .3)';
      g.fill(plane);
      g.restore();
      g.save();
      g.translate(x, y);
      g.scale(1.3, 1.3);
      g.fillStyle = 'oklch(0.44 0.03 120)';
      g.fill(plane);
      g.fillStyle = 'oklch(0.3 0.02 120)';
      for (const ex of [-14, -7, 7, 14]) g.fillRect(ex - 1, -5, 2, 4);
      g.restore();
    }
    let gr = g.createRadialGradient(160, 100, 50, 160, 100, 210);
    gr.addColorStop(0, 'oklch(0 0 0 / 0)');
    gr.addColorStop(1, 'oklch(0.12 0.03 40 / .7)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 320, 200);
    g.fillStyle = 'oklch(0.62 0.14 50 / .08)';
    g.fillRect(0, 0, 320, 200);
    g.font = '11px VT323, monospace';
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'oklch(0.93 0.12 95 / .9)';
    g.fillText(`ALT ${String(Math.round(40 + 860 * alt)).padStart(3, '0')} M`, 10, 190);
    g.textAlign = 'right';
    g.fillText('N ▲', 310, 190);
    g.textAlign = 'start';
  },

  // ---- empty slot: snow on the monitor ----
  noDisk(g, t) {
    noise ??= g.createImageData(320, 200);
    const d = noise.data;
    let s = Math.floor(t * 15) * 9301 + 49297;
    for (let i = 0; i < d.length; i += 4) {
      s = (Math.imul(s, 1103515245) + 12345) | 0;
      const v = (s >>> 16) & 255,
        c = v > 210 ? 96 : v > 120 ? 44 : 12;
      d[i] = c * 0.8;
      d[i + 1] = c * 0.9;
      d[i + 2] = c;
      d[i + 3] = 255;
    }
    g.putImageData(noise, 0, 0);
    g.fillStyle = CGA[0];
    g.fillRect(70, 86, 180, 28);
    g.fillStyle = CGA[3];
    g.font = '16px VT323, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('DRIVE A: NOT READY', 160, 101);
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
  },
};

const HULL = new Path2D('M-10 -5 Q2 -9 10 -4.5 Q17 -2 17 1.5 Q12 5.5 0 5.5 L-10 4.5 Q-13 0 -10 -5Z');
const BOOM = new Path2D(
  'M-6 -3 L-34 -1.5 L-34 1 L-6 3Z M-31 -1 L-37 -10 L-33.5 -10 L-29 -1Z M-33 .5 L-27 .5 L-27 1.7 L-33 1.7Z',
);
const GLASS = new Path2D('M3 -6.5 Q11 -5 14.5 -1 L6 -1Z');
function gunship(g, x, y, t) {
  const body = 'oklch(0.17 0.02 265)';
  g.save();
  g.translate(x, y);
  g.scale(1.25, 1.25);
  g.rotate(-0.05 + 0.03 * Math.sin(t * 1.7));
  g.fillStyle = body;
  g.fill(BOOM);
  g.fill(HULL);
  g.strokeStyle = 'oklch(0.6 0.12 50 / .7)';
  g.lineWidth = 0.45;
  g.stroke(HULL);
  const cg = g.createLinearGradient(4, -6, 14, 0);
  cg.addColorStop(0, 'oklch(0.86 0.12 200)');
  cg.addColorStop(1, 'oklch(0.38 0.1 235)');
  g.fillStyle = cg;
  g.fill(GLASS);
  g.fillStyle = body;
  g.fillRect(-4, 1.5, 10, 1.4);
  g.fillRect(-1, -10.5, 2, 2.6);
  g.fillStyle = 'oklch(0.28 0.03 265)';
  g.fillRect(-2, 2.7, 8, 2.2);
  g.strokeStyle = body;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-7, 5);
  g.lineTo(-8, 8.5);
  g.moveTo(7, 5);
  g.lineTo(8, 8.5);
  g.moveTo(-12, 8.5);
  g.lineTo(13, 8.5);
  g.quadraticCurveTo(15, 8.5, 15.5, 7);
  g.stroke();
  g.fillStyle = 'oklch(0.9 0.02 260 / .13)';
  g.beginPath();
  g.ellipse(0, -10.5, 30, 1.6, 0, 0, 7);
  g.fill();
  const a = t * 42;
  g.strokeStyle = 'oklch(0.12 0.02 265 / .85)';
  g.lineWidth = 0.9;
  for (const ph of [0, Math.PI]) {
    g.beginPath();
    g.moveTo(0, -10.5);
    g.lineTo(30 * Math.cos(a + ph), -10.5 + 0.8 * Math.sin(a + ph));
    g.stroke();
  }
  g.fillStyle = 'oklch(0.9 0.02 260 / .15)';
  g.beginPath();
  g.arc(-35, -5, 4.5, 0, 7);
  g.fill();
  const b = t * 60;
  g.beginPath();
  g.moveTo(-35 + 4.5 * Math.cos(b), -5 + 4.5 * Math.sin(b));
  g.lineTo(-35 - 4.5 * Math.cos(b), -5 - 4.5 * Math.sin(b));
  g.stroke();
  if (Math.floor(t * 1.5) % 2 === 0) {
    g.shadowColor = 'oklch(0.7 0.25 25)';
    g.shadowBlur = 10;
    g.fillStyle = 'oklch(0.75 0.22 25)';
    g.beginPath();
    g.arc(-36, -10, 1, 0, 7);
    g.fill();
  }
  g.restore();
}

// ---------- prefs UI ----------
function applyPrefs() {
  document.documentElement.classList.toggle('no-crt', !prefs.crt);
  $$('[data-state]').forEach(el => {
    el.textContent = prefs[el.dataset.state] ? 'On' : 'Off';
  });
  $$('[data-pressed]').forEach(el => el.setAttribute('aria-pressed', String(!!prefs[el.dataset.pressed])));
}
const toggle = key => {
  prefs[key] = !prefs[key];
  save();
  applyPrefs();
  beep(prefs[key] ? 1320 : 660, 0.04);
};

const help = $('#help');
const actions = {
  help: () => {
    if (help.open) help.close();
    else {
      help.showModal();
      beep(1100, 0.03);
    }
  },
  sound: () => toggle('sound'),
  crt: () => toggle('crt'),
  run,
  quit,
};
help.addEventListener('click', e => {
  if (e.target === help) help.close();
});

// ---------- input ----------
document.addEventListener('click', e => {
  const act = e.target.closest('[data-action]');
  if (act) {
    actions[act.dataset.action]();
    return;
  }
  const ver = e.target.closest('[data-version]');
  if (ver) {
    setVersion(ver.dataset.version, true);
    beep(1320, 0.025);
    return;
  }
  const row = e.target.closest('.game');
  if (row) {
    if (+row.dataset.index !== index) {
      select(+row.dataset.index);
      beep();
    }
    if (narrow.matches)
      $('#detail').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }
});
list.addEventListener('dblclick', e => {
  if (e.target.closest('.game')) void run();
});

function go(d) {
  select(index + d);
  beep();
}

addEventListener('keydown', e => {
  if (term.open) {
    e.preventDefault();
    term.key();
    return;
  }
  if (help.open) {
    if (e.key === 'F1') {
      e.preventDefault();
      help.close();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  const onControl = e.target.closest?.('button, a, input');
  if ((k === 'Enter' || k === ' ') && onControl) return; // let the focused control activate itself
  const handlers = {
    ArrowDown: () => go(1),
    ArrowUp: () => go(-1),
    s: () => go(1),
    w: () => go(-1),
    j: () => go(1),
    k: () => go(-1),
    Home: () => {
      select(0);
      beep();
    },
    End: () => {
      select(GAMES.length - 1);
      beep();
    },
    ArrowRight: () => stepVersion(1),
    ArrowLeft: () => stepVersion(-1),
    d: () => stepVersion(1),
    a: () => stepVersion(-1),
    Enter: run,
    ' ': run,
    F1: actions.help,
    h: actions.help,
    '?': actions.help,
    F2: actions.sound,
    m: actions.sound,
    F3: actions.crt,
    c: actions.crt,
    F10: quit,
    q: quit,
  };
  const fn =
    handlers[k] ??
    (/^[1-9]$/.test(k) && +k <= GAMES.length
      ? () => {
          select(+k - 1);
          beep();
        }
      : null);
  if (fn) {
    e.preventDefault();
    fn();
  }
});

// ---------- gamepad ----------
// Keyboard keeps its own handler above (native repeat, focused-button activation);
// the input module adds pads and supplies the glyphs shown when one is in use.
const input = createInput({
  actions: {
    run: { keys: ['Enter', 'Space'], pad: ['South'] },
    help: { keys: ['F1', 'KeyH'], pad: ['Select'] },
    sound: { keys: ['F2', 'KeyM'], pad: ['West'] },
    crt: { keys: ['F3', 'KeyC'], pad: ['North'] },
    quit: { keys: ['F10', 'KeyQ'], pad: ['East'] },
  },
  display: {
    select: { keys: ['ArrowsV'], pad: ['DpadV'] },
    version: { keys: ['ArrowsH'], pad: ['DpadH'] },
  },
  preventDefault: false,
  autoUpdate: true,
});
const PAD = {
  Up: () => go(-1),
  Down: () => go(1),
  LStickUp: () => go(-1),
  LStickDown: () => go(1),
  Left: () => stepVersion(-1),
  Right: () => stepVersion(1),
  LStickLeft: () => stepVersion(-1),
  LStickRight: () => stepVersion(1),
  South: run,
  Start: run,
  Select: actions.help,
  West: actions.sound,
  North: actions.crt,
  East: quit,
};
input.onPad(k => {
  if (term.open) return term.key();
  if (help.open) return k === 'South' || k === 'East' || k === 'Select' ? help.close() : undefined;
  PAD[k]?.();
});

// ---------- clock ----------
const clock = () => {
  $('#clock').textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};
clock();
setInterval(clock, 1000);

// ---------- start ----------
applyPrefs();
bar.style.transition = 'none';
select(index);
requestAnimationFrame(() => {
  bar.style.transition = '';
});
new ResizeObserver(moveBar).observe(list);
void document.fonts?.ready.then(moveBar);

let booted = false;
try {
  booted = sessionStorage.getItem('nostalgia:booted') === '1';
  sessionStorage.setItem('nostalgia:booted', '1');
} catch {}
if (booted || reduceMotion.matches) term.close();
else void boot();
