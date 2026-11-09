// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InsightScopeDetails from './InsightScopeDetails';

const translate = vi.hoisted(() => vi.fn((key: string) => `translated: ${key}`));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: translate }),
}));
afterEach(cleanup);

describe('scope heading translations', () => {
  it.each(['Control plane', 'Unnamed pool'])('translates the predefined %s heading', name => {
    render(<InsightScopeDetails name={name} result={{}} />);
    expect(screen.getByRole('heading', { name: `translated: ${name}` })).toBeTruthy();
    expect(translate).toHaveBeenCalledWith(name);
  });

  it('preserves actual node pool names without translating them', () => {
    render(<InsightScopeDetails name="systempool" result={{}} />);
    expect(screen.getByRole('heading', { name: 'systempool' })).toBeTruthy();
    expect(translate).not.toHaveBeenCalledWith('systempool');
  });
});
