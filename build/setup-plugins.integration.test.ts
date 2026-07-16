import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { setupPlugins } from "./setup-plugins";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value));
}

test("setup-plugins derives and passes package-authoritative versions to the AKS Desktop build", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "aksd-setup-plugins-"));
  const pluginDir = path.join(rootDir, "plugins", "aks-desktop");
  const headlampAppDir = path.join(rootDir, "headlamp", "app");
  const externalToolsDir = path.join(
    headlampAppDir,
    "resources",
    "external-tools"
  );
  const syntheticConnectionString = "synthetic-integration-connection-string";
  const buildCalls: Array<{
    environment: NodeJS.ProcessEnv;
    pluginDir: string;
  }> = [];

  mkdirSync(path.join(pluginDir, "dist"), { recursive: true });
  mkdirSync(externalToolsDir, { recursive: true });
  writeJson(path.join(rootDir, "package.json"), { version: "1.2.3-beta.4" });
  writeJson(path.join(headlampAppDir, "package.json"), {
    version: "0.43.0",
  });
  writeJson(path.join(pluginDir, "package.json"), { name: "aks-desktop" });
  writeFileSync(path.join(pluginDir, "dist", "main.js"), "fixture");

  setupPlugins({
    buildPlugin: (receivedPluginDir, environment) => {
      buildCalls.push({ pluginDir: receivedPluginDir, environment });
    },
    environment: {
      PATH: "/example/bin",
      REACT_APP_APPINSIGHTS_CONNECTION_STRING: syntheticConnectionString,
    },
    log: () => undefined,
    rootDir,
    setupExternalTools: () => {
      throw new Error("external tools setup should be skipped");
    },
  });

  assert.equal(buildCalls.length, 1);
  assert.equal(buildCalls[0].pluginDir, pluginDir);
  assert.equal(
    buildCalls[0].environment.REACT_APP_AKS_DESKTOP_VERSION,
    "1.2.3-beta.4"
  );
  assert.equal(buildCalls[0].environment.REACT_APP_HEADLAMP_VERSION, "0.43.0");
  assert.equal(
    buildCalls[0].environment.REACT_APP_APPINSIGHTS_CONNECTION_STRING,
    syntheticConnectionString
  );
  assert.equal(
    readFileSync(
      path.join(rootDir, "headlamp", ".plugins", "aks-desktop", "main.js"),
      "utf8"
    ),
    "fixture"
  );
});

test("fails before external tool setup when the Headlamp directory is missing", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "aksd-setup-plugins-"));
  let externalToolsSetupCalled = false;

  assert.throws(
    () =>
      setupPlugins({
        log: () => undefined,
        rootDir,
        setupExternalTools: () => {
          externalToolsSetupCalled = true;
        },
      }),
    /Headlamp repository directory not found/
  );
  assert.equal(externalToolsSetupCalled, false);
});

test("handles an absent Headlamp plugins directory when no plugins are available", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "aksd-setup-plugins-"));
  const headlampAppDir = path.join(rootDir, "headlamp", "app");
  const externalToolsDir = path.join(
    headlampAppDir,
    "resources",
    "external-tools"
  );

  mkdirSync(externalToolsDir, { recursive: true });
  writeJson(path.join(rootDir, "package.json"), { version: "1.2.3" });
  writeJson(path.join(headlampAppDir, "package.json"), { version: "0.43.0" });

  assert.doesNotThrow(() =>
    setupPlugins({
      log: () => undefined,
      rootDir,
      setupExternalTools: () => {
        throw new Error("external tools setup should be skipped");
      },
    })
  );
});

test("clears stale target files before copying a rebuilt plugin", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "aksd-setup-plugins-"));
  const pluginDir = path.join(rootDir, "plugins", "aks-desktop");
  const headlampAppDir = path.join(rootDir, "headlamp", "app");
  const externalToolsDir = path.join(
    headlampAppDir,
    "resources",
    "external-tools"
  );
  const targetDir = path.join(
    rootDir,
    "headlamp",
    ".plugins",
    "aks-desktop"
  );

  mkdirSync(path.join(pluginDir, "dist"), { recursive: true });
  mkdirSync(externalToolsDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  writeJson(path.join(rootDir, "package.json"), { version: "1.2.3" });
  writeJson(path.join(headlampAppDir, "package.json"), { version: "0.43.0" });
  writeJson(path.join(pluginDir, "package.json"), { name: "aks-desktop" });
  writeFileSync(path.join(pluginDir, "dist", "main.js"), "fresh");
  writeFileSync(path.join(targetDir, "stale.js"), "stale");

  setupPlugins({
    buildPlugin: () => undefined,
    log: () => undefined,
    rootDir,
    setupExternalTools: () => {
      throw new Error("external tools setup should be skipped");
    },
  });

  assert.equal(existsSync(path.join(targetDir, "stale.js")), false);
  assert.equal(readFileSync(path.join(targetDir, "main.js"), "utf8"), "fresh");
});
