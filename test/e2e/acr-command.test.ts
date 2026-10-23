// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

const project = path.resolve(__dirname, '../..');
const driver = String.raw`
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const [directory, platform, binary, args] = process.argv.slice(1);
const fs = require('node:fs');
const path = require('node:path');
const simulateFailure = JSON.parse(args).includes('--offline-fail');
const mode = JSON.parse(args).find(arg => arg.startsWith('--offline-')) ?? '';
const nativeSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...rest) =>
  nativeSetTimeout(fn, ms > 55000 && ms <= 60000 ? 20 : ms, ...rest);
Object.defineProperty(process, 'platform', { value: platform });
process.env.PATH = directory;
process.env.PATHEXT = '.exe;.cmd';
process.env.comspec = 'cmd.exe';
const launches = [];
let spawned;
function child() {
  const result = new EventEmitter();
  result.stdin = new PassThrough();
  result.stdout = new PassThrough();
  result.stderr = new PassThrough();
  result.kill = () => true;
  result.pid = 123;
  return result;
}
cp.execFile = (file, argv, options, callback) => {
  launches.push({ launcher: 'execFile', file, args: argv, shell: options.shell ?? false });
  const result = child();
  process.nextTick(() => callback(null, 'fixture stdout'));
  return result;
};
cp.spawn = (file, argv, options) => {
  launches.push({ launcher: 'spawn', file, args: argv, shell: options.shell ?? false,
    windowsVerbatimArguments: options.windowsVerbatimArguments ?? false });
  const result = spawned = child();
  process.nextTick(() => {
    if (mode === '--offline-hang' || mode === '--offline-cleanup-error') return;
    if (mode === '--offline-overflow') {
      result.stdout.write(Buffer.alloc(16 * 1024 * 1024 + 1));
      return;
    }
    result.stdout.end('fixture stdout');
    result.stderr.end();
    result.emit('close', simulateFailure ? 2 : 0, null);
  });
  return result;
};
cp.spawnSync = (file, argv, options) => {
  if (file.endsWith('where.exe')) {
    const executable = fs.existsSync(path.join(directory, 'az.exe')) ? 'az.exe' : 'az.cmd';
    return { status: 0, stdout: path.join(directory, executable) + '\r\n' };
  }
  launches.push({ launcher: 'spawnSync', file, args: argv, timeout: options.timeout });
  return { status: mode === '--offline-cleanup-error' ? 1 : 0 };
};
const { command } = require('./test/e2e/acr-services.ts');
command(binary, JSON.parse(args)).then(
  stdout => console.log(JSON.stringify({ stdout, launches })),
  error => console.log(JSON.stringify({ error: error.message, launches,
    pipesClosed: spawned && [spawned.stdin, spawned.stdout, spawned.stderr].every(pipe => pipe.destroyed) }))
);
`;

async function launch(
  t: test.TestContext,
  platform: string,
  binary: string,
  args: string[],
  nativeAz = false
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aksd-acr-command-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, nativeAz ? 'az.exe' : 'az.cmd'), '@echo off\r\n');
  await fs.writeFile(path.join(directory, 'gh.exe'), 'fixture');
  const result = spawnSync(
    process.execPath,
    ['--require', 'tsx/cjs', '-e', driver, directory, platform, binary, JSON.stringify(args)],
    { cwd: project, encoding: 'utf8', timeout: 15_000 }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('Windows Azure CLI cmd shim uses an escaped batch launcher, not execFile or shell:true', async t => {
  const args = [
    'rest',
    '--url',
    'https://management.azure.com/a?api-version=1&next=2',
    '--body',
    '{"message":"space \\"quotes\\" & | < > ( ) %PATH% !name! ^ end\\\\"}',
  ];
  const result = await launch(t, 'win32', 'az', args);

  assert.equal(result.stdout, 'fixture stdout');
  assert.equal(result.launches.length, 1);
  const invocation = result.launches[0];
  assert.equal(invocation.launcher, 'spawn');
  assert.match(invocation.file, /[\\/]System32[\\/]cmd\.exe$/i);
  assert.equal(invocation.shell, false);
  assert.equal(invocation.windowsVerbatimArguments, true);
  assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/s', '/v:off', '/c']);
  const batch = invocation.args[4];
  assert.ok(batch.includes('^&next=2'));
  for (const escaped of [
    '^^^&',
    '^^^|',
    '^^^<',
    '^^^>',
    '^^^(',
    '^^^)',
    '^^^%PATH^^^%',
    '^^^!name^^^!',
    '^^^^',
  ]) {
    assert.ok(batch.includes(escaped), `Missing batch escaping for ${escaped}`);
  }
});

test('Windows native az.exe stays shell-free', async t => {
  const result = await launch(t, 'win32', 'az', ['account', 'show'], true);
  const invocation = result.launches[0];
  assert.equal(invocation.launcher, 'spawn');
  assert.ok(invocation.file.endsWith('az.exe'));
  assert.equal(invocation.shell, false);
  assert.deepEqual(invocation.args, ['account', 'show']);
});

test('native GitHub commands retain direct execFile on Windows', async t => {
  const args = ['api', 'repos/example/sandbox'];
  const result = await launch(t, 'win32', 'gh', args);
  assert.deepEqual(result.launches, [{ launcher: 'execFile', file: 'gh', args, shell: false }]);
});

test('Azure CLI retains direct execFile on Unix', async t => {
  const args = ['account', 'show'];
  const result = await launch(t, 'linux', 'az', args);
  assert.deepEqual(result.launches, [{ launcher: 'execFile', file: 'az', args, shell: false }]);
});

test('Windows Azure CLI failures reject with a sanitized diagnostic', async t => {
  const result = await launch(t, 'win32', 'az', ['acr', '--offline-fail']);
  assert.match(result.error, /az acr failed \(code 2\)/);
  assert.match(result.error, /output withheld/);
  assert.equal(result.stdout, undefined);
});

for (const [mode, error] of [
  ['--offline-hang', 'ETIMEDOUT'],
  ['--offline-overflow', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'],
  ['--offline-cleanup-error', 'cleanup could not be confirmed'],
]) {
  test(`Windows Azure CLI terminates its owned tree and rejects without close (${mode})`, async t => {
    const result = await launch(t, 'win32', 'az', ['acr', mode]);
    assert.ok(result.error.includes(error), result.error);
    assert.equal(result.pipesClosed, true);
    const cleanup = result.launches.find(
      (invocation: { launcher: string }) => invocation.launcher === 'spawnSync'
    );
    assert.match(cleanup.file, /[\\/]System32[\\/]taskkill\.exe$/i);
    assert.deepEqual(cleanup.args, ['/pid', '123', '/T', '/F']);
    assert.equal(cleanup.timeout, 5000);
  });
}

test(
  'Windows Azure batch shim round-trips argument boundaries without evaluating metacharacters',
  {
    skip: process.platform !== 'win32' ? 'Requires native Windows cmd.exe' : false,
  },
  async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aksd-acr-native-command-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const probe = path.join(directory, 'probe.cjs');
    await fs.writeFile(probe, 'console.log(JSON.stringify(process.argv.slice(2)))');
    await fs.writeFile(path.join(directory, 'az.cmd'), `@"${process.execPath}" "${probe}" %*\r\n`);
    const args = [
      'rest',
      '--url',
      'https://example.invalid/?a=1&b=2',
      '--body',
      '{"name":"space & | < > ( ) %NO_SUCH_VARIABLE% !name! ^ end"}',
      'quote"value',
      '',
      'trailing\\',
    ];
    const result = spawnSync(
      process.execPath,
      [
        '--require',
        'tsx/cjs',
        '-e',
        'const cp=require("node:child_process"),spawn=cp.spawn;cp.spawn=(...a)=>{process.stderr.write("[local fixture invocation] "+JSON.stringify(a.slice(0,2))+"\\n");const c=spawn(...a);c.stderr?.on("data",d=>process.stderr.write("[local fixture stderr] "+d));return c};require("./test/e2e/acr-services.ts").command("az",JSON.parse(process.argv[1])).then(s=>process.stdout.write(s),e=>{console.error(e.message);process.exitCode=1})',
        JSON.stringify(args),
      ],
      {
        cwd: project,
        encoding: 'utf8',
        timeout: 15_000,
        env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}` },
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  }
);

for (const mode of ['timeout', 'overflow']) {
  test(
    `Windows Azure shim cleans descendants holding pipes after ${mode}`,
    {
      skip: process.platform !== 'win32' ? 'Requires native Windows cmd.exe' : false,
    },
    async t => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aksd-acr-tree-'));
      const rootFile = path.join(directory, 'root.pid');
      const descendantFile = path.join(directory, 'descendant.pid');
      t.after(async () => {
        for (const file of [rootFile, descendantFile]) {
          const pid = Number(
            await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return '';
              throw error;
            })
          );
          if (pid > 0)
            spawnSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
              timeout: 5000,
              stdio: 'ignore',
            });
        }
        await fs.rm(directory, { recursive: true, force: true });
      });
      const probe = path.join(directory, 'probe.cjs');
      await fs.writeFile(
        probe,
        `require("node:fs").writeFileSync(${JSON.stringify(descendantFile)},String(process.pid));` +
          (mode === 'overflow'
            ? 'process.stdout.write(Buffer.alloc(17*1024*1024));'
            : 'process.stdout.write("ready");') +
          'setInterval(()=>{},1000);'
      );
      await fs.writeFile(
        path.join(directory, 'az.cmd'),
        `@"${process.execPath}" "${probe}" %*\r\n`
      );
      const harness = `
          const fs=require("node:fs"),cp=require("node:child_process"),spawn=cp.spawn;
          cp.spawn=(...args)=>{const child=spawn(...args);fs.writeFileSync(${JSON.stringify(
            rootFile
          )},String(child.pid));return child;};
          const timer=global.setTimeout;global.setTimeout=(fn,ms,...args)=>timer(fn,ms>55000&&ms<=60000?1500:ms,...args);
          require("./test/e2e/acr-services.ts").command("az",["account","show"]).then(
            ()=>{console.error("Unexpected success");process.exitCode=1;},
            error=>console.log(JSON.stringify({error:error.message})));
        `;
      const started = Date.now();
      const result = spawnSync(process.execPath, ['--require', 'tsx/cjs', '-e', harness], {
        cwd: project,
        encoding: 'utf8',
        timeout: 15_000,
        env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}` },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(
        Date.now() - started < 12_000,
        'Command waited indefinitely for inherited output pipes'
      );
      assert.match(
        JSON.parse(result.stdout).error,
        mode === 'overflow' ? /STDIO_MAXBUFFER/ : /ETIMEDOUT/
      );
      const pid = Number(await fs.readFile(descendantFile, 'utf8'));
      let gone = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          gone = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(gone, `Owned descendant ${pid} was left running`);
    }
  );
}
