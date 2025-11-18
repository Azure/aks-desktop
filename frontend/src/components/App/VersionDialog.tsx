/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Portions (c) Microsoft Corp.

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { getAksDesktopVersion, getProductName, getVersion } from '../../helpers/getProductInfo';
import { useTypedSelector } from '../../redux/hooks';
import { uiSlice } from '../../redux/uiSlice';
import { Dialog } from '../common/Dialog';
import NameValueTable from '../common/NameValueTable';
import Tabs from '../common/Tabs';

export default function VersionDialog(props: {
  getVersion?: () => {
    VERSION: any;
    GIT_VERSION: any;
  };
  getAksDesktopVersion?: () => string | undefined;
}) {
  const open = useTypedSelector(state => state.ui.isVersionDialogOpen);
  const dispatch = useDispatch();
  const { t } = useTranslation(['glossary', 'translation']);
  const { VERSION, GIT_VERSION } = props.getVersion ? props.getVersion() : getVersion();
  const aksDesktopVersion = props.getAksDesktopVersion
    ? props.getAksDesktopVersion()
    : getAksDesktopVersion();

  const [fileDialogOpen, setFileDialogOpen] = React.useState(false);
  const [fileDialogTitle, setFileDialogTitle] = React.useState('');
  const [fileDialogContent, setFileDialogContent] = React.useState('');

  const rows = [
    {
      name: t('AKS desktop Version'),
      value: aksDesktopVersion || 'N/A',
    },
    {
      name: t('Headlamp Version'),
      value: VERSION,
    },
    {
      name: t('Git Commit'),
      value: GIT_VERSION,
    },
  ];

  const handleOpenFile = async (filename: 'LICENSE' | 'NOTICE.md', displayName: string) => {
    if (window.desktopApi?.getLicenseFile) {
      try {
        const result = await window.desktopApi.getLicenseFile(filename);
        if (result.success && result.content) {
          setFileDialogTitle(displayName);
          setFileDialogContent(result.content);
          setFileDialogOpen(true);
        } else {
          console.error(`Failed to load ${filename}:`, result.error);
        }
      } catch (error) {
        console.error(`Error loading ${filename}:`, error);
      }
    } else {
      // Fallback for web mode - open in new tab
      const url = `/${filename}`;
      window.open(url, '_blank');
    }
  };

  const AboutTab = () => <NameValueTable rows={rows} />;

  const LegalTab = () => (
    <Box sx={{ p: 2 }}>
      <Typography variant="body1" paragraph>
        As installed, this program contains software and functionality that is either open source or
        provided under the terms governing your use of Microsoft Azure.
      </Typography>
      <Typography variant="body1" paragraph>
        For all software found at{' '}
        <Link href="https://github.com/Azure/aks-desktop" target="_blank" rel="noopener">
          https://github.com/Azure/aks-desktop
        </Link>
        , such software is provided under the terms of the Apache License, version 2.0.
      </Typography>
      <Typography variant="body1" paragraph>
        For any other software or functionality included in this install, it is governed by your
        agreement governing use of Azure that incorporates the Microsoft Product Terms (see in
        particular the section titled "Use of Software with the Online Service"). Additionally, the
        software is a preview version and subject to terms applicable to "Previews" as detailed in
        the "Universal License Terms for Online Services" section of the Product Terms and the
        Microsoft Products and Services Data Protection Addendum.
      </Typography>
      <Box sx={{ mt: 3 }}>
        <Typography variant="body1" paragraph>
          <Link
            component="button"
            onClick={() => handleOpenFile('LICENSE', 'Apache License 2.0')}
            sx={{ cursor: 'pointer' }}
          >
            Apache License 2.0 (LICENSE)
          </Link>
        </Typography>
        <Typography variant="body1" paragraph>
          <Link
            component="button"
            onClick={() => handleOpenFile('NOTICE.md', 'Third Party Notices')}
            sx={{ cursor: 'pointer' }}
          >
            Third Party Notices (NOTICE.md)
          </Link>
        </Typography>
      </Box>
    </Box>
  );

  const tabs = [
    {
      label: t('About'),
      component: <AboutTab />,
    },
    {
      label: t('Legal'),
      component: <LegalTab />,
    },
  ];

  return (
    <>
      <Dialog
        maxWidth="sm"
        open={open}
        onClose={() => dispatch(uiSlice.actions.setVersionDialogOpen(false))}
        title={getProductName()}
        aria-label={t('translation|Version information')}
        // We want the dialog to show on top of the cluster chooser one if needed
        style={{ zIndex: 1900 }}
      >
        <DialogContent>
          <Tabs tabs={tabs} ariaLabel={t('About dialog tabs')} />
        </DialogContent>
      </Dialog>

      {/* File content dialog */}
      <Dialog
        maxWidth="lg"
        open={fileDialogOpen}
        onClose={() => setFileDialogOpen(false)}
        title={fileDialogTitle}
        style={{ zIndex: 1950 }}
      >
        <DialogContent>
          <Box
            component="pre"
            sx={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              maxHeight: '70vh',
              overflow: 'auto',
            }}
          >
            {fileDialogContent}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFileDialogOpen(false)} color="primary">
            {t('translation|Close')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
