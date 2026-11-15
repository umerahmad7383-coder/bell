// Copies the browser libraries out of node_modules into client/vendor so the
// client folder is a fully static site (deployable on its own to any static host).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'client', 'vendor');
mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/three/build/three.module.min.js', 'three.module.min.js'],
  ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'BufferGeometryUtils.js'],
  ['node_modules/@dimforge/rapier3d-compat/rapier.es.js', 'rapier.es.js'],
  ['node_modules/socket.io/client-dist/socket.io.esm.min.js', 'socket.io.esm.min.js'],
];
for (const [src, dst] of files) {
  const s = join(root, src);
  if (!existsSync(s)) { console.error('missing', src, '- run npm install (with dev dependencies)'); process.exit(1); }
  cpSync(s, join(out, dst));
  console.log('vendored', dst);
}
