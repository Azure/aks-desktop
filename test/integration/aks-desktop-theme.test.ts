import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { DEPENDENCY_INSTALL_STEPS } from '../../build/install-dependencies';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const THEME_DIR = path.join(ROOT_DIR, 'plugins', 'aks-desktop-theme');
const rootManifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const themeManifest = JSON.parse(fs.readFileSync(path.join(THEME_DIR, 'package.json'), 'utf8'));
const brandingRegistrations = new Set([
  'registerAppLogo',
  'registerAppTheme',
  'registerClusterEmptyState',
]);

function pluginSources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return pluginSources(entryPath);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories|guidepup|d)\./.test(entry.name)
      ? [entryPath]
      : [];
  });
}

test('the remaining theme backport retains its upstream PR and commit provenance', () => {
  const series = fs.readFileSync(path.join(ROOT_DIR, 'patches/series'), 'utf8');
  const file = '8095-headlamp-upstream-plugin-menu-reload.patch';
  assert.ok(series.split('\n').includes(`8095 source ${file}`));
  const patch = fs.readFileSync(path.join(ROOT_DIR, 'patches', file), 'utf8');
  assert.ok(patch.startsWith('From 7b54676dc468d52ff25b48ccf97018bdf6e57036 '));
  assert.doesNotMatch(series, /^7655 source|(?:0104|9001)-headlamp-/m);
});

test('the functional plugin leaves host branding to Headlamp', () => {
  for (const file of pluginSources(path.join(ROOT_DIR, 'plugins', 'aks-desktop', 'src'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
    function check(node: ts.Node) {
      if (ts.isImportSpecifier(node)) {
        assert.equal(brandingRegistrations.has((node.propertyName ?? node.name).text), false, file);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        assert.notEqual(node.expression.getText(source), 'Headlamp.setAppMenu', file);
      }
      ts.forEachChild(node, check);
    }
    check(source);
  }
});

test('the theme is independently packaged and enabled without command grants', () => {
  const theme = rootManifest.headlamp.plugins.find(
    (plugin: { name: string }) => plugin.name === themeManifest.name
  );
  assert.deepEqual(theme, {
    name: 'aks-desktop-theme',
    packageName: themeManifest.name,
    source: 'plugins/aks-desktop-theme',
    enabledByDefault: true,
  });
  assert.equal(themeManifest.headlamp.runCommands, undefined);
  assert.equal(
    rootManifest.headlamp.runCommands.some((policy: { plugins: { bundleName: string }[] }) =>
      policy.plugins.some(plugin => plugin.bundleName === theme.name)
    ),
    false
  );
  assert.equal(
    DEPENDENCY_INSTALL_STEPS.some(
      step =>
        step.script === 'theme:install' && step.pluginDirectory === 'plugins/aks-desktop-theme'
    ),
    true
  );
  assert.match(rootManifest.scripts['build:all'], /npm run theme:build/);
  assert.match(rootManifest.scripts['dev:services'], /npm run theme:start/);

  for (const file of pluginSources(path.join(THEME_DIR, 'src'))) {
    const imports = ts.preProcessFile(fs.readFileSync(file, 'utf8')).importedFiles;
    for (const imported of imports) {
      if (imported.fileName.startsWith('.')) {
        const target = path.resolve(path.dirname(file), imported.fileName);
        assert.equal(target.startsWith(`${THEME_DIR}${path.sep}`), true, file);
      }
    }
  }
});

test('the theme lockfile uses portable registry resolutions with pinned integrity', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(THEME_DIR, 'package-lock.json'), 'utf8'));
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name === '') continue;
    const dependency = entry as { version: string; integrity: string; resolved?: string };
    assert.equal(typeof dependency.version, 'string', name);
    assert.match(dependency.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, name);
    if (dependency.resolved) {
      assert.doesNotMatch(dependency.resolved, /\.pkgs\.visualstudio\.com\//, name);
    }
  }
});

test('theme translations retain every extracted locale and translation pipeline entry', () => {
  const keys = [
    'Contact us',
    'Get help, share feedback, or reach the AKS Desktop team',
    'AKS desktop logo',
  ];
  const locProject = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'Localize', 'LocProject.json'), 'utf8')
  );
  assert.equal(
    locProject.Projects[0].LocItems.some(
      (item: { SourceFile: string }) =>
        item.SourceFile === 'Localize\\locales\\en\\aks-desktop-theme-translation.json'
    ),
    true
  );
  for (const locale of themeManifest.headlamp.i18n) {
    const translations = JSON.parse(
      fs.readFileSync(path.join(THEME_DIR, 'locales', locale, 'translation.json'), 'utf8')
    );
    assert.deepEqual(Object.keys(translations).sort(), [...keys].sort());
    assert.notEqual(translations['AKS desktop logo'], '', locale);
    const functionalTranslations = JSON.parse(
      fs.readFileSync(
        path.join(ROOT_DIR, 'plugins', 'aks-desktop', 'locales', locale, 'translation.json'),
        'utf8'
      )
    );
    for (const key of keys) assert.equal(key in functionalTranslations, false, `${locale}: ${key}`);
  }
});
