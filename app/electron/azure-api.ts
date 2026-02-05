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

import {
  AuthenticationRecord,
  deserializeAuthenticationRecord,
  InteractiveBrowserCredential,
  serializeAuthenticationRecord,
  useIdentityPlugin,
} from '@azure/identity';
import { cachePersistencePlugin } from '@azure/identity-cache-persistence';
import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_ID = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';

useIdentityPlugin(cachePersistencePlugin);

const AuthRecord = {
  PATH: path.join(app.getPath('userData'), 'azure_auth_record.json'),
  exists() {
    return fs.existsSync(AuthRecord.PATH);
  },
  load() {
    if (AuthRecord.exists()) {
      const content = fs.readFileSync(AuthRecord.PATH, 'utf-8');
      return deserializeAuthenticationRecord(content);
    }
  },
  save(record: AuthenticationRecord) {
    fs.writeFileSync(AuthRecord.PATH, serializeAuthenticationRecord(record), 'utf-8');
  },
  clear() {
    if (AuthRecord.exists()) {
      fs.unlinkSync(AuthRecord.PATH);
    }
  },
};

let credential: InteractiveBrowserCredential | null = null;

function getCredential(): InteractiveBrowserCredential {
  if (!credential) {
    const authRecord = AuthRecord.load();

    credential = new InteractiveBrowserCredential({
      clientId: CLIENT_ID,
      authenticationRecord: authRecord,
      disableAutomaticAuthentication: !authRecord,
      tokenCachePersistenceOptions: { enabled: true },
      redirectUri: 'http://localhost',
    });
  }
  return credential;
}

interface TokenClaims {
  upn?: string;
  preferred_username?: string;
  tid?: string;
}

function parseTokenClaims(token: string): TokenClaims {
  try {
    const payload = token.split('.')[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

interface TokenResult {
  token: string;
  expiresOnTimestamp: number;
}

async function acquireToken(
  scopes: string | string[],
  { silent = false }: { silent?: boolean } = {}
): Promise<TokenResult | null> {
  const cred = getCredential();
  const scopeArray = Array.isArray(scopes) ? scopes : [scopes];

  try {
    let result = await cred.getToken(scopeArray);

    if (!result && !silent) {
      await cred.authenticate(scopeArray);
      result = await cred.getToken(scopeArray);
    }

    if (!result) return null;

    return {
      token: result.token,
      expiresOnTimestamp: result.expiresOnTimestamp ?? Date.now() + 3600000,
    };
  } catch {
    if (silent) return null;
    throw new Error('Failed to acquire token');
  }
}

function createPromiseQueue() {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn);
    queue = result.then(
      () => {},
      () => {}
    );
    return result;
  };
}

const enqueueToken = createPromiseQueue();

function getToken(scopes: string | string[], { silent }: { silent: boolean } = { silent: false }) {
  return enqueueToken(() => acquireToken(scopes, { silent }));
}

export const setupAzureApi = () => {
  ipcMain.handle('azure-get-token', async (_event, { scopes }: { scopes: string | string[] }) => {
    return getToken(scopes);
  });

  ipcMain.handle(
    'azure-check-login',
    async (): Promise<{
      isLoggedIn: boolean;
      username?: string;
      tenantId?: string;
      subscriptionId?: string;
      error?: string;
    }> => {
      try {
        const result = await getToken('https://management.azure.com/.default', { silent: true });
        if (!result) {
          return { isLoggedIn: false };
        }
        const claims = parseTokenClaims(result.token);
        return {
          isLoggedIn: true,
          username: claims.upn ?? claims.preferred_username,
          tenantId: claims.tid,
        };
      } catch {
        return { isLoggedIn: false };
      }
    }
  );

  ipcMain.handle(
    'azure-login',
    async (): Promise<{
      success: boolean;
      username?: string;
      tenantId?: string;
      error?: string;
    }> => {
      try {
        const cred = getCredential();
        const authRecord = await cred.authenticate('https://management.azure.com/.default');
        if (authRecord) {
          AuthRecord.save(authRecord);
          credential = null;
        }
        return {
          success: true,
          username: authRecord?.username,
          tenantId: authRecord?.tenantId,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Login failed',
        };
      }
    }
  );

  ipcMain.handle('azure-logout', async (): Promise<{ success: boolean; error?: string }> => {
    try {
      credential = null;
      AuthRecord.clear();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Logout failed',
      };
    }
  });
};
