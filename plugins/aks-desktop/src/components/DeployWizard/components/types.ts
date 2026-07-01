// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Helper functions for resource management
 */
export const setFromInput = (
  raw: string,
  unit: 'm' | 'Mi',
  onChange: (v: string) => void,
  min = 1
): void => {
  const numeric = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  if (isNaN(numeric)) {
    onChange('');
    return;
  }
  onChange(`${Math.max(min, numeric)}${unit}`);
};
