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

let tabFocusToggleCounter = 0;

export default function ConfigureYAML({
  yamlEditorValue,
  yamlError,
  onYamlChange,
  onYamlErrorChange,
}: ConfigureYAMLProps) {
  const { t } = useTranslation();

  return (
    <>
      <Typography variant="h6" component="h2" gutterBottom>
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
          onMount={editor => {
            // @todo: this only works the first mount.
            // a11y aria tabFocusMode as an editor option doesn't work in many Monaco versions.
            // Use the EditorOption API or toggle the built-in command instead.
            editor.updateOptions({ tabFocusMode: true });
            // Belt-and-suspenders: on first focus, verify tabFocusMode is actually enabled.
            // If it isn't, trigger the built-in "Toggle Tab Key Moves Focus" action so Tab
            // really moves focus out of the editor. This avoids blindly toggling the state.
            const disposable = editor.onDidFocusEditorText(() => {
              disposable.dispose();
              tabFocusToggleCounter++;
              try {
                editor.trigger('keyboard', 'editor.action.toggleTabFocusMode', undefined);
                if (tabFocusToggleCounter >= 2) {
                  // If we've already toggled once, toggle back so the editor's state isn't changed by this check.
                  editor.trigger('keyboard', 'editor.action.toggleTabFocusMode', undefined);
                }
              } catch {
                // action or option introspection may not exist in all builds – ignore
              }
            });
          }}
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
        /* role="alert" causes assistive technologies to immediately announce this error
           when it is dynamically injected into the DOM (assertive live region), without
           the user needing to navigate to it.
           MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role */
        <Typography role="alert" variant="body2" color="error" sx={{ mt: 1 }}>
          {yamlError}
        </Typography>
      )}
    </>
  );
}
