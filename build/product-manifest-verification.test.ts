// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {
  legalDocumentIdentitiesMatch,
  macAppBundleName,
  pluginIdentitiesMatch,
  readPackagedPluginIdentities,
  productIdentityMatches,
} from './product-manifest-verification';

const expected = {
  name: 'aks-desktop',
  productName: 'AKS Desktop',
  companyName: 'Microsoft',
  version: '0.9.0',
};

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`bundled-tool verification checks the generated ${platform} identity`, () => {
    const filename = path.join(__dirname, 'verify-bundled-tools.ts');
    const sourceFile = ts.createSourceFile(
      filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true
    );
    const declarations = ts.factory.updateSourceFile(sourceFile, sourceFile.statements.filter(statement =>
      !(ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
        ts.isIdentifier(statement.expression.expression) && statement.expression.expression.text === 'main')
    ));
    const code = ts.transpileModule(ts.createPrinter().printFile(declarations), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const project = {
      version: '9.8.7',
      headlamp: {
        product: {
          name: 'aks-desktop',
          productName: 'AKS desktop',
          companyName: 'Microsoft',
          version: '0.45.0',
        },
        build: { productNames: { linux: 'AKS-Desktop' } },
        plugins: [],
      },
    };
    const product = {
      name: 'aks-desktop',
      productName: platform === 'linux' ? 'AKS-Desktop' : 'AKS desktop',
      companyName: 'Microsoft',
      version: '9.8.7',
    };
    for (const [version, companyName, matches] of [
      ['9.8.7', 'Microsoft', true],
      ['0.45.0', 'Microsoft', false],
      ['9.8.7', 'Kinvolk', false],
    ] as const) {
      const results = runInNewContext(`${code}\ntestProductAssembly(); results;`, {
        exports: {}, __dirname, process: { platform }, console: { log() {}, warn() {} },
        require: (name: string) => name === 'fs' ? {
          existsSync: () => true,
          readFileSync: (file: string) => JSON.stringify(
            path.basename(file) === 'app-build-manifest.json'
              ? { product: { ...product, version, companyName }, plugins: [], legalDocuments: [] }
              : project
          ),
        } : require(name),
      });
      assert.equal(
        results.find((result: { name: string }) => result.name === 'Product manifest').passed,
        matches
      );
    }
  });
}

test('bundled-tool verification uses the relocatable Unix Python layout', () => {
  const filename = path.join(__dirname, 'verify-bundled-tools.ts');
  const sourceFile = ts.createSourceFile(
    filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true
  );
  const declarations = ts.factory.updateSourceFile(sourceFile, sourceFile.statements.filter(statement =>
    !(ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
      ts.isIdentifier(statement.expression.expression) && statement.expression.expression.text === 'main')
  ));
  const code = ts.transpileModule(ts.createPrinter().printFile(declarations), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const paths = runInNewContext(`${code}\nresolveBundledPythonPaths('/az-cli');`, {
    exports: {}, __dirname, process: { platform: 'darwin' }, console: { log() {}, warn() {} },
    require,
  });

  assert.equal(paths.executable, path.join('/az-cli', 'python', 'bin', 'python3'));
  assert.equal(paths.libDir, path.join('/az-cli', 'python', 'lib'));
});

test('accepts the configured packaged product identity', () => {
  assert.equal(productIdentityMatches(expected, expected), true);
});

test('rejects stale packaged product versions', () => {
  assert.equal(
    productIdentityMatches({ ...expected, version: '0.8.0' }, expected),
    false
  );
});

test('rejects mismatched product names and missing identities', () => {
  assert.equal(
    productIdentityMatches({ ...expected, productName: 'Headlamp' }, expected),
    false
  );
  assert.equal(productIdentityMatches(undefined, expected), false);
});

test('rejects mismatched or missing product companies', () => {
  assert.equal(
    productIdentityMatches({ ...expected, companyName: 'Kinvolk' }, expected),
    false
  );
  const { companyName: _companyName, ...withoutCompany } = expected;
  assert.equal(productIdentityMatches(withoutCompany, expected), false);
});

test('uses the configured macOS executable name for the app bundle', () => {
  assert.equal(
    macAppBundleName({
      product: { productName: 'AKS Desktop' },
      platforms: { mac: { executableName: 'aks-desktop' } },
    }),
    'aks-desktop'
  );
  assert.equal(macAppBundleName({ product: { productName: 'AKS Desktop' } }), 'AKS Desktop');
});

test('compares configured plugin identities without depending on order', () => {
  const plugins = [
    { name: 'aks-desktop', packageName: 'aks-desktop' },
    { name: 'catalog', packageName: '@headlamp-k8s/plugin-catalog' },
  ];
  assert.equal(pluginIdentitiesMatch([...plugins].reverse(), plugins), true);
  assert.equal(
    pluginIdentitiesMatch(
      [{ name: 'replacement', packageName: 'replacement' }, plugins[1]],
      plugins
    ),
    false
  );
  assert.equal(pluginIdentitiesMatch(undefined, undefined), false);
});

test('reads every packaged plugin identity and rejects malformed bundles', t => {
  const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-plugins-'));
  t.after(() => fs.rmSync(resourcesDir, { recursive: true, force: true }));
  const pluginsDir = path.join(resourcesDir, '.plugins');
  for (const [name, packageName] of [
    ['aks-desktop', 'aks-desktop'],
    ['plugin-catalog', '@headlamp-k8s/plugin-catalog'],
  ]) {
    const pluginDir = path.join(pluginsDir, name);
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: packageName }));
  }
  assert.deepEqual(readPackagedPluginIdentities(resourcesDir), [
    { name: 'aks-desktop', packageName: 'aks-desktop' },
    { name: 'plugin-catalog', packageName: '@headlamp-k8s/plugin-catalog' },
  ]);
  fs.rmSync(path.join(pluginsDir, 'aks-desktop', 'package.json'));
  assert.equal(readPackagedPluginIdentities(resourcesDir), undefined);
});

test('compares configured legal document IDs and files', () => {
  const documents = [
    { id: 'license', file: 'LICENSE.txt' },
    { id: 'notices', file: 'NOTICE.md' },
  ];
  assert.equal(legalDocumentIdentitiesMatch([...documents].reverse(), documents), true);
  assert.equal(
    legalDocumentIdentitiesMatch(
      [{ id: 'privacy', file: 'PRIVACY.md' }, documents[1]],
      documents
    ),
    false
  );
  assert.equal(legalDocumentIdentitiesMatch(undefined, undefined), false);
});
