// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { _electron, type ElectronApplication, expect, type Page, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const { resolveInstalledHeadlampPaths } = require(path.join(
  ROOT_DIR,
  'packages/headlamp-source/src/lib/paths.ts'
));
const { reserveReadinessPort, resolvePackagedExecutable, terminateProcessTree } = require(path.join(
  ROOT_DIR,
  'packages/headlamp-source/src/lib/smoke-app.ts'
));
const project = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const executable =
  process.env.AKS_DESKTOP_EXECUTABLE ||
  resolvePackagedExecutable(
    path.join(resolveInstalledHeadlampPaths(ROOT_DIR).appDir, 'dist'),
    project.headlamp
  );

let app: ElectronApplication;
let applicationProcess: ChildProcess | undefined;
let page: Page;
let profile: string;
let pageErrors: string[];
let applicationOutput: string[] = [];

const MAX_OUTPUT_LINES = 500;
const RELEASE_TIMEOUT_MS = 5_000;

/**
 * Keeps the latest output lines of the launched application, with timestamps, for diagnostics.
 *
 * @param stream - The name of the stream the listener reads.
 * @returns A `data` listener for that stream.
 */
function recordOutput(stream: 'stdout' | 'stderr') {
  return (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line) applicationOutput.push(`${new Date().toISOString()} ${stream} ${line}`);
    }
    applicationOutput.splice(0, applicationOutput.length - MAX_OUTPUT_LINES);
  };
}

/**
 * Settles with `promise`, or rejects with a timeout error after `timeout` milliseconds.
 *
 * @param promise - The operation to wait for.
 * @param timeout - How long to wait, in milliseconds.
 * @param operation - What is being waited for, used in the timeout error.
 * @returns The promise's result.
 */
async function withTimeout<T>(promise: Promise<T>, timeout: number, operation: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timeout ${timeout}ms exceeded waiting for ${operation}`)),
          timeout
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quits the packaged application through Electron and waits for its main process to exit.
 *
 * Playwright's `ElectronApplication.close()` closes its debugger connection to the main process
 * while the application is still quitting, and then waits until every stdio pipe the application
 * inherited is closed, which a helper process left behind by an abnormal exit can prevent. Quit
 * first, wait for the process to exit, and only then release Playwright's connection, for a bounded
 * time. A process that does not exit cleanly, or a release that does not finish in time, fails with
 * the application's latest output attached to the test.
 *
 * @param timeout - How long to wait for the main process to exit, in milliseconds.
 */
async function closeApplication(timeout = 30_000) {
  const application = app;
  const child = applicationProcess;
  applicationProcess = undefined;
  if (!child) return;
  const running = () => child.exitCode === null && child.signalCode === null;
  let failure: unknown;
  try {
    if (running()) {
      const exited = once(child, 'exit');
      exited.catch(() => undefined);
      // Start the deadline without waiting for the call: it does not return while a quit handler
      // blocks the main process, and it loses its connection when the application exits first.
      void application.evaluate(({ app }) => app.quit()).catch(() => undefined);
      await withTimeout(exited, timeout, 'the packaged application to exit');
    }
    if (child.exitCode !== 0) {
      throw new Error(`Packaged application exited with ${child.exitCode ?? child.signalCode}`);
    }
  } catch (error) {
    failure = error;
    if (running()) {
      await terminateProcessTree(child);
    }
  }
  try {
    await withTimeout(
      application.close(),
      RELEASE_TIMEOUT_MS,
      'Playwright to release the packaged application'
    );
  } catch (error) {
    // A process the application left behind can hold its output pipes open after the main process
    // exits, when the main process ID no longer identifies it. Close this side of the pipes instead.
    failure ??= error;
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  if (failure !== undefined) {
    await test.info().attach('packaged-application-output', {
      body: applicationOutput.join('\n'),
      contentType: 'text/plain',
    });
    throw failure;
  }
}

async function launch() {
  const { port, release } = await reserveReadinessPort();
  await release();
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    ),
    HOME: profile,
    APPDATA: profile,
    LOCALAPPDATA: profile,
    XDG_CONFIG_HOME: profile,
    AZURE_CONFIG_DIR: path.join(profile, 'azure'),
    AZURE_CORE_COLLECT_TELEMETRY: '0',
    KUBECONFIG: path.join(profile, 'config'),
    LANG: 'en_US.UTF-8',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_DEV;
  delete env.ELECTRON_START_URL;
  delete env.EXTERNAL_SERVER;
  delete env.HEADLAMP_BUILD_MANIFEST;
  app = await _electron.launch({
    timeout: 30_000,
    executablePath: executable,
    args: [
      `--user-data-dir=${path.join(profile, 'electron')}`,
      `--port=${port}`,
      ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ],
    env,
  });
  const appProcess = app.process();
  applicationProcess = appProcess;
  applicationOutput = [];
  appProcess.stdout?.on('data', recordOutput('stdout'));
  appProcess.stderr?.on('data', recordOutput('stderr'));
  appProcess.once('exit', (code, signal) => {
    console.info('Packaged theme process exited:', {
      pid: appProcess.pid,
      code,
      signal,
    });
  });
  appProcess.once('close', (code, signal) => {
    console.info('Packaged theme process stdio closed:', {
      pid: appProcess.pid,
      code,
      signal,
    });
  });
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByRole('navigation', { name: 'Appbar Tools' })).toBeVisible();
}

async function navigate(route: string) {
  await page.goto(`${page.url().split('#')[0]}#${route}`);
}

async function expectTheme(name: string, navbar: string) {
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('cached-current-theme') || 'null')?.name)
    )
    .toBe(name);
  await expect(page.getByRole('navigation', { name: 'Appbar Tools' })).toHaveCSS(
    'background-color',
    navbar
  );
}

async function expectBranding(enabled: boolean) {
  await navigate('/');
  const logos = page.getByLabel('AKS desktop logo', { exact: true });
  await expect(logos).toHaveCount(enabled ? 1 : 0);
  await expect(page.locator('#main').getByLabel('AKS desktop logo', { exact: true })).toHaveCount(
    0
  );
  await expect(page.getByText('No clusters found', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Contact us', exact: true })).toHaveCount(
    enabled ? 1 : 0
  );
  if (!enabled) {
    await expect(
      page.getByRole('navigation', { name: 'Appbar Tools' }).locator('svg').first()
    ).toHaveAttribute('viewBox', '0 0 184 38');
  }
  await expect(
    page.locator('#main').getByRole('button', { name: 'Add Cluster', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Azure Account', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(({ Menu }) => {
        const menu = Menu.getApplicationMenu();
        return {
          aksDocs: !!menu?.getMenuItemById('aks-documentation'),
          aksContact: !!menu?.getMenuItemById('aks-contact-us'),
          headlampDocs: !!menu?.getMenuItemById('original-documentation'),
          headlampIssues: !!menu?.getMenuItemById('original-open-issue'),
        };
      })
    )
    .toEqual({
      aksDocs: enabled,
      aksContact: enabled,
      headlampDocs: !enabled,
      headlampIssues: !enabled,
    });
}

async function toggleTheme(enabled: boolean) {
  await navigate('/settings/plugins');
  const checkbox = (name: string) =>
    page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name, exact: true }) })
      .getByRole('checkbox');
  const functional = checkbox('aks-desktop');
  await expect(functional).toBeChecked();
  const toggle = checkbox('aks-desktop-theme');
  await toggle.setChecked(enabled);
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Save & Apply', exact: true }).click(),
  ]);
  await expect(checkbox('aks-desktop-theme')).toBeChecked({ checked: enabled });
  await expect(checkbox('aks-desktop')).toBeChecked();
}

test.beforeEach(async () => {
  pageErrors = [];
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-packaged-theme-'));
  fs.writeFileSync(
    path.join(profile, 'config'),
    'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n'
  );
  await launch();
});

test.afterEach(async ({}, testInfo) => {
  try {
    if (page && !page.isClosed() && testInfo.status !== testInfo.expectedStatus) {
      await test.step('Capture packaged theme failure diagnostics', async () => {
        console.error('Packaged theme diagnostics:', {
          url: page.url().split('?')[0],
          pageErrors,
          body: (await page.locator('body').innerText()).slice(0, 4000),
        });
        await testInfo.attach('packaged-theme', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      });
    }
  } finally {
    try {
      await test.step('Close packaged theme application', async () => {
        await closeApplication();
      });
    } finally {
      await test.step('Remove packaged theme profile', async () => {
        // Windows CLI subprocesses can release their log handles after Electron exits.
        await fs.promises.rm(profile, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      });
    }
  }
});

test('restores Headlamp branding on disable/reload and AKS branding on re-enable', async () => {
  await expectTheme('Azure Theme', 'rgb(0, 22, 101)');
  await expectBranding(true);
  await toggleTheme(false);
  await expectTheme('Light', 'rgb(240, 240, 240)');
  await expectBranding(false);

  await toggleTheme(true);
  await expectBranding(true);
  await expectTheme('Light', 'rgb(240, 240, 240)');
  await navigate('/settings/general');
  await page.getByRole('button', { name: 'Azure Theme', exact: true }).click();
  await expectTheme('Azure Theme', 'rgb(0, 22, 101)');
});

test('preserves an explicit user theme across disable, re-enable and app restart', async () => {
  await expectBranding(true);
  await navigate('/settings/general');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expectTheme('Dark', 'rgb(37, 36, 35)');

  await toggleTheme(false);
  await expectBranding(false);
  await expectTheme('Dark', 'rgb(37, 36, 35)');
  await toggleTheme(true);
  await expectBranding(true);
  await expectTheme('Dark', 'rgb(37, 36, 35)');

  await test.step('Close packaged theme application before restart', async () => {
    await closeApplication();
  });
  await launch();
  await expectBranding(true);
  await expectTheme('Dark', 'rgb(37, 36, 35)');
});

test('reports a blocked normal quit and cleans up its owned process tree', async () => {
  const child = app.process();
  await app.evaluate(({ app }) => {
    app.on('before-quit', (event: { preventDefault(): void }) => event.preventDefault());
  });
  await expect(closeApplication(5_000)).rejects.toThrow('Timeout 5000ms exceeded');
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
});
