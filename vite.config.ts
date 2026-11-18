import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite-plus';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { PAGES } from './pages.config.js';

const name = process.env.PAGE;
const page = name ? PAGES[name as keyof typeof PAGES] : undefined;
if (name && !page) throw new Error(`Unknown PAGE "${name}". Known: ${Object.keys(PAGES).join(', ')}`);

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
    // games/ holds the pre-build-system sources, formatted by hand; they move over as they're touched
    ignorePatterns: ['.build/**', 'dist/**', 'games/**', 'pnpm-lock.yaml'],
  },
});
