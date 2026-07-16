import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPluginBuildEnvironment,
  readBuildMetadata,
} from "./build-metadata";

function createRepositoryFixture(
  aksDesktopVersion: unknown,
  headlampVersion: unknown
): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), "aksd-build-metadata-"));
  const headlampAppDir = path.join(rootDir, "headlamp", "app");
  mkdirSync(headlampAppDir, { recursive: true });
  writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({ version: aksDesktopVersion })
  );
  writeFileSync(
    path.join(headlampAppDir, "package.json"),
    JSON.stringify({ version: headlampVersion })
  );
  return rootDir;
}

test("reads AKS Desktop and Headlamp versions from their package files", () => {
  const rootDir = createRepositoryFixture("1.2.3-beta.4", "0.43.0");

  assert.deepEqual(readBuildMetadata(rootDir), {
    aksDesktopVersion: "1.2.3-beta.4",
    headlampVersion: "0.43.0",
  });
});

test("preserves existing environment values and injects package versions", () => {
  const environment = createPluginBuildEnvironment(
    {
      PATH: "/example/bin",
      REACT_APP_APPINSIGHTS_CONNECTION_STRING: "synthetic-override",
    },
    {
      aksDesktopVersion: "1.2.3",
      headlampVersion: "0.43.0",
    }
  );

  assert.equal(environment.PATH, "/example/bin");
  assert.equal(
    environment.REACT_APP_APPINSIGHTS_CONNECTION_STRING,
    "synthetic-override"
  );
  assert.equal(environment.REACT_APP_AKS_DESKTOP_VERSION, "1.2.3");
  assert.equal(environment.REACT_APP_HEADLAMP_VERSION, "0.43.0");
});

test("rejects conflicting ambient version overrides instead of silently using them", () => {
  assert.throws(
    () =>
      createPluginBuildEnvironment(
        { REACT_APP_AKS_DESKTOP_VERSION: "9.9.9" },
        { aksDesktopVersion: "1.2.3", headlampVersion: "0.43.0" }
      ),
    /REACT_APP_AKS_DESKTOP_VERSION.*must match package metadata/
  );
});

for (const invalidOverride of ["", " ", "unknown"]) {
  test(`rejects invalid ambient version override ${JSON.stringify(
    invalidOverride
  )}`, () => {
    assert.throws(
      () =>
        createPluginBuildEnvironment(
          { REACT_APP_HEADLAMP_VERSION: invalidOverride },
          { aksDesktopVersion: "1.2.3", headlampVersion: "0.43.0" }
        ),
      /REACT_APP_HEADLAMP_VERSION/
    );
  });
}

for (const invalidVersion of [
  "",
  "   ",
  "unknown",
  "UNKNOWN",
  undefined,
  null,
]) {
  test(`rejects invalid package version ${JSON.stringify(
    invalidVersion
  )}`, () => {
    const rootDir = createRepositoryFixture(invalidVersion, "0.43.0");

    assert.throws(() => readBuildMetadata(rootDir), /AKS Desktop version/);
  });
}
