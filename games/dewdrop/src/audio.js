// Procedural sound: a little chiptune band (two pulse voices, a triangle bass, a noise kit)
// and the effects, all made with Web Audio. The context is only created by unlock(), which the
// page calls from a user gesture; the demo never creates one.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();                 // from keydown / pointerdown / touchstart
//   audio.music('w0'); audio.sfx('berry', { left: 3 }); audio.setOn(false);
import { createSynth, line, midi, span } from '@nostalgia/audio';

// 4 bars of 16 steps each: chord roots (bass + arpeggio) and a lead line (0 = rest, -1 = hold)
const CH = { M: [0, 4, 7, 12], m: [0, 3, 7, 12], s: [0, 5, 7, 12] };
const TRACKS = {
  title: {
    bpm: 108, duty: 0.25, bars: [[48, 'M'], [45, 'm'], [41, 'M'], [43, 'M']], bass: 'x...x...x...x.x.', drums: 'k...h...s...h...',
    lead: line(`72 - 76 - 79 - 76 - 77 - 76 - 74 - 72 -  69 - 72 - 76 - 72 - 74 - 72 - 71 - 69 -
                65 - 69 - 72 - 69 - 74 - 72 - 69 - 65 -  67 - 71 - 74 - 79 - 77 - 74 - 71 - - -`),
  },
  w0: {
    bpm: 132, duty: 0.5, bars: [[41, 'M'], [48, 'M'], [50, 'm'], [46, 'M']], bass: 'x.x.x.x.x.x.x.xx', drums: 'k.h.s.h.k.khs.h.',
    lead: line(`77 - 77 81 - 79 77 - 72 - 74 - 77 - - -  76 - 76 79 - 77 76 - 72 - - - 72 74 76 -
                77 - 74 - 77 - 81 - 79 - 77 - 74 - 72 -  70 - 74 - 77 - 74 - 72 - 70 - 69 - - -`),
  },
  w1: {
    bpm: 118, duty: 0.125, bars: [[50, 'm'], [48, 'M'], [46, 'M'], [48, 's']], bass: 'x.....x...x.....', drums: 'k...h.h.s...h.hh',
    lead: line(`74 - - 76 77 - - - 76 - 74 - 72 - - -  72 - - 74 76 - - - 74 - 72 - 69 - - -
                70 - - 72 74 - 77 - 76 - 74 - 72 - - -  72 - - 74 76 - 79 - 77 - 76 - 74 - - -`),
  },
  w2: {
    bpm: 144, duty: 0.25, bars: [[45, 'm'], [41, 'M'], [43, 'M'], [40, 'M']], bass: 'x.xxx.xxx.xxx.xx', drums: 'k.hhs.hhk.khs.hs',
    lead: line(`69 - 72 - 76 - 72 - 77 - 76 - 72 - 69 -  65 - 69 - 72 - 69 - 74 - 72 - 69 - 65 -
                67 - 71 - 74 - 71 - 76 - 74 - 71 - 67 -  68 - 71 - 76 - 71 - 74 - 71 - 68 - 64 -`),
  },
  w3: {
    bpm: 100, duty: 0.25, bars: [[43, 'M'], [40, 'm'], [48, 'M'], [50, 'M']], bass: 'x.......x...x...', drums: 'k.......s.....h.',
    lead: line(`79 - - - 78 - 79 - 81 - - - 79 - - -  76 - - - 74 - 76 - 79 - - - 76 - - -
                72 - - - 76 - 79 - 84 - - - 83 - 81 -  81 - - - 79 - 78 - 74 - - - - - - -`),
  },
  hurry: {
    bpm: 168, duty: 0.25, bars: [[45, 'm'], [45, 'm'], [44, 'M'], [44, 'M']], bass: 'x.x.x.x.x.x.x.x.', drums: 'k.hhs.hhk.hhs.hh',
    lead: line(`81 - 80 - 81 - 76 - 81 - 80 - 81 - 76 -  81 - 83 - 84 - 83 - 81 - 80 - 76 - - -
                80 - 79 - 80 - 76 - 80 - 79 - 80 - 76 -  80 - 81 - 83 - 81 - 80 - 76 - 71 - - -`),
  },
  ending: {
    bpm: 92, duty: 0.125, bars: [[48, 'M'], [53, 'M'], [45, 'm'], [43, 'M']], bass: 'x...x...x...x...', drums: 'k.......s.......',
    lead: line(`79 - - - 76 - 79 - 84 - - - 83 - 81 -  81 - - - 77 - 81 - 84 - - - - - - -
                81 - - - 76 - 72 - 76 - - - 79 - 77 -  74 - - - 71 - 74 - 79 - - - - - - -`),
  },
};

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 11, levels: { master: 0.55, music: 0.34, sfx: 0.75 }, tracks: TRACKS,
    pulse: true, attack: 0.005, startDelay: 0.06,
    arrange: ({ tone, hiss, notes }) => ({
      step(tr, i, t, dt) {
        const bar = tr.bars[Math.floor(i / 16) % tr.bars.length], s = i % 16, [root, kind] = bar, ch = CH[kind];
        if (tr.bass[s] === 'x') tone(midi(root - 12), midi(root - 12), t, dt * 1.7, 0.16, 'triangle', 'music');
        // a soft arpeggio on the off-steps
        if (s % 2 === 1) { const f = midi(root + 12 + ch[((s - 1) / 2) % 4]); tone(f, f, t, dt * 0.9, 0.035, 0.5, 'music'); }
        const n = tr.lead[i % tr.lead.length];
        if (n > 0) tone(midi(n), midi(n), t, dt * span(tr.lead, i, 8) * 0.95, 0.075, tr.duty, 'music');
        const d = tr.drums[s];
        if (d === 'k') tone(140, 45, t, 0.1, 0.22, 'sine', 'music');
        if (d === 's') hiss(t, 0.08, 0.08, 6000, 1500, 'bandpass', 'music');
        if (d === 'h') hiss(t, 0.025, 0.035, 9000, 7000, 'highpass', 'music');
      },
      effects: {
        jump: (t, e) => tone(e?.small ? 380 : 300, e?.small ? 700 : 820, t, 0.1, 0.06, 0.25),
        boing: t => { tone(180, 900, t, 0.22, 0.09, 'sine'); tone(360, 1500, t, 0.18, 0.03, 0.125); },
        land: (t, e) => hiss(t, e?.hard ? 0.09 : 0.05, e?.hard ? 0.09 : 0.04, 1400, 200),
        grab: t => tone(900, 700, t, 0.05, 0.04, 0.5),
        vine: t => hiss(t, 0.05, 0.04, 3000, 1500, 'bandpass'),
        drop: t => tone(500, 260, t, 0.08, 0.04, 0.25),
        berry: (t, e) => { const b = 76 + Math.max(0, 8 - (e?.left ?? 0)); notes([b, b + 7], t, 0.06, 0.12, 0.07, 0.25); },
        fly: t => notes([84, 88, 91, 96], t, 0.045, 0.1, 0.05, 0.125),
        bloom: t => notes([72, 76, 79, 84, 88], t, 0.07, 0.3, 0.07, 0.25),
        home: t => notes([79, 84, 88, 91, 96], t, 0.08, 0.35, 0.08, 0.25),
        tremble: t => hiss(t, 0.15, 0.04, 2500, 900, 'bandpass'),
        crumble: t => { hiss(t, 0.3, 0.09, 1800, 200); tone(300, 120, t, 0.2, 0.03, 0.5); },
        regrow: t => tone(500, 900, t, 0.15, 0.02, 'triangle'),
        warn: t => { tone(160, 150, t, 0.12, 0.05, 0.5); tone(160, 150, t + 0.25, 0.12, 0.05, 0.5); },
        spawn: t => { hiss(t, 0.15, 0.06, 900, 300); tone(220, 440, t, 0.12, 0.04, 0.25); },
        hop: t => tone(200, 330, t, 0.08, 0.035, 0.5),
        thump: t => tone(120, 60, t, 0.08, 0.06, 'sine'),
        sink: t => tone(500, 90, t, 0.35, 0.05, 'sine'),
        die: t => { tone(880, 110, t, 0.6, 0.08, 0.25); hiss(t + 0.1, 0.4, 0.12, 2500, 300); },
        respawn: t => notes([67, 71, 74], t, 0.07, 0.15, 0.05, 0.125),
        hurry: t => notes([88, 0, 88, 0, 88], t, 0.07, 0.06, 0.06, 0.5),
        life: t => notes([79, 83, 86, 91], t, 0.07, 0.16, 0.07, 0.25),
        gameover: t => notes([72, 67, 64, 60], t, 0.28, 0.4, 0.08, 0.25),
        select: t => tone(660, 990, t, 0.07, 0.05, 0.25),
        move: t => tone(520, 520, t, 0.03, 0.03, 0.5),
        deny: t => tone(180, 140, t, 0.12, 0.05, 0.5),
        tick: t => tone(1200, 1200, t, 0.02, 0.025, 0.125),
        paint: t => tone(700, 760, t, 0.03, 0.025, 0.5),
      },
    }),
  });
}
