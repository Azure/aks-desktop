// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { virtual } from '@guidepup/virtual-screen-reader';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { GitHubDeviceCodePrompt } from './GitHubDeviceCodePrompt';

vi.mock('@kinvolk/headlamp-plugin/lib', async () => {
  const i18n = (await import('i18next')).default;
  const { initReactI18next, useTranslation } = await import('react-i18next');
  if (!i18n.isInitialized)
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { translation: {} } },
      interpolation: { escapeValue: false },
      returnEmptyString: false,
    });
  return { useTranslation };
});
afterEach(cleanup);

it('announces the public device code and named approval/cancel controls without private data', async () => {
  const authorization = {
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device',
    expiresAt: Date.now() + 900000,
    deviceCode: 'private-device-code',
  };
  render(<GitHubDeviceCodePrompt authorization={authorization} onCancel={() => {}} />);
  await virtual.start({ container: document.body });
  try {
    for (let step = 0; step < 50; step++) await virtual.next();
    const phrases = await virtual.spokenPhraseLog();
    expect(phrases.join(' ')).toContain('ABCD-EFGH');
    expect(phrases).toContain('button, Open GitHub');
    expect(phrases).toContain('button, Cancel');
    expect(phrases.join(' ')).not.toContain('private-device-code');
  } finally {
    await virtual.stop();
  }
});
