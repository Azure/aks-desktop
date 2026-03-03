// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React from 'react';
import { useYamlObjects } from '../hooks/useYamlObjects';
import DeployPure from './DeployPure';

/**
 * Props accepted by the {@link Deploy} connector component.
 * These are forwarded to {@link DeployPure} together with the parsed
 * `yamlObjects` computed by {@link useYamlObjects}.
 */
export interface DeployProps {
  /** The selected deploy source; determines which content path is rendered. */
  sourceType: 'container' | 'yaml' | null;
  /** Target namespace shown in the container-path subtitle. */
  namespace?: string;
  /** Generated YAML for the container-source review editor (read-only Monaco). */
  containerPreviewYaml: string;
  /**
   * Namespace-overridden YAML prepared by the wizard for the YAML-source review.
   * Takes precedence over `yamlEditorValue` when non-empty.
   */
  userPreviewYaml: string;
  /** Raw YAML text typed by the user; used as fallback when `userPreviewYaml` is empty. */
  yamlEditorValue: string;
  /** Outcome of the last deploy attempt, or `null` before any attempt. */
  deployResult: 'success' | 'error' | null;
  /** Human-readable message describing the deploy outcome. */
  deployMessage: string;
}

/**
 * Thin connector that wires {@link useYamlObjects} into {@link DeployPure}.
 *
 * Parses `userPreviewYaml`/`yamlEditorValue` into Kubernetes resource summaries
 * and passes the result — along with all other props — to the pure presentational
 * component so the view remains hook-free and directly story-bookable.
 */
export default function Deploy({
  sourceType,
  namespace,
  containerPreviewYaml,
  userPreviewYaml,
  yamlEditorValue,
  deployResult,
  deployMessage,
}: DeployProps) {
  const yamlObjects = useYamlObjects(sourceType, userPreviewYaml, yamlEditorValue);
  return (
    <DeployPure
      sourceType={sourceType}
      namespace={namespace}
      containerPreviewYaml={containerPreviewYaml}
      deployResult={deployResult}
      deployMessage={deployMessage}
      yamlObjects={yamlObjects}
    />
  );
}
