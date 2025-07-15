// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import MonacoEditor from '@monaco-editor/react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import React, { useMemo } from 'react';
import YAML from 'yaml';

export interface DeployProps {
  sourceType: 'container' | 'yaml' | null;
  namespace?: string;
  containerPreviewYaml: string;
  userPreviewYaml: string;
  yamlEditorValue: string;
  deployResult: 'success' | 'error' | null;
  deployMessage: string;
}

interface K8sObject {
  kind: string;
  name: string;
  namespace?: string;
}

export default function Deploy({
  sourceType,
  namespace,
  containerPreviewYaml,
  userPreviewYaml,
  yamlEditorValue,
  deployResult,
  deployMessage,
}: DeployProps) {
  // Parse YAML to extract object summaries
  const yamlObjects = useMemo<K8sObject[]>(() => {
    if (sourceType !== 'yaml') return [];

    try {
      const yamlContent = userPreviewYaml || yamlEditorValue;
      const docs = YAML.parseAllDocuments(yamlContent);
      return docs
        .map(doc => {
          const obj = doc.toJSON();
          if (!obj || !obj.kind) return null;
          return {
            kind: obj.kind,
            name: obj.metadata?.name || 'unnamed',
            namespace: obj.metadata?.namespace,
          };
        })
        .filter(obj => obj !== null) as K8sObject[];
    } catch (e) {
      return [];
    }
  }, [sourceType, userPreviewYaml, yamlEditorValue]);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Review & Deploy
      </Typography>
      {deployResult && (
        <Box
          sx={{
            mb: 1,
            p: 1.5,
            border: '1px solid',
            borderColor: deployResult === 'success' ? 'success.main' : 'error.main',
            borderRadius: 1,
            color: deployResult === 'success' ? 'success.main' : 'error.main',
            backgroundColor: theme =>
              deployResult === 'success'
                ? theme.palette.mode === 'dark'
                  ? 'rgba(46, 125, 50, 0.12)'
                  : 'rgba(46, 125, 50, 0.08)'
                : theme.palette.mode === 'dark'
                ? 'rgba(211, 47, 47, 0.12)'
                : 'rgba(211, 47, 47, 0.08)',
          }}
        >
          {deployMessage}
        </Box>
      )}
      {sourceType === 'container' ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Generated Kubernetes manifests (namespace: {namespace || 'default'})
          </Typography>
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            <MonacoEditor
              height="60vh"
              language="yaml"
              value={containerPreviewYaml}
              onChange={() => {}}
              options={{
                readOnly: true,
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
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Resources to be deployed ({yamlObjects.length} object
            {yamlObjects.length !== 1 ? 's' : ''})
          </Typography>
          <Stack spacing={1.5}>
            {yamlObjects.map((obj, index) => (
              <Paper
                key={index}
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 1,
                  '&:hover': {
                    borderColor: 'primary.main',
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Chip
                    label={obj.kind}
                    size="small"
                    color="primary"
                    sx={{ fontWeight: 600, minWidth: 120 }}
                  />
                  <Typography variant="body1" sx={{ fontWeight: 500, flex: 1 }}>
                    {obj.name}
                  </Typography>
                  {obj.namespace && (
                    <Chip
                      label={`namespace: ${obj.namespace}`}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: '0.75rem' }}
                    />
                  )}
                </Box>
              </Paper>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}
