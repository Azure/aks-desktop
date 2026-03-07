// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';

const SETTINGS_KEY = 'aks-desktop:pipeline-settings';
const OLD_FEATURE_FLAG_KEY = 'aks-desktop:feature:github-pipeline';

export interface PipelineSettings {
  githubPipelineEnabled: boolean;
}

const DEFAULT_SETTINGS: PipelineSettings = {
  githubPipelineEnabled: true,
};

function loadSettings(): PipelineSettings {
  const oldFlag = localStorage.getItem(OLD_FEATURE_FLAG_KEY);
  if (oldFlag !== null) {
    localStorage.removeItem(OLD_FEATURE_FLAG_KEY);
    const migrated = { ...DEFAULT_SETTINGS, githubPipelineEnabled: oldFlag === 'true' };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
    return migrated;
  }
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return {
      ...DEFAULT_SETTINGS,
      ...(typeof parsed.githubPipelineEnabled === 'boolean'
        ? { githubPipelineEnabled: parsed.githubPipelineEnabled }
        : {}),
    };
  } catch (e) {
    console.warn('Failed to parse pipeline settings from localStorage:', e);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Hook for managing pipeline settings with localStorage persistence.
 * Includes one-time migration from the old feature flag key.
 */
export const usePipelineSettings = (): {
  settings: PipelineSettings;
  updateSettings: (partial: Partial<PipelineSettings>) => void;
} => {
  const [settings, setSettings] = useState<PipelineSettings>(loadSettings);

  const updateSettings = useCallback((partial: Partial<PipelineSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, updateSettings };
};
