// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';

export interface PreviewFeaturesConfig {
  githubPipelines: boolean;
}

export const PREVIEW_FEATURES_DEFAULTS: PreviewFeaturesConfig = {
  githubPipelines: false,
};

export const previewFeaturesStore = new ConfigStore<PreviewFeaturesConfig>('aks-desktop');
