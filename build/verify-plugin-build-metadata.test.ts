import assert from "node:assert/strict";
import test from "node:test";

import { verifyPluginBundleMetadata } from "./verify-plugin-build-metadata";

const metadata = {
  aksDesktopVersion: "1.2.3-beta.4",
  headlampVersion: "0.43.0",
};

test("accepts a bundle containing both expected release versions", () => {
  const bundle = `appVersion:"${metadata.aksDesktopVersion}",headlampVersion:"${metadata.headlampVersion}"`;

  assert.doesNotThrow(() => verifyPluginBundleMetadata(bundle, metadata));
});

test("accepts the production minified shape with hoisted version constants", () => {
  const bundle = `const wR="${metadata.aksDesktopVersion}",SR="${metadata.headlampVersion}";function DR(){return{sessionProps:{appVersion:wR,headlampVersion:SR,locale:"en-US"}}}`;

  assert.doesNotThrow(() => verifyPluginBundleMetadata(bundle, metadata));
});

test("fails when the AKS Desktop version is absent", () => {
  const bundle = `appVersion:"other",headlampVersion:"${metadata.headlampVersion}"`;

  assert.throws(
    () => verifyPluginBundleMetadata(bundle, metadata),
    /AKS Desktop version.*missing/
  );
});

test("fails when the Headlamp version is absent", () => {
  const bundle = `appVersion:"${metadata.aksDesktopVersion}",headlampVersion:"other"`;

  assert.throws(
    () => verifyPluginBundleMetadata(bundle, metadata),
    /Headlamp version.*missing/
  );
});

test("does not match metadata names embedded in longer property names", () => {
  const bundle = `myappVersion:"${metadata.aksDesktopVersion}",myheadlampVersion:"${metadata.headlampVersion}"`;

  assert.throws(
    () => verifyPluginBundleMetadata(bundle, metadata),
    /AKS Desktop version.*missing/
  );
});

test("fails when either telemetry version uses the unknown fallback", () => {
  assert.throws(
    () =>
      verifyPluginBundleMetadata(
        `appVersion:"unknown",headlampVersion:"${metadata.headlampVersion}",release:"${metadata.aksDesktopVersion}"`,
        metadata
      ),
    /AKS Desktop version.*unknown/
  );
  assert.throws(
    () =>
      verifyPluginBundleMetadata(
        `appVersion:"${metadata.aksDesktopVersion}",headlampVersion:"unknown",release:"${metadata.headlampVersion}"`,
        metadata
      ),
    /Headlamp version.*unknown/
  );
});

test("fails when either telemetry version is empty", () => {
  assert.throws(
    () =>
      verifyPluginBundleMetadata(
        `appVersion:"",headlampVersion:"${metadata.headlampVersion}",release:"${metadata.aksDesktopVersion}"`,
        metadata
      ),
    /AKS Desktop version.*empty/
  );
  assert.throws(
    () =>
      verifyPluginBundleMetadata(
        `appVersion:"${metadata.aksDesktopVersion}",headlampVersion:"",release:"${metadata.headlampVersion}"`,
        metadata
      ),
    /Headlamp version.*empty/
  );
});

for (const invalidVersion of ["", " ", "unknown"]) {
  test(`fails when expected metadata contains ${JSON.stringify(
    invalidVersion
  )}`, () => {
    assert.throws(
      () =>
        verifyPluginBundleMetadata("irrelevant", {
          aksDesktopVersion: invalidVersion,
          headlampVersion: metadata.headlampVersion,
        }),
      /AKS Desktop version/
    );
  });
}
