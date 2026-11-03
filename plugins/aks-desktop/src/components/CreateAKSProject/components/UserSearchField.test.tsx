// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolve = vi.hoisted(() => vi.fn());
const mockSearch = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/azure/az-ad', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../utils/azure/az-ad')>()),
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
        'Try searching again. If the problem continues, check your Azure sign-in.'
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

  it('clears loading when the query is shortened below two characters', () => {
    render(<UserSearchField value="" onChange={vi.fn()} label="Assignee" />);
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'alice' } });
    expect(screen.getByRole('progressbar')).toBeVisible();

    fireEvent.change(input, { target: { value: 'a' } });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('keeps an empty search result visible after loading finishes', async () => {
    mockSearch.mockResolvedValue({ success: true, users: [] });

    render(
      <UserSearchField
        value=""
        onChange={vi.fn()}
        label="Assignee"
        error
        helperText="Search for a user or remove this entry"
      />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'alice' } });

    expect(await screen.findByText('No users found')).toBeVisible();
    expect(screen.queryByText('Search for a user or remove this entry')).not.toBeInTheDocument();
  });

  it.each([
    'AADSTS530084: Access has been blocked by conditional access token protection.',
    'AADSTS50076: Multi-factor authentication is required.',
    'AADSTS65001: The user or administrator has not consented.',
    'Microsoft Graph request failed (403): Authorization_RequestDenied: Insufficient privileges.',
    'Microsoft Graph request failed (403): accessDenied: Access is denied.',
  ])('offers usable manual entry when directory search is blocked: %s', async error => {
    mockSearch.mockResolvedValue({
      success: false,
      users: [],
      error,
    });
    mockResolve.mockResolvedValue({ success: false, error });
    const onChange = vi.fn();

    render(<UserSearchField value="" onChange={onChange} label="Assignee" />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'alice' } });

    expect(await screen.findByText(/User search is not available/)).toBeVisible();
    fireEvent.mouseDown(input);
    expect(screen.getAllByText(/User search is not available/).length).toBeGreaterThan(0);
    expect(screen.queryByText('No users found')).not.toBeInTheDocument();
    expect(screen.queryByText(/User search failed\. Check/)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'alice@contoso.com' } });
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('alice@contoso.com'));
    expect(onChange).toHaveBeenLastCalledWith({
      objectId: '',
      upn: 'alice@contoso.com',
      displayName: 'alice@contoso.com',
      upnManuallyEntered: true,
    });

    const objectId = '00000000-1111-2222-3333-444444444444';
    fireEvent.change(input, { target: { value: objectId } });
    await waitFor(() => expect(mockResolve).toHaveBeenLastCalledWith(objectId));
    expect(onChange).toHaveBeenLastCalledWith({ objectId, preserveExistingUpn: true });
    expect(input).toHaveValue(objectId);
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it.each([
    'AADSTS530084: Access has been blocked by conditional access token protection.',
    'AADSTS50079: Multi-factor authentication enrollment is required.',
    'AADSTS65001: The user or administrator has not consented.',
    'Microsoft Graph request failed (403): Authorization_RequestDenied: Insufficient privileges.',
  ])('offers manual entry when complete-email resolution is blocked: %s', async error => {
    mockResolve.mockResolvedValue({
      success: false,
      error,
    });

    render(<UserSearchField value="" onChange={vi.fn()} label="Assignee" />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'alice@contoso.com' },
    });

    expect(await screen.findByText(/User search is not available/)).toBeVisible();
    expect(screen.queryByText(/Sign-in name entered/)).not.toBeInTheDocument();
    expect(screen.queryByText(/User search failed/)).not.toBeInTheDocument();
  });

  it.each([
    '38927c93-a0fd-4b06-b21a-69b8ed1e208c',
    'guest_example.com#EXT#@contoso.onmicrosoft.com',
  ])('resolves a manually entered identifier to both IDs: %s', async identifier => {
    const user = {
      id: '38927c93-a0fd-4b06-b21a-69b8ed1e208c',
      userPrincipalName: 'guest_example.com#EXT#@contoso.onmicrosoft.com',
      displayName: 'Guest User',
      mail: null,
    };
    mockResolve.mockResolvedValue({ success: true, user });
    const onChange = vi.fn();

    render(<UserSearchField value="" onChange={onChange} label="Assignee" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: identifier } });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        objectId: user.id,
        upn: user.userPrincipalName,
        displayName: user.displayName,
      })
    );
    expect(mockResolve).toHaveBeenCalledWith(identifier);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it.each([null, 'guest@example.com'])(
    'selects a guest result using its UPN rather than mail (%s)',
    async mail => {
      const user = {
        id: '38927c93-a0fd-4b06-b21a-69b8ed1e208c',
        userPrincipalName: 'guest_example.com#EXT#@contoso.onmicrosoft.com',
        displayName: 'Guest User',
        mail,
      };
      mockSearch.mockResolvedValue({ success: true, users: [user] });
      const onChange = vi.fn();

      render(<UserSearchField value="" onChange={onChange} label="Assignee" />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'guest' } });
      const option = await screen.findByRole('option');
      expect(option).toHaveTextContent(mail || user.userPrincipalName);
      fireEvent.click(option);

      expect(onChange).toHaveBeenLastCalledWith({
        objectId: user.id,
        upn: user.userPrincipalName,
        displayName: user.displayName,
      });
      expect(mockResolve).not.toHaveBeenCalled();
    }
  );

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
