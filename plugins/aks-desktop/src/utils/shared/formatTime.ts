// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

/** Simple interpolation fallback when no i18n `t` function is provided. */
function defaultT(key: string, options?: Record<string, unknown>): string {
  if (!options) return key;
  return key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(options[k] ?? ''));
}

export function getRelativeTime(isoString: string, t: TranslationFn = defaultT): string {
  const deltaMs = Date.now() - new Date(isoString).getTime();
  if (Number.isNaN(deltaMs)) return '';
  if (deltaMs < 0) return '';
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 10) return t('just now');
  if (seconds < 60) return t('{{seconds}}s ago', { seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('{{minutes}} min ago', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('{{hours}}h ago', { hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('{{days}}d ago', { days });
  const weeks = Math.floor(days / 7);
  if (weeks > 4) {
    return new Date(isoString).toLocaleDateString();
  }
  return t('{{weeks}}w ago', { weeks });
}
