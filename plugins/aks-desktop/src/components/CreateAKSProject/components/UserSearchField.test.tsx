// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolve = vi.hoisted(() => vi.fn());
const mockSearch = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/azure/az-ad', () => ({
  isAzureADLookupUnavailable: (error?: string) =>
    error?.includes('AADSTS530084') || error?.includes('Authorization_RequestDenied') || false,
  resolveAzureADUser: mockResolve,
  searchAzureADUsers: mockSearch,
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

import { UserSearchField } from './UserSearchField';

function ControlledUserSearchField() {
  const [value, setValue] = useState('');
  return (
    <UserSearchField
      value={value}
      onChange={selection => setValue(selection.objectId)}
      label="Assignee"
    />
  );
}

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

  it('surfaces a directory lookup failure instead of presenting an empty result', async () => {
    mockSearch.mockResolvedValue({ success: false, users: [], error: 'ERROR: lookup failed' });

    render(<UserSearchField value="" onChange={vi.fn()} label="Assignee" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'alice' } });

    expect(
      await screen.findByText(
        'User search failed. Check your Azure sign-in and try again, or enter the sign-in name or object ID directly.'
      )
    ).toBeVisible();
    expect(screen.queryByText('No users found')).not.toBeInTheDocument();
  });

  it('does not report an empty result before the debounced search completes', () => {
    mockSearch.mockReturnValue(new Promise(() => {}));

    render(<UserSearchField value="" onChange={vi.fn()} label="Assignee" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'alice' } });

    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText('No users found')).not.toBeInTheDocument();
  });

  it('keeps an empty search result visible after loading finishes', async () => {
    mockSearch.mockResolvedValue({ success: true, users: [] });

    render(<UserSearchField value="" onChange={vi.fn()} label="Assignee" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'alice' } });

    expect(await screen.findByText('No users found')).toBeVisible();
  });

  it('offers manual entry when Conditional Access blocks directory search', async () => {
    mockSearch.mockResolvedValue({
      success: false,
      users: [],
      error: 'AADSTS530084: Access has been blocked by conditional access token protection.',
    });

    render(<UserSearchField value="" onChange={vi.fn()} label="Assignee" />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'alice' } });

    expect(await screen.findByText(/User search is not available/)).toBeVisible();
    fireEvent.mouseDown(input);
    expect(screen.getAllByText(/User search is not available/).length).toBeGreaterThan(0);
    expect(screen.queryByText('No users found')).not.toBeInTheDocument();
    expect(screen.queryByText(/User search failed\. Check/)).not.toBeInTheDocument();
  });

  it('offers manual entry when Conditional Access blocks complete-email resolution', async () => {
    mockResolve.mockResolvedValue({
      success: false,
      error: 'AADSTS530084: Access has been blocked by conditional access token protection.',
    });

    render(<UserSearchField value="" onChange={vi.fn()} label="Assignee" />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'alice@contoso.com' },
    });

    expect(await screen.findByText(/User search is not available/)).toBeVisible();
    expect(screen.queryByText(/Sign-in name entered/)).not.toBeInTheDocument();
    expect(screen.queryByText(/User search failed/)).not.toBeInTheDocument();
  });

  it('keeps a sign-in name as partial input when directory resolution fails', async () => {
    mockResolve.mockResolvedValue({ success: false, error: 'Failed to resolve Azure AD user' });

    render(<UserSearchField value="" onChange={vi.fn()} label="Assignee" />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'alice@contoso.com' },
    });

    expect(screen.queryByText(/Sign-in name entered/)).not.toBeInTheDocument();
    expect(screen.queryByText(/User search failed/)).not.toBeInTheDocument();
  });

  it('keeps a manually entered object ID without showing an optional resolution failure', async () => {
    mockResolve.mockResolvedValue({
      success: false,
      error: 'Failed to resolve Azure AD user',
    });
    const objectId = '00000000-1111-2222-3333-444444444444';

    render(<ControlledUserSearchField />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: objectId } });

    expect(input).toHaveValue(objectId);
    expect(await screen.findByText('Object ID entered')).toBeVisible();
    expect(screen.queryByText('No users found')).not.toBeInTheDocument();
    expect(screen.queryByText(/User search failed/)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '0000' } });

    expect(input).toHaveValue('0000');
    expect(screen.queryByText('Object ID entered')).not.toBeInTheDocument();
  });
});
