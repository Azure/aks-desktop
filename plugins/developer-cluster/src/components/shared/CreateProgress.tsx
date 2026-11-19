// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// A running Create on the Create step and on Overview: the progress text and indicator, then a note
// that the first create downloads components for 10-15 minutes without visible progress, so a quiet
// page is not mistaken for a hung create. The CLI reports no download progress the page could show
// instead.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Stack, Typography } from '@mui/material';
import { InfoBanner } from './InfoBanner';
import { ProgressNotice } from './Progress';

/** The first-run download time the plugin owner observed (2026-10-26). */
const FIRST_RUN_MINUTES_MIN = 10;
const FIRST_RUN_MINUTES_MAX = 15;

/**
 * A running Create: its progress and the first-run note.
 *
 * @returns The progress notice and the note about the first-run download time.
 */
export function CreateProgress() {
  const { t } = useTranslation();
  return (
    <Stack spacing={3}>
      <ProgressNotice text={String(t('Creating your Developer Cluster'))} />
      <InfoBanner title={String(t('The first cluster takes longer.'))}>
        <Typography variant="body2" color="text.secondary">
          {t(
            'Developer Cluster downloads Kubernetes components and container images during the first setup. This can take {{min}}-{{max}} minutes. Download progress is not shown, so this page may appear idle. It updates when the cluster is ready or if setup fails. Keep Windows connected to the internet during setup.',
            { min: FIRST_RUN_MINUTES_MIN, max: FIRST_RUN_MINUTES_MAX }
          )}
        </Typography>
      </InfoBanner>
    </Stack>
  );
}
