// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Button, Dialog } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import DeployWizard from '../DeployWizard/DeployWizard';

export interface ProjectDefinition {
  id: string;
  namespaces: string[];
  clusters: string[];
}

type Project = ProjectDefinition;

interface DeployButtonProps {
  project: Project;
}

function DeployButton({ project }: DeployButtonProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const history = useHistory();
  const [initialApplicationName, setInitialApplicationName] = useState<string | undefined>(
    undefined
  );

  // Check for URL parameters on component mount
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const openDeploy = searchParams.get('openDeploy');
    const applicationName = searchParams.get('applicationName');

    if (openDeploy === 'true') {
      setOpen(true);
      if (applicationName) {
        setInitialApplicationName(applicationName);
      }

      // Clean up URL parameters using React Router
      searchParams.delete('openDeploy');
      searchParams.delete('applicationName');
      const newSearch = searchParams.toString();
      const newPath = newSearch ? `${location.pathname}?${newSearch}` : location.pathname;
      history.replace(newPath);
    }
  }, [location, history]);

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setInitialApplicationName(undefined);
  };

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        startIcon={<Icon icon="mdi:cloud-upload" />}
        onClick={handleClickOpen}
        sx={{
          textTransform: 'none',
          fontWeight: 'bold',
        }}
      >
        Deploy Application
      </Button>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            height: '90vh',
            maxHeight: '90vh',
          },
        }}
      >
        <DeployWizard
          cluster={project.clusters?.[0] || undefined}
          namespace={project.namespaces?.[0] || undefined}
          initialApplicationName={initialApplicationName}
          onClose={handleClose}
        />
      </Dialog>
    </>
  );
}

export default DeployButton;
