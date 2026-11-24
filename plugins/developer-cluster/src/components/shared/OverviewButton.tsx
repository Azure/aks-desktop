// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The link to Overview, which shows the registered cluster.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { PLUGIN_ROUTES } from '../../contract/routes';

/**
 * Go to Overview, a link button to Overview.
 *
 * @param props - The button variant.
 * @returns The link button.
 */
export function OverviewButton({
  variant = 'outlined',
}: {
  /** The MUI button variant; defaults to `outlined`. */
  readonly variant?: 'outlined' | 'contained';
}) {
  const { t } = useTranslation();
  return (
    <Button component={Link} to={PLUGIN_ROUTES.overview} variant={variant}>
      {t('Go to Overview')}
    </Button>
  );
}
