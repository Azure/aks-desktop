#!/usr/bin/env node

// Collects translation keys from plugins/aks-desktop and headlamp/frontend
// into JSON files for the translation team, and distributes completed
// translations back to the source locale directories.
//
// Usage:
//   node Localize/translation-manager.mjs collect
//     Extracts English keys into Localize/locales/en/{source}-{ns}.json
//     for OneLocBuild to use as source files.
//
//   node Localize/translation-manager.mjs distribute
//     Writes collected translations back to the source locale files,
//     completely replacing existing content.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'Localize/locales');

const SOURCES = [
  {
    name: 'frontend',
    localesDir: path.join(ROOT, 'headlamp/frontend/src/i18n/locales'),
    namespaces: ['translation', 'glossary', 'app'],
  },
  {
    name: 'plugin',
    localesDir: path.join(ROOT, 'plugins/aks-desktop/locales'),
    namespaces: ['translation'],
  },
];

/* Returns the flat filename for a source/namespace pair, e.g. "frontend-translation.json". */
function collectedFileName(source, ns) {
  return `${source}-${ns}.json`;
}

/* Reads and parses a JSON file, returns null if it doesn't exist. */
function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/* Writes data as formatted JSON, creating parent directories as needed. */
function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/*
 * Copies English locale files from all sources into Localize/locales/en/.
 */
function collect() {
  let totalKeys = 0;
  let totalFiles = 0;

  for (const source of SOURCES) {
    for (const ns of source.namespaces) {
      const srcPath = path.join(source.localesDir, 'en', `${ns}.json`);
      const data = readJson(srcPath);
      if (!data) continue;

      const outPath = path.join(
        OUTPUT_DIR,
        'en',
        collectedFileName(source.name, ns),
      );
      writeJson(outPath, data);
      totalKeys += Object.keys(data).length;
      totalFiles++;
    }
  }

  console.log(`Collected ${totalKeys} English keys (${totalFiles} files).`);
  console.log(`Output: ${path.relative(ROOT, OUTPUT_DIR)}/en/`);
}

/*
 * Copies collected translation files back to the original source locale
 * directories, fully replacing their content.
 */
function distribute() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.error(`No collected translations found at ${OUTPUT_DIR}`);
    process.exit(1);
  }

  let updated = 0;
  const languages = fs
    .readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const lang of languages) {
    for (const source of SOURCES) {
      for (const ns of source.namespaces) {
        const collectedPath = path.join(
          OUTPUT_DIR,
          lang,
          collectedFileName(source.name, ns),
        );
        const collected = readJson(collectedPath);
        if (!collected) continue;

        const targetPath = path.join(source.localesDir, lang, `${ns}.json`);
        writeJson(targetPath, collected);
        updated++;
      }
    }
  }

  console.log(`Distributed translations to ${updated} locale files.`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'collect') {
    collect();
  } else if (command === 'distribute') {
    distribute();
  } else {
    console.log('Usage:');
    console.log('  node Localize/translation-manager.mjs collect');
    console.log('  node Localize/translation-manager.mjs distribute');
    process.exit(1);
  }
}

main();
