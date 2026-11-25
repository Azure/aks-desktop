// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Texts shared by Setup and Overview.

import { KubernetesDistribution } from '../../contract/devctl';
import { Translate } from './failureText';

/** Distribution defaults, not a probe of the running cluster's network. */
export function networkingText(t: Translate, distribution: KubernetesDistribution | null): string {
  if (distribution === 'K8s') return String(t('Cilium (default)'));
  if (distribution === 'K3s') return String(t('Flannel (bundled)'));
  return String(t('Unknown'));
}

/** One name-value row of a detail card. */
export interface TextRow {
  /** The translated name, on the left. */
  readonly name: string;
  /** The value, on the right. */
  readonly value: string;
}
