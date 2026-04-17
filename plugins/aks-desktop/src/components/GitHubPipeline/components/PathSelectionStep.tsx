// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, ButtonBase, Chip, Paper, Typography } from '@mui/material';
import React from 'react';

export type DeployPathChoice = 'fast' | 'fast-with-ai' | 'agent';

interface PathOption {
  /** Machine identifier used to key the selection state. */
  id: DeployPathChoice;
  /** Iconify icon name rendered at the start of the option card. */
  icon: string;
  /** Short display title for the option (localized). */
  title: string;
  /** Paragraph explaining when to pick this path (localized). */
  description: string;
  /** Approximate duration label shown in caption style (localized). */
  time: string;
  /** When true, the card shows a "Recommended" chip next to the title. */
  recommended?: boolean;
}

interface PathSelectionStepProps {
  /** Repo-relative path of the detected Dockerfile, shown in the subtitle. */
  dockerfilePath: string;
  /** Currently selected path choice, or `null` if none. */
  selected: DeployPathChoice | null;
  /** Invoked when the user picks one of the option cards. */
  onSelect: (choice: DeployPathChoice) => void;
}

export function PathSelectionStep({ dockerfilePath, selected, onSelect }: PathSelectionStepProps) {
  const { t } = useTranslation();

  const options: PathOption[] = [
    {
      id: 'fast',
      icon: 'mdi:rocket-launch-outline',
      title: t('Deploy now'),
      description: t(
        'Generate a tested workflow and K8s manifests from your Dockerfile. Deterministic, no AI needed.'
      ),
      time: t('~3-5 min'),
      recommended: true,
    },
    {
      id: 'fast-with-ai',
      icon: 'mdi:rocket-launch-outline',
      title: t('Deploy now + AI suggestions'),
      description: t(
        'Same fast deploy, plus Copilot will open a PR with Dockerfile and manifest optimization suggestions.'
      ),
      time: t('~3-5 min deploy + async suggestions'),
    },
    {
      id: 'agent',
      icon: 'mdi:robot-outline',
      title: t('Full AI generation'),
      description: t(
        'Let the Copilot Coding Agent generate everything from scratch — Dockerfile, manifests, and workflow.'
      ),
      time: t('~15-40 min'),
    },
  ];

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Icon icon="mdi:source-branch-check" width={28} height={28} />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t('Choose deployment path')}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {t('Dockerfile found at')}{' '}
        <Box component="code" sx={{ fontWeight: 600 }}>
          {dockerfilePath}
        </Box>
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {options.map(opt => {
          const isSelected = selected === opt.id;
          return (
            <Paper
              key={opt.id}
              variant="outlined"
              component={ButtonBase}
              onClick={() => onSelect(opt.id)}
              aria-pressed={isSelected}
              sx={{
                width: '100%',
                textAlign: 'left',
                p: 2,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 2,
                borderColor: isSelected ? 'primary.main' : 'divider',
                borderWidth: isSelected ? 2 : 1,
                bgcolor: isSelected ? 'action.selected' : 'transparent',
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: 'action.hover',
                },
                '&:focus-visible': {
                  outline: theme => `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: 2,
                },
                transition: 'all 0.15s',
              }}
            >
              <Box
                component={Icon}
                icon={opt.icon}
                sx={{
                  fontSize: 24,
                  mt: 0.25,
                  color: isSelected ? 'primary.main' : 'text.secondary',
                  flexShrink: 0,
                }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {opt.title}
                  </Typography>
                  {opt.recommended && (
                    <Chip label={t('Recommended')} size="small" color="primary" />
                  )}
                </Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
                  {opt.description}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                  {opt.time}
                </Typography>
              </Box>
            </Paper>
          );
        })}
      </Box>
    </>
  );
}
