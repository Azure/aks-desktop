// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The link to Overview, which shows the registered cluster.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { PLUGIN_ROUTES } from '../../contract/routes';

export function OverviewButton({
  variant = 'outlined',
}: {
  readonly variant?: 'outlined' | 'contained';
}) {
  const { t } = useTranslation();
  return (
    <Button component={Link} to={PLUGIN_ROUTES.overview} variant={variant}>
      {t('Go to Overview')}
    </Button>
  );
}
