// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  beforeEach(() => {
    mockStore._setForTest({});
  });

  it('returns defaults when store is empty', () => {
    const { result } = renderHook(() => usePreviewFeatures());

    expect(result.current).toEqual({ githubPipelines: false });
  });

  it('returns stored values when present', () => {
    mockStore._setForTest({ githubPipelines: true });

    const { result } = renderHook(() => usePreviewFeatures());

    expect(result.current).toEqual({ githubPipelines: true });
  });
});
