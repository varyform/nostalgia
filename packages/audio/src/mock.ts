// A recording stand-in for Web Audio, for tests: every node made, every connection, property
// set and AudioParam call goes into `log` as one line, with the clock under the test's
// control. install() also swaps in a fake setInterval driven by tick() and a seeded
// Math.random, so a run of the synth is a deterministic list of strings.
//
//   const rec = createRecorder();
//   const restore = rec.install();
//   audio.unlock(); rec.tick(25);           // one second of 40 ms scheduler ticks
//   expect(rec.log).toContain('#7.start(0.08)');
//   restore();

type Arg = unknown;

export interface Recorder {
  log: string[];
  /** The context clock, seconds. */
  time: number;
  /** Make the next `new AudioContext()` throw. */
  failNext: boolean;
  readonly timers: Map<number, () => void>;
  /** Replace AudioContext, setInterval / clearInterval and Math.random; returns the undo. */
  install(): () => void;
  /** Suspend the newest context, as a browser does before a user gesture. */
  suspend(state?: 'suspended' | 'interrupted'): void;
  /** Advance the clock by ms and run every live interval, n times. */
  tick(n?: number, ms?: number): void;
  /** Checksums of every buffer made so far, freshly computed. */
  buffers(): string[];
  /** A source ends, as the browser says once it has stopped: its onended runs. `id` is '#n'. */
  end(id: string): void;
}

export function createRecorder({ sampleRate = 44100, seed = 1 } = {}): Recorder {
  const log: string[] = [];
  const nodes = new Map<string, unknown>();
  const timers = new Map<number, () => void>();
  const buffers: MockBuffer[] = [];
  const contexts: MockContext[] = [];
  let nextId = 0,
    nextTimer = 0,
    rnd = seed;
  const fmt = (v: Arg): string => {
    if (v instanceof MockNode || v instanceof MockBuffer || v instanceof MockWave) return '#' + v.id;
    if (v instanceof MockParam) return `#${v.owner}.${v.name}`;
    if (v instanceof Float32Array || Array.isArray(v)) return '[' + Array.from(v as ArrayLike<number>).join(',') + ']';
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
  };
  const call = (who: string, fn: string, args: Arg[]) => log.push(`${who}.${fn}(${args.map(fmt).join(',')})`);

  class MockParam {
    readonly owner: number;
    readonly name: string;
    #value: number;
    constructor(owner: number, name: string, value: number) {
      this.owner = owner;
      this.name = name;
      this.#value = value;
    }
    get value() {
      return this.#value;
    }
    set value(v: number) {
      this.#value = v;
      log.push(`#${this.owner}.${this.name}=${fmt(v)}`);
    }
    #rec(fn: string, args: Arg[]) {
      call(`#${this.owner}.${this.name}`, fn, args);
      return this;
    }
    setValueAtTime(v: number, t: number) {
      return this.#rec('setValueAtTime', [v, t]);
    }
    linearRampToValueAtTime(v: number, t: number) {
      return this.#rec('linearRampToValueAtTime', [v, t]);
    }
    exponentialRampToValueAtTime(v: number, t: number) {
      return this.#rec('exponentialRampToValueAtTime', [v, t]);
    }
    setTargetAtTime(v: number, t: number, c: number) {
      return this.#rec('setTargetAtTime', [v, t, c]);
    }
    cancelScheduledValues(t: number) {
      return this.#rec('cancelScheduledValues', [t]);
    }
  }

  class MockNode {
    readonly id = ++nextId;
    readonly context: MockContext;
    constructor(context: MockContext) {
      this.context = context;
    }
    protected param(name: string, value: number) {
      return new MockParam(this.id, name, value);
    }
    protected prop(name: string, v: Arg) {
      log.push(`#${this.id}.${name}=${fmt(v)}`);
    }
    connect<T>(dest: T, ...rest: Arg[]): T | undefined {
      call('#' + this.id, 'connect', [dest, ...rest]);
      return dest instanceof MockNode ? dest : undefined;
    }
    disconnect(...args: Arg[]) {
      call('#' + this.id, 'disconnect', args);
    }
  }
  class MockSource extends MockNode {
    onended: (() => void) | null = null;
    start(...args: Arg[]) {
      call('#' + this.id, 'start', args);
    }
    stop(...args: Arg[]) {
      call('#' + this.id, 'stop', args);
    }
  }
  class MockGain extends MockNode {
    readonly gain = this.param('gain', 1);
  }
  class MockOscillator extends MockSource {
    readonly frequency = this.param('frequency', 440);
    readonly detune = this.param('detune', 0);
    #type = 'sine';
    get type() {
      return this.#type;
    }
    set type(v: string) {
      this.#type = v;
      this.prop('type', v);
    }
    setPeriodicWave(w: Arg) {
      call('#' + this.id, 'setPeriodicWave', [w]);
    }
  }
  class MockBufferSource extends MockSource {
    readonly playbackRate = this.param('playbackRate', 1);
    #buffer: MockBuffer | null = null;
    #loop = false;
    get buffer() {
      return this.#buffer;
    }
    set buffer(b: MockBuffer | null) {
      this.#buffer = b;
      log.push(`#${this.id}.buffer=${fmt(b)}${b ? ':' + b.sum() : ''}`);
    }
    get loop() {
      return this.#loop;
    }
    set loop(v: boolean) {
      this.#loop = v;
      this.prop('loop', v);
    }
  }
  class MockBiquad extends MockNode {
    readonly frequency = this.param('frequency', 350);
    readonly Q = this.param('Q', 1);
    readonly gain = this.param('gain', 0);
    readonly detune = this.param('detune', 0);
    #type = 'lowpass';
    get type() {
      return this.#type;
    }
    set type(v: string) {
      this.#type = v;
      this.prop('type', v);
    }
  }
  class MockPanner extends MockNode {
    readonly pan = this.param('pan', 0);
  }
  class MockConstant extends MockSource {
    readonly offset = this.param('offset', 1);
  }
  class MockShaper extends MockNode {
    #curve: Float32Array | null = null;
    #oversample = 'none';
    get curve() {
      return this.#curve;
    }
    set curve(c: Float32Array | null) {
      this.#curve = c;
      log.push(`#${this.id}.curve=${c ? `[${c.length}]` : 'null'}`);
    }
    get oversample() {
      return this.#oversample;
    }
    set oversample(v: string) {
      this.#oversample = v;
      this.prop('oversample', v);
    }
  }
  class MockDelay extends MockNode {
    readonly delayTime = this.param('delayTime', 0);
  }
  class MockCompressor extends MockNode {
    readonly threshold = this.param('threshold', -24);
    readonly knee = this.param('knee', 30);
    readonly ratio = this.param('ratio', 12);
    readonly attack = this.param('attack', 0.003);
    readonly release = this.param('release', 0.25);
  }
  class MockBuffer {
    readonly id = ++nextId;
    readonly numberOfChannels: number;
    readonly length: number;
    readonly sampleRate: number;
    readonly #data: Float32Array[];
    #sum: string | null = null;
    constructor(numberOfChannels: number, length: number, sampleRate: number) {
      this.numberOfChannels = numberOfChannels;
      this.length = length;
      this.sampleRate = sampleRate;
      this.#data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      buffers.push(this);
    }
    getChannelData(c: number) {
      this.#sum = null;
      return this.#data[c];
    }
    /** A position-weighted checksum of every sample. */
    sum(fresh = false) {
      if (fresh || this.#sum === null) {
        let s = 0;
        for (const d of this.#data) for (let k = 0; k < d.length; k++) s += d[k] * ((k % 977) + 1);
        this.#sum = s.toFixed(6);
      }
      return this.#sum;
    }
  }
  class MockWave {
    readonly id = ++nextId;
  }
  class MockContext {
    readonly sampleRate = sampleRate;
    readonly destination: MockNode;
    readonly id: number;
    state: 'running' | 'suspended' | 'interrupted' | 'closed' = 'running';
    constructor() {
      if (rec.failNext) {
        rec.failNext = false;
        log.push('new AudioContext() threw');
        throw new Error('no audio');
      }
      this.id = ++nextId;
      log.push(`#${this.id}=new AudioContext()`);
      this.destination = new MockNode(this);
      contexts.push(this);
    }
    get currentTime() {
      return rec.time;
    }
    resume() {
      call('#' + this.id, 'resume', []);
      this.state = 'running';
      return Promise.resolve();
    }
    close() {
      call('#' + this.id, 'close', []);
      this.state = 'closed';
      return Promise.resolve();
    }
    #make<T extends { id: number }>(what: string, node: T, args: Arg[] = []) {
      log.push(`#${node.id}=${what}(${args.map(fmt).join(',')})`);
      nodes.set(`#${node.id}`, node);
      return node;
    }
    createGain() {
      return this.#make('createGain', new MockGain(this));
    }
    createOscillator() {
      return this.#make('createOscillator', new MockOscillator(this));
    }
    createBufferSource() {
      return this.#make('createBufferSource', new MockBufferSource(this));
    }
    createBiquadFilter() {
      return this.#make('createBiquadFilter', new MockBiquad(this));
    }
    createDelay(max = 1) {
      return this.#make('createDelay', new MockDelay(this), [max]);
    }
    createStereoPanner() {
      return this.#make('createStereoPanner', new MockPanner(this));
    }
    createConstantSource() {
      return this.#make('createConstantSource', new MockConstant(this));
    }
    createWaveShaper() {
      return this.#make('createWaveShaper', new MockShaper(this));
    }
    createIIRFilter(feedforward: number[], feedback: number[]) {
      return this.#make('createIIRFilter', new MockNode(this), [
        feedforward.map(fmt).join(' '),
        feedback.map(fmt).join(' '),
      ]);
    }
    createDynamicsCompressor() {
      return this.#make('createDynamicsCompressor', new MockCompressor(this));
    }
    createBuffer(ch: number, len: number, sr: number) {
      return this.#make('createBuffer', new MockBuffer(ch, len, sr), [ch, len, sr]);
    }
    createPeriodicWave(re: Float32Array, im: Float32Array) {
      return this.#make('createPeriodicWave', new MockWave(), [re, im]);
    }
  }

  const rec: Recorder = {
    log,
    time: 0,
    failNext: false,
    timers,
    install() {
      const g = globalThis as Record<string, unknown>;
      const saved = { AudioContext: g.AudioContext, setInterval: g.setInterval, clearInterval: g.clearInterval };
      const random = Math.random;
      g.AudioContext = MockContext;
      g.setInterval = (fn: () => void, ms: number) => {
        const id = ++nextTimer;
        timers.set(id, fn);
        log.push(`setInterval(${id},${ms})`);
        return id;
      };
      g.clearInterval = (id: number) => {
        timers.delete(id);
        log.push(`clearInterval(${fmt(id)})`);
      };
      Math.random = () => {
        rnd = (rnd * 16807) % 2147483647;
        return rnd / 2147483647;
      };
      return () => {
        Object.assign(g, saved);
        Math.random = random;
      };
    },
    /** The browser stops the context: 'suspended', or iOS's 'interrupted'. */
    suspend(state: 'suspended' | 'interrupted' = 'suspended') {
      contexts[contexts.length - 1].state = state;
    },
    tick(n = 1, ms = 40) {
      for (let k = 0; k < n; k++) {
        rec.time += ms / 1000;
        for (const fn of Array.from(timers.values())) fn();
      }
    },
    buffers: () => buffers.map(b => `#${b.id}:${b.sum(true)}`),
    end(id) {
      (nodes.get(id) as MockSource | undefined)?.onended?.();
    },
  };
  return rec;
}
