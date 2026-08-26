// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => {
    cleanup();
  });

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

  it('ignores a directory lookup after a complete identifier becomes partial', async () => {
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

    fireEvent.change(input, { target: { value: 'someone' } });
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

  it('does not let a queued search override a completed identifier', async () => {
    // Typing "ada" queues a search; a later keystroke completes the UPN and
    // starts a resolve. If the queued search still fires it invalidates that
    // resolve, and the typed UPN is left without its required object ID.
    mockSearch.mockResolvedValue({ success: true, users: [] });
    let settleLookup!: (v: unknown) => void;
    mockResolve.mockReturnValue(
      new Promise(resolve => {
        settleLookup = resolve;
      })
    );
    const onChange = vi.fn();

    render(<UserSearchField value="" onChange={onChange} label="Assignee" />);
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'ada' } });
    fireEvent.change(input, { target: { value: 'ada@contoso.com' } });
    await waitFor(() => expect(mockResolve).toHaveBeenCalled());

    // Past the 350ms debounce: the queued search must never have run.
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(mockSearch).not.toHaveBeenCalled();

    settleLookup({
      success: true,
      user: {
        id: '38927c93-a0fd-4b06-b21a-69b8ed1e208c',
        userPrincipalName: 'ada@contoso.com',
        displayName: 'Ada',
      },
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ objectId: '38927c93-a0fd-4b06-b21a-69b8ed1e208c' })
      )
    );
  });
});
