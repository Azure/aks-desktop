// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import MonacoEditor from '@monaco-editor/react';
import { Box, Button, Typography } from '@mui/material';
import React from 'react';

export interface ConfigureYAMLProps {
  yamlEditorValue: string;
  yamlError: string | null;
  onYamlChange: (value: string) => void;
  onYamlErrorChange: (error: string | null) => void;
}

export default function ConfigureYAML({
  yamlEditorValue,
  yamlError,
  onYamlChange,
  onYamlErrorChange,
}: ConfigureYAMLProps) {
  const { t } = useTranslation();

  return (
    <>
      <Typography variant="h6" gutterBottom>
        {t('Kubernetes YAML')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'Add one or more Kubernetes manifests. Upload files to populate the editor or paste/edit directly below.'
        )}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
        <label>
          <input
            type="file"
            accept=".yaml,.yml"
            multiple
            style={{ display: 'none' }}
            onChange={async e => {
              const files = Array.from(e.target.files || []);
              if (files.length === 0) return;
              const readers = files.map(
                file =>
                  new Promise<{ name: string; content: string }>(resolve => {
                    const reader = new FileReader();
                    reader.onload = () =>
                      resolve({ name: file.name, content: String(reader.result || '') });
                    reader.readAsText(file);
                  })
              );
              const results = await Promise.all(readers);
              const separator = yamlEditorValue.trim() ? '\n---\n' : '';
              const combined = results.map(r => `# ${r.name}\n${r.content}`).join('\n---\n');
              onYamlChange(`${yamlEditorValue}${separator}${combined}`);
              onYamlErrorChange(null);
              e.currentTarget.value = '';
            }}
          />
          <Button component="span" variant="outlined">
            {t('Upload files')}
          </Button>
        </label>
        <Button
          variant="text"
          color="inherit"
          onClick={() => {
            onYamlChange('');
            onYamlErrorChange(null);
          }}
        >
          {t('Clear editor')}
        </Button>
      </Box>

      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        <MonacoEditor
          height="45vh"
          language="yaml"
          value={yamlEditorValue}
          onChange={val => onYamlChange(val || '')}
          options={{
            minimap: { enabled: false },
            wordWrap: 'on',
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            automaticLayout: true,
          }}
        />
      </Box>

      {yamlError && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {yamlError}
        </Typography>
      )}
    </>
  );
}
