/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const FILE_NAME = 'installId.json';

// crypto.randomUUID() always emits v4, so we only accept v4 here. Variant
// nibble (the '8|9|a|b' in position 19) is part of the RFC 4122 contract.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface InstallIdFile {
  installId: string;
  createdAt: string;
}

/**
 * Read the install UUID from `<userDataDir>/installId.json` or create a
 * fresh one if the file is missing, unreadable, or contains a value that
 * doesn't look like a v4 UUID.
 *
 * Called from the Electron main process. The renderer never touches the
 * file directly — it goes through the `'get-install-id'` IPC.
 */
export function getOrCreateInstallId(userDataDir: string): string {
  const filePath = path.join(userDataDir, FILE_NAME);

  const existing = tryReadValid(filePath);
  if (existing) return existing;

  const installId = randomUUID();
  const payload: InstallIdFile = { installId, createdAt: new Date().toISOString() };
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return installId;
}

function tryReadValid(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<InstallIdFile>;
    if (typeof parsed.installId === 'string' && UUID_V4_RE.test(parsed.installId)) {
      return parsed.installId;
    }
  } catch {
    // file missing, unreadable, or not JSON — fall through to regenerate
  }
  return undefined;
}
