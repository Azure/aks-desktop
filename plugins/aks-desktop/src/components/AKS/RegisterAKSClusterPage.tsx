// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { RegisterAKSClusterDialog } from '../AKS';

/**
 * Page component for the AKS cluster registration flow
 * This is rendered when user clicks "Add" on the AKS cluster provider
 */
export default function RegisterAKSClusterPage() {
  const [open, setOpen] = useState(true);
  const history = useHistory();

  const handleClose = () => {
    setOpen(false);
    // Navigate back to home/clusters page
    setTimeout(() => {
      history.push('/');
    }, 100);
  };

  const handleClusterRegistered = () => {
    // Dialog will handle reload, so no need to do anything here
  };

  return (
    <RegisterAKSClusterDialog
      open={open}
      onClose={handleClose}
      onClusterRegistered={handleClusterRegistered}
    />
  );
}
