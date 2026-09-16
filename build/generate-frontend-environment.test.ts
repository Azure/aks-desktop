// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateFrontendEnvironment,
  serializeFrontendEnvironment,
} from './generate-frontend-environment';

test('generates sorted public frontend product environment values', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-frontend-env-'));
  const frontendDir = path.join(
    rootDir,
    'node_modules',
    '@headlamp-k8s',
    'headlamp-source',
    'source',
    'frontend'
  );
  fs.mkdirSync(frontendDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({
      headlamp: {
        build: {
          frontendEnvironment: {
            REACT_APP_HEADLAMP_NOT_FOUND_PAGE_TITLE: 'Page not found in AKS Desktop',
            REACT_APP_HEADLAMP_ERROR_PAGE_TITLE: 'AKS Desktop encountered an error',
          },
        },
      },
    })
  );

  try {
    const outputPath = generateFrontendEnvironment(rootDir);
    assert.equal(outputPath, path.join(frontendDir, '.env.local'));
    assert.equal(
      fs.readFileSync(outputPath, 'utf8'),
      'REACT_APP_HEADLAMP_ERROR_PAGE_TITLE="AKS Desktop encountered an error"\n' +
        'REACT_APP_HEADLAMP_NOT_FOUND_PAGE_TITLE="Page not found in AKS Desktop"\n'
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('rejects private keys and multiline values', () => {
  assert.throws(
    () => serializeFrontendEnvironment({ HEADLAMP_BACKEND_TOKEN: 'secret' }),
    /must start with REACT_APP_/
  );
  assert.throws(
    () => serializeFrontendEnvironment({ REACT_APP_HEADLAMP_ERROR_PAGE_TITLE: 'line 1\nline 2' }),
    /single-line string/
  );
});

test('embeds configured PNG graphics without depending on runtime URL paths', context => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend graphics-'));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const frontendDir = path.join(rootDir, 'node_modules', '@headlamp-k8s', 'headlamp-source', 'source', 'frontend');
  fs.mkdirSync(frontendDir, { recursive: true });
  const icon = Buffer.from('89504e470d0a1a0a', 'hex');
  fs.writeFileSync(path.join(rootDir, 'product icon.png'), icon);
  const project = {
    headlamp: { build: { frontendEnvironment: {
      REACT_APP_HEADLAMP_ERROR_PAGE_GRAPHIC: { file: 'product icon.png' },
      REACT_APP_HEADLAMP_NOT_FOUND_PAGE_GRAPHIC: { file: 'product icon.png' },
    } } },
  };
  const projectPath = path.join(rootDir, 'package.json');
  fs.writeFileSync(projectPath, JSON.stringify(project));
  const graphic = `data:image/png;base64,${icon.toString('base64')}`;
  assert.equal(fs.readFileSync(generateFrontendEnvironment(rootDir), 'utf8'),
    `REACT_APP_HEADLAMP_ERROR_PAGE_GRAPHIC="${graphic}"\n` +
    `REACT_APP_HEADLAMP_NOT_FOUND_PAGE_GRAPHIC="${graphic}"\n`);
  project.headlamp.build.frontendEnvironment.REACT_APP_HEADLAMP_ERROR_PAGE_GRAPHIC.file = '../outside.png';
  fs.writeFileSync(projectPath, JSON.stringify(project));
  assert.throws(() => generateFrontendEnvironment(rootDir), /must stay within/);
  project.headlamp.build.frontendEnvironment.REACT_APP_HEADLAMP_ERROR_PAGE_GRAPHIC.file = 'missing.png';
  fs.writeFileSync(projectPath, JSON.stringify(project));
  assert.throws(() => generateFrontendEnvironment(rootDir), /ENOENT/);
});

test('embeds distinct SVG error artwork and rejects unsupported asset objects', context => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend svg-'));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const frontendDir = path.join(rootDir, 'node_modules', '@headlamp-k8s', 'headlamp-source', 'source', 'frontend');
  fs.mkdirSync(frontendDir, { recursive: true });
  const graphic = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
  fs.writeFileSync(path.join(rootDir, 'error.svg'), graphic);
  const project = {
    headlamp: { build: { frontendEnvironment: {
      REACT_APP_HEADLAMP_ERROR_PAGE_GRAPHIC: { file: 'error.svg' },
    } } },
  };
  const projectPath = path.join(rootDir, 'package.json');
  fs.writeFileSync(projectPath, JSON.stringify(project));
  assert.equal(fs.readFileSync(generateFrontendEnvironment(rootDir), 'utf8'),
    `REACT_APP_HEADLAMP_ERROR_PAGE_GRAPHIC="data:image/svg+xml;base64,${Buffer.from(graphic).toString('base64')}"\n`);
  project.headlamp.build.frontendEnvironment.REACT_APP_HEADLAMP_ERROR_PAGE_GRAPHIC.file = 'icon.txt';
  fs.writeFileSync(projectPath, JSON.stringify(project));
  assert.throws(() => generateFrontendEnvironment(rootDir), /must specify a PNG or SVG file/);
});
