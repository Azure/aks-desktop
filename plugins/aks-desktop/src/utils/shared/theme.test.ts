// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { azureTheme } from './theme';

describe('azureTheme', () => {
  it('uses explicit readable text against the secondary color', () => {
    expect(azureTheme.secondary).toBe('#ecebe9');
    expect(azureTheme.secondaryContrastText).toBe('#000000');
  });
});
