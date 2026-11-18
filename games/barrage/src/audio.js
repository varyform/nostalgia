// Procedural sound on the shared engine: four original tunes (a martial title theme, a
// relaxed shop shuffle and two tense battle loops) and every effect made from oscillators and
// noise. Blasts are sized by their radius. The context is only made by unlock(), from a gesture.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();  audio.music('battle');  audio.sfx('boom', { r: 40 });  audio.setOn(false);
import { createSynth, midi, seq, span } from '@nostalgia/audio';

const CH = { M: [0, 4, 7], m: [0, 3, 7], s4: [0, 5, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };

const TRACKS = {
  title: { // a march in D minor: i, VI, VII, V
    bpm: 104, chords: [[38, 'm'], [46, 'M'], [48, 'M'], [45, 'M']], bass: 'x.x.x.x.x.x.x.xx', drums: 'k.s.k.s.kks.k.sr', brass: true,
    lead: seq(`D5 - - . A4 . D5 . F5 - E5 . D5 . C5 . | Bb4 - - . F4 . Bb4 . D5 - C5 . Bb4 . A4 . |
               C5 - - . G4 . C5 . E5 - D5 . C5 . E5 . | A4 - - - . . E5 . C#5 - . . A4 . . .`),
  },
  shop: { // a shuffle in F for counting money
    bpm: 96, chords: [[41, 'M7'], [38, 'm7'], [43, 'm7'], [48, 'M']], bass: 'x...x.x.x...x.x.', drums: 'k.h.s.hhk.h.s.h.', pad: true,
    lead: seq(`F5 . A5 . C6 . A5 . G5 . F5 . D5 . . . | D5 . F5 . A5 . F5 . E5 . D5 . C5 . . . |
               Bb4 . D5 . G5 . F5 . E5 . D5 . Bb4 . . . | C5 . E5 . G5 . Bb5 . A5 - - . . . . .`),
  },
  battle: { // E minor, the guns are loaded
    bpm: 120, chords: [[40, 'm'], [36, 'M'], [38, 'M'], [35, 'M']], bass: 'x..x..x.x..x..x.', drums: 'k...h.k.s...h.hh', arp: true, soft: true,
    lead: seq(`E5 . . . . . G5 . F#5 . . . E5 . . . | . . . . C5 . . . E5 . D5 . . . . . |
               D5 . . . . . F#5 . A5 . . . G5 . F#5 . | D#5 - - - . . . . B4 . . . . . . .`),
  },
  battle2: { // A minor, a second field
    bpm: 112, chords: [[45, 'm'], [41, 'M'], [43, 'M'], [40, 'M']], bass: 'x.x...x.x.x...x.', drums: 'k..hs..hk.k.s..h', arp: true, soft: true,
    lead: seq(`A4 . C5 . E5 . . . D5 . C5 . B4 . . . | F4 . A4 . C5 . . . B4 . A4 . G#4 . . . |
               A4 . C5 . E5 . A5 . G5 . E5 . C5 . D5 . | E5 - - - . . . . E4 . . . . . . .`),
  },
};
const JINGLE = {
  win: { dt: 0.09, notes: [[62, 1], [66, 1], [69, 1], [74, 2], [0, 1], [69, 1], [74, 4]] },
  match: { dt: 0.11, notes: [[57, 1], [62, 1], [66, 1], [69, 2], [66, 1], [69, 1], [74, 2], [78, 1], [81, 5]] },
  draw: { dt: 0.14, notes: [[64, 2], [63, 2], [62, 2], [55, 5]] },
};

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 1991, tracks: TRACKS,
    levels: { master: 0.6, music: 0.24, sfx: 0.8 },
    echo: { time: 0.23, feedback: 0.25, wet: 0.2 },
    arrange: v => {
      const { tone, fm } = v;
      const hiss = (t, dur, vol, f0, f1, type, bus, q = 1) => v.hiss(t, dur, vol, f0, f1, type, bus, q);
      const last = {};
      // the same effect again within `gap` seconds is dropped (a dozen hits in one step)
      const once = (name, t, gap) => { if (t - (last[name] ?? -1) < gap) return false; last[name] = t; return true; };
      function brass(f, t, dur, vol) {
        tone(f, f, t, dur, vol, 'sawtooth', 'music', 0.03);
        tone(f, f, t, dur, vol * 0.8, 'triangle', 'music', 0.01);
      }
      function jingle(name, t) {
        const J = JINGLE[name];
        let at = t;
        for (const [n, len] of J.notes) {
          if (n) { tone(midi(n), midi(n), at, J.dt * len + 0.05, 0.07, 'triangle', 'sfx', 0.006); tone(midi(n - 12), midi(n - 12), at, J.dt * len, 0.03, 'sawtooth', 'sfx', 0.02); }
          at += J.dt * len;
        }
        v.hold(at + 0.2);
      }
      function boom(t, r, kind) {
        const k = Math.min(1, r / 130);
        if (kind === 'ion') {
          fm(220, t, 0.9 + k, 0.12, 3.01, 6, 'sfx');
          tone(1800, 120, t, 0.8 + k, 0.06, 'sawtooth');
          hiss(t, 0.6, 0.12, 6000, 400, 'bandpass', 'sfx', 2);
          return;
        }
        hiss(t, 0.35 + k * 1.6, 0.16 + k * 0.3, 2600 - k * 1600, 120, 'lowpass');
        tone(110 - k * 50, 28, t, 0.3 + k * 1.2, 0.3 + k * 0.25, 'sine');
        hiss(t, 0.06, 0.12, 9000, 2000, 'highpass');
        if (r >= 60) { tone(55, 22, t + 0.05, 2.4, 0.3, 'triangle'); hiss(t + 0.2, 2.6, 0.12, 500, 60, 'lowpass'); }
      }
      return {
        step(tr, i, t, dt) {
          const s = i % 16, [root, kind] = tr.chords[Math.floor(i / 16) % tr.chords.length], ch = CH[kind];
          const quiet = tr.soft ? 0.7 : 1;
          if (tr.bass[s] === 'x') tone(midi(root - 12), midi(root - 12), t, dt * 1.6, 0.17 * quiet, 'triangle', 'music', 0.005);
          if (tr.pad && s === 0) ch.forEach(c => tone(midi(root + 12 + c), midi(root + 12 + c), t, dt * 15, 0.022, 'sine', 'music', 0.3));
          if (tr.arp && s % 2 === 0) {
            const c = ch[(i / 2) % ch.length];
            tone(midi(root + 24 + c), midi(root + 24 + c), t, dt * 0.8, 0.022, 'square', 'music', 0.003);
          }
          const n = tr.lead[i % tr.lead.length];
          if (n > 0) {
            const dur = dt * (span(tr.lead, i) + 0.5);
            if (tr.brass) brass(midi(n), t, dur, 0.05);
            else { tone(midi(n), midi(n), t, dur, 0.08 * quiet, 'triangle', 'music', 0.01); tone(midi(n) * 2, midi(n) * 2, t, dur * 0.6, 0.012, 'sine', 'music', 0.02); }
          }
          const d = tr.drums[s];
          if (d === 'k') tone(130, 38, t, 0.12, 0.3 * quiet, 'sine', 'music');
          if (d === 's') hiss(t, 0.1, 0.1 * quiet, 4500, 1400, 'bandpass', 'music', 0.9);
          if (d === 'r') for (let k = 0; k < 4; k++) hiss(t + (k * dt) / 4, 0.05, 0.06, 4500, 1600, 'bandpass', 'music', 0.9);
          if (d === 'h') hiss(t, 0.025, 0.03 * quiet, 9000, 7000, 'highpass', 'music');
        },
        effects: {
          fire: (t, e) => {
            const k = e?.kind;
            if (k === 'beam') { tone(1400, 180, t, 0.5, 0.1, 'sawtooth'); fm(660, t, 0.5, 0.1, 1.5, 8, 'sfx'); return; }
            const big = e?.w === 'sunburst' || e?.w === 'daybreak';
            hiss(t, 0.22, 0.24, 3000, 300, 'lowpass');
            tone(big ? 120 : 190, 50, t, big ? 0.45 : 0.25, 0.32, 'sine');
            if (k === 'fire') hiss(t + 0.05, 0.5, 0.08, 800, 2400, 'bandpass', 'sfx', 2);
            if (big) tone(70, 30, t, 0.8, 0.2, 'triangle');
          },
          apex: (t, e) => { if (once('apex', t, 0.4)) tone(e?.big ? 1300 : 1700, 520, t, 1.1, 0.014, 'sine'); },
          boom: (t, e) => { if (once('boom' + ((e?.r ?? 0) > 50 ? 'b' : ''), t, 0.06)) boom(t, e?.r ?? 20, e?.kind); },
          dirt: (t, e) => { if (once('dirt', t, 0.15)) hiss(t + 0.08, Math.min(1.6, 0.3 + (e?.n ?? 0) / 4000), Math.min(0.12, 0.03 + (e?.n ?? 0) / 40000), 700, 150, 'lowpass'); },
          heap: (t, e) => { tone(90, 50, t, 0.3, 0.25, 'sine'); hiss(t, 0.5 + (e?.r ?? 30) / 80, 0.14, 900, 120, 'lowpass'); },
          burn: (t, e) => {
            const n = Math.min(6, 1 + ((e?.n ?? 1) / 10) | 0);
            for (let k = 0; k < n; k++) hiss(t + Math.random() * 0.14, 0.03 + Math.random() * 0.04, 0.05, 3000 + Math.random() * 3000, 800, 'bandpass', 'sfx', 3);
            hiss(t, 0.16, 0.025, 600, 300, 'lowpass');
          },
          spill: t => hiss(t, 0.7, 0.12, 400, 2200, 'bandpass', 'sfx', 1.5),
          shield: t => { if (once('shield', t, 0.08)) { tone(700, 1300, t, 0.25, 0.07, 'triangle'); tone(1400, 2100, t + 0.03, 0.2, 0.03, 'sine'); } },
          shieldUp: t => { tone(300, 1200, t, 0.45, 0.06, 'triangle'); hiss(t, 0.4, 0.04, 2000, 6000, 'bandpass', 'sfx', 4); },
          patch: t => [72, 76, 79].forEach((n, k) => tone(midi(n), midi(n), t + k * 0.07, 0.12, 0.05, 'triangle')),
          blink: t => { tone(200, 2400, t, 0.3, 0.06, 'sine'); tone(2400, 300, t + 0.3, 0.3, 0.05, 'sine'); },
          glider: t => { hiss(t, 0.4, 0.08, 1500, 400, 'bandpass', 'sfx', 1); tone(500, 700, t, 0.15, 0.04, 'triangle'); },
          land: (t, e) => { if ((e?.dist ?? 0) > 3 && once('land', t, 0.1)) { tone(100, 40, t, 0.18, 0.2 + Math.min(0.2, (e?.dist ?? 0) / 400), 'sine'); hiss(t, 0.2, 0.06, 600, 100, 'lowpass'); } },
          hit: (t, e) => { if (once('hit', t, 0.07)) { const k = Math.min(1, (e?.dmg ?? 10) / 60); tone(420, 180, t, 0.15, 0.06 + k * 0.06, 'square'); tone(1100, 900, t, 0.08, 0.03, 'triangle'); } },
          death: t => { boom(t, 70); tone(300, 40, t, 1.2, 0.12, 'sawtooth'); },
          cash: (t, e) => { if ((e?.amount ?? 0) > 0 && once('cash', t, 0.12)) { tone(1975, 1975, t, 0.07, 0.03, 'triangle'); tone(2637, 2637, t + 0.06, 0.1, 0.03, 'triangle'); } },
          turn: t => { tone(880, 880, t, 0.05, 0.035, 'triangle'); tone(1320, 1320, t + 0.06, 0.07, 0.03, 'triangle'); },
          bounce: t => { if (once('bounce', t, 0.08)) tone(300, 900, t, 0.08, 0.06, 'triangle'); },
          skip: t => tone(500, 260, t, 0.1, 0.05, 'triangle'),
          split: t => { for (let k = 0; k < 5; k++) tone(900 + k * 200, 600 + k * 150, t + k * 0.02, 0.08, 0.035, 'triangle'); },
          roll: t => hiss(t, 1.2, 0.07, 300, 120, 'lowpass'),
          drill: t => { for (let k = 0; k < 10; k++) tone(140 + (k % 2) * 40, 120, t + k * 0.06, 0.05, 0.05, 'sawtooth'); },
          beam: () => {},
          drive: t => { if (once('drive', t, 0.11)) { tone(70, 64, t, 0.1, 0.05, 'sawtooth'); hiss(t, 0.08, 0.02, 500, 300, 'lowpass'); } },
          refuel: t => tone(400, 600, t, 0.12, 0.04, 'triangle'),
          nofuel: t => { if (once('nofuel', t, 0.6)) tone(200, 150, t, 0.2, 0.06, 'square'); },
          blocked: t => { if (once('blocked', t, 0.3)) tone(120, 100, t, 0.08, 0.05, 'square'); },
          denied: t => { tone(220, 200, t, 0.12, 0.06, 'square'); tone(180, 160, t + 0.12, 0.16, 0.06, 'square'); },
          wrap: t => { if (once('wrap', t, 0.2)) tone(1200, 400, t, 0.12, 0.03, 'sine'); },
          lost: t => tone(600, 200, t, 0.3, 0.02, 'sine'),
          win: t => jingle('win', t + 0.3),
          draw: t => jingle('draw', t + 0.3),
          match: t => jingle('match', t + 0.2),
          move: t => tone(660, 660, t, 0.03, 0.03, 'triangle'),
          tick: t => { if (once('tick', t, 0.03)) tone(1200, 1200, t, 0.015, 0.015, 'square'); },
          select: t => { tone(660, 990, t, 0.08, 0.05, 'triangle'); },
          back: t => tone(660, 440, t, 0.08, 0.04, 'triangle'),
          buy: t => { tone(1318, 1318, t, 0.06, 0.05, 'triangle'); tone(1975, 1975, t + 0.05, 0.12, 0.05, 'triangle'); },
          sell: t => { tone(1318, 1318, t, 0.06, 0.04, 'triangle'); tone(988, 988, t + 0.05, 0.1, 0.04, 'triangle'); },
          round: t => [62, 69, 74].forEach((n, k) => tone(midi(n), midi(n), t + k * 0.12, 0.2, 0.05, 'sawtooth', 'sfx', 0.02)),
        },
      };
    },
  });
}
