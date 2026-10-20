// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { trackFeature } from '../../telemetry';
import { CONTACT_US_URL } from '../../utils/constants/contactUs';
import { openExternalUrl } from '../../utils/shared/openExternalUrl';

/**
 * App-bar entry point for reaching the AKS Desktop team. Opens the AKS Desktop
 * feedback form, which owns the actual guidance so it stays editable without a
 * release.
 */
export default function ContactUsButton() {
  const { t } = useTranslation();

  return (
    <ActionButton
      description={t('Contact us')}
      longDescription={t('Get help, share feedback, or reach the AKS Desktop team')}
      icon="mdi:message-question-outline"
      iconButtonProps={{ color: 'inherit' }}
      // Deliberately the default 'action' style at every width, matching
      // Headlamp's own app-bar actions (see SettingsButton). Below `sm` TopBar
      // moves actions into an overflow menu and wraps each one in its own
      // MenuItem, so buttonStyle="menu" would nest a MenuItem inside a MenuItem:
      // invalid `<li>` in `<li>`, and — because the inner MenuItem is not
      // focusable and the outer one carries no handler — no way to activate the
      // action by keyboard at all. The IconButton this renders instead stays
      // focusable, and its aria-label supplies the accessible name.
      onClick={() => {
        // Attempt the navigation first: openExternalUrl is synchronous, so the
        // event records a click that was actually acted on. It still cannot
        // confirm the tab opened — it returns void, and a blocked popup or a
        // misconfigured redirect both look identical from here.
        openExternalUrl(CONTACT_US_URL);
        trackFeature({ feature: 'aksd.feedback', status: 'opened' });
      }}
    />
  );
}
