// Build every page (or the ones named) into dist/ as its own Vite run, in parallel:
// single-file output needs one entry per build.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverPages } from '@nostalgia/game/node';

const PAGES = discoverPages(fileURLToPath(new URL('..', import.meta.url)));

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PAGES);
const unknown = names.filter(n => !PAGES[n]);
if (unknown.length) {
  console.error(`Unknown page(s): ${unknown.join(', ')}. Known: ${Object.keys(PAGES).join(', ')}`);
  process.exit(1);
}

const run = name =>
  new Promise((ok, fail) => {
    const p = spawn('vp', ['build', '--logLevel', 'warn'], { env: { ...process.env, PAGE: name }, stdio: 'inherit' });
    p.on('exit', code =>
      code === 0 ? ok(console.log(`✓ ${name} → ${PAGES[name].out}`)) : fail(new Error(`${name} failed (${code})`)),
    );
  });
// the launcher goes last: it counts the games' compiled sizes for its disk-free line
await Promise.all(names.filter(n => n !== 'index').map(run));
if (names.includes('index')) await run('index');
