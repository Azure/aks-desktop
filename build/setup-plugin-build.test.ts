import assert from "node:assert/strict";
import test from "node:test";

import { installAndBuildPlugin } from "./setup-plugin-build";

test("passes the explicit build environment to the plugin install and build command", () => {
  const calls: Array<{
    command: string;
    args: string[];
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      stdio?: string;
      encoding?: string;
      maxBuffer?: number;
    };
  }> = [];
  const environment = {
    PATH: "/example/bin",
    REACT_APP_APPINSIGHTS_CONNECTION_STRING: "synthetic-override",
    REACT_APP_AKS_DESKTOP_VERSION: "1.2.3",
    REACT_APP_HEADLAMP_VERSION: "0.43.0",
  };

  installAndBuildPlugin(
    "/repo/plugins/aks-desktop",
    environment,
    (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "", stderr: "" };
    }
  );

  assert.deepEqual(calls, [
    {
      command: "npm",
      args: ["install"],
      options: {
        cwd: "/repo/plugins/aks-desktop",
        env: environment,
        stdio: "pipe",
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    },
    {
      command: "npm",
      args: ["run", "build"],
      options: {
        cwd: "/repo/plugins/aks-desktop",
        env: environment,
        stdio: "pipe",
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    },
  ]);
});

test("preserves the connection-string override without echoing its value", () => {
  const syntheticConnectionString = "synthetic-sensitive-connection-string";
  const output: string[] = [];
  const environment = {
    REACT_APP_APPINSIGHTS_CONNECTION_STRING: syntheticConnectionString,
    REACT_APP_AKS_DESKTOP_VERSION: "1.2.3",
    REACT_APP_HEADLAMP_VERSION: "0.43.0",
  };
  let receivedEnvironment: NodeJS.ProcessEnv | undefined;

  installAndBuildPlugin(
    "/repo/plugins/aks-desktop",
    environment,
    (_command, _args, options) => {
      receivedEnvironment = options.env;
      return {
        status: 0,
        stdout: `Injecting env var: REACT_APP_APPINSIGHTS_CONNECTION_STRING = "${syntheticConnectionString}"\n`,
        stderr: `diagnostic ${syntheticConnectionString}\n`,
      };
    },
    {
      stdout: (value) => output.push(value),
      stderr: (value) => output.push(value),
    }
  );

  assert.equal(
    receivedEnvironment?.REACT_APP_APPINSIGHTS_CONNECTION_STRING,
    syntheticConnectionString
  );
  assert.doesNotMatch(output.join(""), new RegExp(syntheticConnectionString));
  assert.match(output.join(""), /\[redacted\]/);
});

test("uses npm_execpath when available for cross-platform npm invocation", () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  installAndBuildPlugin(
    "/repo/plugins/aks-desktop",
    { npm_execpath: "/tools/npm-cli.js" },
    (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "", stderr: "" };
    }
  );

  assert.deepEqual(calls, [
    {
      command: process.execPath,
      args: ["/tools/npm-cli.js", "install"],
    },
    {
      command: process.execPath,
      args: ["/tools/npm-cli.js", "run", "build"],
    },
  ]);
});

test("supports verbose output larger than two MiB with redaction", () => {
  const syntheticConnectionString = "synthetic-large-output-secret";
  const largePrefix = "x".repeat(2 * 1024 * 1024 + 1);
  const output: string[] = [];

  installAndBuildPlugin(
    "/repo/plugins/aks-desktop",
    { REACT_APP_APPINSIGHTS_CONNECTION_STRING: syntheticConnectionString },
    (_command, _args, options) => {
      assert.ok(
        (options.maxBuffer ?? 0) > largePrefix.length,
        "capture limit must exceed normal multi-megabyte output"
      );
      return {
        status: 0,
        stdout: `${largePrefix}${syntheticConnectionString}`,
        stderr: "",
      };
    },
    {
      stdout: (value) => output.push(value),
      stderr: (value) => output.push(value),
    }
  );

  assert.ok(output.join("").length > 2 * 1024 * 1024);
  assert.doesNotMatch(output.join(""), new RegExp(syntheticConnectionString));
  assert.match(output.join(""), /\[redacted\]$/);
});

test("reports child start errors without leaking the connection string", () => {
  const syntheticConnectionString = "synthetic-start-error-secret";

  assert.throws(
    () =>
      installAndBuildPlugin(
        "/repo/plugins/aks-desktop",
        { REACT_APP_APPINSIGHTS_CONNECTION_STRING: syntheticConnectionString },
        () => ({
          error: new Error(`failed near ${syntheticConnectionString}`),
          status: null,
          stdout: "",
          stderr: "",
        })
      ),
    (error) =>
      error instanceof Error &&
      /failed to start/.test(error.message) &&
      /\[redacted\]/.test(error.message) &&
      !error.message.includes(syntheticConnectionString)
  );
});

test("reports terminating signals", () => {
  assert.throws(
    () =>
      installAndBuildPlugin("/repo/plugins/aks-desktop", {}, () => ({
        signal: "SIGTERM",
        status: null,
        stdout: "",
        stderr: "",
      })),
    /terminated by signal SIGTERM/
  );
});
