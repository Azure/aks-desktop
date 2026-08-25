import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from './sanitizeFilename';

describe('sanitizeFilename', () => {
  it('preserves allowed characters and collapses unsafe runs', () => {
    expect(sanitizeFilename(' pod///name.json ', 'resource')).toBe('pod-name.json');
  });

  it('uses the fallback when no safe characters remain', () => {
    expect(sanitizeFilename('///', 'resource')).toBe('resource');
  });

  it('handles long unsafe runs in linear time', () => {
    expect(sanitizeFilename(`pod${'/'.repeat(100_000)}logs`, 'resource')).toBe('pod-logs');
  });
});
