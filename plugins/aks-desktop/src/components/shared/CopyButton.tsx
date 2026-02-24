// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { IconButton, Tooltip } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard API may be unavailable in some Electron contexts
      });
  };

  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'}>
      <IconButton size="small" aria-label="Copy to clipboard" onClick={handleCopy} sx={{ ml: 0.5 }}>
        <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={16} />
      </IconButton>
    </Tooltip>
  );
}
