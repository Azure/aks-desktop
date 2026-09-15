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

import { describe, expect, it } from 'vitest';
import type { MCPServer, MCPSettings } from '../types';
import { reconcileBuiltinServers } from './builtinServers';

const EMPTY: MCPSettings = { enabled: false, servers: [] };
const BUILTIN: MCPServer = {
  name: 'builtin-server',
  command: 'builtin-server',
  args: ['serve'],
  enabled: true,
};

function configWithServer(server: MCPServer = BUILTIN): MCPSettings {
  return { enabled: true, servers: [server] };
}

describe('reconcileBuiltinServers', () => {
  it('adds a built-in server and enables MCP', () => {
    const result = reconcileBuiltinServers(EMPTY, [BUILTIN]);

    expect(result.changed).toBe(true);
    expect(result.config).toEqual(configWithServer());
    expect(result.state[BUILTIN.name]).toEqual({ command: BUILTIN.command, args: BUILTIN.args });
  });

  it('makes no changes when the built-in is already up to date', () => {
    const seeded = reconcileBuiltinServers(EMPTY, [BUILTIN]);
    const again = reconcileBuiltinServers(seeded.config, [BUILTIN], seeded.state);

    expect(again.changed).toBe(false);
    expect(again.stateChanged).toBe(false);
    expect(again.config).toBe(seeded.config);
  });

  it('refreshes the plugin-owned definition while preserving user toggles', () => {
    const oldBuiltin = { ...BUILTIN, args: ['old'] };
    const stored = configWithServer({ ...oldBuiltin, enabled: false, autoApprove: true });
    const state = { [BUILTIN.name]: { command: oldBuiltin.command, args: oldBuiltin.args } };

    const result = reconcileBuiltinServers(stored, [BUILTIN], state);

    expect(result.config.servers[0]).toEqual({ ...BUILTIN, enabled: false, autoApprove: true });
  });

  it('does not overwrite a definition the user edited', () => {
    const customized = { ...BUILTIN, args: ['custom'] };
    const state = { [BUILTIN.name]: { command: BUILTIN.command, args: ['old'] } };

    const result = reconcileBuiltinServers(configWithServer(customized), [BUILTIN], state);

    expect(result.changed).toBe(false);
    expect(result.config.servers[0]).toBe(customized);
  });

  it('treats environments with different key order as unchanged', () => {
    const builtin = { ...BUILTIN, env: { A: '1', B: '2' } };
    const stored = configWithServer({ ...builtin, env: { B: '2', A: '1' } });
    const state = {
      [BUILTIN.name]: { command: builtin.command, args: builtin.args, env: builtin.env },
    };

    expect(reconcileBuiltinServers(stored, [builtin], state).changed).toBe(false);
  });

  it('does not reseed a server the user removed', () => {
    const state = { [BUILTIN.name]: { command: BUILTIN.command, args: BUILTIN.args } };

    expect(reconcileBuiltinServers(EMPTY, [BUILTIN], state).changed).toBe(false);
  });

  it('does not adopt a same-named server the user created', () => {
    const custom = { ...BUILTIN, command: '/custom/server' };

    const result = reconcileBuiltinServers(configWithServer(custom), [BUILTIN]);

    expect(result.changed).toBe(false);
    expect(result.config.servers[0]).toBe(custom);
  });

  it('upgrades legacy state when the built-in still exists', () => {
    const result = reconcileBuiltinServers(configWithServer(), [BUILTIN], [BUILTIN.name]);

    expect(result.changed).toBe(false);
    expect(result.stateChanged).toBe(true);
    expect(result.state[BUILTIN.name]).toEqual({ command: BUILTIN.command, args: BUILTIN.args });
  });

  it('removes a retired plugin-owned server and disables an empty MCP config', () => {
    const state = { [BUILTIN.name]: { command: BUILTIN.command, args: BUILTIN.args } };

    const result = reconcileBuiltinServers(configWithServer(), [], state);

    expect(result.changed).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(result.config).toEqual(EMPTY);
    expect(result.state).toEqual({});
  });

  it('preserves a customized retired server and forgets plugin ownership', () => {
    const customized = { ...BUILTIN, args: ['custom'] };
    const state = { [BUILTIN.name]: { command: BUILTIN.command, args: BUILTIN.args } };

    const result = reconcileBuiltinServers(configWithServer(customized), [], state);

    expect(result.changed).toBe(false);
    expect(result.stateChanged).toBe(true);
    expect(result.config.servers[0]).toBe(customized);
    expect(result.state).toEqual({});
  });

  it('preserves a legacy retired server whose original definition is unknown', () => {
    const result = reconcileBuiltinServers(configWithServer(), [], [BUILTIN.name]);

    expect(result.changed).toBe(false);
    expect(result.stateChanged).toBe(true);
    expect(result.config.servers[0]).toBe(BUILTIN);
    expect(result.state).toEqual({});
  });

  it('preserves unrelated servers when retiring a built-in', () => {
    const other = { name: 'other', command: 'other', args: [], enabled: true };
    const config = { enabled: true, servers: [BUILTIN, other] };
    const state = { [BUILTIN.name]: { command: BUILTIN.command, args: BUILTIN.args } };

    const result = reconcileBuiltinServers(config, [], state);

    expect(result.config).toEqual({ enabled: true, servers: [other] });
  });
});
