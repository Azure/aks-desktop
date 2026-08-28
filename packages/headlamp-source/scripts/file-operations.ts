const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PURPOSE = 'Provide safe file-copy and wildcard-removal helpers.';
const SCRIPT_USAGE = `Import API:

  copyDirectoryContents(source, destination)
  removePathPattern(pattern)`;

/**
 * Copies visible entries from one directory into another.
 *
 * @param source - Directory whose visible contents are copied.
 * @param destination - Directory that receives the copied entries.
 * @returns Nothing.
 */
function copyDirectoryContents(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    if (!entry.startsWith('.')) {
      fs.cpSync(path.join(source, entry), path.join(destination, entry), {
        recursive: true,
      });
    }
  }
}

/**
 * Removes a literal path or paths matching a filename wildcard.
 *
 * @param pattern - Literal path or basename pattern containing `*` wildcards.
 * @returns Nothing.
 */
function removePathPattern(pattern: string): void {
  const directory = path.dirname(pattern);
  const namePattern = path.basename(pattern);
  if (!namePattern.includes('*')) {
    fs.rmSync(pattern, { recursive: true, force: true });
    return;
  }
  if (!fs.existsSync(directory)) {
    return;
  }
  const expression = new RegExp(
    `^${namePattern
      .split('*')
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  );
  for (const entry of fs.readdirSync(directory)) {
    if (expression.test(entry)) {
      fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
    }
  }
}

module.exports = {
  SCRIPT_PURPOSE,
  SCRIPT_USAGE,
  copyDirectoryContents,
  removePathPattern,
};
