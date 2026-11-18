// Procedural sound: a small undersea band (a soft pulse lead, a triangle bass, FM bells on the
// arpeggio, a hushed noise kit) and the effects, all made with Web Audio by @nostalgia/audio.
// The context is only created by unlock(), which the page calls from a user gesture; the demo
// never creates one.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();                 // from keydown / pointerdown / touchstart
//   audio.music('w0'); audio.sfx('shard', { left: 3 }); audio.setOn(false);
import { createSynth, line, midi, span } from '@nostalgia/audio';

const CH = { M: [0, 4, 7, 12], m: [0, 3, 7, 12] };
// four bars of 16 steps: chord roots (bass and bells), a lead line, a bass and a drum pattern
const TRACKS = {
  title: {
    bpm: 92, duty: 0.25, bars: [[50, 'm'], [48, 'M'], [46, 'M'], [45, 'M']], bass: 'x.......x...x...', drums: 'k.......s.......', bell: 0.05,
    lead: line(`74 - - - 77 - 81 - - - 79 - 77 - 76 -  74 - - - - - 72 - 76 - 79 - - - 77 -
                70 - - - 74 - 77 - 81 - 79 - 77 - 74 -  73 - - - 76 - 79 - 77 - 76 - 74 - - -`),
  },
  w0: {
    bpm: 124, duty: 0.5, bars: [[43, 'M'], [40, 'm'], [48, 'M'], [50, 'M']], bass: 'x...x.x.x...x.x.', drums: 'k.h.s.h.k.h.s.hh', bell: 0.03,
    lead: line(`79 - 83 - 86 - 83 - 81 - 79 - 76 - 79 -  76 - - 79 - 76 74 - 71 - 74 - 76 - - -
                72 - 76 - 79 - 84 - 83 - 81 - 79 - 76 -  78 - 81 - 78 - 74 - 76 - 78 - 79 - - -`),
  },
  w1: {
    bpm: 112, duty: 0.25, bars: [[45, 'm'], [41, 'M'], [43, 'M'], [40, 'M']], bass: 'x..x..x.x..x..x.', drums: 'k..h..s.k.hh..s.', bell: 0.035,
    lead: line(`69 - 72 - 76 - 77 - 76 - 72 - 69 - - -  65 - 69 - 72 - 74 - 72 - 69 - 65 - - -
                67 - 71 - 74 - 76 - 74 - 71 - 67 - 71 -  68 - - - 71 - 74 - 76 - 74 - 71 - 68 -`),
  },
  w2: {
    bpm: 100, duty: 0.125, bars: [[48, 'm'], [44, 'M'], [49, 'M'], [43, 'M']], bass: 'x.....x...x.....', drums: 'k.....h.s.....h.', bell: 0.04,
    lead: line(`72 - - 75 - - 79 - 80 - 79 - 75 - - -  72 - - 75 - - 80 - 84 - 80 - 77 - - -
                73 - - 77 - - 80 - 85 - 84 - 80 - - -  74 - 71 - 74 - 77 - 79 - - - 74 - - -`),
  },
  w3: {
    bpm: 138, duty: 0.25, bars: [[50, 'm'], [46, 'M'], [48, 'M'], [45, 'M']], bass: 'x.xxx.x.x.xxx.x.', drums: 'k.hhs.hhk.khs.hh', bell: 0.03,
    lead: line(`74 - 74 77 - 74 81 - 79 - 77 - 76 - 74 -  70 - 70 74 - 70 77 - 76 - 74 - 72 - - -
                72 - 72 76 - 72 79 - 77 - 76 - 74 - 72 -  73 - 76 - 79 - 81 - 79 - 76 - 73 - - -`),
  },
  ending: {
    bpm: 88, duty: 0.125, bars: [[48, 'M'], [53, 'M'], [45, 'm'], [43, 'M']], bass: 'x...x...x...x...', drums: 'k.......s.......', bell: 0.05,
    lead: line(`79 - - - 76 - 72 - 76 - 79 - 84 - - -  81 - - - 77 - 72 - 77 - 81 - 84 - - -
                81 - - - 76 - 72 - 69 - 72 - 76 - 74 -  74 - - - 79 - 83 - 86 - 84 - 83 - - -`),
  },
};

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 23, levels: { master: 0.55, music: 0.3, sfx: 0.8 }, tracks: TRACKS,
    pulse: true, attack: 0.006, startDelay: 0.06, echo: { time: 0.27, feedback: 0.3, wet: 0.22, cut: 2400 },
    arrange: ({ tone, hiss, notes, fm }) => ({
      step(tr, i, t, dt) {
        const [root, kind] = tr.bars[Math.floor(i / 16) % tr.bars.length], s = i % 16, ch = CH[kind];
        if (tr.bass[s] === 'x') tone(midi(root - 12), midi(root - 12), t, dt * 1.8, 0.15, 'triangle', 'music');
        // glassy bells on the off-steps
        if (s % 2 === 1) fm(midi(root + 24 + ch[((s - 1) / 2) % 4]), t, dt * 2.5, tr.bell, 3.5, 1.4);
        const n = tr.lead[i % tr.lead.length];
        if (n > 0) tone(midi(n), midi(n), t, dt * span(tr.lead, i, 8) * 0.95, 0.07, tr.duty, 'music');
        const d = tr.drums[s];
        if (d === 'k') tone(120, 42, t, 0.12, 0.2, 'sine', 'music');
        if (d === 's') hiss(t, 0.1, 0.06, 4200, 900, 'bandpass', 'music');
        if (d === 'h') hiss(t, 0.03, 0.03, 9000, 7000, 'highpass', 'music');
      },
      effects: {
        dig: t => { hiss(t, 0.2, 0.11, 2600, 380); tone(240, 80, t, 0.16, 0.05, 0.25); },
        fizzle: t => tone(320, 180, t, 0.12, 0.04, 0.5),
        regrow: t => hiss(t, 0.5, 0.025, 600, 2400, 'bandpass', 'sfx', 2, 0.3),
        sealed: t => { tone(130, 55, t, 0.14, 0.09, 'sine'); hiss(t, 0.08, 0.05, 1200, 200); },
        shard: (t, e) => { const b = 84 + Math.max(0, 6 - (e?.left ?? 0)); notes([b, b + 7, b + 12], t, 0.05, 0.22, 0.06, 'triangle'); },
        reveal: t => { notes([72, 76, 79, 84, 88, 91, 96], t, 0.07, 0.4, 0.06, 'triangle'); fm(midi(96), t + 0.5, 1.2, 0.06, 3.5, 2, 'sfx'); },
        trap: t => { tone(300, 140, t, 0.1, 0.07, 0.5); hiss(t + 0.02, 0.12, 0.05, 1800, 300); },
        free: t => tone(110, 170, t, 0.22, 0.05, 0.25),
        crush: t => { hiss(t, 0.45, 0.13, 1500, 120); tone(180, 40, t, 0.4, 0.08, 'sine'); },
        respawn: t => { tone(180, 720, t, 0.35, 0.035, 'triangle'); hiss(t, 0.3, 0.03, 600, 3000, 'bandpass'); },
        lift: t => notes([79, 74], t, 0.06, 0.1, 0.04, 0.25),
        drop: t => notes([74, 81], t, 0.06, 0.1, 0.04, 0.25),
        land: (t, e) => hiss(t, (e?.n ?? 0) > 24 ? 0.08 : 0.04, (e?.n ?? 0) > 24 ? 0.07 : 0.03, 1300, 200),
        die: t => { tone(700, 90, t, 0.7, 0.08, 0.25); hiss(t + 0.1, 0.5, 0.1, 2200, 260); },
        clear: t => notes([72, 76, 79, 84, 79, 84, 88], t, 0.08, 0.3, 0.07, 0.25),
        life: t => notes([79, 83, 86, 91], t, 0.07, 0.16, 0.06, 0.25),
        gameover: t => notes([69, 65, 62, 57], t, 0.3, 0.45, 0.08, 0.25),
        select: t => tone(620, 930, t, 0.07, 0.05, 0.25),
        move: t => tone(500, 500, t, 0.03, 0.03, 0.5),
        deny: t => tone(170, 130, t, 0.12, 0.05, 0.5),
        paint: t => tone(680, 740, t, 0.03, 0.025, 0.5),
      },
    }),
  });
}
