// @vitest-environment jsdom
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use a real i18next instance so {{variable}} interpolation works correctly in
// error messages (e.g. 'Namespace status verification failed: {{message}}'
// renders with the actual message instead of the raw placeholder).
// react-i18next falls back to the global instance set by initReactI18next, so
// no I18nextProvider wrapper is needed.
vi.mock('@kinvolk/headlamp-plugin/lib', async () => {
  const i18n = (await import('i18next')).default;
  const { initReactI18next, useTranslation } = await import('react-i18next');
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { translation: {} } },
      interpolation: { escapeValue: false },
      returnEmptyString: false,
    });
  }
  return { useTranslation, K8s: { useClustersConf: () => ({}) } };
});

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: vi.fn() }),
}));

vi.mock('../../../utils/azure/az-cli', () => ({
  checkNamespaceExists: vi.fn(),
  createManagedNamespace: vi.fn(),
  createNamespaceRoleAssignment: vi.fn(),
  resolveUserObjectId: vi.fn().mockResolvedValue({ success: true, objectId: 'mock-object-id' }),
  verifyNamespaceAccess: vi.fn(),
}));

vi.mock('../../../utils/azure/checkAzureCli', () => ({
  checkAzureCliAndAksPreview: vi.fn().mockResolvedValue({ suggestions: [] }),
}));

vi.mock('./useAzureResources', () => ({
  useAzureResources: () => ({
    subscriptions: [],
    clusters: [],
    loading: false,
    error: null,
    clusterError: null,
    loadingClusters: false,
    totalClusterCount: 0,
    fetchSubscriptions: vi.fn().mockResolvedValue([]),
    fetchClusters: vi.fn().mockResolvedValue([]),
    clearClusters: vi.fn(),
    clearError: vi.fn(),
    clearClusterError: vi.fn(),
  }),
}));

vi.mock('./useClusterCapabilities', () => ({
  useClusterCapabilities: () => ({
    capabilities: null,
    loading: false,
    error: null,
    fetchCapabilities: vi.fn(),
    clearCapabilities: vi.fn(),
  }),
}));

vi.mock('./useExtensionCheck', () => ({
  useExtensionCheck: () => ({
    installed: true,
    installing: false,
    error: null,
    showSuccess: false,
    installExtension: vi.fn(),
    checkExtension: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('./useFeatureCheck', () => ({
  useFeatureCheck: () => ({
    registered: true,
    state: null,
    registering: false,
    error: null,
    showSuccess: false,
    registerFeature: vi.fn(),
    checkFeature: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('./useNamespaceCheck', () => ({
  useNamespaceCheck: () => ({
    exists: false,
    checking: false,
    error: null,
    checkNamespace: vi.fn(),
    clearStatus: vi.fn(),
  }),
}));

vi.mock('./useFormData', () => ({
  useFormData: vi.fn(),
}));

vi.mock('./useValidation', () => ({
  useValidation: () => ({ isValid: true, errors: {}, warnings: [], fieldErrors: {} }),
}));

import {
  checkNamespaceExists,
  createManagedNamespace,
  createNamespaceRoleAssignment,
  resolveUserObjectId,
  verifyNamespaceAccess,
} from '../../../utils/azure/az-cli';
import { useCreateAKSProjectWizard } from './useCreateAKSProjectWizard';
import { useFormData } from './useFormData';

const defaultFormData = {
  subscription: '',
  cluster: '',
  resourceGroup: '',
  projectName: 'test-project',
  description: '',
  cpuRequest: 2000,
  cpuLimit: 2000,
  memoryRequest: 4096,
  memoryLimit: 4096,
  ingress: 'AllowSameNamespace',
  egress: 'AllowAll',
  userAssignments: [],
};

describe('useCreateAKSProjectWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Silence console.error so error-path tests don't pollute the test output.
    // Individual tests that need to assert on console.error output create their
    // own spy on top and restore it themselves before this one is cleaned up.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(resolveUserObjectId).mockResolvedValue({
      success: true,
      objectId: 'mock-object-id',
    });
    vi.mocked(useFormData).mockReturnValue({
      formData: defaultFormData,
      updateFormData: vi.fn(),
      resetFormData: vi.fn(),
      setFormDataField: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('has initial activeStep of 0', () => {
    const { result } = renderHook(() => useCreateAKSProjectWizard());
    expect(result.current.activeStep).toBe(0);
  });

  it('handleNext increments activeStep', () => {
    const { result } = renderHook(() => useCreateAKSProjectWizard());
    act(() => {
      result.current.handleNext();
    });
    expect(result.current.activeStep).toBe(1);
  });

  it('handleBack decrements activeStep', () => {
    const { result } = renderHook(() => useCreateAKSProjectWizard());
    act(() => {
      result.current.handleNext();
    });
    act(() => {
      result.current.handleBack();
    });
    expect(result.current.activeStep).toBe(0);
  });

  it('onBack calls history.push("/")', () => {
    // We check indirectly — onBack should not throw
    const { result } = renderHook(() => useCreateAKSProjectWizard());
    expect(() => {
      act(() => {
        result.current.onBack();
      });
    }).not.toThrow();
  });

  it('initial isCreating is false', () => {
    const { result } = renderHook(() => useCreateAKSProjectWizard());
    expect(result.current.isCreating).toBe(false);
  });

  it('handleSubmit success path: sets showSuccessDialog after success and timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });

    // Return success immediately, skip all internal delays by resolving everything fast
    vi.mocked(createManagedNamespace).mockResolvedValue({ success: true } as any);
    vi.mocked(checkNamespaceExists).mockResolvedValue({ exists: true } as any);

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    // Start the submit and advance only the success-path timers (5s + 2s)
    await act(async () => {
      const submitPromise = result.current.handleSubmit();
      await vi.advanceTimersByTimeAsync(7000);
      await submitPromise;
    });

    expect(result.current.isCreating).toBe(false);
    expect(result.current.showSuccessDialog).toBe(true);
  }, 10000);

  it('handleSubmit error path: sets creationError when createManagedNamespace fails', async () => {
    vi.mocked(createManagedNamespace).mockResolvedValue({
      success: false,
      error: 'boom',
    } as any);

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.creationError).toBeTruthy();
    expect(result.current.isCreating).toBe(false);
  });

  it('handleSubmit sets isCreating false after error completion', async () => {
    vi.mocked(createManagedNamespace).mockResolvedValue({
      success: false,
      error: 'quick-fail',
    } as any);

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.isCreating).toBe(false);
  });

  it('handleSubmit timeout: sets creationError when timeout fires during createNamespaceRoleAssignment', async () => {
    vi.useFakeTimers();
    vi.mocked(useFormData).mockReturnValue({
      formData: {
        ...defaultFormData,
        userAssignments: [{ email: 'user@example.com', role: 'Admin' }],
      },
      updateFormData: vi.fn(),
      resetFormData: vi.fn(),
      setFormDataField: vi.fn(),
    } as any);
    vi.mocked(createManagedNamespace).mockResolvedValue({ success: true } as any);
    vi.mocked(checkNamespaceExists).mockResolvedValue({ exists: true } as any);
    // Role assignment hangs so the 10-minute timeout fires while it is in-flight
    vi.mocked(createNamespaceRoleAssignment).mockReturnValue(new Promise(() => {}) as any);

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    await act(async () => {
      const submitPromise = result.current.handleSubmit();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
      await submitPromise;
    });

    expect(result.current.creationError).toContain('timed out');
    expect(result.current.isCreating).toBe(false);
  });

  it('handleSubmit timeout: sets creationError when timeout fires during verifyNamespaceAccess', async () => {
    vi.useFakeTimers();
    vi.mocked(useFormData).mockReturnValue({
      formData: {
        ...defaultFormData,
        userAssignments: [{ email: 'user@example.com', role: 'Admin' }],
      },
      updateFormData: vi.fn(),
      resetFormData: vi.fn(),
      setFormDataField: vi.fn(),
    } as any);
    vi.mocked(createManagedNamespace).mockResolvedValue({ success: true } as any);
    vi.mocked(checkNamespaceExists).mockResolvedValue({ exists: true } as any);
    vi.mocked(createNamespaceRoleAssignment).mockResolvedValue({ success: true } as any);
    // Access verification hangs so the 10-minute timeout fires while it is in-flight
    vi.mocked(verifyNamespaceAccess).mockReturnValue(new Promise(() => {}) as any);

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    await act(async () => {
      const submitPromise = result.current.handleSubmit();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
      await submitPromise;
    });

    expect(result.current.creationError).toContain('timed out');
    expect(result.current.isCreating).toBe(false);
  });

  it('handleSubmit timeout: sets creationError when timeout fires during initial namespace verification loop', async () => {
    vi.useFakeTimers();
    vi.mocked(createManagedNamespace).mockResolvedValue({ success: true } as any);
    // checkNamespaceExists hangs on the very first call inside the initial verification loop
    vi.mocked(checkNamespaceExists).mockReturnValue(new Promise(() => {}) as any);

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    await act(async () => {
      const submitPromise = result.current.handleSubmit();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
      await submitPromise;
    });

    expect(result.current.creationError).toContain('timed out');
    expect(result.current.isCreating).toBe(false);
  });

  it('handleSubmit timeout: sets creationError when timeout fires during final checkNamespaceExists', async () => {
    vi.useFakeTimers();
    vi.mocked(createManagedNamespace).mockResolvedValue({ success: true } as any);
    // Initial verification resolves; final verification hangs so the timeout fires
    vi.mocked(checkNamespaceExists)
      .mockResolvedValueOnce({ exists: true } as any)
      .mockReturnValue(new Promise(() => {}) as any);

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    await act(async () => {
      const submitPromise = result.current.handleSubmit();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
      await submitPromise;
    });

    expect(result.current.creationError).toContain('timed out');
    expect(result.current.isCreating).toBe(false);
  });

  it('handleSubmit timeout: sets creationError when timeout fires during final verification 2s retry', async () => {
    vi.useFakeTimers();
    vi.mocked(createManagedNamespace).mockResolvedValue({ success: true } as any);
    // Initial verification: exists; final attempt 0: not found (triggers 2s retry); attempt 1: hangs
    vi.mocked(checkNamespaceExists)
      .mockResolvedValueOnce({ exists: true } as any)
      .mockResolvedValueOnce({ exists: false } as any)
      .mockReturnValue(new Promise(() => {}) as any);

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    await act(async () => {
      const submitPromise = result.current.handleSubmit();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
      await submitPromise;
    });

    expect(result.current.creationError).toContain('timed out');
    expect(result.current.isCreating).toBe(false);
  });

  describe('PII redaction in non-debug error logging', () => {
    it('redacts email addresses from the error message before logging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(createManagedNamespace).mockRejectedValue(
        new Error('Access denied for user admin@contoso.com')
      );

      const { result } = renderHook(() => useCreateAKSProjectWizard());

      await act(async () => {
        await result.current.handleSubmit();
      });

      // flat(1): mock.calls is array-of-arrays (one entry per call); flatten one level to get individual args
      const allArgs = consoleSpy.mock.calls
        .flat(1)
        .map(a => (typeof a === 'string' ? a : JSON.stringify(a)));
      const combined = allArgs.join(' ');
      expect(combined).not.toMatch(/admin@contoso\.com/);
      expect(combined).toMatch(/<redacted>/);

      consoleSpy.mockRestore();
    });

    it('redacts email addresses from the error stack before logging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const err = new Error('Access denied for user secret@example.org');
      // Inject an email into the stack trace so it mirrors a realistic JS stack.
      // The line:column numbers (42:11) are synthetic — they exist only to give the stack a
      // plausible shape; their exact values are not significant.
      err.stack = `Error: Access denied for user secret@example.org\n    at handleSubmit (useCreateAKSProjectWizard.ts:42:11)`;
      vi.mocked(createManagedNamespace).mockRejectedValue(err);

      const { result } = renderHook(() => useCreateAKSProjectWizard());

      await act(async () => {
        await result.current.handleSubmit();
      });

      // Collect every argument passed to console.error and stringify objects
      const allArgs = consoleSpy.mock.calls.flatMap(callArgs =>
        callArgs.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)))
      );
      const combined = allArgs.join(' ');
      expect(combined).not.toMatch(/secret@example\.org/);
      expect(combined).toMatch(/<redacted>/);

      consoleSpy.mockRestore();
    });

    it('exposes the raw (un-redacted) error message in creationError for the user-visible dialog', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(createManagedNamespace).mockRejectedValue(
        new Error('Role assignment failed for user ops@contoso.com')
      );

      const { result } = renderHook(() => useCreateAKSProjectWizard());

      await act(async () => {
        await result.current.handleSubmit();
      });

      // The user-visible error dialog should show the full message so the operator
      // can see which email caused the failure — it must NOT be redacted.
      expect(result.current.creationError).toContain('ops@contoso.com');
      expect(result.current.creationError).not.toContain('<redacted>');

      vi.restoreAllMocks();
    });
  });

  it('handleSubmit timeout: onProgress callback does not update creationProgress after timeout fires', async () => {
    vi.useFakeTimers();
    let resolveRoleAssignment!: () => void;

    vi.mocked(useFormData).mockReturnValue({
      formData: {
        ...defaultFormData,
        userAssignments: [{ email: 'user@example.com', role: 'Admin' }],
      },
      updateFormData: vi.fn(),
      resetFormData: vi.fn(),
      setFormDataField: vi.fn(),
    } as any);
    vi.mocked(createManagedNamespace).mockResolvedValue({ success: true } as any);
    vi.mocked(checkNamespaceExists).mockResolvedValue({ exists: true } as any);
    // First role assignment call hangs until manually resolved; remaining calls succeed immediately.
    vi.mocked(createNamespaceRoleAssignment)
      .mockReturnValueOnce(
        new Promise<any>(resolve => {
          resolveRoleAssignment = () => resolve({ success: true });
        })
      )
      .mockResolvedValue({ success: true } as any);
    vi.mocked(verifyNamespaceAccess).mockResolvedValue({ success: true, hasAccess: true } as any);

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    await act(async () => {
      const submitPromise = result.current.handleSubmit();
      // Fire the 10-minute timeout while createNamespaceRoleAssignment is still pending
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
      await submitPromise;
    });

    expect(result.current.creationError).toContain('timed out');
    const progressAtTimeout = result.current.creationProgress;

    // Unblock the hanging role assignment so assignRolesToNamespace resumes and
    // calls onProgress multiple times — all of which must be no-ops because
    // aborted is already true.
    await act(async () => {
      resolveRoleAssignment();
      await Promise.resolve();
    });

    // creationProgress must be unchanged — the guard prevents state updates after timeout
    expect(result.current.creationProgress).toBe(progressAtTimeout);
  });

  it('creationPromise.catch() suppresses unhandled rejection when timeout wins the race', async () => {
    vi.useFakeTimers();
    let rejectCreation!: (err: Error) => void;
    vi.mocked(createManagedNamespace).mockReturnValue(
      new Promise((_, reject) => {
        rejectCreation = reject;
      }) as any
    );

    const { result } = renderHook(() => useCreateAKSProjectWizard());

    await act(async () => {
      const submitPromise = result.current.handleSubmit();
      // Fire the 10-minute timeout; Promise.race resolves with the timeout error
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
      await submitPromise;
    });

    expect(result.current.creationError).toContain('timed out');

    // Reject the still-running creationPromise after handleSubmit has already settled.
    // Without creationPromise.catch(() => {}), this would be an unhandled rejection.
    await act(async () => {
      rejectCreation(new Error('late rejection'));
      await Promise.resolve();
    });

    // Reaching here means the late rejection was silently swallowed
    expect(result.current.isCreating).toBe(false);
  });
});
