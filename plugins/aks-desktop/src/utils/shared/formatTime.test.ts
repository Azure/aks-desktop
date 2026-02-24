// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { getRelativeTime } from './formatTime';

describe('getRelativeTime', () => {
  function isoAgo(ms: number): string {
    return new Date(Date.now() - ms).toISOString();
  }

  it('returns "just now" for timestamps less than 10 seconds ago', () => {
    expect(getRelativeTime(isoAgo(0))).toBe('just now');
    expect(getRelativeTime(isoAgo(5_000))).toBe('just now');
    expect(getRelativeTime(isoAgo(9_999))).toBe('just now');
  });

  it('returns seconds for 10s–59s ago', () => {
    expect(getRelativeTime(isoAgo(10_000))).toBe('10s ago');
    expect(getRelativeTime(isoAgo(45_000))).toBe('45s ago');
    expect(getRelativeTime(isoAgo(59_000))).toBe('59s ago');
  });

  it('returns minutes for 1–59 min ago', () => {
    expect(getRelativeTime(isoAgo(60_000))).toBe('1 min ago');
    expect(getRelativeTime(isoAgo(30 * 60_000))).toBe('30 min ago');
    expect(getRelativeTime(isoAgo(59 * 60_000))).toBe('59 min ago');
  });

  it('returns hours for 1–23 hours ago', () => {
    expect(getRelativeTime(isoAgo(60 * 60_000))).toBe('1h ago');
    expect(getRelativeTime(isoAgo(12 * 60 * 60_000))).toBe('12h ago');
    expect(getRelativeTime(isoAgo(23 * 60 * 60_000))).toBe('23h ago');
  });

  it('returns days for 1–6 days ago', () => {
    expect(getRelativeTime(isoAgo(24 * 60 * 60_000))).toBe('1d ago');
    expect(getRelativeTime(isoAgo(6 * 24 * 60 * 60_000))).toBe('6d ago');
  });

  it('returns weeks for 1–4 weeks ago', () => {
    expect(getRelativeTime(isoAgo(7 * 24 * 60 * 60_000))).toBe('1w ago');
    expect(getRelativeTime(isoAgo(28 * 24 * 60 * 60_000))).toBe('4w ago');
  });

  it('returns a formatted date for more than 4 weeks ago', () => {
    const result = getRelativeTime(isoAgo(35 * 24 * 60 * 60_000));
    // Should be a locale date string, not a relative time
    expect(result).not.toContain('ago');
    expect(result).not.toBe('');
  });

  it('returns empty string for invalid dates', () => {
    expect(getRelativeTime('not-a-date')).toBe('');
    expect(getRelativeTime('')).toBe('');
  });

  it('returns empty string for future timestamps', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(getRelativeTime(future)).toBe('');
  });
});
