// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shared imports, mocks, fixtures, and helpers for all `*.guidepup.test.tsx`
 * files in the CreateAKSProject component suite.
 *
 * Each split test file imports from this module so that mock setup only needs
 * to be maintained in one place.
 */

import '@testing-library/jest-dom/vitest';
import { virtual } from '@guidepup/virtual-screen-reader';
import { cleanup } from '@testing-library/react';
import React from 'react';
import { afterEach } from 'vitest';
import { STEPS } from '../../types';
// NOTE: vi.mock() calls MUST live in each *.test.tsx file so Vitest can hoist
// them.  This shared module only provides exports and lifecycle hooks.
import type { CreateAKSProjectPureProps } from '../CreateAKSProjectPure';

// ── Base props (matches Storybook baseArgs) ──────────────────────────────────
export const BASE_PROPS: CreateAKSProjectPureProps = {
  activeStep: 0,
  steps: STEPS,
  handleNext: () => {},
  handleBack: () => {},
  handleStepClick: () => {},
  handleSubmit: async () => {},
  onBack: () => {},
  isCreating: false,
  creationProgress: '',
  creationError: null,
  creationWarnings: [],
  showSuccessDialog: false,
  applicationName: '',
  setApplicationName: (() => {}) as any,
  cliSuggestions: [],
  validation: { isValid: true },
  azureResourcesLoading: false,
  onNavigateToProject: () => {},
  stepContent: <div>Step content</div>,
  projectName: 'my-project',
  onDismissError: () => {},
  onCancelSuccess: () => {},
  stepContentRef: React.createRef<HTMLDivElement>(),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Collect all spoken phrases to "end of document" (bounded to avoid infinite loops). */
export async function phrases(maxSteps = 300): Promise<string[]> {
  const log: string[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const p = await virtual.lastSpokenPhrase();
    log.push(p);
    if (p === 'end of document') break;
    await virtual.next();
  }
  return log;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
afterEach(async () => {
  await virtual.stop();
  cleanup();
});
