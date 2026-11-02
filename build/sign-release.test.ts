// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { signRelease, type SigningOptions } from './sign-release.ts';

const options: SigningOptions = {
  repository: 'example/aks-desktop', tag: 'v1.2.3', token: 'test-token', allowPublished: false,
};
const metadataNames = new Set(['checksums.txt', 'checksums.txt.sigstore.json']);

class GitHubFixture {
  release = { id: 1, tag_name: options.tag, draft: true };
  otherReleases: typeof this.release[] = [];
  assets = new Map<number, {
    id: number; name: string; size: number; state: string; updated_at: string;
    digest: string | null; contents: Buffer;
  }>();
  nextId = 1;
  calls: { method: string; url: URL }[] = [];
  cosignCalls: string[][] = [];
  manifest = '';
  temporaryDirectory = '';
  intercept: (url: URL, init: RequestInit) => Response | undefined = () => undefined;
  duringSigning: () => void = () => {};

  add(name: string, contents = name): number {
    const id = this.nextId++;
    const bytes = Buffer.from(contents);
    this.assets.set(id, {
      id, name, size: bytes.length, state: 'uploaded', updated_at: '2026-10-29T00:00:00Z',
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, contents: bytes,
    });
    return id;
  }

  fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init.method ?? 'GET';
    assert.ok(['api.github.com', 'uploads.github.com'].includes(url.hostname));
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${options.token}`);
    this.calls.push({ method, url });
    const intercepted = this.intercept(url, init);
    if (intercepted) return intercepted;
    if (url.pathname === `/repos/${options.repository}/releases/tags/${options.tag}`) {
      return new Response('Pending draft tag has no Git tag', { status: 404 });
    }
    if (url.pathname === `/repos/${options.repository}/releases`) {
      const page = Number(url.searchParams.get('page'));
      return Response.json([...this.otherReleases, this.release].slice((page - 1) * 100, page * 100));
    }
    if (url.pathname === `/repos/${options.repository}/releases/${this.release.id}`) {
      return Response.json(this.release);
    }
    if (url.pathname === `/repos/${options.repository}/releases/1/assets`) {
      if (method === 'POST') {
        const name = url.searchParams.get('name');
        assert.ok(name);
        assert.ok(![...this.assets.values()].some(asset => asset.name === name));
        const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
        const id = this.add(name, bytes.toString());
        return Response.json(this.assets.get(id), { status: 201 });
      }
      const page = Number(url.searchParams.get('page'));
      return Response.json([...this.assets.values()].slice((page - 1) * 100, page * 100));
    }
    const assetId = Number(url.pathname.split('/').at(-1));
    const asset = this.assets.get(assetId);
    if (asset) {
      if (method === 'DELETE') {
        this.assets.delete(assetId);
        return new Response(null, { status: 204 });
      }
      return new Response(new Uint8Array(asset.contents));
    }
    return new Response('Not found', { status: 404 });
  };

  cosign = (args: string[]): void => {
    this.cosignCalls.push(args);
    const bundlePath = args[args.indexOf('--bundle') + 1];
    if (args[0] === 'sign-blob') {
      this.temporaryDirectory = dirname(bundlePath);
      this.manifest = readFileSync(args.at(-1)!, 'utf8');
      writeFileSync(bundlePath, `signature for ${this.manifest}`);
      this.duringSigning();
    } else {
      assert.equal(args[0], 'verify-blob');
      assert.equal(args[args.indexOf('--certificate-identity') + 1],
        `https://github.com/${options.repository}/.github/workflows/sign-release.yml@refs/heads/main`);
      assert.equal(args[args.indexOf('--certificate-oidc-issuer') + 1],
        'https://token.actions.githubusercontent.com');
      assert.equal(readFileSync(bundlePath, 'utf8'), `signature for ${readFileSync(args[1], 'utf8')}`);
    }
  };

  run(overrides: Partial<SigningOptions> = {}) {
    return signRelease({ ...options, ...overrides }, this.fetcher, this.cosign);
  }

  metadata() {
    return [...this.assets.values()].filter(asset => metadataNames.has(asset.name));
  }
}

async function rejects(api: GitHubFixture, pattern: RegExp): Promise<void> {
  await assert.rejects(api.run(), error => {
    const details = error instanceof AggregateError ? error.errors.map(String).join('\n') : String(error);
    assert.match(details, pattern);
    return true;
  });
}

test('signs a draft with a pending tag even when the by-tag endpoint returns 404', async () => {
  const api = new GitHubFixture();
  const b = api.add('aks-desktop-win.exe', 'windows payload');
  const a = api.add('aks-desktop-linux.tar.gz', 'linux payload');
  const originals = [...api.assets.values()];
  await api.run();
  const expected = [a, b].map(id => {
    const asset = api.assets.get(id)!;
    return `${createHash('sha256').update(asset.contents).digest('hex')}  ${asset.name}\n`;
  }).join('');
  assert.equal(api.manifest, expected);
  assert.equal(api.metadata().length, 2);
  for (const original of originals) assert.equal(api.assets.get(original.id), original);
  assert.deepEqual(api.cosignCalls.map(args => args[0]), ['sign-blob', 'verify-blob']);
  assert.ok(!existsSync(api.temporaryDirectory));
  assert.equal(api.release.draft, true);
  assert.ok(api.calls.every(call => call.method !== 'PATCH'));
  assert.ok(api.calls.every(call => !call.url.pathname.includes('/releases/tags/')));
  assert.equal(api.calls.filter(call => call.url.pathname === `/repos/${options.repository}/releases/1`).length, 2);
});

test('reruns replace metadata without including it in its own checksums', async () => {
  const api = new GitHubFixture();
  api.add('aks-desktop.dmg');
  api.add('checksums.txt', 'old checksums');
  api.add('checksums.txt.sigstore.json', 'old signature');
  await api.run();
  const manifest = api.manifest;
  await api.run();
  assert.equal(api.manifest, manifest);
  assert.equal(api.metadata().length, 2);
  assert.ok(!manifest.includes('checksums.txt'));
  const deletes = api.calls.filter(call => call.method === 'DELETE');
  assert.equal(deletes[0].url.pathname.split('/').at(-1), '3');
  assert.equal(deletes[1].url.pathname.split('/').at(-1), '2');
});

test('enumerates all release and asset pages beyond the first 100 entries', async () => {
  const api = new GitHubFixture();
  api.otherReleases = Array.from({ length: 100 }, (_, i) => ({ id: i + 2, tag_name: `v0.0.${i}`, draft: false }));
  for (let i = 0; i < 101; i++) api.add(`aks-desktop-${i}.zip`);
  await api.run();
  assert.equal(api.manifest.trim().split('\n').length, 101);
  assert.ok(api.calls.some(call => call.url.searchParams.get('page') === '2'));
  assert.ok(api.calls.some(call => call.url.pathname.endsWith('/releases') && call.url.searchParams.get('page') === '2'));
});

for (const mode of ['missing', 'ambiguous', 'api-failure']) {
  test(`rejects ${mode} release discovery before signing or mutation`, async () => {
    const api = new GitHubFixture();
    api.add('aks-desktop.exe');
    api.intercept = url => {
      if (url.pathname !== `/repos/${options.repository}/releases`) return undefined;
      if (mode === 'api-failure') return new Response('Unavailable', { status: 503 });
      return Response.json(mode === 'missing' ? [] : [api.release, { ...api.release, id: 2 }]);
    };
    await rejects(api, /not found|Multiple releases|503/);
    assert.equal(api.cosignCalls.length, 0);
    assert.ok(api.calls.every(call => call.method === 'GET'));
  });
}

test('published releases require opt-in and remain published after signing', async () => {
  const api = new GitHubFixture();
  api.release.draft = false;
  api.add('aks-desktop.exe');
  await rejects(api, /explicit opt-in/);
  assert.equal(api.cosignCalls.length, 0);
  await api.run({ allowPublished: true });
  assert.equal(api.release.draft, false);
});

for (const [name, value] of [['repository', '../bad/repo'], ['tag', 'v1.2.3\nunsafe'], ['token', '']]) {
  test(`rejects invalid ${name} without an API call`, async () => {
    const api = new GitHubFixture();
    await assert.rejects(api.run({ [name]: value }), /Provide/);
    assert.equal(api.calls.length, 0);
  });
}

test('rejects empty releases before invoking cosign', async () => {
  const api = new GitHubFixture();
  await rejects(api, /nonempty/);
  assert.equal(api.cosignCalls.length, 0);
});

for (const name of ['bad\nname.exe', '../outside.exe', 'space name.exe', '-option.exe', 'bad\\name.exe']) {
  test(`rejects unsafe asset name ${JSON.stringify(name)}`, async () => {
    const api = new GitHubFixture();
    api.add(name);
    await rejects(api, /unsafe/);
    assert.equal(api.cosignCalls.length, 0);
  });
}

test('rejects duplicate names and incomplete uploads', async () => {
  const duplicate = new GitHubFixture();
  duplicate.add('aks-desktop.exe');
  duplicate.add('aks-desktop.exe');
  await rejects(duplicate, /Duplicate/);
  const incomplete = new GitHubFixture();
  const id = incomplete.add('aks-desktop.exe');
  incomplete.assets.get(id)!.state = 'starter';
  await rejects(incomplete, /fully uploaded/);
});

test('API list failures stop before signing or mutation', async () => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  api.intercept = url => url.searchParams.has('page') ? new Response('Unavailable', { status: 503 }) : undefined;
  await rejects(api, /503/);
  assert.equal(api.cosignCalls.length, 0);
  assert.ok(api.calls.every(call => call.method === 'GET'));
});

test('a later pagination failure cannot produce a manifest for only the first page', async () => {
  const api = new GitHubFixture();
  for (let i = 0; i < 101; i++) api.add(`aks-desktop-${i}.zip`);
  api.intercept = url => url.searchParams.get('page') === '2'
    ? new Response('Interrupted pagination', { status: 503 }) : undefined;
  await rejects(api, /503/);
  assert.equal(api.cosignCalls.length, 0);
  assert.ok(api.calls.every(call => call.method === 'GET'));
});

test('zero-byte payloads cannot be signed', async () => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe', '');
  await rejects(api, /nonempty/);
  assert.equal(api.cosignCalls.length, 0);
});

test('download failures, truncated streams, and digest mismatches stop before signing', async t => {
  for (const mode of ['http', 'truncated', 'digest', 'stream', 'empty']) {
    await t.test(mode, async () => {
      const api = new GitHubFixture();
      const id = api.add('aks-desktop.exe', 'expected payload');
      api.intercept = url => {
        if (!url.pathname.endsWith(`/assets/${id}`)) return undefined;
        if (mode === 'http') return new Response('Unavailable', { status: 503 });
        if (mode === 'empty') return new Response(null);
        if (mode === 'stream') return new Response(new ReadableStream({
          start(controller) { controller.error(new Error('Interrupted download')); },
        }));
        return new Response(mode === 'truncated' ? 'short' : 'different bytes!');
      };
      await rejects(api, /503|match GitHub|Interrupted|No download body/);
      assert.equal(api.cosignCalls.length, 0);
    });
  }
});

test('older assets without an API digest are still hashed from their bytes', async () => {
  const api = new GitHubFixture();
  const id = api.add('aks-desktop.exe');
  api.assets.get(id)!.digest = null;
  await api.run();
  assert.ok(api.manifest.includes('aks-desktop.exe'));
});

test('cosign failures leave existing metadata untouched and remove temporary files', async () => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  const old = api.add('checksums.txt.sigstore.json');
  api.cosign = args => {
    api.temporaryDirectory = dirname(args[args.indexOf('--bundle') + 1]);
    throw new Error('Cosign failed');
  };
  await rejects(api, /Cosign failed/);
  assert.ok(api.assets.has(old));
  assert.ok(api.calls.every(call => call.method === 'GET'));
  assert.ok(!existsSync(api.temporaryDirectory));
});

test('signature verification failures cannot replace existing release metadata', async () => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  const old = api.add('checksums.txt.sigstore.json');
  const cosign = api.cosign;
  api.cosign = args => {
    cosign(args);
    if (args[0] === 'verify-blob') throw new Error('Signature verification failed');
  };
  await rejects(api, /Signature verification failed/);
  assert.ok(api.assets.has(old));
  assert.ok(api.calls.every(call => call.method === 'GET'));
  assert.ok(!existsSync(api.temporaryDirectory));
});

for (const change of ['payload', 'metadata', 'publish']) {
  test(`rejects concurrent ${change} edits before changing metadata`, async () => {
    const api = new GitHubFixture();
    api.add('aks-desktop.exe');
    api.duringSigning = () => {
      if (change === 'publish') api.release.draft = false;
      else api.add(change === 'metadata' ? 'checksums.txt' : 'aks-desktop.deb');
    };
    await rejects(api, /Release changed/);
    assert.ok(api.calls.every(call => call.method === 'GET'));
  });
}

for (const failedName of ['checksums.txt', 'checksums.txt.sigstore.json']) {
  test(`failed ${failedName} upload is explicit, cleaned up, and recoverable by rerunning`, async () => {
    const api = new GitHubFixture();
    api.add('aks-desktop.exe');
    api.intercept = (url, init) => init.method === 'POST' && url.searchParams.get('name') === failedName
      ? new Response('Upload failed', { status: 500 }) : undefined;
    await rejects(api, /500/);
    assert.equal(api.metadata().length, 0);
    api.intercept = () => undefined;
    await api.run();
    assert.equal(api.metadata().length, 2);
  });
}

test('failed deletion stops before uploading new metadata', async () => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  api.add('checksums.txt.sigstore.json');
  api.intercept = (_url, init) => init.method === 'DELETE' ? new Response('Delete failed', { status: 500 }) : undefined;
  await rejects(api, /500/);
  assert.ok(api.calls.every(call => call.method !== 'POST'));
});

for (const name of ['checksums.txt', 'checksums.txt.sigstore.json']) {
  test(`reconciles a starter ${name} created before a 502 response`, async () => {
    const api = new GitHubFixture();
    const payload = api.add('aks-desktop.exe');
    api.intercept = (url, init) => {
      if (init.method === 'POST' && url.searchParams.get('name') === name) {
        const id = api.add(name, '');
        api.assets.get(id)!.state = 'starter';
        return new Response('Upstream failed after creation', { status: 502 });
      }
      return undefined;
    };
    await rejects(api, /502/);
    assert.equal(api.metadata().length, 0);
    assert.ok(api.assets.has(payload));
    api.intercept = () => undefined;
    await api.run();
    assert.equal(api.metadata().length, 2);
  });
}

test('a mismatching attached copy is removed and never reported as success', async () => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  api.intercept = (url, init) => {
    const asset = api.assets.get(Number(url.pathname.split('/').at(-1)));
    return (init.method ?? 'GET') === 'GET' && asset?.name === 'checksums.txt'
      ? new Response('Wrong bytes') : undefined;
  };
  await rejects(api, /does not match/);
  assert.equal(api.metadata().length, 0);
});

test('reconciliation failure is reported while known uploads are still removed', async t => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  const log = t.mock.method(console, 'error', () => {});
  let failed = false;
  api.intercept = (url, init) => {
    if (init.method === 'POST' && url.searchParams.get('name') === 'checksums.txt.sigstore.json') {
      failed = true;
      api.add('checksums.txt.sigstore.json', '');
      return new Response('Upload failed', { status: 502 });
    }
    if (failed && url.searchParams.has('page')) return new Response('Listing failed', { status: 503 });
    return undefined;
  };
  await assert.rejects(api.run(), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(String(error.errors[0]), /502/);
    assert.match(String(error.errors[1]), /503/);
    return true;
  });
  assert.deepEqual(api.metadata().map(asset => asset.name), ['checksums.txt.sigstore.json']);
  assert.equal(log.mock.callCount(), 1);
});

test('starter deletion failure is reported and does not prevent other cleanup', async t => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  const log = t.mock.method(console, 'error', () => {});
  let starterId = 0;
  api.intercept = (url, init) => {
    if (init.method === 'POST' && url.searchParams.get('name') === 'checksums.txt.sigstore.json') {
      starterId = api.add('checksums.txt.sigstore.json', '');
      api.assets.get(starterId)!.state = 'starter';
      return new Response('Upload failed', { status: 502 });
    }
    if (init.method === 'DELETE' && url.pathname.endsWith(`/assets/${starterId}`)) {
      return new Response('Deletion failed', { status: 500 });
    }
    return undefined;
  };
  await assert.rejects(api.run(), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(String(error.errors[1]), /500/);
    return true;
  });
  assert.deepEqual(api.metadata().map(asset => asset.id), [starterId]);
  assert.equal(log.mock.callCount(), 1);
});

test('cleanup does not remove original metadata or names whose upload was not attempted', async () => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  const previous = api.add('checksums.txt.sigstore.json');
  let unrelated = 0;
  api.intercept = (url, init) => {
    if (init.method === 'DELETE' && url.pathname.endsWith(`/assets/${previous}`)) {
      return new Response(null, { status: 204 });
    }
    if (init.method === 'POST') {
      unrelated = api.add('unrelated.txt', 'concurrent upload');
      api.add('checksums.txt', '');
      return new Response('Upload failed', { status: 502 });
    }
    return undefined;
  };
  await rejects(api, /502/);
  assert.ok(api.assets.has(previous));
  assert.ok(api.assets.has(unrelated));
  assert.deepEqual(api.metadata().map(asset => asset.id), [previous]);
});

test('payload edits during publication invalidate and remove the new signing metadata', async () => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  api.intercept = (url, init) => {
    if (init.method === 'POST' && url.searchParams.get('name') === 'checksums.txt.sigstore.json') {
      api.add('aks-desktop-added.deb');
    }
    return undefined;
  };
  await rejects(api, /Release changed during publication/);
  assert.equal(api.metadata().length, 0);
});

test('cleanup failures are reported alongside the original upload error', async t => {
  const api = new GitHubFixture();
  api.add('aks-desktop.exe');
  const log = t.mock.method(console, 'error', () => {});
  api.intercept = (url, init) => {
    if (init.method === 'DELETE' || (init.method === 'POST' && url.searchParams.get('name') === 'checksums.txt.sigstore.json')) {
      return new Response('Failed', { status: 500 });
    }
    return undefined;
  };
  await assert.rejects(api.run(), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    return true;
  });
  assert.equal(log.mock.callCount(), 1);
});

test('CLI reports invalid configuration with a failing exit status', () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./sign-release.ts', import.meta.url))], {
    env: { ...process.env, GITHUB_TOKEN: '', ALLOW_PUBLISHED: 'false' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Provide/);
});

test('workflow restricts signing to main and serializes the complete signing job', () => {
  const workflow = readFileSync(new URL('../.github/workflows/sign-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if: github\.ref != 'refs\/heads\/main'/);
  assert.match(workflow, /group: release-signing-\$\{\{ inputs\.release_tag \}\}\n\s+cancel-in-progress: false/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /ALLOW_PUBLISHED: \$\{\{ inputs\.allow_published \}\}/);
});
