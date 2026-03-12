// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import AksLogo from './aks-logo.svg';

export default function AzureLogo() {
  const { t } = useTranslation();
  return <AksLogo aria-label={t('AKS desktop logo')} style={{ height: '2rem' }} />;
}
