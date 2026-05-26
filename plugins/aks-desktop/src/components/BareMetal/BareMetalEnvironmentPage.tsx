// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import BareMetalEnvironmentDialog from './BareMetalEnvironmentDialog';

/**
 * Page component for the BareMetal test environment setup/teardown flow.
 * Rendered when the user clicks "Add" on the BareMetal Test Environment cluster provider.
 */
export default function BareMetalEnvironmentPage() {
  const [open, setOpen] = useState(true);
  const history = useHistory();

  const handleClose = () => {
    setOpen(false);
    setTimeout(() => {
      history.push('/');
    }, 100);
  };

  return <BareMetalEnvironmentDialog open={open} onClose={handleClose} />;
}
