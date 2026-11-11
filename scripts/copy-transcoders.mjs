#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'ktx2');

let transcoderJs;
try {
  transcoderJs = require.resolve('three/addons/libs/basis/basis_transcoder.js');
} catch {
  console.error('Cannot resolve three/addons/libs/basis/basis_transcoder.js - run npm install.');
  process.exit(1);
}

// The .wasm sits beside the .js, and is reached through that directory rather than a second
// require.resolve, which would rely on the resolver accepting a specifier that is not a module.
const sources = [transcoderJs, join(dirname(transcoderJs), 'basis_transcoder.wasm')];

for (const source of sources) {
  if (!existsSync(source)) {
    console.error(`Missing ${source} - run npm install first.`);
    process.exit(1);
  }
}

mkdirSync(dest, { recursive: true });
for (const source of sources) {
  copyFileSync(source, join(dest, basename(source)));
}

console.log(`Copied basis transcoder into ${dest}`);
