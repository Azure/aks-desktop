// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";

import {
  getExtensionTimeoutResult,
  readRequiredAzureCliExtensions,
  shouldVerifyBundledExtensions,
} from "./azure-cli-verification";

const tempDirs: string[] = [];

afterEach(() => {
  tempDirs
    .splice(0)
    .forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

function createRoot(packageJson: string): string {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "aks-cli-verification-")
  );
  tempDirs.push(rootDir);
  fs.writeFileSync(path.join(rootDir, "package.json"), packageJson);
  return rootDir;
}

test("fails required extension verification when Azure CLI invocation times out", () => {
  assert.deepEqual(getExtensionTimeoutResult(["aks-preview", "connectedk8s"]), {
    name: "Azure CLI extensions",
    passed: false,
    message:
      "Could not verify required extensions after Azure CLI invocation timed out: aks-preview, connectedk8s",
  });
});

test("reads required Azure CLI extensions from package configuration", () => {
  const rootDir = createRoot(
    JSON.stringify({
      config: {
        externalTools: {
          azureCli: { extensions: ["aks-preview", "connectedk8s"] },
        },
      },
    })
  );

  assert.deepEqual(readRequiredAzureCliExtensions(rootDir), [
    "aks-preview",
    "connectedk8s",
  ]);
});

test("returns no required extensions for missing or malformed configuration", () => {
  const malformedRoot = createRoot("{");
  const missingRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "aks-cli-verification-")
  );
  tempDirs.push(missingRoot);

  assert.deepEqual(readRequiredAzureCliExtensions(malformedRoot), []);
  assert.deepEqual(readRequiredAzureCliExtensions(missingRoot), []);
});

test("verifies bundled extensions only on platforms that pre-install them", () => {
  assert.equal(shouldVerifyBundledExtensions("linux"), true);
  assert.equal(shouldVerifyBundledExtensions("darwin"), true);
  assert.equal(shouldVerifyBundledExtensions("win32"), false);
});
