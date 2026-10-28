// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const { resolveInstalledHeadlampPaths } = require(path.join(
  ROOT_DIR,
  'packages/headlamp-source/src/lib/paths.ts'
));
const { reserveReadinessPort, resolvePackagedExecutable } = require(path.join(
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
let page: Page;
let profile: string;
let pageErrors: string[];

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
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ],
    env,
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
  await expect(logos).toHaveCount(enabled ? 2 : 0);
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
      console.error('Packaged theme diagnostics:', {
        url: page.url().split('?')[0],
        pageErrors,
        body: (await page.locator('body').innerText()).slice(0, 4000),
      });
      await testInfo.attach('packaged-theme', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  } finally {
    try {
      await app?.close();
    } finally {
      // Windows CLI subprocesses can release their log handles after Electron exits.
      await fs.promises.rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
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

  await app.close();
  await launch();
  await expectBranding(true);
  await expectTheme('Dark', 'rgb(37, 36, 35)');
});
