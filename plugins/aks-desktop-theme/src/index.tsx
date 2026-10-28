// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  Headlamp,
  registerAppBarAction,
  registerAppLogo,
  registerAppTheme,
  registerClusterEmptyState,
} from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import AKSClusterEmptyState from './components/ClusterEmptyState/AKSClusterEmptyState';
import ContactUsButton from './components/ContactUs/ContactUsButton';
import AzureLogo from './components/Logo/Logo';
import { CONTACT_US_URL } from './utils/constants/contactUs';
import { azureTheme } from './utils/shared/theme';

if (Headlamp.isRunningAsApp()) {
  Headlamp.setAppMenu(menus => {
    const helpMenu = menus?.find(menu => menu.id === 'original-help');
    if (helpMenu?.submenu) {
      const docIndex = helpMenu.submenu.findIndex(item => item.id === 'original-documentation');
      if (docIndex !== -1) {
        helpMenu.submenu[docIndex] = {
          label: 'Documentation',
          id: 'aks-documentation',
          url: 'https://aka.ms/aks/aks-desktop',
        };
      }

      const issueIndex = helpMenu.submenu.findIndex(item => item.id === 'original-open-issue');
      if (issueIndex !== -1) {
        helpMenu.submenu[issueIndex] = {
          label: 'Contact us',
          id: 'aks-contact-us',
          url: CONTACT_US_URL,
        };
      }
    }
    return menus;
  });

  registerAppLogo(AzureLogo);
  registerClusterEmptyState(AKSClusterEmptyState);
  registerAppTheme(azureTheme, { default: true });
  registerAppBarAction({ id: 'aksd.contact-us', action: () => <ContactUsButton /> });
}
