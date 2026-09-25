// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';
import YAML from 'yaml';

/**
 * A lightweight summary of a single Kubernetes resource parsed from YAML.
 * Used to display resource cards in the Deploy review step.
 */
export interface K8sObject {
  /** The Kubernetes resource kind (e.g. `"Deployment"`, `"Service"`). */
  kind: string;
  /** The resource name from `metadata.name`, or `"unnamed"` if absent. */
  name: string;
  /** The target namespace from `metadata.namespace`, if present. */
  namespace?: string;
}

/**
 * Parses YAML content into a list of {@link K8sObject} summaries.
 *
 * Returns an empty array when `sourceType` is not `'yaml'` or when the
 * YAML cannot be parsed, so callers never need to handle thrown errors.
 *
 * @param sourceType - The selected deploy source. Only `'yaml'` triggers parsing.
 * @param userPreviewYaml - Namespace-overridden YAML prepared for the review step.
 *   Takes precedence over `yamlEditorValue` when non-empty.
 * @param yamlEditorValue - Raw YAML text typed by the user in the editor.
 * @returns Parsed Kubernetes resource summaries, or `[]` on any parse failure.
 */
export function useYamlObjects(
  sourceType: 'container' | 'yaml' | null,
  userPreviewYaml: string,
  yamlEditorValue: string
): K8sObject[] {
  const { t } = useTranslation();
  return useMemo(() => {
    if (sourceType !== 'yaml') return [];
    try {
      const yamlContent = userPreviewYaml || yamlEditorValue;
      const docs = YAML.parseAllDocuments(yamlContent);
      return docs
        .map(doc => {
          const obj = doc.toJSON();
          if (!obj || !obj.kind) return null;
          const result: K8sObject = {
            kind: obj.kind as string,
            name: (obj.metadata?.name || t('unnamed')) as string,
            namespace: obj.metadata?.namespace as string | undefined,
          };
          return result;
        })
        .filter((obj): obj is K8sObject => obj !== null);
    } catch {
      return [];
    }
  }, [sourceType, userPreviewYaml, yamlEditorValue]);
}
