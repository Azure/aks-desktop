#!/usr/bin/env node

// Collects translation keys from the in-repo plugins, installed Headlamp source,
// and external headlamp-plugins repository into JSON files for the translation
// team, and distributes completed translations back to their locale directories.
//
// Usage:
//   node Localize/translation-manager.mjs collect
//     Extracts English keys into Localize/locales/en/{source}-{ns}.json
//     for OneLocBuild to use as source files.
//
//   node Localize/translation-manager.mjs distribute
//     Writes collected translations back to the source locale files.
//     `replaceDir` targets (owned by this repo) are fully replaced.
//     `mergeDir` targets (the external plugins repo) only receive keys that
//     are still missing there, so community translations always win.
//
// The external plugins repo is expected as a sibling checkout ("../plugins");
// override with the HEADLAMP_PLUGINS_DIR environment variable. Sources whose
// directories are missing are skipped.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "Localize/locales");

const EXTERNAL_PLUGINS_DIR = path.resolve(
  process.env.HEADLAMP_PLUGINS_DIR ?? path.join(ROOT, "..", "plugins")
);

/* Locales dir of a plugin in the external headlamp-plugins repo. */
function externalPluginLocales(name) {
  return path.join(EXTERNAL_PLUGINS_DIR, name, "locales");
}

/* Locales dir of a plugin vendored in this repo. */
function localPluginLocales(name) {
  return path.join(ROOT, "plugins", name, "locales");
}

/*
 * name       - prefix of the collected file, e.g. "keda" -> keda-translation.json
 * sourceDir  - locales dir the English source keys are read from
 * replaceDir - locales dir fully overwritten on distribute (owned by this repo)
 * mergeDir   - locales dir that only receives keys it is still missing
 */
const SOURCES = [
  {
    name: "frontend",
    sourceDir: path.join(
      ROOT,
      "node_modules/@headlamp-k8s/headlamp-source/source/frontend/src/i18n/locales",
    ),
    replaceDir: path.join(
      ROOT,
      "node_modules/@headlamp-k8s/headlamp-source/source/frontend/src/i18n/locales",
    ),
    namespaces: ["translation", "glossary", "app"],
  },
  {
    name: "plugin",
    sourceDir: localPluginLocales("aks-desktop"),
    replaceDir: localPluginLocales("aks-desktop"),
    namespaces: ["translation"],
  },
  {
    name: "ai-assistant",
    sourceDir: localPluginLocales("ai-assistant"),
    replaceDir: localPluginLocales("ai-assistant"),
    mergeDir: externalPluginLocales("ai-assistant"),
    namespaces: ["translation"],
  },
  {
    name: "plugin-catalog",
    sourceDir: localPluginLocales("plugin-catalog"),
    replaceDir: localPluginLocales("plugin-catalog"),
    mergeDir: externalPluginLocales("plugin-catalog"),
    namespaces: ["translation"],
  },
  // Plugins that only live in the external repo: translated here, merged back
  // without ever overwriting an existing community translation.
  ...["cert-manager", "keda", "prometheus"].map((name) => ({
    name,
    sourceDir: externalPluginLocales(name),
    mergeDir: externalPluginLocales(name),
    namespaces: ["translation"],
  })),
];

/** Terms that should be left as-is */
const LOCKED_TERMS = [
  // Product / brand names
  "Kubernetes",
  "Headlamp",
  "Azure",
  "GitHub",
  "Docker",
  "Prometheus",
  "KEDA",
  "cert-manager",
  "Iconify",

  // CLI tools and config
  "kubeconfig",
  "kubectl",
  "aks-preview",
  "ManagedNamespacePreview",

  // K8s API field names (camelCase identifiers shown in UI)
  "ipBlock",
  "namespaceSelector",
  "podSelector",
  "fieldRef",
  "resourceFieldRef",

  // K8s service types (config values)
  "ClusterIP",
  "LoadBalancer",
  "NodePort",

  // Technical status names
  "OOMKilled",

  // Data format names
  "YAML",
  "JSON",
];

/* Builds the `{Locked="…"}` comment for a value, or returns null if nothing matches. */
function lockedComment(value) {
  const matches = LOCKED_TERMS.filter((term) => value.includes(term));
  if (matches.length === 0) return null;
  return `{Locked=${matches.map((t) => `"${t}"`).join(",")}}`;
}

/* Returns the flat filename for a source/namespace pair, e.g. "frontend-translation.json". */
function collectedFileName(source, ns) {
  return `${source}-${ns}.json`;
}

/* Reads and parses a JSON file, returns null if it doesn't exist. */
function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/* Writes data as formatted JSON, creating parent directories as needed. */
function writeJson(filePath, data, eol = "\n") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const json = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(filePath, eol === "\n" ? json : json.replace(/\n/g, eol));
}

/* OneLocBuild writes CRLF, so keep whatever a file already uses. */
function detectEol(filePath, fallback = "\n") {
  if (!fs.existsSync(filePath)) return fallback;
  return fs.readFileSync(filePath, "utf-8").includes("\r\n") ? "\r\n" : "\n";
}

/*
 * Copies English locale files from all sources into Localize/locales/en/.
 */
function collect() {
  let totalKeys = 0;
  let totalFiles = 0;

  for (const source of SOURCES) {
    for (const ns of source.namespaces) {
      const srcPath = path.join(source.sourceDir, "en", `${ns}.json`);
      const data = readJson(srcPath);
      if (!data) continue;

      const output = {};
      const sortedEntries = Object.entries(data).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      for (const [key, value] of sortedEntries) {
        output[key] = value;
        const comment = lockedComment(String(value));
        if (comment) output[`_${key}.comment`] = comment;
      }

      const outPath = path.join(
        OUTPUT_DIR,
        "en",
        collectedFileName(source.name, ns)
      );
      writeJson(outPath, output);
      totalKeys += Object.keys(data).length;
      totalFiles++;

      totalFiles += scaffoldLanguages(source.name, ns, sortedEntries);
    }
  }

  console.log(`Collected ${totalKeys} English keys (${totalFiles} files).`);
  console.log(`Output: ${path.relative(ROOT, OUTPUT_DIR)}/en/`);
}

/* Language directories under Localize/locales, excluding the English source. */
function languageDirs() {
  return fs
    .readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "en")
    .map((e) => e.name);
}

/*
 * Mirrors the English key set into every language file, keeping any value the
 * translation team already provided and leaving new keys blank. Existing key
 * order is preserved so re-collecting stays a minimal diff.
 */
function scaffoldLanguages(sourceName, ns, sortedEntries) {
  let written = 0;
  const englishKeys = sortedEntries.map(([key]) => key);
  const englishKeySet = new Set(englishKeys);

  for (const lang of languageDirs()) {
    const filePath = path.join(
      OUTPUT_DIR,
      lang,
      collectedFileName(sourceName, ns)
    );
    const existing = readJson(filePath) ?? {};

    const output = {};
    for (const key of Object.keys(existing)) {
      if (englishKeySet.has(key)) output[key] = existing[key];
    }
    for (const key of englishKeys) {
      if (!(key in output)) output[key] = "";
    }

    writeJson(filePath, output, detectEol(filePath, "\r\n"));
    written++;
  }

  return written;
}

/*
 * Copies collected translation files back to the original source locale
 * directories. `replaceDir` targets are fully rewritten; `mergeDir` targets
 * keep every translation they already have and only gain the missing ones.
 */
function distribute() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.error(`No collected translations found at ${OUTPUT_DIR}`);
    process.exit(1);
  }

  let replaced = 0;
  let merged = 0;
  let addedKeys = 0;
  const languages = languageDirs();

  for (const lang of languages) {
    for (const source of SOURCES) {
      for (const ns of source.namespaces) {
        const collectedPath = path.join(
          OUTPUT_DIR,
          lang,
          collectedFileName(source.name, ns)
        );
        const collected = readJson(collectedPath);
        if (!collected) continue;

        const translations = stripComments(collected);

        if (source.replaceDir) {
          writeJson(
            path.join(source.replaceDir, lang, `${ns}.json`),
            translations
          );
          replaced++;
        }

        if (source.mergeDir) {
          const sourceEn =
            readJson(
              path.join(OUTPUT_DIR, "en", collectedFileName(source.name, ns))
            ) ?? {};
          const added = mergeMissing(
            source.mergeDir,
            lang,
            ns,
            translations,
            sourceEn
          );
          if (added > 0) {
            merged++;
            addedKeys += added;
          }
        }
      }
    }
  }

  console.log(`Replaced ${replaced} locale files.`);
  console.log(
    `Added ${addedKeys} missing keys across ${merged} external locale files.`
  );
}

/* Drops the `_<key>.comment` entries added during collection. */
function stripComments(collected) {
  return Object.fromEntries(
    Object.entries(collected).filter(
      ([k]) => !k.startsWith("_") || !k.endsWith(".comment")
    )
  );
}

/*
 * Adds translations to an external locale file for keys it does not have yet.
 * Only keys present in that plugin's own English file are considered, and only
 * when its English text still matches what we translated, so an existing
 * community translation is never overwritten or mismatched.
 */
function mergeMissing(localesDir, lang, ns, translations, sourceEn) {
  const targetEn = readJson(path.join(localesDir, "en", `${ns}.json`));
  if (!targetEn) return 0;

  const targetPath = path.join(localesDir, lang, `${ns}.json`);
  const existing = readJson(targetPath) ?? {};

  // Keep the plugin's own English key order so merging stays a minimal diff.
  const result = {};
  let added = 0;
  for (const [key, english] of Object.entries(targetEn)) {
    // An existing empty string means the key is present but untranslated.
    if (existing[key]) {
      result[key] = existing[key];
      continue;
    }
    if (sourceEn[key] !== english) {
      if (key in existing) result[key] = existing[key];
      continue;
    }
    const value = translations[key];
    if (!value) {
      if (key in existing) result[key] = existing[key];
      continue;
    }
    result[key] = value;
    added++;
  }
  for (const [key, value] of Object.entries(existing)) {
    if (!(key in result)) result[key] = value;
  }

  if (added === 0) return 0;

  writeJson(targetPath, result, detectEol(targetPath));
  return added;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "collect") {
    collect();
  } else if (command === "distribute") {
    distribute();
  } else {
    console.log("Usage:");
    console.log("  node Localize/translation-manager.mjs collect");
    console.log("  node Localize/translation-manager.mjs distribute");
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}

export { mergeMissing };
