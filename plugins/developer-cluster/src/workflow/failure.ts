// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Failures of the Developer Cluster lifecycle workflow. The workflow adds no codes of its own: a
// state it detects itself reuses a host or native code, so every failure maps to one fixed text
// (src/components/shared/failureText.ts). `host` and `native` are stable source identifiers; both
// are failures the plugin detects itself. `native` covers a failed or malformed read of Headlamp's
// `/config` and any unexpected exception. The UI never shows exception text.

import { CliCommandError } from '../cli/runner';
import { PluginErrorCode } from '../contract/capability';
import { CliErrorCode } from '../contract/devctl';

/** Plugin-side failure codes. */
export type NativeErrorCode = 'failed' | 'invalid-metadata';

export type NativeFailure =
  | { readonly source: 'native'; readonly code: NativeErrorCode }
  | { readonly source: 'host'; readonly code: PluginErrorCode };

export class NativeError extends Error {
  readonly failure: NativeFailure;

  constructor(failure: NativeFailure) {
    super(`Developer Cluster check failed: ${failure.source} ${failure.code}`);
    this.name = 'NativeError';
    this.failure = failure;
  }
}

/** A failure the UI shows with the fixed text for its source and code. */
export type WorkflowFailure =
  | NativeFailure
  | { readonly source: 'cli'; readonly code: CliErrorCode };

/** A host code for a state the workflow detected itself. */
export function hostError(code: PluginErrorCode): NativeError {
  return new NativeError({ source: 'host', code });
}

/** A native code for a state the workflow detected itself. */
export function nativeError(code: NativeErrorCode): NativeError {
  return new NativeError({ source: 'native', code });
}

/**
 * Classifies an exception from the typed host and CLI wrappers. Any other exception is a broken
 * invariant and becomes native `failed`.
 */
export function classifyFailure(error: unknown): WorkflowFailure {
  if (error instanceof CliCommandError) return frozen({ source: 'cli', code: error.code });
  if (error instanceof NativeError) return frozen(error.failure);
  return frozen({ source: 'native', code: 'failed' });
}

function frozen(failure: WorkflowFailure): WorkflowFailure {
  return Object.freeze({ ...failure });
}
