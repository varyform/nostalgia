import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite-plus';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { discoverPages } from '@nostalgia/game/node';

const PAGES = discoverPages(import.meta.dirname);
const name = process.env.PAGE;
const page = name ? PAGES[name] : undefined;
if (name && !page) throw new Error(`Unknown PAGE "${name}". Known: ${Object.keys(PAGES).join(', ')}`);

// The launcher's C: drive is a 20 MB hard disk (a Seagate ST-225, as DOS 5 formats it), and the
// compiled games are what is on it: each file takes whole 2 KB clusters, after the DOS system files.
// The launcher itself is left out, as the shell. Built last (scripts/build.js), it sees every game.
const DISK = { total: 21_309_440, cluster: 2048 };
const DOS = [33_430, 37_394, 47_845]; // IO.SYS, MSDOS.SYS, COMMAND.COM
function bytesFree(): number {
  const clusters = (n: number) => Math.ceil(n / DISK.cluster) * DISK.cluster;
  const games = Object.entries(PAGES)
    .filter(([key]) => key !== 'index')
    .map(([, p]) => resolve(import.meta.dirname, p.out))
    .filter(existsSync)
    .map(f => statSync(f).size);
  return DISK.total - [...DOS, ...games].reduce((sum, n) => sum + clusters(n), 0);
}

// Copy the inlined HTML out of the scratch build dir to its place in dist/.
function emitTo(out: string): Plugin {
  return {
    name: 'nostalgia:emit-to',
    apply: 'build',
    writeBundle(_, bundle) {
      const html = Object.values(bundle).find(f => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') throw new Error('no HTML in bundle');
      const file = resolve(import.meta.dirname, out);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, html.source);
      this.info(`→ ${out}`);
    },
  };
}

// In dev, send `/` to the launcher source.
const devRoot: Plugin = {
  name: 'nostalgia:dev-root',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(302, { Location: '/launcher/' });
        res.end();
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: page ? [viteSingleFile({ removeViteModuleLoader: true }), emitTo(page.out)] : [devRoot],
  define: { 'import.meta.env.BYTES_FREE': JSON.stringify(!name || name === 'index' ? bytesFree() : 0) },
  build: page && {
    outDir: `.build/${name}`,
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, page.entry) },
  },
  server: {
    open: '/launcher/',
    watch: { ignored: ['**/.build/**', '**/dist/**'] },
  },
  test: {
    include: ['packages/**/*.test.ts'],
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ['.build/**', 'dist/**'],
  },
  fmt: {
    singleQuote: true,
    printWidth: 120,
    arrowParens: 'avoid',
    // games/ holds the pre-build-system sources, formatted by hand; they move over as they're touched.
    // packages/rig/src is the rig editor's runtime as the editor formats it (scripts/sync-rig.mjs).
    ignorePatterns: ['.build/**', 'dist/**', 'games/**', 'packages/rig/src/**', 'pnpm-lock.yaml'],
  },
});
