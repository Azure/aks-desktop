// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The fixed customer text for every failure code. The page never shows CLI output or a host
// message, which may contain paths or credentials. Every text is a literal key, so `npm run i18n`
// extracts it.

import type { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { PluginErrorCode } from '../../contract/capability';
import { CliErrorCode } from '../../contract/devctl';
import { NativeErrorCode, WorkflowFailure } from '../../workflow/failure';

/** The plugin's translate function, `t` from `useTranslation`. */
export type Translate = ReturnType<typeof useTranslation>['t'];

/**
 * The text for a CLI failure.
 *
 * @param t - The plugin's translate function.
 * @param code - The CLI failure category.
 * @returns The translated text.
 */
function cliFailureText(t: Translate, code: CliErrorCode): string {
  switch (code) {
    case 'unavailable':
      return String(t('AKS Desktop could not start the aks-devctl command-line tool.'));
    case 'denied':
      return String(
        t(
          'AKS Desktop did not allow the aks-devctl command-line tool to run this command. Check that AKS Desktop and the Developer Cluster plugin are up to date.'
        )
      );
    case 'exit':
      return String(t('The aks-devctl command-line tool stopped without reporting a result.'));
    case 'missing-terminal':
      return String(t('The aks-devctl command-line tool finished without confirming the result.'));
    case 'unexpected-result':
      return String(t('The aks-devctl command-line tool returned an unexpected result.'));
    case 'failed':
      return String(t('The aks-devctl command-line tool reported an error.'));
  }
}

/**
 * The text for a failure the plugin detected itself with a host code.
 *
 * @param t - The plugin's translate function.
 * @param code - The host failure code.
 * @returns The translated text.
 */
function hostFailureText(t: Translate, code: PluginErrorCode): string {
  switch (code) {
    case 'unsupported':
      return String(t('Local clusters require the Windows x64 build of AKS Desktop.'));
    case 'already-exists':
      return String(
        t('A local cluster is already registered. Delete it before you create another one.')
      );
    case 'identity-mismatch':
      return String(
        t('The current credentials or AKS Desktop entry no longer match the selected cluster.')
      );
    case 'collision':
      return String(
        t(
          'A kubeconfig context conflicts with this local cluster. Existing configuration was preserved.'
        )
      );
  }
}

/**
 * The text for a native failure, such as a failed or malformed read of Headlamp's `/config`.
 *
 * @param t - The plugin's translate function.
 * @param code - The native failure code.
 * @returns The translated text.
 */
function nativeFailureText(t: Translate, code: NativeErrorCode): string {
  switch (code) {
    case 'failed':
      return String(t('AKS Desktop could not complete the local-cluster request.'));
    case 'invalid-metadata':
      return String(t('AKS Desktop returned invalid local-cluster metadata.'));
  }
}

/**
 * The fixed customer text for a workflow failure.
 *
 * @param t - The plugin's translate function.
 * @param failure - The failure's source and code.
 * @returns The translated text for the source and code.
 */
export function failureText(t: Translate, failure: WorkflowFailure): string {
  switch (failure.source) {
    case 'cli':
      return cliFailureText(t, failure.code);
    case 'host':
      return hostFailureText(t, failure.code);
    case 'native':
      return nativeFailureText(t, failure.code);
  }
}
