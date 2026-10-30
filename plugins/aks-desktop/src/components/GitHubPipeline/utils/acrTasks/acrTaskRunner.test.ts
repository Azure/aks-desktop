// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ACR_BUILD_SCRIPT_PATH, ACR_TASKS_API_VERSION, getAcrBuildFiles } from './acrTaskRunner';

const ownedDirectory = dirname(fileURLToPath(import.meta.url));
const registry =
  '/subscriptions/sub-123/resourceGroups/registry-rg/providers/Microsoft.ContainerRegistry/registries/demo';
const sha = 'a'.repeat(40);
const externalDockerfile = '.aksd-acr.Dockerfile';
const stagingIgnore = `\n${externalDockerfile}\n${externalDockerfile}.dockerignore\n`;
const fixtures: string[] = [];

// The actual emitted __main__ runs with only its transport, clock and Azure token process replaced.
const driver = String.raw`
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import runpy
import signal
import subprocess
import sys
import tarfile
import time
from types import SimpleNamespace
import urllib.error
import urllib.parse
import urllib.request

config = json.loads(Path(sys.argv[2]).read_text())
# Hosted Ubuntu uses local __pycache__; macOS Python may relocate it to a system cache.
sys.pycache_prefix = None
script = sys.argv[1]
sys.argv = [script] + config.get("args", [])
records = {"requests": [], "tokens": [], "archive": {}, "archive_names": [], "sleeps": [],
           "log_reads": [], "log_bytes": 0}
clock = [0]
time.monotonic = lambda: clock[0]
def sleep(seconds):
    records["sleeps"].append(seconds)
    clock[0] += seconds
time.sleep = sleep

def token(args, **kwargs):
    assert args[:3] == ["az", "account", "get-access-token"], args
    assert "--resource" in args and args[args.index("--resource")+1] == "https://management.azure.com/"
    records["tokens"].append(args)
    if config.get("token_error"):
        raise subprocess.CalledProcessError(1, args, stderr="secret-token")
    return SimpleNamespace(stdout="bearer-secret-" + str(len(records["tokens"])))
subprocess.run = token

class Response:
    def __init__(self, data=None, status=200, headers=None, log=False, fail_after=None, interrupt=None):
        self.body = data if isinstance(data, bytes) else json.dumps(data or {}).encode()
        self.status, self.headers = status, headers or {}
        self.reader = io.BytesIO(self.body)
        self.log, self.fail_after, self.interrupt = log, fail_after, interrupt
    def read(self, size=-1):
        if self.log:
            if self.interrupt:
                signum, self.interrupt = self.interrupt, None
                signal.raise_signal(signal.SIGTERM if signum == "term" else signal.SIGINT)
            assert 0 < size <= 64 * 1024, "Logs must use bounded reads"
            records["log_reads"].append(size)
            if self.fail_after is not None and self.reader.tell() >= self.fail_after:
                raise OSError("interrupted signed-secret-url")
            size = min(size, config.get("log_chunk_size", size))
        raw = self.reader.read(size)
        if self.log:
            records["log_bytes"] += len(raw)
        return raw
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass

def error(request, code, headers=None):
    raise urllib.error.HTTPError(request.full_url, code, "signed-secret-url", headers or {}, io.BytesIO(b"secret"))

counts = {}
def open_request(request, timeout=None):
    url, method = request.full_url, request.get_method()
    parsed = urllib.parse.urlsplit(url)
    # Exercise stdlib request-line validation without opening a network connection.
    connection = http.client.HTTPConnection(parsed.hostname)
    connection.putrequest(method, request.selector)
    connection.close()
    path = parsed.path
    key = method + " " + path
    counts[key] = counts.get(key, 0) + 1
    body = request.data
    if isinstance(body, bytes):
        body = json.loads(body)
    elif hasattr(body, "read"):
        with tarfile.open(fileobj=body, mode="r:gz") as archive:
            for item in archive:
                records["archive_names"].append(item.name)
                records["archive"][item.name] = {
                    "link": item.linkname if item.issym() else None,
                    "content": archive.extractfile(item).read().decode(errors="replace") if item.isfile() else None,
                }
        body = "archive"
    records["requests"].append({"method": method, "url": url, "body": body,
                                "headers": dict(request.header_items()), "timeout": timeout})
    if config.get("http_error") and path.endswith(config.get("error_path", "listBuildSourceUploadUrl")):
        error(request, config["http_error"])
    if config.get("upload_error") and parsed.hostname == "storage.example":
        error(request, 403)
    if config.get("renew") and path.endswith("listBuildSourceUploadUrl") and counts[key] == 1:
        error(request, 401)
    if config.get("renew_twice") and path.endswith("listBuildSourceUploadUrl"):
        error(request, 401)
    if config.get("throttle") and path.endswith("listBuildSourceUploadUrl") and counts[key] < 3:
        error(request, 429, {"Retry-After": config.get("retry_after", "7")})
    if path.endswith("/registries"):
        items = [{"name": "demo", "id": config["registry"],
                  "properties": {"loginServer": "demo.azurecr.io"}}]
        if config.get("lookup") == "missing":
            items = []
        if config.get("lookup") == "ambiguous":
            items *= 2
        if config.get("lookup") == "paged" and not parsed.query.endswith("page=2"):
            return Response({"value": [], "nextLink": url + "&page=2"})
        if config.get("lookup") == "bad_version":
            return Response({"value": [], "nextLink": url.replace("2023-07-01", "2019-04-01")})
        return Response({"value": items})
    if path.endswith("/listBuildSourceUploadUrl"):
        if config.get("invalid_json"):
            return Response(b"not json secret-token")
        return Response(config.get("upload", {"uploadUrl": "https://storage.example/context?sig=sas-secret",
                                             "relativePath": "source/relative/context.tar.gz"}))
    if parsed.hostname == "storage.example":
        assert "Authorization" not in dict(request.header_items())
        assert request.get_header("X-ms-blob-type") == "BlockBlob"
        return Response(status=201)
    if path.endswith("/scheduleRun"):
        if config.get("schedule_transport"):
            raise urllib.error.URLError("https://storage.example/?sig=secret-token")
        if config.get("schedule_401") and counts[key] == 1:
            error(request, 401)
        if config.get("schedule_error"):
            error(request, config["schedule_error"])
        variant = config.get("async")
        if variant:
            header = ("Location" if variant == "location" else
                      "Operation-Location" if variant == "operation-location" else "Azure-AsyncOperation")
            headers = {header: "https://management.azure.com/operations/build", "Retry-After": "2"}
            if variant == "result":
                headers["Location"] = "https://management.azure.com/results/build"
            if variant == "hostile":
                headers[header] = "https://attacker.example/operations/build?sig=hidden"
            return Response({"status": "Accepted"}, status=200 if variant == "200" else 202, headers=headers)
        return Response({"properties": {"runId": "run-42", "status": "Queued"}})
    if path == "/operations/build":
        if config.get("async") == "no_run":
            return Response({"status": "Succeeded"})
        if config.get("async") == "failed":
            return Response({"status": "Failed"})
        if config.get("async") == "never":
            return Response({"status": "Running"}, headers={"Retry-After": "600"})
        if counts[key] == 1:
            return Response({"status": "Running"}, headers={"Retry-After": "3"})
        if config.get("async") == "result":
            return Response({"status": "Succeeded"})
        return Response({"id": config["registry"] + "/runs/run-42", "properties": {"status": "Queued"}})
    if path == "/results/build":
        return Response({"name": "run-42", "properties": {"status": "Queued"}})
    if path.endswith("/listLogSasUrl"):
        if config.get("logs_error") or (config.get("logs_delay") and counts[key] == 1):
            error(request, 403)
        if config.get("missing_log"):
            return Response({})
        return Response({"logLink": "https://logs.example/build?sig=log-sas-secret"})
    if parsed.hostname == "logs.example":
        assert "Authorization" not in dict(request.header_items())
        if config.get("signal_log_open") and counts[key] == 1:
            signal.raise_signal(signal.SIGTERM if config["signal_log_open"] == "term" else signal.SIGINT)
        issued = " ".join("bearer-secret-" + str(i + 1) for i in range(len(records["tokens"])))
        raw = ("building source\n" + issued + " https://storage.example/blob?sig=secret\nfinished\n").encode()
        if config.get("large_log"):
            raw = b"x" * (17 * 1024 * 1024) + b"complete\n"
        if config.get("log_text") is not None:
            raw = config["log_text"].encode()
        if config.get("log_versions"):
            versions = config["log_versions"]
            raw = versions[min(counts[key] - 1, len(versions) - 1)].encode()
        if config.get("split_utf8"):
            raw = "alpha\n🚀 café 世界\n".encode()
            if counts[key] == 1:
                raw = raw[:raw.index("🚀".encode()) + 2]
        offset = int(request.get_header("Range", "bytes=0-")[6:-1])
        status, headers = 200, {"Content-Length": str(len(raw))}
        if config.get("truncate_log") and counts[key] >= config.get("truncate_after", 1):
            headers["Content-Length"] = str(len(raw) + 100)
            return Response(raw, headers=headers, log=True)
        if request.get_header("Range") and not config.get("ignore_range"):
            if offset >= len(raw):
                error(request, 416, {"Content-Range": "bytes */" + str(len(raw))})
            start = offset + 1 if config.get("bad_range") else offset
            end = min(len(raw), offset + config.get("range_page", len(raw)))
            total = "*" if config.get("unknown_log_size") else str(len(raw))
            status, headers = 206, {"Content-Range": "bytes " + str(start) + "-" + str(end - 1) + "/" + total}
            raw = raw[offset:end]
        failed = 14 if config.get("stream_retry") and counts[key] == 1 else None
        interrupt = config.get("signal_log_read") if counts[key] == 1 else None
        return Response(raw, status, headers, log=True, fail_after=failed, interrupt=interrupt)
    if path.endswith("/cancel"):
        return Response(status=202)
    if "/runs/run-42" in path and method == "GET":
        if config.get("signal") and counts[key] == 1:
            signal.raise_signal(signal.SIGTERM if config["signal"] == "term" else signal.SIGINT)
        statuses = config.get("statuses", ["Running", "Succeeded"])
        status = statuses[min(counts[key]-1, len(statuses)-1)]
        return Response({"properties": {"status": status}},
                        headers={"Retry-After": config.get("run_retry_after", "1")})
    raise AssertionError("Unexpected HTTP call " + method + " " + path)

def opener(*handlers):
    assert len(handlers) == 1
    assert handlers[0].redirect_request(None, None, 302, "", {}, "https://attacker.example/") is None
    return SimpleNamespace(open=open_request)
urllib.request.build_opener = opener
class Capture:
    def __init__(self):
        self.digest, self.size, self.tail = hashlib.sha256(), 0, ""
    def write(self, text):
        raw = text.encode()
        self.digest.update(raw)
        self.size += len(raw)
        self.tail = (self.tail + text)[-256:]
    def flush(self):
        pass
original_stdout = sys.stdout
capture = Capture() if config.get("capture_output") else None
if capture:
    sys.stdout = capture
try:
    runpy.run_path(script, run_name="__main__")
except SystemExit as result:
    records["exit"] = result.code
finally:
    sys.stdout = original_stdout
    if capture:
        records.update(output_bytes=capture.size, output_hash=capture.digest.hexdigest(),
                       output_tail=capture.tail)
    Path(config["result"]).write_text(json.dumps(records))
sys.exit(records.get("exit", 99))
`;

type Scenario = Record<string, unknown>;
type Request = {
  method: string;
  url: string;
  body: Record<string, unknown> | string;
  headers: Record<string, string>;
  timeout: number;
};
type Records = {
  requests: Request[];
  tokens: string[][];
  archive: Record<string, { content: string | null; link: string | null }>;
  archive_names: string[];
  sleeps: number[];
  exit: number;
  log_reads: number[];
  log_bytes: number;
  output_bytes?: number;
  output_hash?: string;
  output_tail?: string;
};

function fixture(env: Record<string, string> = {}) {
  const directory = resolve(
    mkdtempSync(relative(process.cwd(), join(ownedDirectory, '.runtime-test-')))
  );
  fixtures.push(directory);
  const workspace = join(directory, 'checkout');
  const runnerTemp = join(directory, 'runner');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(runnerTemp);
  const write = (path: string, content: string) => {
    const target = join(workspace, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  for (const [path, content] of Object.entries(getAcrBuildFiles())) write(path, content);
  write('Dockerfile', 'FROM scratch\nCOPY . /app\n');
  write('app.txt', 'application');
  writeFileSync(join(directory, 'driver.py'), driver);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    RUNNER_TEMP: runnerTemp,
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_JOB: 'build',
    AZURE_ACR_RESOURCE_ID: registry,
    AZURE_CONTAINER_REGISTRY: 'demo',
    AZURE_SUBSCRIPTION_ID: 'sub-123',
    CONTAINER_NAME: 'team/app',
    GITHUB_SHA: sha,
    DOCKER_FILE: './Dockerfile',
    BUILD_CONTEXT_PATH: '.',
    BUILD_ARGUMENTS: '{"MODE":"release","SPACES":"a b","QUOTE":"a\\"b","EMPTY":""}',
    ...env,
  };
  delete environment.PYTHONDONTWRITEBYTECODE;
  delete environment.PYTHONPYCACHEPREFIX;
  function run(scenario: Scenario = {}) {
    const resultPath = join(directory, 'result.json');
    const scenarioPath = join(directory, 'scenario.json');
    writeFileSync(scenarioPath, JSON.stringify({ registry, ...scenario, result: resultPath }));
    const result = spawnSync(
      'python3',
      [join(directory, 'driver.py'), join(workspace, ACR_BUILD_SCRIPT_PATH), scenarioPath],
      {
        cwd: workspace,
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
      }
    );
    if (result.error) throw result.error;
    const records: Records = JSON.parse(readFileSync(resultPath, 'utf8'));
    return { ...result, records };
  }
  return { directory, workspace, runnerTemp, write, run, environment };
}

function requests(records: Records, action: string) {
  return records.requests.filter(request => new URL(request.url).pathname.endsWith(action));
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('generated ACR Tasks runtime', () => {
  it('does not generate or upload helper bytecode with normal Python settings', () => {
    const test = fixture();
    test.write('app/__pycache__/user.cache.pyc', 'user-provided context file');

    const { status, stderr, records } = test.run();

    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    expect(test.environment.PYTHONDONTWRITEBYTECODE).toBeUndefined();
    expect(test.environment.PYTHONPYCACHEPREFIX).toBeUndefined();
    expect(
      Object.keys(records.archive).filter(path => path.startsWith('.github/scripts/__pycache__'))
    ).toEqual([]);
    expect(existsSync(join(test.workspace, '.github/scripts/__pycache__'))).toBe(false);
    expect(records.archive['app/__pycache__/user.cache.pyc'].content).toBe(
      'user-provided context file'
    );
  });

  it('executes the emitted files with the exact upload and DockerBuildRequest wire contract', () => {
    expect(ACR_TASKS_API_VERSION).toBe('2019-04-01');
    const { status, stdout, stderr, records } = fixture().run();
    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    const schedule = requests(records, '/scheduleRun');
    expect(schedule).toHaveLength(1);
    expect(schedule[0].body).toEqual({
      type: 'DockerBuildRequest',
      platform: { os: 'Linux' },
      dockerFilePath: 'Dockerfile',
      imageNames: [`team/app:${sha}`],
      isPushEnabled: true,
      timeout: 3600,
      arguments: [
        { name: 'MODE', value: 'release', isSecret: false },
        { name: 'SPACES', value: 'a b', isSecret: false },
        { name: 'QUOTE', value: 'a"b', isSecret: false },
        { name: 'EMPTY', value: '', isSecret: false },
      ],
      sourceLocation: 'source/relative/context.tar.gz',
    });
    for (const request of records.requests.filter(
      request => new URL(request.url).hostname === 'management.azure.com'
    )) {
      expect(new URL(request.url).searchParams.get('api-version')).toBe('2019-04-01');
    }
    expect(requests(records, '/listBuildSourceUploadUrl')).toHaveLength(1);
    expect(records.tokens).toHaveLength(1);
    expect(records.archive['app.txt'].content).toBe('application');
    expect(stdout).toContain('ACR run run-42: running');
    expect(stdout.match(/building source/g)).toHaveLength(1);
    expect(stdout).toContain('finished');
    expect(stdout + stderr).not.toMatch(/bearer-secret|sas-secret|sig=secret/);
    expect(requests(records, '/listLogSasUrl')).toHaveLength(2);
  });

  it.each(['paged', undefined])(
    'resolves legacy login-name-only configuration with a stable subscription list (%s)',
    lookup => {
      const { status, stderr, records } = fixture({
        AZURE_ACR_RESOURCE_ID: '',
        AZURE_CONTAINER_REGISTRY: 'demo.azurecr.io',
      }).run({ lookup });
      expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
      const lists = requests(records, '/registries');
      expect(lists).toHaveLength(lookup === 'paged' ? 2 : 1);
      for (const item of lists) {
        expect(item.url).toContain(
          '/subscriptions/sub-123/providers/Microsoft.ContainerRegistry/registries?api-version=2023-07-01'
        );
        expect(item.url).not.toContain('registry-rg');
      }
    }
  );

  it.each(['explicit', 'legacy lookup', 'async result'])(
    'encodes Unicode registry paths for real HTTP request lines (%s)',
    variant => {
      const unicodeRegistry = registry.replace('/registry-rg/', '/équipe/');
      const result = fixture({
        AZURE_ACR_RESOURCE_ID: variant === 'legacy lookup' ? '' : unicodeRegistry,
      }).run({
        registry: unicodeRegistry,
        ...(variant === 'async result' ? { async: 'result' } : {}),
      });

      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
      const resourceCalls = result.records.requests.filter(request =>
        request.url.includes('/resourceGroups/')
      );
      expect(resourceCalls.length).toBeGreaterThan(0);
      for (const request of resourceCalls) {
        expect(new URL(request.url).pathname).toContain('/resourceGroups/%C3%A9quipe/');
        expect(request.url).not.toContain('é');
      }
    }
  );

  it.each(['missing', 'ambiguous', 'bad_version'])(
    'rejects invalid registry discovery (%s)',
    lookup => {
      const { status, records } = fixture({ AZURE_ACR_RESOURCE_ID: '' }).run({ lookup });
      expect(status).toBe(1);
      expect(requests(records, '/scheduleRun')).toHaveLength(0);
    }
  );

  it.each(['MODE=release', '[]', '{"KEY":3}', 'null'])(
    'validates JSON build arguments before network calls (%s)',
    args => {
      const { status, stderr, records } = fixture({ BUILD_ARGUMENTS: args }).run();
      expect(status).toBe(1);
      expect(stderr).toContain('BUILD_ARGUMENTS must be a JSON object with string values');
      expect(records.requests).toHaveLength(0);
    }
  );

  it('honors Docker ignore negation, **, directory rules, .git and safe symlinks', () => {
    const test = fixture();
    test.write(
      '.dockerignore',
      '# root comment\n*.secret\n**/*.key\ncache/\n!cache/keep.txt\nignored/\n'
    );
    test.write('password.secret', 'excluded secret');
    test.write('deep/private.key', 'excluded key');
    test.write('cache/private.txt', 'excluded cache');
    test.write('cache/keep.txt', 'included exception');
    test.write('ignored/private', 'excluded target');
    test.write('.git/config', 'excluded git config');
    test.write('deep/.git/config', 'excluded nested git config');
    symlinkSync('app.txt', join(test.workspace, 'app-link'));
    symlinkSync('ignored/private', join(test.workspace, 'secret-link'));
    const { status, stderr, records } = test.run();
    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    expect(records.archive['app-link'].link).toBe('app.txt');
    expect(records.archive['cache/keep.txt'].content).toBe('included exception');
    expect(records.archive['.dockerignore']).toBeDefined();
    for (const excluded of [
      'password.secret',
      'deep/private.key',
      'cache/private.txt',
      'ignored/private',
      '.git/config',
      'deep/.git/config',
      'secret-link',
    ])
      expect(records.archive[excluded]).toBeUndefined();
  });

  it('uses Dockerfile-specific ignore instead of the context .dockerignore', () => {
    const test = fixture({ DOCKER_FILE: 'docker/prod.Dockerfile' });
    test.write('docker/prod.Dockerfile', 'FROM scratch');
    test.write('docker/prod.Dockerfile.dockerignore', 'keep.txt\n');
    test.write('.dockerignore', 'app.txt\n');
    test.write('keep.txt', 'excluded by override');
    const { status, records } = test.run();
    expect(status).toBe(0);
    expect(records.archive['app.txt']).toBeDefined();
    expect(records.archive['keep.txt']).toBeUndefined();
    expect(records.archive['.dockerignore'].content).toBe('keep.txt\n');
    expect(records.archive_names.filter(name => name === '.dockerignore')).toHaveLength(1);
    expect(requests(records, '/scheduleRun')[0].body).toMatchObject({
      dockerFilePath: 'docker/prod.Dockerfile',
    });
  });

  it.each([
    { pattern: '**.pem', excluded: ['private.pem', 'certs/private.pem', 'deep/certs/private.pem'] },
    { pattern: '**private.pem', excluded: ['private.pem', 'certs/private.pem'] },
    { pattern: '**/private?.pem', excluded: ['private1.pem', 'certs/private2.pem'] },
    { pattern: 'private\\[1\\].pem', excluded: ['private[1].pem'] },
    { pattern: 'private\\*.pem', excluded: ['private*.pem'] },
    { pattern: 'private\\?.pem', excluded: ['private?.pem'] },
  ])(
    'preserves Docker wildcard and Linux escape semantics for $pattern',
    ({ pattern, excluded }) => {
      const test = fixture();
      test.write('.dockerignore', `${pattern}\n`);
      test.write('public.txt', 'public file');
      for (const file of excluded) test.write(file, 'excluded private file');

      const { status, stderr, records } = test.run();

      expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
      for (const file of excluded) expect(records.archive[file], file).toBeUndefined();
      expect(records.archive['public.txt'].content).toBe('public file');
      expect(
        Object.values(records.archive)
          .map(item => item.content)
          .join('')
      ).not.toContain('excluded private file');
    }
  );

  it('preserves escaped literal backslashes in Linux ignore patterns', () => {
    const test = fixture();
    test.write('.dockerignore', 'private\\\\key.pem\n');
    test.write('private\\key.pem', 'excluded private file');
    test.write('private/key.pem', 'different path');
    const { status, records } = test.run();
    expect(status).toBe(0);
    expect(records.archive['private\\key.pem']).toBeUndefined();
    expect(records.archive['private/key.pem'].content).toBe('different path');
  });

  it.each(['private\\', 'private[', 'private[]', 'private[z-a]'])(
    'rejects malformed Docker ignore patterns before any upload (%s)',
    pattern => {
      const test = fixture();
      test.write('.dockerignore', `${pattern}\n`);
      const { status, stderr, records } = test.run();
      expect(status).toBe(1);
      expect(stderr).toContain('Docker ignore');
      expect(records.requests).toHaveLength(0);
    }
  );

  it('handles root-relative, character, recursive and multi-directory Docker ignore rules', () => {
    const test = fixture();
    test.write(
      '.dockerignore',
      '\uFEFF/root-only\none/?ile[0-9].txt\n**/hidden/**\n**/password\n!deep/hidden/allowed\nDockerfile\n'
    );
    for (const path of [
      'root-only',
      'deep/root-only',
      'one/file1.txt',
      'deep/password',
      'deep/hidden/private',
      'deep/hidden/allowed',
    ]) {
      test.write(path, path);
    }
    const { status, records } = test.run();
    expect(status).toBe(0);
    for (const path of ['root-only', 'one/file1.txt', 'deep/password', 'deep/hidden/private']) {
      expect(records.archive[path]).toBeUndefined();
    }
    for (const path of ['Dockerfile', 'deep/root-only', 'deep/hidden/allowed']) {
      expect(records.archive[path]).toBeDefined();
    }
  });

  it('never traverses or follows a symlink directory to an excluded outside secret', () => {
    const test = fixture();
    test.write('.dockerignore', 'excluded\n');
    const outside = join(test.directory, 'private');
    mkdirSync(outside);
    writeFileSync(join(outside, 'password'), 'outside secret');
    symlinkSync(outside, join(test.workspace, 'excluded'));
    const { status, records } = test.run();
    expect(status).toBe(0);
    expect(records.archive.excluded).toBeUndefined();
    expect(
      Object.values(records.archive)
        .map(item => item.content)
        .join('')
    ).not.toContain('outside secret');
  });

  it('rejects using .git itself as the context', () => {
    const test = fixture({ BUILD_CONTEXT_PATH: '.git' });
    test.write('.git/config', 'private metadata');
    const { status, stderr, records } = test.run();
    expect(status).toBe(1);
    expect(stderr).toContain('Build context cannot be inside .git');
    expect(requests(records, '/scheduleRun')).toHaveLength(0);
  });

  it('packages nested context at archive root and an external checkout Dockerfile at one synthetic path', () => {
    const test = fixture({ DOCKER_FILE: 'docker/Buildfile', BUILD_CONTEXT_PATH: 'src/web' });
    test.write('docker/Buildfile', 'FROM scratch\nCOPY . /app');
    test.write('docker/Buildfile.dockerignore', '*.secret\n');
    test.write('src/web/index.html', 'web');
    test.write('src/web/password.secret', 'excluded secret');
    const { status, stderr, records } = test.run();
    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    expect(Object.keys(records.archive)).toEqual([
      'index.html',
      externalDockerfile,
      '.dockerignore',
      `${externalDockerfile}.dockerignore`,
    ]);
    expect(requests(records, '/scheduleRun')[0].body).toMatchObject({
      dockerFilePath: externalDockerfile,
    });
  });

  it('normalizes an external Dockerfile override for legacy ACR builders and BuildKit', () => {
    const test = fixture({ DOCKER_FILE: 'docker/Buildfile', BUILD_CONTEXT_PATH: 'src/web' });
    const override = 'private.txt\n';
    test.write('docker/Buildfile', 'FROM scratch\nCOPY included.txt /included.txt\n');
    test.write('docker/Buildfile.dockerignore', override);
    test.write('src/web/.dockerignore', 'included.txt\n');
    test.write('src/web/included.txt', 'required source');
    test.write('src/web/private.txt', 'excluded private file');

    const { status, stderr, records } = test.run();

    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    expect(records.archive['included.txt'].content).toBe('required source');
    expect(records.archive['private.txt']).toBeUndefined();
    expect(records.archive['.dockerignore'].content).toBe(`${override}${stagingIgnore}`);
    expect(records.archive_names.filter(name => name === '.dockerignore')).toHaveLength(1);
    const payload = requests(records, '/scheduleRun')[0].body;
    expect(payload).toMatchObject({ dockerFilePath: externalDockerfile });
    expect(records.archive[`${externalDockerfile}.dockerignore`]?.content).toBe(
      `${override}${stagingIgnore}`
    );
  });

  it.each([
    {
      description: 'inside the context with an ignored target',
      context: '.',
      alias: 'Selected.Dockerfile',
      target: 'templates/Buildfile',
      link: 'templates/Buildfile',
      archived: 'Selected.Dockerfile',
    },
    {
      description: 'outside a nested context',
      context: 'src/web',
      alias: 'docker/Selected.Dockerfile',
      target: 'docker/templates/Buildfile',
      link: 'templates/Buildfile',
      archived: externalDockerfile,
    },
    {
      description: 'inside a nested context with a target elsewhere in the checkout',
      context: 'src/web',
      alias: 'src/web/Selected.Dockerfile',
      target: 'docker/Buildfile',
      link: '../../docker/Buildfile',
      archived: 'Selected.Dockerfile',
    },
  ])('uses the selected Dockerfile alias sidecar $description', input => {
    const test = fixture({ DOCKER_FILE: input.alias, BUILD_CONTEXT_PATH: input.context });
    const prefix = input.context === '.' ? '' : `${input.context}/`;
    const rules = 'private.txt\ntemplates/\n';
    const contents = 'FROM scratch\nCOPY public.txt /public.txt\n';
    test.write(input.target, contents);
    test.write(`${input.target}.dockerignore`, 'public.txt\n');
    test.write(`${input.alias}.dockerignore`, rules);
    test.write(`${prefix}.dockerignore`, 'public.txt\n');
    test.write(`${prefix}private.txt`, 'private-upload-marker');
    test.write(`${prefix}public.txt`, 'required public source');
    symlinkSync(input.link, join(test.workspace, input.alias));

    const { status, stderr, records } = test.run();

    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    expect(records.archive['private.txt']).toBeUndefined();
    expect(records.archive['public.txt'].content).toBe('required public source');
    expect(records.archive[input.archived]).toEqual({ link: null, content: contents });
    expect(records.archive['.dockerignore'].content).toBe(
      `${rules}${input.archived === externalDockerfile ? stagingIgnore : ''}`
    );
    expect(
      Object.values(records.archive)
        .map(item => item.content)
        .join('')
    ).not.toContain('private-upload-marker');
    expect(requests(records, '/scheduleRun')[0].body).toMatchObject({
      dockerFilePath: input.archived,
    });
  });

  it.each(['outside checkout', 'Git metadata'])(
    'rejects a selected Dockerfile alias resolving to %s before upload',
    kind => {
      const test = fixture({ DOCKER_FILE: 'Selected.Dockerfile' });
      if (kind === 'outside checkout') {
        writeFileSync(join(test.directory, 'outside'), 'private checkout-external data');
      } else {
        test.write('.git/config', 'private Git metadata');
      }
      symlinkSync(
        kind === 'outside checkout' ? '../outside' : '.git/config',
        join(test.workspace, 'Selected.Dockerfile')
      );
      const { status, records } = test.run();
      expect(status).toBe(1);
      expect(requests(records, '/listBuildSourceUploadUrl')).toHaveLength(0);
      expect(records.archive).toEqual({});
    }
  );

  it.each([
    { alias: 'Selected.Dockerfile', context: '.', link: '.git/config' },
    { alias: 'docker/Selected.Dockerfile', context: 'src/web', link: '../.git/config' },
  ])('rejects a selected alias sidecar targeting Git metadata (%s)', input => {
    const test = fixture({ DOCKER_FILE: input.alias, BUILD_CONTEXT_PATH: input.context });
    const target = 'templates/Buildfile';
    test.write(target, 'FROM scratch');
    test.write(`${target}.dockerignore`, 'public.txt\n');
    test.write('.git/config', 'private-git-sidecar-marker');
    test.write('src/web/public.txt', 'public source');
    mkdirSync(dirname(join(test.workspace, input.alias)), { recursive: true });
    symlinkSync(
      input.alias.startsWith('docker/') ? '../templates/Buildfile' : target,
      join(test.workspace, input.alias)
    );
    symlinkSync(input.link, join(test.workspace, `${input.alias}.dockerignore`));
    const { status, stderr, records } = test.run();
    expect(status).toBe(1);
    expect(stderr).toContain('Docker ignore file cannot be inside .git');
    expect(requests(records, '/listBuildSourceUploadUrl')).toHaveLength(0);
    expect(records.archive).toEqual({});
  });

  it.each(['relative outside context', 'absolute inside context'])(
    'rejects a selected root-ignore symlink that is %s before upload',
    kind => {
      const test = fixture({ DOCKER_FILE: 'docker/Buildfile', BUILD_CONTEXT_PATH: 'src/web' });
      test.write('docker/Buildfile', 'FROM scratch');
      test.write('private-ignore', 'checkout-private-marker');
      test.write('src/web/ignore.rules', 'private.txt\n');
      symlinkSync(
        kind === 'relative outside context'
          ? '../../private-ignore'
          : join(test.workspace, 'src/web/ignore.rules'),
        join(test.workspace, 'src/web/.dockerignore')
      );
      const { status, stderr, records } = test.run();
      expect(status).toBe(1);
      expect(stderr).toContain('Context symlink escapes the build context');
      expect(requests(records, '/listBuildSourceUploadUrl')).toHaveLength(0);
      expect(records.archive).toEqual({});
    }
  );

  it('normalizes a selected root-ignore symlink whose relative target remains inside the context', () => {
    const test = fixture({ DOCKER_FILE: 'docker/Buildfile', BUILD_CONTEXT_PATH: 'src/web' });
    test.write('docker/Buildfile', 'FROM scratch');
    test.write('src/web/ignore.rules', 'private.txt\n');
    test.write('src/web/private.txt', 'excluded private file');
    symlinkSync('ignore.rules', join(test.workspace, 'src/web/.dockerignore'));
    const { status, stderr, records } = test.run();
    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    expect(records.archive['.dockerignore'].content).toBe(`private.txt\n${stagingIgnore}`);
    expect(records.archive['private.txt']).toBeUndefined();
  });

  it.each([
    {
      description: 'with an excluded target in the root context',
      context: '.',
      dockerfile: 'Dockerfile',
      excludeTarget: true,
    },
    {
      description: 'with an excluded target in a nested context',
      context: 'src/web',
      dockerfile: 'docker/Buildfile',
      excludeTarget: true,
    },
    {
      description: 'with an included target in the root context',
      context: '.',
      dockerfile: 'Dockerfile',
      excludeTarget: false,
    },
  ])('materializes a selected root-ignore symlink $description', input => {
    const prefix = input.context === '.' ? '' : `${input.context}/`;
    const test = fixture({
      DOCKER_FILE: `${prefix}${input.dockerfile}`,
      BUILD_CONTEXT_PATH: input.context,
    });
    const dockerfile = 'FROM scratch\nCOPY . /app\n';
    const rules = `.dockerignore\n${input.dockerfile}\nprivate.txt\n${
      input.excludeTarget ? 'ignore.rules\n' : ''
    }`;
    test.write(`${prefix}${input.dockerfile}`, dockerfile);
    test.write(`${prefix}ignore.rules`, rules);
    test.write(`${prefix}private.txt`, 'private-upload-marker');
    test.write(`${prefix}public.txt`, 'required public source');
    symlinkSync('ignore.rules', join(test.workspace, `${prefix}.dockerignore`));

    const { status, stderr, records } = test.run();

    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    expect(records.archive['.dockerignore']).toEqual({ link: null, content: rules });
    expect(records.archive_names.filter(name => name === '.dockerignore')).toHaveLength(1);
    expect(records.archive[input.dockerfile]).toEqual({ link: null, content: dockerfile });
    expect(records.archive['ignore.rules']).toEqual(
      input.excludeTarget ? undefined : { link: null, content: rules }
    );
    expect(records.archive['private.txt']).toBeUndefined();
    expect(records.archive['public.txt'].content).toBe('required public source');
    expect(requests(records, '/scheduleRun')[0].body).toMatchObject({
      dockerFilePath: input.dockerfile,
    });
  });

  it('rejects a selected root-ignore symlink with a missing target before upload', () => {
    const test = fixture();
    symlinkSync('missing.rules', join(test.workspace, '.dockerignore'));

    const { status, stderr, records } = test.run();

    expect(status).toBe(1);
    expect(stderr).toContain('Docker ignore path must be a file');
    expect(requests(records, '/listBuildSourceUploadUrl')).toHaveLength(0);
    expect(records.archive).toEqual({});
  });

  it('rejects a selected ignore directory instead of replacing it with an empty file', () => {
    const test = fixture({ DOCKER_FILE: 'docker/Buildfile', BUILD_CONTEXT_PATH: 'src/web' });
    test.write('docker/Buildfile', 'FROM scratch');
    test.write('src/web/.dockerignore/invalid.txt', 'not an ignore file');
    const { status, stderr, records } = test.run();
    expect(status).toBe(1);
    expect(stderr).toContain('Docker ignore path must be a file');
    expect(requests(records, '/listBuildSourceUploadUrl')).toHaveLength(0);
  });

  it.each([
    { description: 'no ignore file', root: undefined, override: undefined, selected: '' },
    {
      description: 'root ignore rules',
      root: 'private.txt',
      override: undefined,
      selected: 'private.txt',
    },
    {
      description: 'specific override',
      root: 'app.txt\n',
      override: 'private.txt\n!.aksd-acr.Dockerfile*',
      selected: 'private.txt\n!.aksd-acr.Dockerfile*',
    },
  ])(
    'excludes external Dockerfile staging from COPY context with $description',
    ({ root, override, selected }) => {
      const test = fixture({ DOCKER_FILE: 'docker/Buildfile', BUILD_CONTEXT_PATH: 'src/web' });
      test.write('docker/Buildfile', 'FROM scratch\nCOPY . /app/\n');
      test.write('src/web/app.txt', 'application');
      if (root !== undefined) test.write('src/web/.dockerignore', root);
      if (override !== undefined) test.write('docker/Buildfile.dockerignore', override);
      if (selected) test.write('src/web/private.txt', 'excluded secret');

      const { status, stderr, records } = test.run();

      expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
      expect(records.archive['app.txt'].content).toBe('application');
      expect(records.archive[externalDockerfile].content).toContain('COPY . /app/');
      expect(records.archive[`${externalDockerfile}.dockerignore`]?.content).toBe(
        `${selected}${stagingIgnore}`
      );
      expect(records.archive['.dockerignore']?.content).toBe(`${selected}${stagingIgnore}`);
      expect(records.archive_names.filter(name => name === '.dockerignore')).toHaveLength(1);
      expect(records.archive_names.some(name => name.startsWith('.aksd-acr/'))).toBe(false);
      expect(records.archive['private.txt']).toBeUndefined();
    }
  );

  it.each(['.aksd-acr', externalDockerfile, `${externalDockerfile}.dockerignore`])(
    'rejects collisions with reserved external staging path %s',
    name => {
      const test = fixture({ DOCKER_FILE: 'docker/Buildfile', BUILD_CONTEXT_PATH: 'src/web' });
      test.write('docker/Buildfile', 'FROM scratch');
      test.write(`src/web/${name}`, 'existing source');
      const { status, stderr, records } = test.run();
      expect(status).toBe(1);
      expect(stderr).toContain(`Reserved context path ${name} already exists`);
      expect(requests(records, '/scheduleRun')).toHaveLength(0);
    }
  );

  it.each(['context', 'dockerfile', 'symlink'])('rejects checkout/context escapes (%s)', kind => {
    const test = fixture(
      kind === 'context'
        ? { BUILD_CONTEXT_PATH: '..' }
        : kind === 'dockerfile'
        ? { DOCKER_FILE: '../outside' }
        : {}
    );
    writeFileSync(join(test.directory, 'outside'), 'outside workspace secret');
    if (kind === 'symlink') symlinkSync('../../outside', join(test.workspace, 'escape'));
    const { status, stderr, records } = test.run();
    expect(status).toBe(1);
    expect(stderr).toMatch(/inside the checkout|escapes the build context/);
    expect(requests(records, '/scheduleRun')).toHaveLength(0);
  });

  it.each(['200', 'location', 'operation-location', 'result'])(
    'follows asynchronous schedule responses (%s)',
    variant => {
      const { status, stderr, records } = fixture().run({ async: variant });
      expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
      expect(requests(records, '/scheduleRun')).toHaveLength(1);
      expect(requests(records, '/operations/build')).toHaveLength(2);
      if (variant === 'result') expect(requests(records, '/results/build')).toHaveLength(1);
    }
  );

  it.each(['no_run', 'failed', 'never', 'hostile'])(
    'fails closed on unusable or bounded async scheduling (%s)',
    variant => {
      const { status, records, stderr } = fixture().run({ async: variant });
      expect(status).toBe(1);
      expect(requests(records, '/scheduleRun')).toHaveLength(1);
      expect(
        records.requests.every(request => new URL(request.url).hostname !== 'attacker.example')
      ).toBe(true);
      expect(stderr).not.toContain('sig=hidden');
      if (variant === 'never')
        expect(records.sleeps.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(4320);
    }
  );

  it.each(['Failed', 'Canceled', 'Error', 'Timeout', 'Cancelled', 'TimedOut'])(
    'downloads logs and fails for terminal run status %s',
    status => {
      const result = fixture().run({ statuses: [status] });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('building source');
      expect(result.stderr).toContain(`ACR run ended in ${status.toLowerCase()}`);
      expect(requests(result.records, '/listLogSasUrl')).toHaveLength(1);
    }
  );

  it('does not report success if final build logs cannot be fetched', () => {
    const result = fixture().run({ statuses: ['Succeeded'], logs_error: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('final build logs could not be downloaded');
  });

  it('streams complete logs larger than 16 MiB without a successful-build size cap', () => {
    const result = fixture().run({
      statuses: ['Succeeded'],
      large_log: true,
      capture_output: true,
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(result.records.log_bytes).toBe(17 * 1024 * 1024 + 'complete\n'.length);
    expect(result.records.output_bytes).toBeGreaterThan(17 * 1024 * 1024);
    expect(result.records.output_tail).toMatch(/x+complete\n$/);
    const expected = createHash('sha256')
      .update(
        'Uploaded local build context; scheduling ACR run\nACR run run-42 scheduled\nACR run run-42: succeeded\n'
      )
      .update(Buffer.alloc(17 * 1024 * 1024, 'x'))
      .update('complete\n')
      .digest('hex');
    expect(result.records.output_hash).toBe(expected);
    expect(Math.max(...result.records.log_reads)).toBe(64 * 1024);
  });

  it('uses byte ranges after the last offset and handles unchanged logs with 416', () => {
    const result = fixture().run();
    expect(result.status).toBe(0);
    const downloads = result.records.requests.filter(
      request => new URL(request.url).hostname === 'logs.example'
    );
    expect(downloads).toHaveLength(2);
    expect(downloads[0].headers.Range).toBeUndefined();
    expect(downloads[1].headers.Range).toBe(`bytes=${result.records.log_bytes}-`);
    expect(result.stdout.match(/building source/g)).toHaveLength(1);
    expect(result.stdout).toContain('finished');
  });

  it.each([false, true])(
    'preserves appended UTF-8 across HTTP and chunk boundaries (ignored Range: %s)',
    ignoreRange => {
      const result = fixture().run({
        split_utf8: true,
        log_chunk_size: 1,
        ignore_range: ignoreRange,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('🚀 café 世界\n');
      expect(result.stdout).not.toContain('\uFFFD');
      expect(result.records.requests.some(request => request.headers.Range === 'bytes=8-')).toBe(
        true
      );
    }
  );

  it('redacts tokens and a long signed query split across tiny streaming chunks', () => {
    const text = `start 🚀 bearer-secret-1 https://storage.example/blob?sig=${'secret'.repeat(
      500
    )} end café\n`;
    const result = fixture().run({ statuses: ['Succeeded'], log_text: text, log_chunk_size: 3 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('start 🚀 [REDACTED]');
    expect(result.stdout).toContain('?[REDACTED signed query] end café\n');
    expect(result.stdout).not.toMatch(/bearer-secret|sig=|secretsecret|\uFFFD/);
  });

  it('redacts a token and signed query that continue in later polling responses', () => {
    const first = 'alpha\nbearer-sec';
    const complete = 'alpha\nbearer-secret-1 https://storage.example/blob?sig=';
    const result = fixture().run({
      statuses: ['Running', 'Running', 'Succeeded'],
      log_versions: [first, complete, `${complete}query-secret end\n`],
      log_chunk_size: 2,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/bearer-sec|query-secret|sig=/);
    expect(result.stdout).toContain('[REDACTED]');
    expect(result.stdout).toContain('?[REDACTED signed query]');
    expect(result.stdout).toContain('end\n');
  });

  it('resumes an interrupted log stream at the consumed offset without duplicate output', () => {
    const text = 'alpha\n🚀 bearer-secret-1 omega\n';
    const result = fixture().run({
      statuses: ['Succeeded'],
      log_text: text,
      log_chunk_size: 7,
      stream_retry: true,
    });
    expect(result.status).toBe(0);
    expect(result.records.log_bytes).toBe(Buffer.byteLength(text));
    expect(result.stdout).toContain('alpha\n🚀 [REDACTED] omega\n');
    expect(result.records.requests.some(request => request.headers.Range === 'bytes=14-')).toBe(
      true
    );
    expect(result.stdout).not.toContain('bearer-secret');
  });

  it.each([false, true])(
    'follows partial range continuations through the complete final build log (unknown size: %s)',
    unknownSize => {
      const complete = `start\n${'café 🚀 '.repeat(100)}final-marker\n`;
      const result = fixture().run({
        log_versions: ['start\n', complete],
        range_page: 19,
        log_chunk_size: 3,
        unknown_log_size: unknownSize,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('final-marker\n');
      expect(result.stdout).not.toContain('\uFFFD');
      expect(result.records.log_bytes).toBe(Buffer.byteLength(complete));
      const downloads = result.records.requests.filter(
        request => new URL(request.url).hostname === 'logs.example'
      );
      expect(downloads.length).toBeGreaterThan(3);
      expect(downloads[2].headers.Range).toBe('bytes=25-');
    }
  );

  it('rejects a mismatched log Content-Range rather than silently omitting log bytes', () => {
    const result = fixture().run({
      log_versions: ['first\n', 'first\nsecond\n'],
      bad_range: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('final build logs could not be downloaded');
  });

  it.each([
    { description: 'initial download', truncateAfter: 1 },
    { description: 'server ignoring a resumed Range request', truncateAfter: 2 },
  ])('rejects truncated HTTP 200 logs on $description', ({ truncateAfter }) => {
    const result = fixture().run({
      statuses: truncateAfter === 1 ? ['Succeeded'] : ['Running', 'Succeeded'],
      truncate_log: true,
      truncate_after: truncateAfter,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('final build logs could not be downloaded');
    if (truncateAfter > 1) {
      expect(
        result.records.requests.some(request => request.headers.Range?.startsWith('bytes='))
      ).toBe(true);
    }
  });

  it('reports progress before logs exist, then downloads final logs', () => {
    const result = fixture().run({ logs_delay: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Build logs not available yet');
    expect(result.stdout).toContain('finished');
  });

  it('fails if a successful run does not provide a final log link', () => {
    const result = fixture().run({ statuses: ['Succeeded'], missing_log: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('final build logs could not be downloaded');
  });

  it('still retrieves useful build logs when run polling itself fails', () => {
    const result = fixture().run({ http_error: 500, error_path: '/runs/run-42' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('building source');
    expect(requests(result.records, '/listLogSasUrl')).toHaveLength(1);
    expect(requests(result.records, '/scheduleRun')).toHaveLength(1);
    expect(requests(result.records, '/cancel')).toHaveLength(1);
  });

  it.each([
    { invalid_json: true },
    { upload_error: true },
    { upload: { uploadUrl: 'https://storage.example/?sig=secret' } },
  ])('rejects invalid or failed context upload before scheduling (%s)', scenario => {
    const result = fixture().run(scenario);
    expect(result.status).toBe(1);
    expect(requests(result.records, '/scheduleRun')).toHaveLength(0);
    expect(result.stderr).not.toContain('secret-token');
  });

  it.each([400, 403, 404, 429, 500])('bounds HTTP %s failures before scheduling', code => {
    const result = fixture().run({ http_error: code });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`ACR HTTP ${code}`);
    expect(requests(result.records, '/scheduleRun')).toHaveLength(0);
    expect(requests(result.records, '/listBuildSourceUploadUrl').length).toBeLessThanOrEqual(5);
    expect(result.stdout + result.stderr).not.toContain('signed-secret-url');
  });

  it('caches the ARM token and renews it only once after a 401', () => {
    const result = fixture().run({ renew: true });
    expect(result.status).toBe(0);
    expect(result.records.tokens).toHaveLength(2);
    expect(requests(result.records, '/listBuildSourceUploadUrl')).toHaveLength(2);
    expect(result.stdout + result.stderr).not.toContain('bearer-secret');
  });

  it('does not loop on repeated authentication failures', () => {
    const result = fixture().run({ renew_twice: true });
    expect(result.status).toBe(1);
    expect(result.records.tokens).toHaveLength(2);
    expect(requests(result.records, '/listBuildSourceUploadUrl')).toHaveLength(2);
  });

  it('does not expose Azure CLI token acquisition stderr', () => {
    const result = fixture().run({ token_error: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unable to acquire ARM token');
    expect(result.stderr).not.toContain('secret-token');
    expect(result.records.requests).toHaveLength(0);
  });

  it('renews a rejected schedule token without an unsafe extra accepted run', () => {
    const result = fixture().run({ schedule_401: true });
    expect(result.status).toBe(0);
    expect(requests(result.records, '/scheduleRun')).toHaveLength(2);
    expect(result.records.tokens).toHaveLength(2);
  });

  it('honors Retry-After while throttled', () => {
    const result = fixture().run({ throttle: true });
    expect(result.status).toBe(0);
    expect(result.records.sleeps.slice(0, 2)).toEqual([7, 7]);
  });

  it('also honors an HTTP-date Retry-After', () => {
    const result = fixture().run({ throttle: true, retry_after: 'Wed, 21 Oct 2015 07:28:00 GMT' });
    expect(result.status).toBe(0);
    expect(result.records.sleeps.slice(0, 2)).toEqual([0, 0]);
  });

  it.each([{ schedule_error: 500 }, { schedule_error: 429 }, { schedule_transport: true }])(
    'never retries an ambiguous schedule and persists uncertainty (%s)',
    scenario => {
      const test = fixture();
      const result = test.run(scenario);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('acceptance is uncertain');
      expect(requests(result.records, '/scheduleRun')).toHaveLength(1);
      const cleanup = test.run({ args: ['--cancel'] });
      expect(cleanup.status).toBe(1);
      expect(cleanup.stderr).toContain('no run ID is available to cancel');
      expect(cleanup.records.requests).toHaveLength(0);
    }
  );

  it.each(['term', 'int'])(
    'cancels a known run on SIG%s and supports persisted cleanup',
    signal => {
      const test = fixture();
      const result = test.run({ signal, statuses: ['Running'] });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Build interrupted');
      expect(requests(result.records, '/cancel')).toHaveLength(1);
      expect(requests(result.records, '/scheduleRun')).toHaveLength(1);
      const cleanup = test.run({ args: ['--cancel'], statuses: ['Running'] });
      expect(cleanup.status).toBe(0);
      expect(requests(cleanup.records, '/cancel')).toHaveLength(1);
      expect(requests(cleanup.records, '/scheduleRun')).toHaveLength(0);
    }
  );

  it.each([
    { signal: 'term', phase: 'open' },
    { signal: 'int', phase: 'open' },
    { signal: 'term', phase: 'read' },
    { signal: 'int', phase: 'read' },
  ])(
    'cancels SIG$signal during active log $phase instead of treating it as unavailable logs',
    ({ signal, phase }) => {
      const result = fixture().run({
        [`signal_log_${phase}`]: signal,
        statuses: ['Running', 'Running', 'Succeeded'],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Build interrupted; cancelling the ACR run');
      expect(result.stdout).not.toContain('Build logs not available yet');
      expect(requests(result.records, '/cancel')).toHaveLength(1);
      expect(requests(result.records, '/scheduleRun')).toHaveLength(1);
    }
  );

  it('bounds stuck runs and requests cancellation', () => {
    const result = fixture().run({ statuses: ['Running'], run_retry_after: '600' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('deadline exceeded');
    expect(requests(result.records, '/cancel')).toHaveLength(1);
  });

  it('uses a persisted operation to discover and cancel a run during a later cleanup', () => {
    const test = fixture();
    expect(test.run({ async: 'never' }).status).toBe(1);
    const cleanup = test.run({ args: ['--cancel'], statuses: ['Running'] });
    expect(cleanup.status).toBe(0);
    expect(requests(cleanup.records, '/operations/build')).toHaveLength(2);
    expect(requests(cleanup.records, '/cancel')).toHaveLength(1);
    expect(requests(cleanup.records, '/scheduleRun')).toHaveLength(0);
  });

  it('reports failed cancellation requests explicitly', () => {
    const test = fixture();
    expect(test.run({ signal: 'term', statuses: ['Running'] }).status).toBe(1);
    const cleanup = test.run({
      args: ['--cancel'],
      statuses: ['Running'],
      http_error: 403,
      error_path: '/cancel',
    });
    expect(cleanup.status).toBe(1);
    expect(cleanup.stderr).toContain('ACR HTTP 403');
  });

  it('does not cancel a completed run during cleanup', () => {
    const test = fixture();
    expect(test.run({ statuses: ['Succeeded'] }).status).toBe(0);
    const cleanup = test.run({ args: ['--cancel'], statuses: ['Succeeded'] });
    expect(cleanup.status).toBe(0);
    expect(requests(cleanup.records, '/cancel')).toHaveLength(0);
  });

  it('treats missing cancellation state as a no-op before any run is scheduled', () => {
    const result = fixture({
      AZURE_ACR_RESOURCE_ID: '',
      AZURE_SUBSCRIPTION_ID: '',
      CONTAINER_NAME: '',
    }).run({ args: ['--cancel'] });
    expect(result.status).toBe(0);
    expect(result.records.requests).toHaveLength(0);
    expect(result.records.tokens).toHaveLength(0);
  });

  it('rejects malformed cancellation state rather than silently succeeding', () => {
    const test = fixture();
    expect(test.run({ statuses: ['Succeeded'] }).status).toBe(0);
    const stateFile = readdirSync(test.runnerTemp).find(path => path.endsWith('.json'))!;
    writeFileSync(join(test.runnerTemp, stateFile), '{ broken json');
    const result = test.run({ args: ['--cancel'] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('state is malformed');
    expect(result.records.requests).toHaveLength(0);
  });

  it('keeps state isolated by job and refuses scheduling the same job twice', () => {
    const test = fixture();
    expect(test.run({ statuses: ['Succeeded'] }).status).toBe(0);
    const duplicate = test.run({ statuses: ['Succeeded'] });
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain('refusing to schedule a duplicate');
    expect(requests(duplicate.records, '/scheduleRun')).toHaveLength(0);
    test.environment.GITHUB_JOB = 'another-build';
    expect(test.run({ statuses: ['Succeeded'] }).status).toBe(0);
  });
});
