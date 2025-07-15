// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Alert, AlertTitle, Box, Button, Link, List, ListItem, ListItemText } from '@mui/material';
import React, { useState } from 'react';

interface AzureCliWarningProps {
  suggestions: string[];
}

// Function to parse text and convert URLs to clickable links
const parseTextWithLinks = (text: string) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      return (
        <Link
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            textDecoration: 'underline',
            '&:hover': {
              textDecoration: 'underline',
            },
          }}
        >
          {part}
        </Link>
      );
    }
    return part;
  });
};

const AzureCliWarning: React.FC<AzureCliWarningProps> = ({ suggestions }) => {
  const [visible, setVisible] = useState(true);
  if (!visible || suggestions.length === 0) return null;

  return (
    <Box sx={{ mb: 2 }}>
      <Alert
        severity="warning"
        onClose={() => setVisible(false)}
        sx={{
          fontSize: '1rem',
          zIndex: 1000,
        }}
      >
        <AlertTitle>
          <strong>Azure CLI/aks-preview requirements not met:</strong>
        </AlertTitle>
        <List dense sx={{ mt: 1, mb: 1 }}>
          {suggestions.map((msg, i) => (
            <ListItem key={i} sx={{ py: 0.5, px: 0 }}>
              <ListItemText primary={<Box component="span">• {parseTextWithLinks(msg)}</Box>} />
            </ListItem>
          ))}
        </List>
        <Button
          variant="contained"
          color="warning"
          size="small"
          sx={{ mt: 1 }}
          onClick={() => setVisible(false)}
        >
          Dismiss
        </Button>
      </Alert>
    </Box>
  );
};

export default AzureCliWarning;
