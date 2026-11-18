// The one way test harnesses start a browser: chrome-headless-shell, headless and muted,
// driven over the DevTools protocol, and never outliving the script that started it.
//
//   import { launch } from '../../scripts/headless.js';   // (an absolute path from the scratchpad)
//   const browser = await launch({ width: 1400, height: 900 });
//   const page = await browser.page('file:///…/dist/keepsake.html?demo=on&sound=off');
//   console.log(await page.eval('document.title'));
//   await browser.close();
//
//   node scripts/headless.js --reap      closes browsers whose script is gone (mise run reap)
//
// A browser is closed when the script calls close(), exits, throws, is interrupted, or is
// killed outright (a watchdog process waits on the script's pid), and after `maxLife`
// seconds in any case, so a hung harness can't leave one running.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const SHELL = `${homedir()}/.local/share/chrome-headless-shell/chrome-headless-shell`;
const PROFILE = 'nostalgia-headless-';

/** Start a browser. Options: width, height, dpr (2), args (extra flags), maxLife (s, 900). */
export async function launch({ width = 1400, height = 900, dpr = 2, args = [], maxLife = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), PROFILE));
  const chrome = spawn(
    process.env.BROWSER_PATH || SHELL,
    [
      '--headless',
      '--mute-audio',
      `--force-device-scale-factor=${dpr}`,
      `--window-size=${width},${height}`,
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      ...args,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  // Kills the browser when this script dies by any means, or when it has run for maxLife.
  const watchdog = spawn(
    'sh',
    [
      '-c',
      `n=0; while kill -0 ${process.pid} 2>/dev/null && [ $n -lt ${maxLife} ]; do sleep 1; n=$((n+1)); done; kill ${chrome.pid} 2>/dev/null; sleep 2; kill -9 ${chrome.pid} 2>/dev/null; rm -rf '${profile}'`,
    ],
    { stdio: 'ignore', detached: true },
  );
  watchdog.unref();

  let ws;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      ws?.close();
    } catch {
      /* already gone */
    }
    chrome.kill('SIGTERM');
    await new Promise(r => (chrome.exitCode === null ? chrome.once('exit', r) : r()));
    watchdog.kill();
    rmSync(profile, { recursive: true, force: true });
  };
  const onExit = () => {
    if (!closed) chrome.kill('SIGKILL');
  };
  process.once('exit', onExit);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.once(sig, () => {
      onExit();
      process.exit(130);
    });
  for (const ev of ['uncaughtException', 'unhandledRejection'])
    process.once(ev, err => {
      onExit();
      console.error(err);
      process.exit(1);
    });

  // The browser prints its DevTools address on stderr.
  const url = await new Promise((ok, fail) => {
    let err = '';
    const timer = setTimeout(() => fail(new Error(`no DevTools address from the browser:\n${err}`)), 15000);
    chrome.stderr.on('data', d => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        ok(m[1]);
      }
    });
    chrome.once('exit', code => fail(new Error(`browser exited (${code}):\n${err}`)));
  });

  ws = new WebSocket(url);
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', fail, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { ok, fail } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) fail(new Error(`${m.error.message} (${m.error.code})`));
      else ok(m.result);
    } else for (const fn of listeners) fn(m);
  });
  /** One DevTools command, at the browser or at a session (a page, an iframe). */
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const i = ++id;
      pending.set(i, { ok, fail });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId && { sessionId }) }));
    });

  /** Open a tab (optionally at url) and attach to it. */
  async function page(at = 'about:blank', { mobile = false } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const errors = [];
    listeners.add(m => {
      if (m.sessionId === sessionId && m.method === 'Runtime.exceptionThrown')
        errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    });
    await s('Runtime.enable');
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
    const p = {
      sessionId,
      errors,
      send: s,
      /** Evaluate an expression in the page (awaiting promises) and return its value. */
      async eval(expression) {
        const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      async goto(to) {
        await s('Page.navigate', { url: to });
      },
    };
    if (at !== 'about:blank') await p.goto(at);
    return p;
  }

  return { url, send, page, close, on: fn => listeners.add(fn), off: fn => listeners.delete(fn) };
}

/** Close every headless browser whose script is gone: its parent is init (pid 1). */
export function reap() {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n');
  const orphans = rows
    .map(r => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(r))
    .filter(m => m && m[2] === '1' && m[3].includes('chrome-headless-shell') && !m[3].includes('--type='));
  for (const [, pid] of orphans) process.kill(Number(pid), 'SIGTERM');
  return orphans.map(m => Number(m[1]));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--reap')) {
  const pids = reap();
  console.log(pids.length ? `closed ${pids.length} orphaned browser(s): ${pids.join(' ')}` : 'no orphaned browsers');
}
