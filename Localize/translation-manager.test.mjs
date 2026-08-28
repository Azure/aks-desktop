import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { mergeMissing } from "./translation-manager.mjs";

function createLocalesDir(t) {
  const localesDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "translation-manager-")
  );
  t.after(() => fs.rmSync(localesDir, { recursive: true, force: true }));
  return localesDir;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test("collect preserves existing translations while scaffolding new keys", (t) => {
  const root = createLocalesDir(t);
  const managerPath = path.join(root, "Localize", "translation-manager.mjs");
  writeFile(
    managerPath,
    fs.readFileSync(new URL("./translation-manager.mjs", import.meta.url))
  );
  for (const namespace of ["translation", "glossary", "app"]) {
    writeFile(
      path.join(
        root,
        "node_modules",
        "@headlamp-k8s",
        "headlamp-source",
        "source",
        "frontend",
        "src",
        "i18n",
        "locales",
        "en",
        `${namespace}.json`
      ),
      "{}"
    );
  }
  writeFile(
    path.join(
      root,
      "plugins",
      "aks-desktop",
      "locales",
      "en",
      "translation.json"
    ),
    JSON.stringify({ existing: "Existing", added: "Added" })
  );
  const collectedPath = path.join(
    root,
    "Localize",
    "locales",
    "de",
    "plugin-translation.json"
  );
  writeFile(collectedPath, JSON.stringify({ existing: "Vorhanden" }));

  const result = spawnSync(process.execPath, [managerPath, "collect"], {
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(collectedPath, "utf-8")), {
    existing: "Vorhanden",
    added: "",
  });
});

test("collect rejects a missing installed Headlamp translation source", (t) => {
  const root = createLocalesDir(t);
  const managerPath = path.join(root, "Localize", "translation-manager.mjs");
  writeFile(
    managerPath,
    fs.readFileSync(new URL("./translation-manager.mjs", import.meta.url))
  );

  const result = spawnSync(process.execPath, [managerPath, "collect"], {
    encoding: "utf-8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required translation source is missing/);
});

test("collected Prometheus metric count uses correct English plurals", () => {
  const translations = JSON.parse(
    fs.readFileSync(
      new URL("./locales/en/prometheus-translation.json", import.meta.url),
      "utf-8"
    )
  );

  assert.equal(translations["{{count}} metrics_one"], "{{count}} metric");
  assert.equal(translations["{{count}} metrics_other"], "{{count}} metrics");
});

test("distribute rejects a translation when English changed after collection", (t) => {
  const root = createLocalesDir(t);
  const managerPath = path.join(root, "Localize", "translation-manager.mjs");
  writeFile(
    managerPath,
    fs.readFileSync(new URL("./translation-manager.mjs", import.meta.url))
  );
  writeFile(
    path.join(
      root,
      "Localize",
      "locales",
      "en",
      "cert-manager-translation.json"
    ),
    JSON.stringify({ greeting: "Original greeting" })
  );
  writeFile(
    path.join(
      root,
      "Localize",
      "locales",
      "fr",
      "cert-manager-translation.json"
    ),
    JSON.stringify({ greeting: "Ancienne salutation" })
  );

  const externalPluginsDir = path.join(root, "external-plugins");
  writeFile(
    path.join(
      externalPluginsDir,
      "cert-manager",
      "locales",
      "en",
      "translation.json"
    ),
    JSON.stringify({ greeting: "Updated greeting" })
  );

  const result = spawnSync(process.execPath, [managerPath, "distribute"], {
    encoding: "utf-8",
    env: { ...process.env, HEADLAMP_PLUGINS_DIR: externalPluginsDir },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.existsSync(
      path.join(
        externalPluginsDir,
        "cert-manager",
        "locales",
        "fr",
        "translation.json"
      )
    ),
    false
  );
});

test("mergeMissing preserves the target locale CRLF line endings", (t) => {
  const localesDir = createLocalesDir(t);
  writeFile(
    path.join(localesDir, "en", "translation.json"),
    JSON.stringify({ existing: "Existing", added: "Added" })
  );
  const targetPath = path.join(localesDir, "fr", "translation.json");
  writeFile(targetPath, '{\r\n  "existing": "Existant"\r\n}\r\n');

  const added = mergeMissing(
    localesDir,
    "fr",
    "translation",
    { existing: "Existant", added: "Ajoute" },
    { existing: "Existing", added: "Added" }
  );

  assert.equal(added, 1);
  assert.equal(
    fs.readFileSync(targetPath, "utf-8"),
    '{\r\n  "existing": "Existant",\r\n  "added": "Ajoute"\r\n}\r\n'
  );
});
