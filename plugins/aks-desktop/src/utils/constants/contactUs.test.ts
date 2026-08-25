// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openExternalUrl } from '../shared/openExternalUrl';
import { CONTACT_US_URL } from './contactUs';

describe('CONTACT_US_URL', () => {
  const originalOpen = window.open;

  beforeEach(() => {
    window.open = vi.fn() as typeof window.open;
  });

  afterEach(() => {
    window.open = originalOpen;
  });

  it('survives openExternalUrl validation', () => {
    // openExternalUrl returns silently for an invalid or non-http(s) URL, so a
    // typo would ship as a dead button with no error. Assert the real helper
    // actually opens it, rather than mocking the helper away.
    openExternalUrl(CONTACT_US_URL);
    expect(window.open).toHaveBeenCalledWith(CONTACT_US_URL, '_blank', 'noopener,noreferrer');
  });
});
