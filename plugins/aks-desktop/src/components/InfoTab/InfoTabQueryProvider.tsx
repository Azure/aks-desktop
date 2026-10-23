// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { managedNamespaceQueryClient } from '../../utils/azure/managedNamespaceQueries';

export default function InfoTabQueryProvider({ children }: React.PropsWithChildren) {
  return <QueryClientProvider client={managedNamespaceQueryClient}>{children}</QueryClientProvider>;
}
