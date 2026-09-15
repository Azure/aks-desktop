// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the K8s API
const mockGet = vi.fn();

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        apiEndpoint: {
          get: (...args: any[]) => mockGet(...args),
        },
      },
    },
  },
}));

import { fetchNamespaceData } from '../kubernetes/namespaceUtils';

/**
 * Helper: creates a mockGet implementation that calls the success callback
 * asynchronously (via queueMicrotask) so that cancelFn is assigned before
 * the callback accesses it — matching real Headlamp API behaviour.
 */
function mockGetSuccess(response: any, mockCancel: ReturnType<typeof vi.fn> = vi.fn()) {
  mockGet.mockImplementation((_name: string, successCb: (ns: any) => void) => {
    const cancelPromise = Promise.resolve(mockCancel);
    queueMicrotask(() => successCb(response));
    return cancelPromise;
  });
  return mockCancel;
}

function mockGetError(error: any, mockCancel: ReturnType<typeof vi.fn> = vi.fn()) {
  mockGet.mockImplementation(
    (_name: string, _successCb: (ns: any) => void, errorCb: (err: any) => void) => {
      const cancelPromise = Promise.resolve(mockCancel);
      queueMicrotask(() => errorCb(error));
      return cancelPromise;
    }
  );
  return mockCancel;
}

describe('fetchNamespaceData', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  test('resolves with namespace data', async () => {
    const mockNs = { metadata: { name: 'test-ns', labels: {} } };
    mockGetSuccess(mockNs);

    const result = await fetchNamespaceData('test-ns', 'test-cluster');

    expect(result).toEqual(mockNs);
    expect(mockGet).toHaveBeenCalledWith(
      'test-ns',
      expect.any(Function),
      expect.any(Function),
      {},
      'test-cluster'
    );
  });

  test('calls cancel function on success', async () => {
    const mockCancel = mockGetSuccess({ metadata: {} });

    await fetchNamespaceData('test-ns', 'test-cluster');

    // Wait for the cancelFn.then to resolve
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockCancel).toHaveBeenCalled();
  });

  test('rejects with error on failure', async () => {
    mockGetError('Not found');

    await expect(fetchNamespaceData('missing-ns', 'test-cluster')).rejects.toThrow(
      'Failed to fetch namespace: Not found'
    );
  });

  test('calls cancel function on error', async () => {
    const mockCancel = mockGetError('Not found');

    try {
      await fetchNamespaceData('missing-ns', 'test-cluster');
    } catch {
      // Expected
    }

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockCancel).toHaveBeenCalled();
  });
});
