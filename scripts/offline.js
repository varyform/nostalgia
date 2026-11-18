// An offline copy of dist/ for the iOS app: every page as is, but with its Google Fonts
// inlined (the Latin subsets, as data: URLs), so nothing is fetched from the internet.
// The website keeps its <link>s; only the copy changes.
//
//   node scripts/offline.js <out dir> [cache dir]
//
// Downloads are kept in the cache dir (default <out>/../fonts), so later builds work
// without a connection too.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const [outArg, cacheArg] = process.argv.slice(2);
if (!outArg) {
  console.error('usage: node scripts/offline.js <out dir> [cache dir]');
  process.exit(1);
}
const out = resolve(outArg);
const cache = resolve(cacheArg ?? join(out, '../fonts'));
mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });

// Google serves woff2 to a current browser, and lists one @font-face per subset.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const KEEP = new Set(['latin', 'latin-ext']);

function cached(url, kind) {
  const file = join(cache, createHash('sha1').update(url).digest('hex') + '.' + kind);
  if (existsSync(file)) return readFileSync(file);
  // curl, not fetch: it gets through where Node's own networking is held back
  const body = execFileSync('curl', ['-sSfL', '--max-time', '30', '-A', UA, url], { maxBuffer: 1 << 26 });
  writeFileSync(file, body);
  return body;
}

// A variable font comes back as one @font-face per asked-for weight, all on the same file:
// those become one face with a weight range, so each file is inlined once.
function inline(cssUrl) {
  const css = cached(cssUrl, 'css').toString();
  const faces = new Map();
  for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (!KEEP.has(m[1])) continue;
    const prop = name => new RegExp(`${name}:\\s*([^;]+);`).exec(m[2])?.[1].trim();
    const url = /url\((https:\/\/[^)]+)\)/.exec(m[2])?.[1];
    if (!url) continue;
    const [family, style, range, weight] = [
      prop('font-family'),
      prop('font-style'),
      prop('unicode-range'),
      Number(prop('font-weight')),
    ];
    const key = [family, style, url, range].join('|');
    const face = faces.get(key) ?? { family, style, url, range, weights: [] };
    face.weights.push(weight);
    faces.set(key, face);
  }
  if (!faces.size) throw new Error(`no Latin faces in ${cssUrl}`);
  const css2 = [...faces.values()].map(f => {
    const lo = Math.min(...f.weights),
      hi = Math.max(...f.weights);
    const font = cached(f.url, 'woff2').toString('base64');
    return `@font-face{font-family:${f.family};font-style:${f.style};font-weight:${lo === hi ? lo : `${lo} ${hi}`};font-display:swap;src:url(data:font/woff2;base64,${font}) format('woff2');unicode-range:${f.range}}`;
  });
  return `<style>${css2.join('\n')}</style>`;
}

let fonts = 0;
for (const name of readdirSync(dist).filter(f => f.endsWith('.html'))) {
  let html = readFileSync(join(dist, name), 'utf8');
  html = html.replace(/<link[^>]*rel="preconnect"[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, '');
  for (const [tag, url] of html.matchAll(/<link[^>]*href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/g)) {
    html = html.replace(tag, inline(url.replaceAll('&amp;', '&')));
    fonts++;
  }
  if (/https?:\/\/fonts\./.test(html)) throw new Error(`${name} still loads fonts from the internet`);
  writeFileSync(join(out, name), html);
}
console.log(`offline copy of dist/ in ${out}: ${fonts} font sheets inlined`);
