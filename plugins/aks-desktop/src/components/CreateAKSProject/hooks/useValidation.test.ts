// @vitest-environment jsdom
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FormData } from '../types';
import { useValidation } from './useValidation';

const formData: FormData = {
  projectName: 'test-project',
  description: '',
  subscription: 'test-subscription',
  cluster: 'test-cluster',
  resourceGroup: 'test-resource-group',
  ingress: 'AllowSameNamespace',
  egress: 'AllowAll',
  cpuRequest: 2000,
  memoryRequest: 4096,
  cpuLimit: 2000,
  memoryLimit: 4096,
  userAssignments: [
    {
      objectId: '38927c93-a0fd-4b06-b21a-69b8ed1e208c',
      role: 'Writer',
    },
  ],
};

describe('useValidation', () => {
  it('revalidates assignments when the UPN requirement changes', () => {
    const { result, rerender } = renderHook(
      ({ requiresUpn }) =>
        useValidation(0, formData, undefined, false, null, true, undefined, requiresUpn),
      { initialProps: { requiresUpn: true } }
    );

    expect(result.current.fieldErrors?.assignments?.[0]).toMatch(/sign-in name/i);

    rerender({ requiresUpn: false });
    expect(result.current.fieldErrors?.assignments).toBeUndefined();

    rerender({ requiresUpn: true });
    expect(result.current.fieldErrors?.assignments?.[0]).toMatch(/sign-in name/i);
  });
});
