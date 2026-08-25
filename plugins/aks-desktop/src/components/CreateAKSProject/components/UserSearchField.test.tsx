// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolve = vi.hoisted(() => vi.fn());
const mockSearch = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/azure/az-ad', () => ({
  resolveAzureADUser: mockResolve,
  searchAzureADUsers: mockSearch,
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

import { UserSearchField } from './UserSearchField';

describe('UserSearchField — clearing the field', () => {
  beforeEach(() => {
    mockResolve.mockReset();
    mockSearch.mockReset().mockResolvedValue({ success: true, users: [] });
  });

  it('ignores a directory lookup that lands after the field was cleared', async () => {
    // Typing a complete UPN kicks off a lookup to fill in the object ID. If the
    // user clears the field before it lands, the late result must not put the
    // assignee back.
    let settleLookup!: (v: unknown) => void;
    mockResolve.mockReturnValue(
      new Promise(resolve => {
        settleLookup = resolve;
      })
    );
    const onChange = vi.fn();

    render(<UserSearchField value="" onChange={onChange} label="Assignee" />);
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'someone@contoso.com' } });
    await waitFor(() => expect(mockResolve).toHaveBeenCalled());

    fireEvent.change(input, { target: { value: '' } });
    onChange.mockClear();

    settleLookup({
      success: true,
      user: {
        id: '38927c93-a0fd-4b06-b21a-69b8ed1e208c',
        userPrincipalName: 'someone@contoso.com',
        displayName: 'Someone',
      },
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onChange).not.toHaveBeenCalled();
  });
});
