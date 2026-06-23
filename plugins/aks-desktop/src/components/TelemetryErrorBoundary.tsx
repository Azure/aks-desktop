// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert } from '@mui/material';
import React from 'react';
import { trackException } from '../telemetry';

interface State {
  hasError: boolean;
}

interface Props {
  children: React.ReactNode;
}

function ErrorFallback() {
  const { t } = useTranslation();
  return <Alert severity="error">{t('An error occurred in this view.')}</Alert>;
}

/**
 * Plugin-subtree error boundary. Reports Error.name through the
 * telemetry chokepoint and renders an Alert fallback. The headlamp
 * shell is intentionally not wrapped.
 *
 * Class component — getDerivedStateFromError and componentDidCatch
 * have no hooks equivalent.
 */
export class TelemetryErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[aksd] TelemetryErrorBoundary caught:', error, errorInfo.componentStack);
    try {
      trackException(error.name);
    } catch (telemetryError) {
      // eslint-disable-next-line no-console
      console.error('[aksd] TelemetryErrorBoundary: trackException threw', telemetryError);
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
