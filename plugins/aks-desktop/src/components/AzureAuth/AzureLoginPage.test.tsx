// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockPush = vi.hoisted(() => vi.fn());
const mockGetLoginStatus = vi.hoisted(() => vi.fn());
const mockInitiateLogin = vi.hoisted(() => vi.fn());
const mockTrackFeature = vi.hoisted(() => vi.fn());
const mockTrackError = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockPush }),
  useLocation: () => ({ search: '' }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? Object.entries(params).reduce(
            (result, [name, value]) => result.replace(`{{${name}}}`, value),
            key
          )
        : key,
  }),
}));

vi.mock('../../utils/azure/az-auth', () => ({
  getLoginStatus: mockGetLoginStatus,
  initiateLogin: mockInitiateLogin,
}));

vi.mock('../../utils/constants/timing', () => ({
  LOGIN_POLL_INTERVAL_MS: 100,
  LOGIN_REDIRECT_DELAY_MS: 10,
  LOGIN_TIMEOUT_MS: 300,
}));

vi.mock('../../telemetry', () => ({
  trackFeature: mockTrackFeature,
  trackError: mockTrackError,
}));

vi.mock('@iconify/react', () => ({ Icon: () => <span /> }));

import AzureLoginPage from './AzureLoginPage';

describe('AzureLoginPage telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockTrackFeature.mockImplementation(() => {});
    mockTrackError.mockImplementation(() => {});
    mockGetLoginStatus.mockResolvedValue({ isLoggedIn: false });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderReady() {
    const view = render(<AzureLoginPage />);
    await waitFor(() => expect(screen.getByText('Sign in with Azure')).toBeInTheDocument());
    return view;
  }

  test('tracks exactly one opened event across rerenders', async () => {
    const { rerender } = await renderReady();

    rerender(<AzureLoginPage redirectTo="/projects" />);
    rerender(<AzureLoginPage redirectTo="/settings" />);

    expect(mockTrackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.azure-login', status: 'opened' }],
    ]);
    expect(mockTrackError).not.toHaveBeenCalled();
  });

  test('tracks ordered login success once and stops polling', async () => {
    mockInitiateLogin.mockResolvedValue({ success: true });
    mockGetLoginStatus
      .mockResolvedValueOnce({ isLoggedIn: false })
      .mockResolvedValueOnce({ isLoggedIn: true });

    await renderReady();
    fireEvent.click(screen.getByText('Sign in with Azure'));
    await act(async () => vi.advanceTimersByTimeAsync(110));
    await act(async () => vi.advanceTimersByTimeAsync(20));
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(mockTrackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.azure-login', status: 'opened' }],
      [{ feature: 'aksd.azure-login', status: 'started' }],
      [{ feature: 'aksd.azure-login', status: 'succeeded' }],
    ]);
    expect(mockTrackError).not.toHaveBeenCalled();
    expect(mockGetLoginStatus).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/azure/profile');
  });

  test('tracks exactly one timeout when polling never completes', async () => {
    mockInitiateLogin.mockResolvedValue({ success: true });

    await renderReady();
    fireEvent.click(screen.getByText('Sign in with Azure'));
    await act(async () => vi.advanceTimersByTimeAsync(310));
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(mockTrackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.azure-login', status: 'opened' }],
      [{ feature: 'aksd.azure-login', status: 'started' }],
      [{ feature: 'aksd.azure-login', status: 'failed' }],
    ]);
    expect(mockTrackError.mock.calls).toEqual([
      [{ area: 'azure-login', errorClass: 'TimeoutError', phase: 'failed' }],
    ]);
    expect(mockGetLoginStatus).toHaveBeenCalledTimes(4);
  });

  test('repeated polling rejections terminate at max attempts with one timeout', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    mockInitiateLogin.mockResolvedValue({ success: true });
    mockGetLoginStatus
      .mockResolvedValueOnce({ isLoggedIn: false })
      .mockRejectedValueOnce(new Error('poll one'))
      .mockRejectedValueOnce(new Error('poll two'))
      .mockRejectedValueOnce(new Error('poll three'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await renderReady();
    fireEvent.click(screen.getByText('Sign in with Azure'));
    await act(async () => vi.advanceTimersByTimeAsync(310));
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(mockTrackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.azure-login', status: 'opened' }],
      [{ feature: 'aksd.azure-login', status: 'started' }],
      [{ feature: 'aksd.azure-login', status: 'failed' }],
    ]);
    expect(mockTrackError.mock.calls).toEqual([
      [{ area: 'azure-login', errorClass: 'TimeoutError', phase: 'failed' }],
    ]);
    expect(mockGetLoginStatus).toHaveBeenCalledTimes(4);
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(screen.getByText('Login timeout. Please try again.')).toBeInTheDocument();
  });

  test('cancellation stops polling and emits no later terminal event', async () => {
    mockInitiateLogin.mockResolvedValue({ success: true });

    await renderReady();
    fireEvent.click(screen.getByText('Sign in with Azure'));
    await waitFor(() => expect(screen.getByText('Cancel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Cancel'));
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(mockTrackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.azure-login', status: 'opened' }],
      [{ feature: 'aksd.azure-login', status: 'started' }],
      [{ feature: 'aksd.azure-login', status: 'cancelled' }],
    ]);
    expect(mockTrackError).not.toHaveBeenCalled();
    expect(mockGetLoginStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Sign in with Azure')).toBeInTheDocument();
  });

  test('unmount cancels an in-flight poll without terminal telemetry', async () => {
    let resolvePoll: ((value: { isLoggedIn: boolean }) => void) | undefined;
    const pendingPoll = new Promise<{ isLoggedIn: boolean }>(resolve => {
      resolvePoll = resolve;
    });
    mockInitiateLogin.mockResolvedValue({ success: true });
    mockGetLoginStatus
      .mockResolvedValueOnce({ isLoggedIn: false })
      .mockReturnValueOnce(pendingPoll);

    const { unmount } = await renderReady();
    fireEvent.click(screen.getByText('Sign in with Azure'));
    await act(async () => vi.advanceTimersByTimeAsync(110));

    unmount();
    await act(async () => {
      resolvePoll?.({ isLoggedIn: true });
      await pendingPoll;
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mockTrackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.azure-login', status: 'opened' }],
      [{ feature: 'aksd.azure-login', status: 'started' }],
    ]);
    expect(mockTrackError).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockGetLoginStatus).toHaveBeenCalledTimes(2);
  });

  test('telemetry failures do not interrupt cancellation', async () => {
    mockInitiateLogin.mockResolvedValue({ success: true });

    await renderReady();
    fireEvent.click(screen.getByText('Sign in with Azure'));
    await waitFor(() => expect(screen.getByText('Cancel')).toBeInTheDocument());

    mockTrackFeature.mockImplementation(() => {
      throw new Error('telemetry unavailable');
    });

    expect(() => fireEvent.click(screen.getByText('Cancel'))).not.toThrow();
    expect(screen.getByText('Sign in with Azure')).toBeInTheDocument();
  });
});
