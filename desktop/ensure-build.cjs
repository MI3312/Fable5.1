// Makes sure ../dist/lucid-sky.html exists and is newer than the game's source before Electron
// starts. The release zip already contains a build, so usually this does nothing. When it does
// need to build, it installs the build tools in the project root first (npm install), so a plain
// `npm install && npm start` in this folder is all anyone has to do.
//   node ensure-build.cjs          build only if missing or out of date
//   node ensure-build.cjs --force  always rebuild
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist', 'lucid-sky.html');
const force = process.argv.includes('--force');

function newest(dir) {
  let t = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

function needsBuild() {
  if (force || !fs.existsSync(dist)) return true;
  const built = fs.statSync(dist).mtimeMs;
  const src = Math.max(newest(path.join(root, 'src')), newest(path.join(root, 'css')), fs.statSync(path.join(root, 'index.html')).mtimeMs);
  return src > built + 5000;
}

if (!needsBuild()) {
  console.log('[lucid-sky] using the existing build in dist/lucid-sky.html');
  process.exit(0);
}

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
try {
  if (!fs.existsSync(path.join(root, 'node_modules', 'esbuild')) || !fs.existsSync(path.join(root, 'node_modules', 'three'))) {
    console.log('[lucid-sky] installing the build tools in the project root (one time)...');
    run('npm install');
  }
  console.log('[lucid-sky] building dist/lucid-sky.html...');
  run('npm run build');
} catch (e) {
  if (fs.existsSync(dist)) {
    console.warn('[lucid-sky] the build failed; starting with the previous build instead.');
    process.exit(0);
  }
  console.error('[lucid-sky] could not build the game. From the project root, run:  npm install  then  npm run build');
  process.exit(1);
}
