// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

export function getRelativeTime(isoString: string): string {
  const deltaMs = Date.now() - new Date(isoString).getTime();
  if (Number.isNaN(deltaMs)) return '';
  const seconds = Math.floor(Math.max(0, deltaMs) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks > 4) {
    return new Date(isoString).toLocaleDateString();
  }
  return `${weeks}w ago`;
}
