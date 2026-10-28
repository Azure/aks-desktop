// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopeLabels } from '../../types/upgradeInsights';
import { freshnessLabels } from './domain';

const pluginRoot = path.resolve(__dirname, '../../..');
const collectedRoot = path.resolve(pluginRoot, '../../Localize/locales');
const keys = [
  ...Object.values(scopeLabels(key => key)),
  'Unknown scope',
  ...Object.keys(freshnessLabels(key => key)),
];

describe('readiness locale extraction', () => {
  it.each(fs.readdirSync(path.join(pluginRoot, 'locales')))(
    'retains all scope and freshness keys in plugin and collected catalogs for %s',
    locale => {
      for (const file of [
        path.join(pluginRoot, 'locales', locale, 'translation.json'),
        path.join(collectedRoot, locale, 'plugin-translation.json'),
      ]) {
        const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const key of keys) {
          expect(Object.prototype.hasOwnProperty.call(catalog, key), `${file}: ${key}`).toBe(true);
          if (locale === 'en') expect(catalog[key]).toBe(key);
        }
      }
    }
  );
});
