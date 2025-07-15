// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Helper functions for resource management
 */
export const bumpWithUnit = (current: string, step: number, unit: 'm' | 'Mi', min = 1): string => {
  const numeric = parseInt(String(current).replace(/[^0-9]/g, ''), 10);
  const safe = isNaN(numeric) ? 0 : numeric;
  const next = Math.max(min, safe + step);
  return `${next}${unit}`;
};

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
