// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../Logo/Logo', () => ({
  default: () => <div data-testid="aks-logo" />,
}));

import AKSClusterEmptyState from './AKSClusterEmptyState';

describe('AKSClusterEmptyState', () => {
  it('adds AKS identity without replacing the host empty-state content', () => {
    render(<AKSClusterEmptyState defaultContent={<button>Add a cluster</button>} />);

    expect(screen.getByTestId('aks-logo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a cluster' })).toBeInTheDocument();
  });
});
