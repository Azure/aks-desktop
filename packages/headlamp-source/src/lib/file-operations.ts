/**
 * Safe filesystem helpers shared by source-package build scripts. Directory copies omit hidden
 * entries, and wildcard removal expands only the final path segment.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * Copies a file or directory while replacing every symbolic link with its target.
 *
 * @param source - File or directory to copy.
 * @param destination - Path that receives the copied content.
 * @returns Nothing.
 */
function copyDereferenced(source: string, destination: string): void {
  const sourceStat = fs.statSync(source);
  if (sourceStat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true, mode: sourceStat.mode });
    for (const entry of fs.readdirSync(source)) {
      copyDereferenced(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, sourceStat.mode);
}

/**
 * Copies visible entries from one directory into another.
 *
 * @param source - Directory whose visible contents are copied.
 * @param destination - Directory that receives the copied entries.
 * @param dereference - Whether copied symbolic links should contain their target files.
 * @returns Nothing.
 */
function copyDirectoryContents(source: string, destination: string, dereference = false): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    if (!entry.startsWith('.')) {
      const sourceEntry = path.join(source, entry);
      const destinationEntry = path.join(destination, entry);
      if (dereference) {
        copyDereferenced(sourceEntry, destinationEntry);
      } else {
        fs.cpSync(sourceEntry, destinationEntry, { recursive: true });
      }
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
  copyDirectoryContents,
  removePathPattern,
};