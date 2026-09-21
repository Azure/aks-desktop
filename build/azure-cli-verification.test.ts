// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";

import {
  canInvokePackagedRuntime,
  getExtensionTimeoutResult,
  invalidInstalledAzureCliExtensions,
  missingInstalledWheelFiles,
  readInstalledAzureCliExtensionVersion,
  readRequiredAzureCliExtensionVersions,
  readRequiredAzureCliExtensions,
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
          azureCli: {
            extensions: ["aks-preview", "connectedk8s"],
            extensionVersions: { "aks-preview": "19.0.0", connectedk8s: "1.11.3" },
          },
        },
      },
    })
  );

  assert.deepEqual(readRequiredAzureCliExtensions(rootDir), [
    "aks-preview",
    "connectedk8s",
  ]);
  assert.deepEqual(readRequiredAzureCliExtensionVersions(rootDir), {
    "aks-preview": "19.0.0",
    connectedk8s: "1.11.3",
  });
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

test("returns no required extensions when configuration is not a list", () => {
  const nonArrayRoot = createRoot(
    JSON.stringify({
      config: {
        externalTools: {
          azureCli: { extensions: "aks-preview" },
        },
      },
    })
  );

  assert.deepEqual(readRequiredAzureCliExtensions(nonArrayRoot), []);
});

test("validates exact installed extension names and versions from wheel metadata", () => {
  const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aks-cli-extensions-"));
  tempDirs.push(extensionRoot);
  const resourceGraph = path.join(
    extensionRoot,
    "resource-graph",
    "resource_graph-2.1.1.dist-info"
  );
  fs.mkdirSync(resourceGraph, { recursive: true });
  fs.writeFileSync(
    path.join(resourceGraph, "METADATA"),
    "Name: resource-graph\nVersion: 2.1.1\n"
  );
  fs.writeFileSync(
    path.join(resourceGraph, "RECORD"),
    "resource_graph/__init__.py,sha256=test,0\n../../bin/tool,sha256=test,0\nresource_graph/__pycache__/optional.pyc,,\n"
  );
  fs.mkdirSync(path.join(extensionRoot, "resource-graph", "resource_graph"));
  fs.writeFileSync(
    path.join(extensionRoot, "resource-graph", "resource_graph", "__init__.py"),
    ""
  );

  assert.equal(
    readInstalledAzureCliExtensionVersion(
      path.join(extensionRoot, "resource-graph"),
      "resource-graph"
    ),
    "2.1.1"
  );
  assert.deepEqual(
    invalidInstalledAzureCliExtensions(extensionRoot, {
      "resource-graph": "2.1.1",
      connectedk8s: "1.11.3",
    }),
    ["connectedk8s"]
  );
  assert.deepEqual(
    invalidInstalledAzureCliExtensions(extensionRoot, { "resource-graph": "2.1.0" }),
    ["resource-graph"]
  );
  fs.mkdirSync(path.join(extensionRoot, "aks-preview"));
  assert.deepEqual(
    invalidInstalledAzureCliExtensions(extensionRoot, { "resource-graph": "2.1.1" }),
    ["aks-preview"]
  );
  assert.deepEqual(
    missingInstalledWheelFiles(path.join(extensionRoot, "resource-graph")),
    []
  );
  fs.rmSync(path.join(extensionRoot, "resource-graph", "resource_graph", "__init__.py"));
  assert.deepEqual(
    missingInstalledWheelFiles(path.join(extensionRoot, "resource-graph")),
    ["resource_graph/__init__.py"]
  );
  fs.writeFileSync(
    path.join(extensionRoot, "resource-graph", "resource_graph", "__init__.py"),
    ""
  );
  fs.rmSync(path.join(resourceGraph, "RECORD"));
  assert.deepEqual(
    missingInstalledWheelFiles(path.join(extensionRoot, "resource-graph")),
    ["resource_graph-2.1.1.dist-info/RECORD"]
  );
});

test("invokes packaged runtimes only on a matching host", () => {
  assert.equal(canInvokePackagedRuntime("darwin", "x64", "darwin", "x64"), true);
  assert.equal(canInvokePackagedRuntime("darwin", "arm64", "darwin", "x64"), false);
  assert.equal(canInvokePackagedRuntime("linux", "x64", "darwin", "x64"), false);
});

