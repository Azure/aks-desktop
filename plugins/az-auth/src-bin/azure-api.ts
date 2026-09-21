// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  type AuthenticationRecord,
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
  credential: undefined as InteractiveBrowserCredential | undefined,

  /** Get a single instance of the azure interactive browser credentials */
  getCredential(): InteractiveBrowserCredential {
    if (!AzureApi.credential) {
      const authRecord = AuthRecord.load();

      AzureApi.credential = new InteractiveBrowserCredential({
        authenticationRecord: authRecord,
        disableAutomaticAuthentication: !authRecord,
        redirectUri: 'http://localhost',
        tokenCachePersistenceOptions: {
          enabled: true,
          unsafeAllowUnencryptedStorage: isWSL(),
        },
      });
    }
    return AzureApi.credential;
  },

  /** Request a token for given scopes */
  async getToken(scopes: string | string[], { silent }: { silent: boolean } = { silent: false }) {
    try {
      const cred = AzureApi.getCredential();
      const scopeArray = Array.isArray(scopes) ? scopes : [scopes];

      let result = await cred.getToken(scopeArray);

      if (!result && !silent) {
        await cred.authenticate(scopeArray);
        result = await cred.getToken(scopeArray);
      }

      return result ?? undefined;
    } catch (e) {
      if (silent) return undefined;
      console.error(e);
      throw new Error('Failed to acquire token');
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

      if (!result) {
        return { isLoggedIn: false };
      }

      function parseTokenClaims(token: string): {
        upn?: string;
        preferred_username?: string;
        tid?: string;
      } {
        const payload = token.split('.')[1];
        const decoded = Buffer.from(payload, 'base64').toString('utf-8');
        return JSON.parse(decoded);
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
      const cred = AzureApi.getCredential();
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
      console.error('error', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Login failed',
      };
    }
  },

  async logout() {
    try {
      AzureApi.credential = undefined;
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
