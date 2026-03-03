// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/PluginSettings/previewFeaturesStore', () => {
  const PREVIEW_FEATURES_DEFAULTS = { githubPipelines: false };
  let storedConfig: Record<string, unknown> = {};
  return {
    PREVIEW_FEATURES_DEFAULTS,
    previewFeaturesStore: {
      useConfig: () => () => storedConfig,
      get: () => storedConfig,
      update: (partial: Record<string, unknown>) => {
        storedConfig = { ...storedConfig, ...partial };
      },
      _setForTest: (config: Record<string, unknown>) => {
        storedConfig = config;
      },
    },
  };
});

import { previewFeaturesStore } from '../components/PluginSettings/previewFeaturesStore';
import { usePreviewFeatures } from './usePreviewFeatures';

const mockStore = previewFeaturesStore as unknown as {
  _setForTest: (config: Record<string, unknown>) => void;
};

describe('usePreviewFeatures', () => {
  it('returns defaults when store is empty', () => {
    mockStore._setForTest({});

    const { result } = renderHook(() => usePreviewFeatures());

    expect(result.current).toEqual({ githubPipelines: false });
  });

  it('returns stored values when present', () => {
    mockStore._setForTest({ githubPipelines: true });

    const { result } = renderHook(() => usePreviewFeatures());

    expect(result.current).toEqual({ githubPipelines: true });
  });

  it('merges stored values over defaults', () => {
    mockStore._setForTest({ githubPipelines: true });

    const { result } = renderHook(() => usePreviewFeatures());

    expect(result.current.githubPipelines).toBe(true);
  });

  it('falls back to defaults for missing keys', () => {
    mockStore._setForTest({});

    const { result } = renderHook(() => usePreviewFeatures());

    expect(result.current.githubPipelines).toBe(false);
  });
});
