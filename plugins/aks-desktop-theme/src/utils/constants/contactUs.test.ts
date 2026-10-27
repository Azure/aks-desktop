// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { CONTACT_US_URL } from './contactUs';

describe('CONTACT_US_URL', () => {
  it('uses an absolute HTTPS feedback URL', () => {
    const url = new URL(CONTACT_US_URL);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('aka.ms');
    expect(url.pathname).toBe('/aks-desktop/feedback');
  });
});
