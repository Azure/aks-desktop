// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React, { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useTelemetryFeatureOpened } from '../../hooks/useTelemetryFeatureOpened';
import { trackAksFeature } from '../../telemetry/aksFeature';
import RegisterAKSClusterDialog from './RegisterAKSClusterDialog';

/**
 * Page component for the AKS cluster registration flow
 * This is rendered when user clicks "Add" on the AKS cluster provider
 */
export default function RegisterAKSClusterPage() {
  const [open, setOpen] = useState(true);
  const history = useHistory();
  const terminalStatusRef = useRef<'active' | 'cancelled' | 'failed' | 'succeeded'>('active');
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useTelemetryFeatureOpened('aksd.cluster-add');

  useEffect(() => {
    return () => {
      if (navigationTimerRef.current !== null) {
        clearTimeout(navigationTimerRef.current);
      }
    };
  }, []);

  const handleClose = () => {
    if (terminalStatusRef.current === 'active') {
      terminalStatusRef.current = 'cancelled';
      trackAksFeature('aksd.cluster-add', 'cancelled');
    }

    setOpen(false);
    // Navigate back to home/clusters page
    if (navigationTimerRef.current === null) {
      navigationTimerRef.current = setTimeout(() => {
        navigationTimerRef.current = null;
        history.push('/');
      }, 100);
    }
  };

  const handleClusterRegistered = () => {
    if (terminalStatusRef.current === 'active') {
      terminalStatusRef.current = 'succeeded';
    }
    // Dialog will handle reload, so no need to do anything here
  };

  const handleRegistrationStarted = () => {
    terminalStatusRef.current = 'active';
  };

  const handleRegistrationFinished = (outcome: 'failed' | 'succeeded') => {
    terminalStatusRef.current = outcome;
  };

  return (
    <RegisterAKSClusterDialog
      open={open}
      onClose={handleClose}
      onClusterRegistered={handleClusterRegistered}
      onRegistrationFinished={handleRegistrationFinished}
      onRegistrationStarted={handleRegistrationStarted}
    />
  );
}
