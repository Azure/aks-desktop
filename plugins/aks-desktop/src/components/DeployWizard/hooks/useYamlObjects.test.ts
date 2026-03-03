// @vitest-environment jsdom
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@kinvolk/headlamp-plugin/lib', async () => {
  const i18n = (await import('i18next')).default;
  const { initReactI18next, useTranslation } = await import('react-i18next');
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { translation: {} } },
      interpolation: { escapeValue: false },
      returnEmptyString: false,
    });
  }
  return { useTranslation };
});

import { useYamlObjects } from './useYamlObjects';

describe('useYamlObjects', () => {
  it('returns [] when sourceType is null', () => {
    const { result } = renderHook(() => useYamlObjects(null, '', ''));
    expect(result.current).toEqual([]);
  });

  it('returns [] when sourceType is container', () => {
    const { result } = renderHook(() =>
      useYamlObjects(
        'container',
        'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: foo',
        ''
      )
    );
    expect(result.current).toEqual([]);
  });

  it('parses a single YAML document and returns one K8sObject', () => {
    const yaml =
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n  namespace: default';
    const { result } = renderHook(() => useYamlObjects('yaml', yaml, ''));
    expect(result.current).toEqual([{ kind: 'Deployment', name: 'my-app', namespace: 'default' }]);
  });

  it('parses multi-document YAML and returns multiple objects', () => {
    const yaml = [
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app',
      'apiVersion: v1\nkind: Service\nmetadata:\n  name: my-svc\n  namespace: prod',
    ].join('\n---\n');
    const { result } = renderHook(() => useYamlObjects('yaml', yaml, ''));
    expect(result.current).toHaveLength(2);
    expect(result.current[0]).toEqual({ kind: 'Deployment', name: 'my-app', namespace: undefined });
    expect(result.current[1]).toEqual({ kind: 'Service', name: 'my-svc', namespace: 'prod' });
  });

  it('returns [] on invalid YAML without throwing', () => {
    const { result } = renderHook(() => useYamlObjects('yaml', 'invalid: yaml: [unterminated', ''));
    expect(result.current).toEqual([]);
  });

  it("uses t('unnamed') for documents without metadata.name", () => {
    const yaml = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  namespace: default';
    const { result } = renderHook(() => useYamlObjects('yaml', yaml, ''));
    expect(result.current).toEqual([{ kind: 'Deployment', name: 'unnamed', namespace: 'default' }]);
  });

  it('uses yamlEditorValue when userPreviewYaml is empty', () => {
    const yaml = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm1';
    const { result } = renderHook(() => useYamlObjects('yaml', '', yaml));
    expect(result.current).toEqual([{ kind: 'ConfigMap', name: 'cm1', namespace: undefined }]);
  });
});
