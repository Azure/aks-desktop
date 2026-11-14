// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { parseDocument } from 'yaml';
import { generateUnixAzWrapperScript, generateUnixPythonWrapperScript } from './az-cli-config.ts';

type Language = 'python' | 'bash' | 'sh' | 'powershell';
export interface Script {
  name: string;
  language: Language;
  source: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function shellLanguage(shell: string): Language {
  switch (shell.split(/\s+/)[0]) {
    case 'bash': return 'bash';
    case 'sh': return 'sh';
    case 'python': return 'python';
    case 'pwsh':
    case 'powershell': return 'powershell';
    default: throw new Error(`Unsupported script shell: ${shell}`);
  }
}

export function normalizePipelineExpressions(source: string): string {
  return source.replace(/\$\{\{[\s\S]*?\}\}/g, 'CI_EXPRESSION')
    .replace(/\$\(([A-Za-z_][A-Za-z0-9_.-]*)\)/g, (original, name: string) =>
      name.includes('.') || name === name.toUpperCase() ? 'CI_EXPRESSION' : original);
}

export function workflowScripts(filename: string, source: string): Script[] {
  const document = parseDocument(source);
  if (document.errors.length) throw new Error(`${filename}: ${document.errors.join('\n')}`);
  const data: unknown = document.toJS();
  const scripts: Script[] = [];
  function add(name: string, language: Language, body: string): void {
    scripts.push({ name: `${filename}:${name}`, language, source: normalizePipelineExpressions(body) });
  }
  function defaultShell(value: unknown): string | undefined {
    return record(value) && record(value.run) && typeof value.run.shell === 'string'
      ? value.run.shell : undefined;
  }
  if (record(data) && record(data.jobs)) {
    for (const [name, job] of Object.entries(data.jobs)) {
      if (!record(job) || !Array.isArray(job.steps)) continue;
      const shell = defaultShell(job.defaults) ?? defaultShell(data.defaults) ??
        (typeof job['runs-on'] === 'string' && job['runs-on'].startsWith('windows-') ? 'pwsh' : 'bash');
      job.steps.forEach((step: unknown, index: number) => {
        if (record(step) && typeof step.run === 'string') {
          add(`${name}.steps[${index}]`, shellLanguage(
            typeof step.shell === 'string' ? step.shell : shell
          ), step.run);
        }
      });
    }
  } else {
    function visit(value: unknown, location: string, shell = 'bash'): void {
      if (Array.isArray(value)) {
        value.forEach((child, index) => visit(child, `${location}[${index}]`, shell));
      } else if (record(value)) {
        const taskShell = typeof value.task === 'string' && value.task.startsWith('PowerShell@')
          ? 'powershell' : shell;
        for (const [key, child] of Object.entries(value)) {
          if (typeof child === 'string' && ['bash', 'powershell', 'pwsh', 'script'].includes(key)) {
            add(`${location}.${key}`, shellLanguage(key === 'script' ? taskShell : key), child);
          } else {
            visit(child, `${location}.${key}`, taskShell);
          }
        }
      }
    }
    visit(data, 'pipeline');
  }
  return scripts;
}

export function embeddedPython(filename: string, source: string): Script[] {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const scripts: Script[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.arguments.length >= 2 &&
        /python/i.test(node.arguments[0].getText(parsed)) &&
        ts.isArrayLiteralExpression(node.arguments[1])) {
      const args = node.arguments[1].elements;
      const index = args.findIndex(arg => ts.isStringLiteralLike(arg) && arg.text === '-c');
      if (index >= 0) {
        const script = args[index + 1];
        if (!script || !ts.isStringLiteralLike(script)) {
          throw new Error(`${filename}: embedded Python must be a static string or a standalone .py file`);
        }
        const line = parsed.getLineAndCharacterOfPosition(script.getStart(parsed)).line + 1;
        scripts.push({ name: `${filename}:${line}.py`, language: 'python', source: script.text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return scripts;
}

function run(command: string, args: string[], input?: string, env = process.env): number {
  const result = spawnSync(command, args, { input, env, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} terminated by ${result.signal}`);
  return result.status ?? 1;
}

function trackedScripts(root: string): Script[] {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
  const scripts: Script[] = [];
  for (const filename of new Set(result.stdout.split('\0').filter(Boolean))) {
    const absolute = path.join(root, filename);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const huskyHook = /^\.husky\/[^./]+$/.test(filename);
    if (/\.(py|sh|bash|ps1)$/.test(filename) || huskyHook) {
      const language = filename.endsWith('.py') ? 'python'
        : filename.endsWith('.ps1') ? 'powershell' : huskyHook ? 'sh' : 'bash';
      scripts.push({ name: filename, language, source: fs.readFileSync(absolute, 'utf8') });
    } else if (/^(\.github\/workflows|\.azure-pipeline)\/.*\.ya?ml$/.test(filename)) {
      scripts.push(...workflowScripts(filename, fs.readFileSync(absolute, 'utf8')));
    } else if (/^(build|Localize|packages|plugins)\/.*\.(ts|js|cjs|mjs)$/.test(filename) &&
        !/\.(test|spec)\.[cm]?[jt]s$/.test(filename)) {
      scripts.push(...embeddedPython(filename, fs.readFileSync(absolute, 'utf8')));
    }
  }
  scripts.push(
    { name: 'generated az-wrapper', language: 'bash', source: generateUnixAzWrapperScript() },
    { name: 'generated python-wrapper', language: 'bash', source: generateUnixPythonWrapperScript() }
  );
  return scripts;
}

function main(): void {
  const mode = process.argv[2] ?? 'python-shell';
  if (!['python-shell', 'powershell'].includes(mode)) throw new Error(`Unknown lint mode: ${mode}`);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scripts = trackedScripts(root);
  let failures = 0;
  if (mode === 'powershell') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-script-lint-'));
    try {
      const selected = scripts.filter(script => script.language === 'powershell');
      selected.forEach((script, index) => {
        console.log(`${index}.ps1: ${script.name}`);
        fs.writeFileSync(path.join(directory, `${index}.ps1`), script.source);
      });
      failures = run('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `
        $ErrorActionPreference = 'Stop'
        Import-Module PSScriptAnalyzer -RequiredVersion 1.25.0
        $findings = @(Invoke-ScriptAnalyzer -Path $env:AKS_SCRIPT_LINT_PATH -Recurse -Severity Warning,Error,ParseError)
        $findings | Format-Table -AutoSize | Out-String -Width 240 | Write-Output
        if ($findings.Count -gt 0) { exit 1 }
      `], undefined, { ...process.env, AKS_SCRIPT_LINT_PATH: directory });
      console.log(`Checked ${selected.length} PowerShell scripts.`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  } else {
    for (const script of scripts.filter(script => script.language !== 'powershell')) {
      console.log(`Checking ${script.name}`);
      if (script.language === 'python') {
        failures += run('ruff', ['check', '--no-cache', '--config',
          path.join(root, '.config/lint/ruff.toml'), '--stdin-filename', script.name, '-'], script.source);
      } else {
        failures += run('shellcheck', ['--severity=warning', `--shell=${script.language}`, '-'], script.source);
      }
    }
  }
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
