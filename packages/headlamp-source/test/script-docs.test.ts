import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const SCRIPTS_DIR = path.resolve(__dirname, '..', 'scripts');
const SCRIPT_FILES = fs.readdirSync(SCRIPTS_DIR).filter(file => file.endsWith('.ts')).sort();
const CLI_FILES = [
  'bundle-plugins.ts',
  'compose-patches.ts',
  'generate-product-manifest.ts',
  'smoke-app.ts',
  'update-source.ts',
];

function attachedTsdoc(sourceFile: ts.SourceFile, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) || [];
  const range = ranges.at(-1);
  if (!range) {
    return '';
  }
  const comment = sourceFile.text.slice(range.pos, range.end);
  return comment.startsWith('/**') ? comment : '';
}

function auditFunction(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  parameters: ts.NodeArray<ts.ParameterDeclaration>
): string[] {
  const docs = attachedTsdoc(sourceFile, node);
  if (!docs) {
    return [`${path.basename(sourceFile.fileName)}:${name} is missing TSDoc`];
  }

  const errors: string[] = [];
  const paramTags = [...docs.matchAll(/@param\s+([^\s-]+)/g)].map(match => match[1]);
  if (paramTags.length !== parameters.length) {
    errors.push(
      `${path.basename(sourceFile.fileName)}:${name} has ${paramTags.length} @param tags for ${parameters.length} parameters`
    );
  }
  for (const parameter of parameters) {
    const parameterName = parameter.name.getText(sourceFile);
    if (!paramTags.includes(parameterName)) {
      errors.push(`${path.basename(sourceFile.fileName)}:${name} is missing @param ${parameterName}`);
    }
  }
  if (!/@returns\b/.test(docs)) {
    errors.push(`${path.basename(sourceFile.fileName)}:${name} is missing @returns`);
  }
  return errors;
}

test('all named source-script functions have complete TSDoc', () => {
  const errors: string[] = [];
  let functionCount = 0;

  for (const file of SCRIPT_FILES) {
    const filePath = path.join(SCRIPTS_DIR, file);
    const sourceFile = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    function visit(node: ts.Node): void {
      if (ts.isFunctionDeclaration(node) && node.name) {
        functionCount++;
        errors.push(...auditFunction(sourceFile, node, node.name.text, node.parameters));
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        functionCount++;
        errors.push(
          ...auditFunction(
            sourceFile,
            node.parent.parent,
            node.name.text,
            node.initializer.parameters
          )
        );
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.equal(functionCount, 63);
  assert.deepEqual(errors, []);
});

test('all source scripts expose purpose and usage metadata near the top', () => {
  for (const file of SCRIPT_FILES) {
    const source = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declarations = new Map<string, ts.VariableStatement>();

    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          declarations.set(declaration.name.text, statement);
        }
      }
    }

    for (const name of ['SCRIPT_PURPOSE', 'SCRIPT_USAGE']) {
      const declaration = declarations.get(name);
      assert.ok(declaration, `${file} must declare ${name}`);
      const line = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line;
      assert.ok(line < 40, `${file}:${name} must be near the top of the file`);
      assert.match(declaration.getText(sourceFile), /['`][\s\S]*\S[\s\S]*['`]/);
      assert.match(source, new RegExp(`module\\.exports = \\{[\\s\\S]*\\b${name}\\b`));
    }
  }
});

test('all source-script interfaces and fields have TSDoc', () => {
  const errors: string[] = [];
  let interfaceCount = 0;
  let fieldCount = 0;

  for (const file of SCRIPT_FILES) {
    const filePath = path.join(SCRIPTS_DIR, file);
    const sourceFile = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    function visit(node: ts.Node): void {
      if (ts.isInterfaceDeclaration(node)) {
        interfaceCount++;
        if (!attachedTsdoc(sourceFile, node)) {
          errors.push(`${file}:${node.name.text} is missing TSDoc`);
        }
        for (const member of node.members) {
          if (ts.isPropertySignature(member)) {
            fieldCount++;
            if (!attachedTsdoc(sourceFile, member)) {
              errors.push(`${file}:${node.name.text}.${member.name.getText(sourceFile)} is missing TSDoc`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.equal(interfaceCount, 5);
  assert.equal(fieldCount, 16);
  assert.deepEqual(errors, []);
});

test('source-script CLIs print reusable purpose and usage help', () => {
  const tsxCli = path.resolve(__dirname, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

  for (const file of CLI_FILES) {
    const scriptPath = path.join(SCRIPTS_DIR, file);
    const { SCRIPT_PURPOSE, SCRIPT_USAGE } = require(scriptPath);
    const result = spawnSync(process.execPath, [tsxCli, scriptPath, '--help'], {
      encoding: 'utf8',
      env: process.env,
    });

    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), `${SCRIPT_PURPOSE}\n\n${SCRIPT_USAGE}`);
  }
});
