// Procedural sound: a little street band for each scene (an accordion-ish pulse lead on the
// harbour polka, a brass march in the park, a music-box waltz on the roofs, a breakneck fanfare
// while the glove lasts) and the effects, all made with Web Audio by @nostalgia/audio. Every
// tune is written for Keepsake. The context is only created by unlock(), which the page calls
// from a user gesture; the demo never creates one.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();  audio.music('harbour');  audio.sfx('catch', { n: 3 });  audio.setOn(false);
import { createSynth, line, midi, span } from '@nostalgia/audio';

const CH = { M: [0, 4, 7], m: [0, 3, 7] };
// four bars each: chord roots (bass and stabs), the lead, a bass pattern (x root, o fifth,
// c a chord stab) and drums (k kick, s snare, h hat), `bar` steps to the bar
const TRACKS = {
  title: {
    bpm: 96, bar: 16, lead: 'triangle', vol: 0.08, bars: [[53, 'M'], [57, 'm'], [58, 'M'], [48, 'M']], bass: 'x.......o.......', drums: 'k.......s.......',
    tune: `77 - - - 76 - 74 - 72 - - - 69 - - -  72 - - - 76 - 79 - 81 - - - 79 - - -
           77 - - - 74 - 70 - 74 - 77 - 79 - - -  81 - - - 79 - 76 - 72 - - - - - - -`,
  },
  harbour: {
    bpm: 132, bar: 16, lead: 0.25, vol: 0.06, bars: [[53, 'M'], [50, 'm'], [58, 'M'], [48, 'M']], bass: 'x...c...o...c...', drums: 'k.h.s.h.k.h.s.hh',
    tune: `72 . 69 . 72 - 77 - 76 . 74 . 72 - - .  74 . 69 . 74 - 77 - 81 - 79 . 77 - - .
           70 . 74 . 77 - 74 - 72 . 70 . 69 - 70 .  72 - - . 67 . 70 . 69 - 67 - 65 - - .`,
  },
  park: {
    bpm: 116, bar: 16, lead: 0.5, vol: 0.055, bars: [[48, 'M'], [45, 'm'], [53, 'M'], [43, 'M']], bass: 'x...c...o...c...', drums: 'k...s...k.k.s...',
    tune: `67 - 72 - 76 - 72 - 79 - - 76 74 - 72 -  69 - 72 - 76 - 81 - 79 - 76 - 72 - - -
           65 - 69 - 72 - 77 - 76 - 74 - 72 - 69 -  71 - 74 - 79 - 77 - 74 - 71 - 67 - - -`,
  },
  roofs: {
    bpm: 150, bar: 12, lead: 'triangle', vol: 0.075, bell: true, bars: [[45, 'm'], [41, 'M'], [48, 'M'], [40, 'M']], bass: 'x...c...c...', drums: 'k...h...h...',
    tune: `76 - - - 72 - 69 - 72 - 76 -  77 - - - 76 - 72 - 69 - - -
           72 - - - 74 - 76 - 79 - 76 -  76 - - - 74 - 71 - 68 - - -`,
  },
  power: {
    bpm: 152, bar: 16, lead: 0.125, vol: 0.06, bars: [[50, 'M'], [52, 'm'], [50, 'M'], [45, 'M']], bass: 'x.x.o.o.x.x.o.o.', drums: 'k.hsk.hsk.hsk.ss',
    tune: `74 . 78 . 81 . 86 - 81 . 78 . 81 - - .  76 . 79 . 83 . 88 - 83 . 79 . 83 - - .
           78 . 81 . 86 . 90 - 86 . 81 . 86 - - .  85 - 86 - 88 - 85 - 81 - 78 - 76 - - -`,
  },
};
for (const tr of Object.values(TRACKS)) tr.line = line(tr.tune);

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 41, levels: { master: 0.55, music: 0.3, sfx: 0.8 }, tracks: TRACKS,
    pulse: true, attack: 0.005, startDelay: 0.06, echo: { time: 0.22, feedback: 0.22, wet: 0.16, cut: 2600 },
    arrange: ({ tone, hiss, notes, fm, hold }) => ({
      step(tr, i, t, dt) {
        const [root, kind] = tr.bars[Math.floor(i / tr.bar) % tr.bars.length], s = i % tr.bar, ch = CH[kind];
        const b = tr.bass[s];
        if (b === 'x') tone(midi(root - 12), midi(root - 12), t, dt * 2.2, 0.16, 'triangle', 'music');
        if (b === 'o') tone(midi(root - 5), midi(root - 5), t, dt * 2, 0.13, 'triangle', 'music');
        if (b === 'c') for (const n of ch) tone(midi(root + 12 + n), midi(root + 12 + n), t, dt * 1.3, 0.022, 0.5, 'music', 0);
        if (tr.bell && s % 2 === 0) fm(midi(root + 24 + ch[(s / 2) % 3]), t, dt * 3, 0.03, 3.5, 1.2);
        const n = tr.line[i % tr.line.length];
        if (n > 0) {
          const d = dt * span(tr.line, i, 8) * 0.92;
          tone(midi(n), midi(n), t, d, tr.vol, tr.lead, 'music');
          // a second reed a hair sharp: the squeezebox
          if (tr.lead === 0.25) tone(midi(n) * 1.006, midi(n) * 1.006, t, d, tr.vol * 0.5, 0.5, 'music');
        }
        const dr = tr.drums[s];
        if (dr === 'k') tone(130, 45, t, 0.11, 0.18, 'sine', 'music');
        if (dr === 's') hiss(t, 0.09, 0.05, 4200, 1100, 'bandpass', 'music');
        if (dr === 'h') hiss(t, 0.025, 0.025, 9500, 7500, 'highpass', 'music');
      },
      effects: {
        punch: (t, e) => { hiss(t, 0.08, 0.07, 1800, 500, 'bandpass'); if (e?.power) tone(160, 60, t, 0.16, 0.08, 'sine'); },
        smash: t => { hiss(t, 0.22, 0.12, 5000, 800, 'highpass'); notes([88, 84, 91], t, 0.03, 0.06, 0.03, 'triangle'); },
        birdhit: t => { tone(1400, 2200, t, 0.08, 0.05, 0.25); tone(1800, 900, t + 0.08, 0.12, 0.04, 0.25); hiss(t, 0.1, 0.06, 3000, 1200); },
        bonk: t => { tone(220, 110, t, 0.2, 0.12, 'square'); hiss(t, 0.18, 0.1, 1600, 300); notes([84, 88, 91, 96], t + 0.15, 0.06, 0.1, 0.035, 'triangle'); },
        fling: t => { tone(90, 40, t, 0.3, 0.2, 'sine'); hiss(t, 0.3, 0.12, 2400, 200); tone(400, 1600, t + 0.05, 0.45, 0.05, 0.25); },
        power: t => { hold(t + 0.8); notes([74, 78, 81, 86, 90], t, 0.07, 0.18, 0.07, 0.25); },
        powerend: t => notes([86, 81, 78], t, 0.08, 0.12, 0.05, 0.25),
        glove: t => notes([86, 93], t, 0.08, 0.16, 0.035, 'triangle'),
        catch: (t, e) => { const b = 79 + ((e?.n ?? 0) % 8); notes([b, b + 4, b + 7], t, 0.045, 0.18, 0.06, 'triangle'); fm(midi(b + 12), t, 0.4, 0.03, 3.5, 1.5, 'sfx'); },
        toss: t => tone(900, 1300, t, 0.08, 0.02, 'sine'),
        splash: (t, e) => hiss(t, e?.big ? 0.6 : 0.25, e?.big ? 0.16 : 0.05, e?.big ? 2200 : 3500, 300, 'lowpass', 'sfx', undefined, 0.01),
        sink: t => { tone(500, 140, t, 0.6, 0.06, 'sine'); for (let k = 0; k < 4; k++) tone(300 + k * 60, 600 + k * 80, t + 0.12 * k, 0.06, 0.03, 'sine'); },
        miss: t => { hold(t + 1.6); notes([72, 71, 70, 69], t + 0.1, 0.18, 0.3, 0.07, 0.25); tone(200, 60, t + 0.8, 0.7, 0.06, 'triangle'); },
        clear: t => { hold(t + 2.4); notes([72, 76, 79, 84, 0, 79, 84, 88], t, 0.12, 0.3, 0.07, 0.25); notes([60, 64, 67, 72], t, 0.24, 0.4, 0.06, 'triangle'); },
        life: t => notes([79, 83, 86, 91, 95], t, 0.06, 0.15, 0.06, 0.25),
        over: t => { hold(t + 3); notes([69, 0, 67, 0, 65, 64, 62], t, 0.22, 0.4, 0.07, 0.25); },
        wind: t => tone(120, 200, t, 0.25, 0.05, 'triangle'),
        swipe: t => { hiss(t, 0.16, 0.12, 900, 3000, 'bandpass', 'sfx', 1.5); tone(150, 70, t, 0.12, 0.06, 'square'); },
        crouch: t => tone(160, 110, t, 0.18, 0.04, 'triangle'),
        flex: t => notes([55, 59, 62], t, 0.12, 0.2, 0.04, 0.5),
        leap: t => tone(110, 330, t, 0.3, 0.06, 'triangle'),
        drop: t => tone(300, 90, t, 0.35, 0.05, 'triangle'),
        thud: t => { tone(90, 38, t, 0.18, 0.16, 'sine'); hiss(t, 0.1, 0.06, 600, 120); },
        heave: t => tone(240, 320, t, 0.2, 0.02, 0.5),
        throw: t => hiss(t, 0.15, 0.05, 900, 2600, 'bandpass', 'sfx', 2),
        squawk: t => { for (let k = 0; k < 3; k++) tone(1300 - k * 80, 900, t + k * 0.09, 0.07, 0.04, 0.25); },
        boing: t => { tone(180, 720, t, 0.3, 0.09, 'triangle'); tone(360, 1100, t + 0.04, 0.2, 0.03, 0.5); },
        swing: t => hiss(t, 0.5, 0.06, 500, 1600, 'bandpass', 'sfx', 3, 0.1),
        crate: t => { tone(700, 500, t, 0.05, 0.04, 0.5); tone(260, 180, t + 0.05, 0.1, 0.04, 'square'); },
        rehang: t => tone(500, 520, t, 0.05, 0.02, 0.5),
        climb: t => hiss(t, 0.5, 0.05, 900, 300, 'lowpass', 'sfx', undefined, 0.15),
        wake: t => notes([60, 64], t, 0.1, 0.12, 0.04, 0.5),
        land: t => hiss(t, 0.06, 0.04, 1300, 200),
        go: t => notes([79, 84], t, 0.08, 0.14, 0.05, 0.25),
        card: t => notes([72, 77, 81], t, 0.1, 0.25, 0.05, 'triangle'),
        tick: t => tone(620, 620, t, 0.03, 0.03, 0.5),
        select: t => tone(620, 930, t, 0.07, 0.05, 0.25),
      },
    }),
  });
}
