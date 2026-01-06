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
  ClickAnalyticsPlugin,
  IClickAnalyticsConfiguration,
} from '@microsoft/applicationinsights-clickanalytics-js';
import {
  AppInsightsContext,
  ReactPlugin,
  useAppInsightsContext,
  withAITracking,
} from '@microsoft/applicationinsights-react-js';
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { useEffect, useRef, useState } from 'react';

export enum AppInsightsEventType {
  AppInitialize = 'AppInitialize',
  UserLoginSuccess = 'UserLoginSuccess',
  UserSwitchNamespace = 'UserSwitchNamespace',
  UserSwitchPartition = 'UserSwitchPartition',
}

// Lazy-initialized plugins - only created when needed
let reactPlugin: ReactPlugin | null = null;
let clickAnalyticsPlugin: ClickAnalyticsPlugin | null = null;

function getPlugins() {
  if (!reactPlugin) {
    reactPlugin = new ReactPlugin();
  }
  if (!clickAnalyticsPlugin) {
    clickAnalyticsPlugin = new ClickAnalyticsPlugin();
  }
  return { reactPlugin, clickAnalyticsPlugin };
}

const EntireApp_ = ({ children }: { children: React.ReactNode }) => {
  const appInsights = useAppInsightsContext();

  useEffect(() => {
    appInsights.trackEvent({ name: AppInsightsEventType.AppInitialize });
  }, [appInsights]);

  return <>{children}</>;
};

export const MyAppInsights = ({ children }: { children: React.ReactNode }) => {
  const initialized = useRef<boolean>(false);
  const [isReady, setIsReady] = useState<boolean>(false);
  const pluginsRef = useRef<{
    reactPlugin: ReactPlugin;
    clickAnalyticsPlugin: ClickAnalyticsPlugin;
  } | null>(null);
  const connectionString = import.meta.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING || '';

  useEffect(() => {
    // If no connection string, skip AppInsights initialization
    if (!connectionString) {
      setIsReady(true);
      return;
    }

    if (!initialized.current) {
      console.log('[AppInsights] Initializing Application Insights...');

      // Lazy-initialize plugins only when needed
      const plugins = getPlugins();
      pluginsRef.current = plugins;

      const clickAnalyticsConfig: IClickAnalyticsConfiguration = {
        autoCapture: true,
        dataTags: {
          customDataPrefix: 'data-event-',
        },
      };

      const appInsights = new ApplicationInsights({
        config: {
          connectionString,
          extensions: [plugins.reactPlugin, plugins.clickAnalyticsPlugin],
          extensionConfig: {
            [plugins.clickAnalyticsPlugin.identifier]: clickAnalyticsConfig,
          },
          enableAutoRouteTracking: true,
        },
      });

      appInsights.loadAppInsights();
      initialized.current = true;
    }

    setIsReady(true);
  }, [connectionString]);

  // If no connection string, render children directly without wrapper
  if (!connectionString) {
    return <>{children}</>;
  }

  // Wait for initialization before rendering
  if (!isReady || !pluginsRef.current) {
    return null;
  }

  // Create the tracked component using the initialized plugin
  const EntireApp = withAITracking(pluginsRef.current.reactPlugin, EntireApp_);

  return (
    <AppInsightsContext.Provider value={pluginsRef.current.reactPlugin}>
      <EntireApp>{children}</EntireApp>
    </AppInsightsContext.Provider>
  );
};
