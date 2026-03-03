// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  PREVIEW_FEATURES_DEFAULTS,
  type PreviewFeaturesConfig,
  previewFeaturesStore,
} from '../components/PluginSettings/previewFeaturesStore';

const useStoreConfig = previewFeaturesStore.useConfig();

export function usePreviewFeatures(): PreviewFeaturesConfig {
  const stored = useStoreConfig();
  return { ...PREVIEW_FEATURES_DEFAULTS, ...stored };
}
