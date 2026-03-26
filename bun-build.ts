#!/usr/bin/env bun

import { $ } from 'bun';
import fs from 'node:fs';
import path from 'node:path';

const DIST_TYPES_DIR = path.join(process.cwd(), 'dist-types');
const GLOBAL_TYPES_PATH = path.join(process.cwd(), 'global.d.ts');

const prependGlobalReferences = (dirPath: string) => {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      prependGlobalReferences(entryPath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) {
      continue;
    }

    const relativeGlobalPath = path
      .relative(path.dirname(entryPath), GLOBAL_TYPES_PATH)
      .replace(/\\/g, '/');
    const normalizedGlobalPath = relativeGlobalPath.startsWith('.')
      ? relativeGlobalPath
      : `./${relativeGlobalPath}`;
    const banner = `/// <reference path="${normalizedGlobalPath}" />\n\n`;
    const source = fs.readFileSync(entryPath, 'utf8');

    if (!source.startsWith(banner)) {
      fs.writeFileSync(entryPath, `${banner}${source}`);
    }
  }
};

const rewriteRelativeImportSpecifiers = (dirPath: string) => {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      rewriteRelativeImportSpecifiers(entryPath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue;
    }

    const source = fs.readFileSync(entryPath, 'utf8');
    const rewritten = source
      .replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g, (_match, prefix, specifier, suffix) =>
        /\.[a-z]+$/i.test(specifier)
          ? `${prefix}${specifier}${suffix}`
          : `${prefix}${specifier}.js${suffix}`
      )
      .replace(
        /(import\s*\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g,
        (_match, prefix, specifier, suffix) =>
          /\.[a-z]+$/i.test(specifier)
            ? `${prefix}${specifier}${suffix}`
            : `${prefix}${specifier}.js${suffix}`
      );

    if (rewritten !== source) {
      fs.writeFileSync(entryPath, rewritten);
    }
  }
};

async function build() {
  await $`rm -rf dist`;
  await $`rm -rf dist-types`;
  await $`mkdir -p dist`;
  await $`mkdir -p dist-types`;
  await $`rm -f ../../.cache/tsc/18ways-core.tsbuildinfo`;
  await $`../../node_modules/.bin/tsc \
    -p tsconfig.json \
    --noEmit false \
    --declaration false \
    --emitDeclarationOnly false \
    --outDir dist`;
  rewriteRelativeImportSpecifiers(path.join(process.cwd(), 'dist'));
  await $`rm -f dist/tsconfig.tsbuildinfo`;
  await $`rm -f ../../.cache/tsc/18ways-core.tsbuildinfo`;
  await $`../../node_modules/.bin/tsc \
    -p tsconfig.json \
    --emitDeclarationOnly \
    --declaration \
    --noEmit false \
    --outDir dist-types`;

  prependGlobalReferences(DIST_TYPES_DIR);
  await $`rm -f dist-types/tsconfig.tsbuildinfo`;
}

build().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
