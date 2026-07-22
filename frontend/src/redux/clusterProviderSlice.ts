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

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { ApiError } from '../lib/k8s/api/v2/ApiError';

export interface DialogProps {
  cluster: any;
  openConfirmDialog: string;
  setOpenConfirmDialog: (value: string) => void;
}

export interface MenuItemProps {
  cluster: any;
  handleMenuClose: () => void;
  setOpenConfirmDialog: (value: string) => void;
}

export interface ClusterStatusProps {
  cluster: any;
  error: ApiError | null | undefined;
}

export type DialogComponent = (props: DialogProps) => React.ReactElement | null;
export type MenuItemComponent = (props: MenuItemProps) => React.ReactElement | null;
export type ClusterStatusComponent = (props: ClusterStatusProps) => React.ReactElement | null;

/**
 * Context passed to a {@link ClusterPreOpenHook} when a cluster is about to be opened.
 */
export interface ClusterPreOpenContext {
  /** The name of the cluster being opened. */
  cluster: string;
  /**
   * The cluster's configuration, as known to the app, or `null` if unavailable.
   * Typed `unknown` so this slice does not depend on the k8s cluster
   * types while still requiring hook authors to narrow before use.
   */
  clusterConf: unknown;
  /**
   * Reports human-readable progress for the "connecting" popup shown while the
   * cluster is being prepared (e.g. "Starting proxy…", "Verifying connection…").
   * Optional — hooks that don't report progress just show a generic message.
   */
  reportProgress?: (message: string) => void;
}

/**
 * A hook run once, before a cluster's views are rendered.
 *
 * Use it to perform any asynchronous preparation a cluster needs before it can
 * be used — starting a proxy/tunnel, refreshing credentials, writing a
 * kubeconfig context, warming a cache, etc. Hooks run for every cluster, so a
 * hook that only applies to certain clusters should inspect the context and
 * resolve immediately for the ones it does not own.
 *
 * The returned promise gates entry to the cluster: while it is pending the app
 * shows a neutral loading state, and if it rejects the thrown error's message
 * is surfaced to the user with a retry affordance. Resolve to allow the cluster
 * to open.
 */
export type ClusterPreOpenHook = (context: ClusterPreOpenContext) => Promise<void>;

/**
 * Information about a cluster provider, that is shown on the add cluster page.
 */
export interface ClusterProviderInfo {
  /** The title of the provider. */
  title: string;
  /** An icon component, an imported SVG. */
  icon: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
  /** Description of the provider. Explaining a bit about what it is. */
  description: string;
  /** Url for where the Add button should go to. */
  url: string;
}

export interface ClusterProviderSliceState {
  /** Dialog components that can be rendered by the application, on the Home. */
  dialogs: DialogComponent[];
  /** Menu items that can be rendered by the application, on the Home page in the cluster action menu. */
  menuItems: MenuItemComponent[];
  /** Cluster providers for the Add Cluster page. */
  clusterProviders: ClusterProviderInfo[];
  /** Cluster statuses for the Home page. */
  clusterStatuses: ClusterStatusComponent[];
  /** Hooks run before a cluster is opened, to prepare it (e.g. start a proxy). */
  preOpenHooks: ClusterPreOpenHook[];
  /**
   * Clusters currently being prepared by pre-open hooks, mapped to the latest
   * progress message (empty string until a hook reports one). Presence in this
   * map means "preparation in progress" — used to show the connecting popup and
   * to suppress the app's "Lost connection" health banner during preparation.
   */
  preparing: Record<string, string>;
}

export const initialState: ClusterProviderSliceState = {
  menuItems: [],
  dialogs: [],
  clusterProviders: [],
  clusterStatuses: [],
  preOpenHooks: [],
  preparing: Object.create(null),
};

const clusterProviderSlice = createSlice({
  name: 'clusterProviderSlice',
  initialState,
  reducers: {
    addDialog(state, action: PayloadAction<DialogComponent>) {
      state.dialogs.push(action.payload);
    },
    addMenuItem(state, action: PayloadAction<MenuItemComponent>) {
      state.menuItems.push(action.payload);
    },
    addAddClusterProvider(state, action: PayloadAction<ClusterProviderInfo>) {
      state.clusterProviders.push(action.payload);
    },
    addClusterStatus(state, action: PayloadAction<ClusterStatusComponent>) {
      state.clusterStatuses.push(action.payload);
    },
    addPreOpenHook(state, action: PayloadAction<ClusterPreOpenHook>) {
      state.preOpenHooks.push(action.payload);
    },
    /** Marks a cluster as being prepared, optionally with a progress message. */
    setClusterPreparing(state, action: PayloadAction<{ cluster: string; message?: string }>) {
      // Ensure a null-prototype map, including when rehydrating persisted/older
      // state that predates this field or was stored as a plain object.
      if (!state.preparing || Object.getPrototypeOf(state.preparing) !== null) {
        state.preparing = Object.assign(Object.create(null), state.preparing);
      }
      state.preparing[action.payload.cluster] = action.payload.message ?? '';
    },
    /** Clears a cluster's preparing state once its pre-open hooks settle. */
    clearClusterPreparing(state, action: PayloadAction<string>) {
      if (state.preparing) {
        delete state.preparing[action.payload];
      }
    },
  },
});

export const {
  addDialog,
  addMenuItem,
  addAddClusterProvider,
  addClusterStatus,
  addPreOpenHook,
  setClusterPreparing,
  clearClusterPreparing,
} = clusterProviderSlice.actions;

export default clusterProviderSlice.reducer;
