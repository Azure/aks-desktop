// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';

interface UseDialogStateResult {
  open: boolean;
  initialApplicationName: string | undefined;
  openDialog: (appName?: string) => void;
  closeDialog: () => void;
}

/**
 * Custom hook to manage dialog state for the deploy wizard
 * Handles dialog visibility and initial application name state
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
