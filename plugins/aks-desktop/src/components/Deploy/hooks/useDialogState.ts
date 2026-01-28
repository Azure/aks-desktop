// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';

/**
 * Return type for the {@link useDialogState} hook.
 */
interface UseDialogStateResult {
  /** Whether the dialog is currently open. */
  open: boolean;
  /** The application name to pre-populate in the wizard, if any. */
  initialApplicationName: string | undefined;
  /** Opens the dialog, optionally with a pre-populated application name. */
  openDialog: (appName?: string) => void;
  /** Closes the dialog and resets the initial application name. */
  closeDialog: () => void;
}

/**
 * Manages open/close state and initial application name for the deploy wizard dialog.
 *
 * @returns An object containing dialog state and control functions.
 */
export const useDialogState = (): UseDialogStateResult => {
  const [open, setOpen] = useState(false);
  const [initialApplicationName, setInitialApplicationName] = useState<string | undefined>(
    undefined
  );

  const openDialog = useCallback((appName?: string) => {
    setOpen(true);
    setInitialApplicationName(appName);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setInitialApplicationName(undefined);
  }, []);

  return {
    open,
    initialApplicationName,
    openDialog,
    closeDialog,
  };
};
