// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { getAzCommand, getInstallationInstructions } from './az-cli-path';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Azure CLI path resolution', () => {
  test('uses the command resolved through the packaged command environment', () => {
    expect(getAzCommand()).toBe('az');
  });

  test('uses the Electron bridge for bundled-tool recovery guidance', () => {
    vi.stubGlobal('window', { desktopApi: { platform: 'win32' } });

    const instructions = getInstallationInstructions();

    expect(instructions).toContain('bundled Azure CLI');
    expect(instructions).toContain('Repair or reinstall AKS desktop');
    expect(instructions).toContain('separate system Azure CLI installation is not required');
    expect(instructions).not.toContain('install-azure-cli-linux');
  });

  test.each(['win32', 'darwin', 'linux'])('uses bundled recovery in Electron on %s', platform => {
    const instructions = getInstallationInstructions(platform, true);

    expect(instructions).toContain('bundled Azure CLI');
    expect(instructions).not.toContain(`install-azure-cli-${platform}`);
  });

  test('retains system installation guidance outside Electron', () => {
    expect(getInstallationInstructions('win32', false)).toContain('WinGet');
    expect(getInstallationInstructions('darwin', false)).toContain('Homebrew');
    expect(getInstallationInstructions('linux', false)).toContain('InstallAzureCLIDeb');
  });
});
