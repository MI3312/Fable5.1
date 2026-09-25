// Bundles three.js (from node_modules) into a single minified ES module at lib/three.module.min.js
// so the game can run from any static web server with no network access.
import { build } from 'esbuild';

await build({
  entryPoints: ['node_modules/three/build/three.module.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'lib/three.module.min.js',
  legalComments: 'inline',
});
console.log('Wrote lib/three.module.min.js');
