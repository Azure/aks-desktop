/** Converts untrusted text into a filesystem-safe filename segment in linear time. */
export function sanitizeFilename(value: string | undefined, fallback: string): string {
  const input = value || fallback;
  let result = '';
  let pendingSeparator = false;

  for (const character of input) {
    const code = character.charCodeAt(0);
    const allowed =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      character === '.' ||
      character === '_' ||
      character === '-';

    if (allowed) {
      if (pendingSeparator && result && !result.endsWith('-')) result += '-';
      result += character;
      pendingSeparator = false;
    } else {
      pendingSeparator = true;
    }
  }

  let start = 0;
  let end = result.length;
  while (start < end && result[start] === '-') start++;
  while (end > start && result[end - 1] === '-') end--;
  return result.slice(start, end) || fallback;
}
