import { games, pageUrl } from '@nostalgia/game';
import { createInput } from '@nostalgia/input';

// ---------- catalogue: every games/<id>/game.json, plus the empty drive ----------
const REPO = 'https://github.com/varyform/nostalgia/tree/main/games/';
const GAMES = [...games, { id: 'empty', empty: true, exe: 'A:\\', title: 'Drive A:' }];
// Share's icons: a chain link, and a tick once copied
const icon = d =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" aria-hidden="true">${d}</svg>`;
const LINK = icon(
  '<path d="M10 14l4-4M9 7l2-2a4 4 0 0 1 6 0 4 4 0 0 1 0 6l-2 2M15 17l-2 2a4 4 0 0 1-6 0 4 4 0 0 1 0-6l2-2"/>',
);
const TICK = icon('<path d="M5 12l5 5 9-10"/>');

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const narrow = matchMedia('(max-width: 860px)');
const mod = (a, b) => ((a % b) + b) % b;
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
    if (ac.state !== 'running' && ac.state !== 'closed') ac.resume(); // iOS: also 'interrupted'
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

$('#count').textContent = `${games.length} game(s)`;
$('#free').textContent = `${Number(import.meta.env.BYTES_FREE).toLocaleString('en-US')} bytes free`;

function moveBar() {
  const r = rows[index];
  bar.style.height = r.offsetHeight + 'px';
  bar.style.translate = `0 ${r.offsetTop}px`;
  // the list scrolls inside its window on short screens: keep the selection in sight
  const box = list.parentElement;
  if (box.scrollHeight > box.clientHeight) {
    const top = r.offsetTop,
      bottom = top + r.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }
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
// a game's control, drawn from the bindings it plays with
const controlGlyph = (g, action) => {
  const b = g.input.actions[action] ?? g.input.display?.[action] ?? {};
  const attr = (name, list) => (list?.length ? ` ${name}="${list.join(' ')}"` : '');
  return `<input-glyph${attr('keys', b.keys)}${attr('pad', b.pad)}></input-glyph>`;
};
const pairs = items => `<dl class="pairs">${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

function renderDetail() {
  const g = GAMES[index],
    info = $('#info');
  if (g.empty) {
    $('#detail-title').textContent = 'A:\\';
    $('#preview-tag').textContent = 'NO SIGNAL';
    stage.show(g);
    info.innerHTML = `
      <div class="info__desc">
        <div class="info__head">
          <h3 class="info__title">Drive A:</h3>
          <p class="info__meta">No disk in drive</p>
        </div>
        <p class="info__blurb">The next remake goes in this slot.</p>
        <div class="info__foot">
          <p class="info__error">Not ready reading drive A\nAbort, Retry, Fail?</p>
          <div class="actions"><button class="btn btn--run" data-action="run">Retry</button></div>
        </div>
      </div>`;
    return;
  }
  const v = version(g);
  $('#detail-title').textContent = `${dos(g.id)}\\${g.exe}`;
  $('#preview-tag').textContent = v.tag;
  stage.show(g, v);
  // the controls go beside the preview; the description, facts, version and Run below it
  info.innerHTML = `
    <div class="info__controls">
      <p class="label">Controls</p>
      ${pairs(g.controls.map(([action, label]) => [controlGlyph(g, action), label]))}
    </div>
    <div class="info__desc">
      <div class="info__head">
        <h3 class="info__title">${g.title}</h3>
        <div class="info__line">
          <p class="info__meta">${g.genre} · in the spirit of ${g.after} (${g.year})</p>
          <ul class="chips">${g.tags.map(t => `<li class="chip">${t}</li>`).join('')}</ul>
        </div>
      </div>
      <p class="info__blurb">${g.blurb}</p>
      <div class="info__facts">${pairs(g.facts)}</div>
      <div class="info__foot">
        <div class="info__version">
          <p class="label" id="version-label">Version</p>
          <div class="seg" role="radiogroup" aria-labelledby="version-label">
            ${g.versions.map(x => `<button class="seg__btn" role="radio" aria-checked="${x === v}" data-version="${x.key}">${x.label}</button>`).join('')}
          </div>
          <p class="seg__note">${v.note}</p>
        </div>
        <div class="actions">
          <span class="actions__main">
            <button class="btn btn--run" data-action="run">▶ Run ${g.exe}</button>
            <button class="btn btn--ghost btn--share" data-action="share" title="Copy a direct link to ${g.title}" aria-label="Share a direct link to ${g.title}">${LINK}</button>
          </span>
          <a class="btn btn--ghost" href="${REPO}${g.id}" target="_blank" rel="noopener">Source</a>
        </div>
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
  if (!stage.ready) return; // its demo is still loading
  const v = version(g),
    D = dos(g.id);
  if (reduceMotion.matches) return stage.play(g);
  term.show('launch');
  await term.type('C:\\NOSTALGIA> ', `cd ${D.toLowerCase()}`);
  await term.type(
    `C:\\NOSTALGIA\\${D}> `,
    `${g.exe.split('.')[0].toLowerCase()}${g.versions.length > 1 ? ' /' + v.key : ''}`,
  );
  seek();
  term.line(`Loading ${g.title}${g.versions.length > 1 ? ` (${v.label})` : ''}...`);
  await term.wait(520);
  await stage.play(g);
  term.close();
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
// The selected game runs its own demo (?demo=on) in an iframe laid out at the full viewport
// size and scaled down into the preview box. Launching zooms it to full size and tells the
// page to play; the game posts `exit` from its title screen (see packages/game/src/host.ts).
const previewBox = $('.preview');
const stage = {
  frame: null, // the demo on show
  pending: null, // the next one, until it has loaded
  snow: null, // the empty drive
  playing: null, // the game being played
  get ready() {
    return !!this.frame && !this.pending;
  },
  show(g, v, reload = false) {
    if (this.playing) return;
    const src = g.empty ? '' : pageUrl(g, v, { demo: true });
    if (!reload && !g.empty && (this.pending ?? this.frame)?.dataset.src === src) return;
    this.pending?.remove();
    this.pending = null;
    if (g.empty) {
      this.clear();
      const cv = document.createElement('canvas');
      cv.setAttribute('aria-hidden', 'true');
      previewBox.prepend(cv);
      this.snow = { el: cv, run: noDisk(cv, { reducedMotion: reduceMotion.matches }) };
      return;
    }
    const f = document.createElement('iframe');
    f.className = 'preview__frame';
    f.title = `${g.title} demo`;
    f.tabIndex = -1;
    // `*`: opened from disk the frame's origin is opaque and would not match the default (src)
    f.allow = 'gamepad *; fullscreen *; autoplay *';
    f.setAttribute('aria-hidden', 'true');
    f.src = f.dataset.src = src;
    // the previous demo keeps playing until this one is up
    f.addEventListener(
      'load',
      () => {
        if (this.pending !== f) return;
        this.pending = null;
        this.clear();
        this.frame = f;
        f.classList.add('is-ready');
      },
      { once: true },
    );
    this.pending = f;
    previewBox.prepend(f);
    this.fit(f);
  },
  clear() {
    this.frame?.remove();
    this.frame = null;
    this.snow?.run.stop();
    this.snow?.el.remove();
    this.snow = null;
  },
  // where the frame sits in the box: the viewport, scaled to fit and centred
  boxTransform() {
    const r = previewBox.getBoundingClientRect(),
      b = previewBox.clientLeft,
      w = previewBox.clientWidth,
      h = previewBox.clientHeight,
      k = Math.min(w / innerWidth, h / innerHeight);
    return { k, x: (w - innerWidth * k) / 2, y: (h - innerHeight * k) / 2, left: r.left + b, top: r.top + b };
  },
  fit(f) {
    const { k, x, y } = this.boxTransform();
    f.style.width = innerWidth + 'px';
    f.style.height = innerHeight + 'px';
    f.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  },
  fitAll() {
    for (const f of [this.frame, this.pending]) if (f && f !== this.playing) this.fit(f);
  },
  // FLIP: pin the frame where it is on screen, then let it grow to the viewport
  async play(g) {
    const f = this.frame;
    if (!f || this.playing) return;
    this.playing = f;
    const { k, x, y, left, top } = this.boxTransform();
    document.documentElement.classList.add('is-playing');
    f.style.transform = `translate(${left + x}px, ${top + y}px) scale(${k})`;
    f.classList.add('is-playing');
    if (!reduceMotion.matches) {
      void f.offsetWidth;
      f.classList.add('is-zooming');
      f.style.transform = 'none';
      await transitionEnd(f);
    } else f.style.transform = 'none';
    f.classList.remove('is-zooming');
    f.removeAttribute('aria-hidden');
    f.tabIndex = 0;
    document.title = `${g.title} · Nostalgia`;
    history.pushState({ playing: g.id }, '');
    f.contentWindow?.postMessage({ nostalgia: 'play', sound: prefs.sound }, '*');
    f.focus();
  },
  // back to the box, then a fresh demo in place of the played game
  async exit() {
    const f = this.playing;
    if (!f) return;
    // unlock first: a returning scrollbar moves the box, and the frame must land where it is now
    document.documentElement.classList.remove('is-playing');
    const { k, x, y, left, top } = this.boxTransform();
    f.blur();
    if (!reduceMotion.matches) {
      f.classList.add('is-zooming');
      f.style.transform = `translate(${left + x}px, ${top + y}px) scale(${k})`;
      await transitionEnd(f);
    }
    document.title = title;
    this.playing = null;
    f.classList.remove('is-playing', 'is-zooming');
    f.tabIndex = -1;
    f.setAttribute('aria-hidden', 'true');
    this.fit(f);
    list.focus();
    const g = GAMES[index];
    if (!g.empty) this.show(g, version(g), true);
  },
};
const title = document.title;
// the zoom's end, or its duration when the event never comes (hidden tab, no transition)
const transitionEnd = el =>
  new Promise(done => {
    const end = e => {
      if (e && (e.target !== el || e.propertyName !== 'transform')) return;
      el.removeEventListener('transitionend', end);
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(end, 700);
    el.addEventListener('transitionend', end);
  });
new ResizeObserver(() => stage.fitAll()).observe(previewBox);
addEventListener('resize', () => stage.fitAll());
// the game leaves from its title screen; Back leaves from anywhere
addEventListener('message', e => {
  if (!stage.playing || e.source !== stage.playing.contentWindow || e.data?.nostalgia !== 'exit') return;
  if (history.state?.playing) history.back();
  else void stage.exit();
});
addEventListener('popstate', () => void stage.exit());
reduceMotion.addEventListener('change', () => renderDetail());

// the empty drive: snow on a 320×200 monitor
function noDisk(cv, { reducedMotion }) {
  cv.width = 320;
  cv.height = 200;
  cv.style.imageRendering = 'pixelated';
  const g = cv.getContext('2d'),
    img = g.createImageData(320, 200),
    d = img.data;
  const [black, , , white] = [0, 1, 2, 3].map(i => getComputedStyle(cv).getPropertyValue(`--cga-${i}`).trim());
  let raf = 0;
  const draw = now => {
    let s = Math.floor(now / 66) * 9301 + 49297;
    for (let i = 0; i < d.length; i += 4) {
      s = (Math.imul(s, 1103515245) + 12345) | 0;
      const v = (s >>> 16) & 255,
        c = v > 210 ? 96 : v > 120 ? 44 : 12;
      d[i] = c * 0.8;
      d[i + 1] = c * 0.9;
      d[i + 2] = c;
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = black;
    g.fillRect(70, 86, 180, 28);
    g.fillStyle = white;
    g.font = '16px VT323, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('DRIVE A: NOT READY', 160, 101);
    if (!reducedMotion) raf = requestAnimationFrame(draw);
  };
  draw(performance.now());
  return { stop: () => cancelAnimationFrame(raf) };
}

// ---------- prefs UI ----------
// fullscreen is the browser's state, not a saved pref: it can only start from a key press or click
const fullscreen = {
  get on() {
    return !!(document.fullscreenElement ?? document.webkitFullscreenElement);
  },
  supported: !!(document.fullscreenEnabled ?? document.webkitFullscreenEnabled),
  toggle() {
    const d = document,
      el = d.documentElement;
    const done = this.on
      ? d.exitFullscreen
        ? d.exitFullscreen()
        : d.webkitExitFullscreen?.()
      : el.requestFullscreen
        ? el.requestFullscreen()
        : el.webkitRequestFullscreen?.();
    done?.catch?.(() => {}); // refused (no user gesture, policy): nothing to undo
    beep(this.on ? 660 : 1320, 0.04);
  },
};
const state = key => (key === 'fullscreen' ? fullscreen.on : !!prefs[key]);
function applyPrefs() {
  document.documentElement.classList.toggle('no-crt', !prefs.crt);
  $$('[data-state]').forEach(el => {
    el.textContent = state(el.dataset.state) ? 'On' : 'Off';
  });
  $$('[data-pressed]').forEach(el => el.setAttribute('aria-pressed', String(state(el.dataset.pressed))));
}
// no element fullscreen (iPhone Safari): leave its controls out
if (!fullscreen.supported) $$('[data-fullscreen]').forEach(el => (el.hidden = true));
document.addEventListener('fullscreenchange', applyPrefs);
document.addEventListener('webkitfullscreenchange', applyPrefs);
const toggle = key => {
  prefs[key] = !prefs[key];
  save();
  applyPrefs();
  beep(prefs[key] ? 1320 : 660, 0.04);
};

// ---------- share: a direct link to the game's own page, in the chosen version ----------
// The iOS app runs an offline copy, so off the web the link points at the public site.
const SITE = 'https://ogg.ol3h.org/';
const coarse = matchMedia('(pointer: coarse)');
async function share() {
  const g = GAMES[index];
  if (g.empty) return error();
  const url = new URL(pageUrl(g, version(g)), /^https?:$/.test(location.protocol) ? location.href : SITE).href;
  // phones and tablets get the share sheet; desktops a copy, which is what a link is for there
  if (coarse.matches && navigator.share) {
    try {
      await navigator.share({ title: `${g.title} · Nostalgia`, url });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    prompt(`Link to ${g.title}`, url);
    return;
  }
  beep(1320, 0.03);
  const btn = $('.btn--share');
  if (!btn) return;
  btn.innerHTML = TICK;
  btn.title = 'Link copied';
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.innerHTML = LINK;
    btn.title = `Copy a direct link to ${g.title}`;
  }, 1600);
}

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
  fullscreen: () => fullscreen.supported && fullscreen.toggle(),
  run,
  share,
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
  if (stage.playing) return;
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
    F4: actions.fullscreen,
    f: actions.fullscreen,
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
    fullscreen: { keys: ['F4', 'KeyF'], pad: ['R1'] },
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
  R1: actions.fullscreen,
  East: quit,
};
input.onPad(k => {
  if (stage.playing) return;
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
