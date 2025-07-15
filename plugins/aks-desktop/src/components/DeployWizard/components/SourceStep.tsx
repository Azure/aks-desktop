// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { alpha, Box, Card, CardContent, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';

type DeploymentSource = {
  type: 'container' | 'yaml';
  displayName: string;
  description: string;
  icon: 'container' | 'yaml';
  features: string[];
};

export interface SourceStepProps {
  sourceType: 'container' | 'yaml' | null;
  onSourceTypeChange: (type: 'container' | 'yaml') => void;
}

const deploymentSources: DeploymentSource[] = [
  {
    type: 'container',
    displayName: 'Container Image',
    description: 'Deploy from Azure Container Registry, Docker Hub, or GHCR',
    icon: 'container',
    features: [
      'Auto-generated Deployment and Service manifests',
      'Guided configuration for ports, replicas, env, and resources',
      'No Kubernetes expertise required to get started',
    ],
  },
  {
    type: 'yaml',
    displayName: 'Kubernetes YAML',
    description: 'Bring your own Kubernetes manifests to deploy',
    icon: 'yaml',
    features: [
      'Use existing manifests for full control',
      'Multi-file support (Deployments, Services, Ingress, etc.)',
      'Preview and basic validation before apply',
    ],
  },
];

export default function SourceStep({ sourceType, onSourceTypeChange }: SourceStepProps) {
  const theme = useTheme();
  return (
    <Box>
      <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, mb: 1 }}>
        Select Source
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Choose a source for your deployment (container image, repo, etc.).
      </Typography>
      <Box sx={{ display: 'flex', gap: 3, mt: 2 }}>
        {deploymentSources.map(source => {
          const selected = sourceType === source.type;
          const iconName =
            source.icon === 'container' ? 'mdi:cube-outline' : 'mdi:file-code-outline';
          return (
            <Card
              key={source.type}
              onClick={() => onSourceTypeChange(source.type)}
              elevation={selected ? 4 : 1}
              sx={{
                flex: 1,
                cursor: 'pointer',
                position: 'relative',
                border: selected ? '2px solid' : '1px solid',
                borderColor: selected ? 'primary.main' : 'divider',
                borderRadius: 3,
                backgroundColor: selected ? alpha('#1976d2', 0.04) : 'background.paper',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                overflow: 'visible',
                display: 'flex',
                flexDirection: 'column',
                height: '42vh',
                minHeight: '350px',
                maxHeight: '500px',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: selected ? 6 : 4,
                  borderColor: selected ? 'primary.main' : 'primary.light',
                },
              }}
            >
              <CardContent
                sx={{
                  p: 3,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  '&:last-child': { pb: 3 },
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    mb: 2,
                  }}
                >
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: 2,
                      display: 'flex',
                      backgroundColor: selected ? 'primary.main' : alpha('#1976d2', 0.08),
                      alignItems: 'center',
                      justifyContent: 'center',
                      mb: 2,
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <Icon icon={iconName} width={36} height={36} color="contrastText" />
                  </Box>
                  {selected && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        backgroundColor: 'primary.main',
                        borderRadius: '50%',
                        width: 28,
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: 2,
                        zIndex: 1,
                      }}
                    >
                      <Icon
                        icon="mdi:check"
                        color={theme.palette.getContrastText(theme.palette.primary.main)}
                        width={18}
                        height={18}
                      />
                    </Box>
                  )}
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 600,
                      color: selected ? 'primary.main' : 'text.primary',
                      textAlign: 'center',
                      mb: 1.5,
                    }}
                  >
                    {source.displayName}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2.5, textAlign: 'center', lineHeight: 1.6, maxWidth: '90%' }}
                  >
                    {source.description}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-start',
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{
                      fontWeight: 600,
                      mb: 1.5,
                      color: selected ? 'primary.main' : 'text.primary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      fontSize: '0.7rem',
                    }}
                  >
                    Features
                  </Typography>
                  <Box
                    component="ul"
                    sx={{
                      mt: 0,
                      pl: 2.5,
                      m: 0,
                      listStyle: 'none',
                      position: 'relative',
                    }}
                  >
                    {source.features.map(feature => (
                      <Box
                        component="li"
                        key={feature}
                        sx={{
                          position: 'relative',
                          pl: 2.5,
                          mb: 1.5,
                          '&::before': {
                            content: '""',
                            position: 'absolute',
                            left: 0,
                            top: '0.5em',
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            backgroundColor: selected ? 'primary.main' : 'text.secondary',
                          },
                          '&:last-child': {
                            mb: 0,
                          },
                        }}
                      >
                        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                          {feature}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}
