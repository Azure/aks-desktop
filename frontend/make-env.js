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

// Portions (c) Microsoft Corp.

'use strict';
// Creates the .env file
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '../app/package.json'), 'utf8'));

// Headlamp base version that AKS desktop is built upon (read from app/package.json)
const HEADLAMP_BASE_VERSION = appInfo.version;

// Read AKS desktop version from the root package.json
let aksDesktopVersion = '';
try {
  // Try monorepo root first (when headlamp is a submodule)
  let aksDesktopInfo;
  const monorepoPath = path.join(__dirname, '../../package.json');
  const standalonePath = path.join(__dirname, '../package.json');

  if (fs.existsSync(monorepoPath)) {
    aksDesktopInfo = JSON.parse(fs.readFileSync(monorepoPath, 'utf8'));
  } else if (fs.existsSync(standalonePath)) {
    // Fallback to headlamp's own package.json if running standalone
    aksDesktopInfo = JSON.parse(fs.readFileSync(standalonePath, 'utf8'));
  }

  if (aksDesktopInfo) {
    aksDesktopVersion = aksDesktopInfo.version;
  }
} catch (e) {
  console.warn('Could not read AKS desktop version from package.json:', e.message);
}

const gitVersion = execSync('git rev-parse HEAD').toString().trim();

const envContents = {
  REACT_APP_HEADLAMP_VERSION: HEADLAMP_BASE_VERSION,
  REACT_APP_HEADLAMP_GIT_VERSION: gitVersion,
  REACT_APP_HEADLAMP_PRODUCT_NAME: appInfo.productName,
  REACT_APP_AKS_DESKTOP_VERSION: aksDesktopVersion,
  REACT_APP_ENABLE_REACT_QUERY_DEVTOOLS: 'false',
  REACT_APP_HEADLAMP_SIDEBAR_DEFAULT_OPEN: 'true'
};

function createEnvText() {
  let text = '';
  Object.entries(envContents).forEach(([key, value]) => {
    text += `${key}=${value}\n`;
  });

  return text;
}

const fileName = process.argv[2] || '.env';

fs.writeFileSync(fileName, createEnvText());
