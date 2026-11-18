// Every page the repo builds: its source entry and the single self-contained
// HTML file it compiles to in dist/ (one file per game version, no assets).
export const PAGES = {
  launcher: { entry: 'launcher/index.html', out: 'dist/index.html' },
  'skyhook-cga': { entry: 'games/skyhook/index.html', out: 'dist/skyhook-cga.html' },
  'skyhook-hd': { entry: 'games/skyhook/modern.html', out: 'dist/skyhook-hd.html' },
  dropzone: { entry: 'games/dropzone/index.html', out: 'dist/dropzone.html' },
};
