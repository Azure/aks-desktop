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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopApi } from '../types/electron';

const mockStoreGet = vi.fn();
const mockStoreUpdate = vi.fn();

vi.mock('../pluginState', () => ({
  pluginStore: {
    get: mockStoreGet,
    update: mockStoreUpdate,
  },
}));

const { retireBuiltinMCPServers } = await import('./retireBuiltinServers');

const server = {
  name: 'aks-mcp',
  command: 'aks-mcp',
  args: ['--transport', 'stdio'],
  enabled: true,
};
const state = {
  [server.name]: { command: server.command, args: server.args },
};

function setMcpApi(getConfig: () => Promise<unknown>, updateConfig = vi.fn()) {
  window.desktopApi = { mcp: { getConfig, updateConfig } } as unknown as DesktopApi;
  return updateConfig;
}

describe('retireBuiltinMCPServers', () => {
  beforeEach(() => {
    mockStoreGet.mockReset();
    mockStoreUpdate.mockReset();
    delete window.desktopApi;
  });

  it('does nothing when no built-in ownership state was persisted', async () => {
    mockStoreGet.mockReturnValue({});
    const getConfig = vi.fn();
    setMcpApi(getConfig);

    await retireBuiltinMCPServers();

    expect(getConfig).not.toHaveBeenCalled();
    expect(mockStoreUpdate).not.toHaveBeenCalled();
  });

  it('removes an unchanged plugin-owned server from host and plugin state', async () => {
    mockStoreGet.mockReturnValue({ seededBuiltinMCPServers: state });
    const updateConfig = setMcpApi(
      vi.fn().mockResolvedValue({ success: true, config: { enabled: true, servers: [server] } }),
      vi.fn().mockResolvedValue({ success: true })
    );

    await retireBuiltinMCPServers();

    expect(updateConfig).toHaveBeenCalledWith({ enabled: false, servers: [] });
    expect(mockStoreUpdate).toHaveBeenCalledWith({
      mcpConfig: { enabled: false, servers: [] },
      seededBuiltinMCPServers: {},
    });
  });

  it('preserves a customized server while forgetting plugin ownership', async () => {
    mockStoreGet.mockReturnValue({ seededBuiltinMCPServers: state });
    const customized = { ...server, args: ['--access-level', 'admin'] };
    const updateConfig = setMcpApi(
      vi.fn().mockResolvedValue({
        success: true,
        config: { enabled: true, servers: [customized] },
      })
    );

    await retireBuiltinMCPServers();

    expect(updateConfig).not.toHaveBeenCalled();
    expect(mockStoreUpdate).toHaveBeenCalledWith({ seededBuiltinMCPServers: {} });
  });

  it('keeps plugin state when the host rejects the configuration update', async () => {
    mockStoreGet.mockReturnValue({ seededBuiltinMCPServers: state });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setMcpApi(
      vi.fn().mockResolvedValue({ success: true, config: { enabled: true, servers: [server] } }),
      vi.fn().mockResolvedValue({ success: false, error: 'write failed' })
    );

    await retireBuiltinMCPServers();

    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to retire built-in MCP servers:',
      'write failed'
    );
    consoleError.mockRestore();
  });
});
