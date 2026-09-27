// Builds a single self-contained HTML file (dist/lucid-sky.html) that runs straight
// from the filesystem (double-click) - three.js, the game, the terrain worker and CSS inlined.
let build;
try {
  ({ build } = await import('esbuild'));
} catch (e) {
  console.error('The build needs esbuild, which is not installed yet.\nRun  npm install  in the project root (the folder with this package.json), then  npm run build  again.');
  process.exit(1);
}
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const worker = await build({
  entryPoints: ['src/world/worker.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
});
const workerSrc = worker.outputFiles[0].text;

const main = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  write: false,
  alias: { three: './node_modules/three/build/three.module.js' },
  banner: { js: `globalThis.__LUCID_WORKER_SRC__ = ${JSON.stringify(workerSrc)};` },
  legalComments: 'none',
});
const mainSrc = main.outputFiles[0].text;

const css = await readFile('css/style.css', 'utf8');
let html = await readFile('index.html', 'utf8');
html = html.replace(/<link rel="stylesheet" href="css\/style.css" \/>/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(/<script type="module" src="src\/main.js"><\/script>/, () => `<script type="module">\n${mainSrc.replace(/<\/script/g, '<\\/script')}\n</script>`);

await mkdir('dist', { recursive: true });
await writeFile('dist/lucid-sky.html', html);
console.log(`Wrote dist/lucid-sky.html (${(html.length / 1024).toFixed(0)} KB)`);
