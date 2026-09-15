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

import { reconcileBuiltinServers } from '@headlamp-k8s/ai-common/mcp/config/builtinServers';
import type { MCPSettings } from '@headlamp-k8s/ai-common/mcp/types';
import { pluginStore } from '../pluginState';

const EMPTY_MCP_CONFIG: MCPSettings = { enabled: false, servers: [] };

/**
 * Removes servers seeded by earlier plugin versions when their definitions are
 * still unchanged. Customized servers remain user-owned and are preserved.
 *
 * This is an upgrade migration for persisted `seededBuiltinMCPServers` state.
 * The startup call and this module can be removed after releases containing
 * that state no longer need a supported upgrade path.
 */
export async function retireBuiltinMCPServers(): Promise<void> {
  const previousState = pluginStore.get()?.seededBuiltinMCPServers;
  if (!previousState || Object.keys(previousState).length === 0) return;

  const mcpApi = typeof window === 'undefined' ? undefined : window.desktopApi?.mcp;
  if (!mcpApi) return;

  try {
    const response = await mcpApi.getConfig();
    if (!response?.success || !Array.isArray(response.config?.servers)) {
      console.error(
        'Failed to read MCP configuration before retiring built-in servers:',
        response?.error
      );
      return;
    }

    const currentConfig = { ...EMPTY_MCP_CONFIG, ...response.config } as MCPSettings;
    const result = reconcileBuiltinServers(currentConfig, [], previousState);
    if (!result.changed) {
      if (result.stateChanged) {
        pluginStore.update({ seededBuiltinMCPServers: result.state });
      }
      return;
    }

    const updateResponse = await mcpApi.updateConfig(result.config);
    if (!updateResponse?.success) {
      console.error('Failed to retire built-in MCP servers:', updateResponse?.error);
      return;
    }

    pluginStore.update({
      mcpConfig: result.config,
      seededBuiltinMCPServers: result.state,
    });
  } catch (error) {
    console.error('Error retiring built-in MCP servers:', error);
  }
}
