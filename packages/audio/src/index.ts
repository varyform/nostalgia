/**
 * @nostalgia/audio — the sound engine every game's audio.js is built on.
 *
 * Procedural sound with Web Audio: oscillators and seeded noise, no samples. The game
 * brings the score (tracks, how one 16th step is played, its effects); the engine brings
 * the context, the buses, the voices and the sequencer.
 *
 *   import { createSynth, line, midi, span } from '@nostalgia/audio';
 *
 *   const TRACKS = { title: { bpm: 108, lead: line('72 - 76 . 79 - - .') } };
 *
 *   export function createAudio({ on = true } = {}) {
 *     return createSynth({
 *       on, seed: 11, levels: { master: 0.55, music: 0.34, sfx: 0.75 }, tracks: TRACKS,
 *       arrange: v => ({
 *         step(tr, i, t, dt) {                                // one 16th of a track, at context time t
 *           const n = tr.lead[i % tr.lead.length];
 *           if (n > 0) v.tone(midi(n), midi(n), t, dt * span(tr.lead, i), 0.07, 'triangle', 'music');
 *           if (i % 4 === 0) v.hiss(t, 0.03, 0.04, 9000, 7000, 'highpass', 'music');
 *         },
 *         effects: {                                          // sfx(name, e) → effects[name](now, e)
 *           jump: t => v.tone(300, 620, t, 0.09, 0.06),
 *           coin: (t, e) => v.notes([84, 91 + (e?.combo ?? 0)], t, 0.06, 0.1, 0.06),
 *         },
 *         methods: { drone(on) { … } },                       // optional: merged into the API, built
 *                                                             // on v.ac / v.noise / v.bus.sfx
 *       }),
 *     });
 *   }
 *
 *   const audio = createAudio({ on: true });
 *   audio.unlock();                 // from keydown / pointerdown / touchstart: makes the context
 *   audio.music('title');           // null stops; the same name again keeps playing
 *   audio.sfx('jump');              // nothing before unlock(), or while muted
 *   audio.setOn(!audio.on);
 *   audio.destroy();
 *
 * Voices (all times are context seconds; bus is 'music' or 'sfx', default 'sfx' except fm):
 *   tone(f0, f1, t, dur, vol, type = 'square', bus, attack)   one oscillator, f0 → f1
 *   hiss(t, dur, vol, f0 = 3000, f1 = 300, filter = 'lowpass', bus, q, attack = 0.004)   filtered noise
 *   fm(f, t, dur, vol, ratio = 2, index = 2, bus = 'music')   two-operator FM
 *
 * The richer voices (instruments.ts), each one note with an ADSR (attack, decay, sustain,
 * release: held until t + dur, then released) and a bus (default 'music'):
 *   sub(f, t, dur, vol, { punch, drop, drive, tone })          a sine punched down onto f, clipped
 *   supersaw(f, t, dur, vol, { detune, mix, width, cutoff, reso, envmod })   seven saws in stereo
 *   pulse(f, t, dur, vol, { width, pwm, rate, detune, cutoff, reso, envmod })   PWM pulses
 *   fm(f, t, dur, vol, { ratio, fine, index, modDecay, modSustain })   FM with an index envelope
 *   notes(midiList, t, gap, dur, vol, type, bus)               a run of tones, 0 = rest
 *   hold(until)                                                music waits until then (a jingle)
 *   env(gain, t, attack, peak, dur), ac, noise, bus.{master,music,sfx}   for custom graphs
 *
 * An attack of 0 starts a voice at its peak and only decays: a pluck, a blip.
 *
 * Options: `pulse` makes numeric tone types pulse duty cycles (0.125, 0.25, 0.5);
 * `speaker` turns the whole synth into a PC speaker (square on/off, clicks for noise, a
 * small cone); `echo` adds a slap-back delay on the music bus (or `bus: 'sfx'`, with `cut`
 * darkening the repeats); `compressor` puts one before the speakers; `attack`, `floor`
 * (the envelopes' silence), `tail` (how long a voice runs on after its envelope), `lead`
 * (how far after the clock sfx() plays), `noiseLength` and `startDelay` tune the defaults.
 * Without `tracks` the synth plays effects only. Score helpers: midi(n), line('72 - .'),
 * seq('C5 - . | G#4'), span(lead, i, max) — the steps a note lasts with its '-' holds.
 */
export {
  createSynth,
  type Arrangement,
  type Bus,
  type Effect,
  type Levels,
  type Synth,
  type SynthOptions,
  type Voices,
  type Wave,
} from './synth.ts';
export {
  adsr,
  type Adsr,
  type FmOptions,
  type PulseOptions,
  type SubOptions,
  type SupersawOptions,
  type VoiceOptions,
} from './instruments.ts';
export { line, midi, seq, span } from './notes.ts';
