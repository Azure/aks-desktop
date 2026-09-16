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
  type AuthenticationRecord,
  AuthenticationRequiredError,
  deserializeAuthenticationRecord,
  InteractiveBrowserCredential,
  serializeAuthenticationRecord,
  useIdentityPlugin,
} from '@azure/identity';
import { cachePersistencePlugin } from '@azure/identity-cache-persistence';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

useIdentityPlugin(cachePersistencePlugin);

const isWSL = () => {
  try {
    return fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
};

/**
 * Manage authentication record. It doesn't contain any sensitive information
 *
 * https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/identity/identity/samples/AzureIdentityExamples.md#persist-the-authentication-record
 **/
const AuthRecord = {
  PATH: path.join(os.homedir(), 'azure_auth_record.json'),
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

const AzureApi = {
  /** Create Azure interactive browser credentials */
  createCredential({ silent }: { silent: boolean }): InteractiveBrowserCredential {
    const authRecord = AuthRecord.load();

    return new InteractiveBrowserCredential({
      authenticationRecord: authRecord,
      disableAutomaticAuthentication: silent,
      redirectUri: 'http://localhost',
      tokenCachePersistenceOptions: {
        enabled: true,
        unsafeAllowUnencryptedStorage: isWSL(),
      },
    });
  },

  /** Request a token for given scopes */
  async getToken(
    scopes: string | string[],
    { silent }: { silent: boolean } = { silent: true }
  ): Promise<
    { success: true; token: string; expiresOnTimestamp?: number } | { success: false; error?: any }
  > {
    try {
      const cred = AzureApi.createCredential({ silent });
      const scopeArray = Array.isArray(scopes) ? scopes : [scopes];

      let result;
      try {
        result = await cred.getToken(scopeArray);
      } catch (err) {
        if (silent) {
          return { success: false, error: err };
        }

        if (!(err instanceof AuthenticationRequiredError)) {
          return { success: false, error: err };
        }
      }

      if (!result && !silent) {
        const authRecord = await cred.authenticate(scopeArray);
        if (authRecord) {
          AuthRecord.save(authRecord);
        }
        result = await cred.getToken(scopeArray);
      }

      if (!result) return { success: false };

      return {
        success: true,
        token: result.token,
        expiresOnTimestamp: result.expiresOnTimestamp ?? Date.now() + 3600000,
      };
    } catch (e) {
      if (silent) return { success: false, error: e };

      console.error('Get token failed', e);
      return { success: false, error: e };
    }
  },

  /** Get information about currently logged in user */
  async userInfo(): Promise<{
    isLoggedIn: boolean;
    username?: string;
    tenantId?: string;
  }> {
    try {
      const result = await AzureApi.getToken('https://management.azure.com/.default', {
        silent: true,
      });

      if (!result || !result.success) {
        return { isLoggedIn: false };
      }

      function parseTokenClaims(token: string): {
        upn?: string;
        preferred_username?: string;
        tid?: string;
      } {
        try {
          const payload = token.split('.')[1];
          const decoded = Buffer.from(payload, 'base64').toString('utf-8');
          return JSON.parse(decoded);
        } catch {
          return {};
        }
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
  },

  /** Trigger interactive login */
  async login() {
    try {
      const cred = AzureApi.createCredential({ silent: false });
      const authRecord = await cred.authenticate('https://management.azure.com/.default');
      if (authRecord) {
        AuthRecord.save(authRecord);
      }
      return {
        success: true,
        username: authRecord?.username,
        tenantId: authRecord?.tenantId,
      };
    } catch (err) {
      console.error('Error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Login failed',
      };
    }
  },

  async logout() {
    try {
      AuthRecord.clear();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Logout failed',
      };
    }
  },
};

const printResult = (result: unknown) => {
  if (process.stdout.closed) return;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'get-token': {
      const scopes = rest.length > 0 ? rest : ['https://management.azure.com/.default'];
      printResult(await AzureApi.getToken(scopes));
      process.exit(0);
      return;
    }
    case 'user-info': {
      printResult(await AzureApi.userInfo());
      process.exit(0);
      return;
    }
    case 'login': {
      printResult(await AzureApi.login());
      process.exit(0);
      return;
    }
    case 'logout': {
      printResult(await AzureApi.logout());
      process.exit(0);
      return;
    }
    default: {
      process.stderr.write(process.argv.join(' '));
      process.stderr.write('Usage: azure-api <get-token [SCOPES]|user-info|login|logout>\n');
      process.exit(1);
    }
  }
};

main().catch(err => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
