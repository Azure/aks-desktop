// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openExternalUrl } from './openExternalUrl';

describe('openExternalUrl', () => {
  const originalOpen = window.open;

  beforeEach(() => {
    window.open = vi.fn() as typeof window.open;
  });

  afterEach(() => {
    window.open = originalOpen;
  });

  it('does nothing for empty URLs', () => {
    openExternalUrl('');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does nothing for invalid URLs', () => {
    openExternalUrl('not a url');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does nothing for disallowed protocols', () => {
    // eslint-disable-next-line no-script-url
    openExternalUrl('javascript:alert(1)');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does nothing for ftp protocol', () => {
    openExternalUrl('ftp://example.com/file');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('opens https URLs with window.open', () => {
    openExternalUrl('https://example.com');
    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('opens http URLs with window.open', () => {
    openExternalUrl('http://example.com');
    expect(window.open).toHaveBeenCalledWith(
      'http://example.com/',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
