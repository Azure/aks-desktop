// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isAzCliInstalled: vi.fn(),
  initiateCliLogin: vi.fn(),
  allowAzureCliFallback: vi.fn(),
  logoutNative: vi.fn(),
  getNativeAuthGeneration: vi.fn(),
  allowCliOperations: vi.fn(),
  blockCliOperations: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock('../../utils/azure/az-cli-core', () => ({
  isAzCliInstalled: mocks.isAzCliInstalled,
  allowCliOperations: mocks.allowCliOperations,
  blockCliOperations: mocks.blockCliOperations,
}));
vi.mock('../../utils/azure/az-auth', () => ({ initiateCliLogin: mocks.initiateCliLogin }));
vi.mock('../../utils/azure/native-auth', () => ({
  allowAzureCliFallback: mocks.allowAzureCliFallback,
  logoutNative: mocks.logoutNative,
  getNativeAuthGeneration: mocks.getNativeAuthGeneration,
}));

import CliLoginStep from './CliLoginStep';

describe('CliLoginStep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isAzCliInstalled.mockResolvedValue(true);
    mocks.logoutNative.mockResolvedValue(true);
  });
  afterEach(cleanup);

  test('continues without prompting when CLI is unavailable', async () => {
    mocks.isAzCliInstalled.mockResolvedValue(false);
    const onContinue = vi.fn();
    render(<CliLoginStep onContinue={onContinue} />);
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(mocks.initiateCliLogin).not.toHaveBeenCalled();
    expect(mocks.blockCliOperations).toHaveBeenCalled();
    expect(mocks.allowCliOperations).not.toHaveBeenCalled();
  });

  test('starts optional CLI login only after explicit consent and waits before continuing', async () => {
    let resolve!: (result: { success: boolean; message: string }) => void;
    mocks.initiateCliLogin.mockReturnValue(new Promise(r => (resolve = r)));
    const onContinue = vi.fn();
    render(
      <React.StrictMode>
        <CliLoginStep onContinue={onContinue} />
      </React.StrictMode>
    );
    const signIn = await screen.findByRole('button', { name: 'Sign in to Azure CLI' });
    expect(mocks.initiateCliLogin).not.toHaveBeenCalled();
    fireEvent.click(signIn);
    await screen.findByRole('status');
    expect(mocks.initiateCliLogin).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => resolve({ success: true, message: 'done' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(mocks.allowCliOperations).toHaveBeenCalledOnce();
  });

  test('shows failure, permits retry and offers native-only continuation', async () => {
    mocks.initiateCliLogin.mockResolvedValue({ success: false, message: 'Failed' });
    const onContinue = vi.fn();
    render(<CliLoginStep onContinue={onContinue} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to Azure CLI' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Failed');
    expect(screen.getByText(/will not change your Azure CLI cloud/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Azure CLI sign-in' }));
    await waitFor(() => expect(mocks.initiateCliLogin).toHaveBeenCalledTimes(2));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Continue without Azure CLI' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  test('ignores a completion after unmount', async () => {
    let resolve!: (result: { success: boolean; message: string }) => void;
    mocks.initiateCliLogin.mockReturnValue(new Promise(r => (resolve = r)));
    const onContinue = vi.fn();
    const rendered = render(<CliLoginStep onContinue={onContinue} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to Azure CLI' }));
    await screen.findByRole('status');
    rendered.unmount();
    await act(async () => resolve({ success: true, message: 'done' }));
    expect(onContinue).not.toHaveBeenCalled();
  });

  test('continues only once when CLI login finishes after skipping', async () => {
    let resolve!: (result: { success: boolean; message: string }) => void;
    mocks.initiateCliLogin.mockReturnValue(new Promise(r => (resolve = r)));
    const onContinue = vi.fn();
    render(<CliLoginStep onContinue={onContinue} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to Azure CLI' }));
    await screen.findByRole('status');
    expect(screen.getByText(/may change the CLI account after you leave/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue without waiting for Azure CLI' }));
    expect(mocks.blockCliOperations).toHaveBeenCalledTimes(2);
    await act(async () => resolve({ success: true, message: 'done' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(mocks.allowCliOperations).not.toHaveBeenCalled();
  });

  test('skips an available optional CLI without launching login', async () => {
    const onContinue = vi.fn();
    render(<CliLoginStep onContinue={onContinue} />);
    await screen.findByRole('button', { name: 'Sign in to Azure CLI' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue without Azure CLI' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(mocks.initiateCliLogin).not.toHaveBeenCalled();
    expect(mocks.allowCliOperations).not.toHaveBeenCalled();
  });

  test('CLI-only mode requires successful sign-in before enabling fallback', async () => {
    mocks.initiateCliLogin.mockResolvedValue({ success: true, message: 'done' });
    const onContinue = vi.fn();
    render(<CliLoginStep nativeAuthenticated={false} onContinue={onContinue} />);
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(mocks.logoutNative).toHaveBeenCalledOnce();
    expect(mocks.allowAzureCliFallback).toHaveBeenCalledOnce();
  });

  test('CLI-only mode reports native cleanup failures without starting the CLI', async () => {
    mocks.logoutNative.mockRejectedValue(new Error('cleanup failed'));
    const onContinue = vi.fn();
    render(<CliLoginStep nativeAuthenticated={false} onContinue={onContinue} />);

    expect((await screen.findByRole('alert')).textContent).toContain('cleanup failed');
    expect(mocks.initiateCliLogin).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry Azure CLI sign-in' })).toBeTruthy();
  });

  test('CLI-only mode stops when the sign-out policy cannot be saved', async () => {
    mocks.logoutNative.mockResolvedValue(false);
    const onContinue = vi.fn();
    render(<CliLoginStep nativeAuthenticated={false} onContinue={onContinue} />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'sign-out policy could not be saved'
    );
    expect(mocks.initiateCliLogin).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry Azure CLI sign-in' })).toBeTruthy();
  });

  test('does not start an uncancellable CLI login after leaving during native cleanup', async () => {
    let resolveCleanup!: () => void;
    mocks.logoutNative.mockReturnValue(new Promise<void>(resolve => (resolveCleanup = resolve)));
    const onBack = vi.fn();
    render(<CliLoginStep nativeAuthenticated={false} onContinue={vi.fn()} onBack={onBack} />);
    await screen.findByRole('status');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await act(async () => resolveCleanup());

    expect(onBack).toHaveBeenCalledOnce();
    expect(mocks.initiateCliLogin).not.toHaveBeenCalled();
  });

  test('CLI-only mode does not continue without the CLI', async () => {
    mocks.isAzCliInstalled.mockResolvedValue(false);
    const onContinue = vi.fn();
    const onBack = vi.fn();
    render(<CliLoginStep nativeAuthenticated={false} onContinue={onContinue} onBack={onBack} />);
    expect((await screen.findByRole('alert')).textContent).toContain('not available');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
    expect(mocks.logoutNative).not.toHaveBeenCalled();
    expect(mocks.allowAzureCliFallback).not.toHaveBeenCalled();
  });

  test('does not re-enable CLI fallback when returning during an in-flight sign-in', async () => {
    let resolve!: (result: { success: boolean; message: string }) => void;
    mocks.initiateCliLogin.mockReturnValue(new Promise(r => (resolve = r)));
    const onContinue = vi.fn();
    const onBack = vi.fn();
    render(<CliLoginStep nativeAuthenticated={false} onContinue={onContinue} onBack={onBack} />);
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await act(async () => resolve({ success: true, message: 'done' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
    expect(mocks.logoutNative).toHaveBeenCalledOnce();
    expect(mocks.allowAzureCliFallback).not.toHaveBeenCalled();
    expect(mocks.allowCliOperations).not.toHaveBeenCalled();
  });

  test('does not approve a CLI login for a different native session', async () => {
    let resolve!: (result: { success: boolean; message: string }) => void;
    mocks.getNativeAuthGeneration.mockReturnValueOnce(1).mockReturnValueOnce(2);
    mocks.initiateCliLogin.mockReturnValue(new Promise(r => (resolve = r)));
    const onContinue = vi.fn();
    render(<CliLoginStep onContinue={onContinue} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to Azure CLI' }));
    await screen.findByRole('status');
    await act(async () => resolve({ success: true, message: 'done' }));
    expect((await screen.findByRole('alert')).textContent).toContain('account changed');
    expect(onContinue).not.toHaveBeenCalled();
    expect(mocks.allowCliOperations).not.toHaveBeenCalled();
  });
});
