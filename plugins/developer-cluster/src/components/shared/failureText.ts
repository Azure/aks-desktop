// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The fixed customer text for every failure code. The page never shows CLI output or a host
// message, which may contain paths or credentials. Every text is a literal key, so `npm run i18n`
// extracts it.

import type { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { PluginErrorCode } from '../../contract/capability';
import { CliErrorCode } from '../../contract/devctl';
import { NativeErrorCode, WorkflowFailure } from '../../workflow/failure';

export type Translate = ReturnType<typeof useTranslation>['t'];

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

function nativeFailureText(t: Translate, code: NativeErrorCode): string {
  switch (code) {
    case 'failed':
      return String(t('AKS Desktop could not complete the local-cluster request.'));
    case 'invalid-metadata':
      return String(t('AKS Desktop returned invalid local-cluster metadata.'));
  }
}

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
