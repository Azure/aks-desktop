// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const manifestName = 'checksums.txt';
const signatureName = 'checksums.txt.sigstore.json';
const metadataNames = new Set([manifestName, signatureName]);
const safeName = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

type Release = { id: number; tag: string; draft: boolean };
type Asset = {
  id: number;
  name: string;
  size: number;
  state: string;
  updated_at: string;
  digest: string | null;
};

export type SigningOptions = {
  repository: string;
  tag: string;
  token: string;
  allowPublished: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRelease(value: unknown): Release {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || typeof value.id !== 'number'
    || value.id <= 0 || typeof value.tag_name !== 'string' || typeof value.draft !== 'boolean') {
    throw new Error('Invalid release response from GitHub');
  }
  return { id: value.id, tag: value.tag_name, draft: value.draft };
}

function parseAsset(value: unknown): Asset {
  if (!isRecord(value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id)
    || value.id <= 0 || typeof value.name !== 'string' || !safeName.test(value.name)
    || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 0
    || typeof value.state !== 'string' || typeof value.updated_at !== 'string'
    || (value.digest !== null && typeof value.digest !== 'string')) {
    throw new Error('Invalid or unsafe release asset response from GitHub');
  }
  return {
    id: value.id, name: value.name, size: value.size, state: value.state,
    updated_at: value.updated_at, digest: value.digest,
  };
}

function snapshot(assets: Asset[]): string {
  return JSON.stringify([...assets].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function runCosign(args: string[]): void {
  execFileSync('cosign', args, { stdio: 'inherit' });
}

export async function signRelease(
  options: SigningOptions,
  fetcher: typeof fetch = fetch,
  cosign: (args: string[]) => void = runCosign,
): Promise<void> {
  const { repository, tag, token, allowPublished } = options;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !safeName.test(tag) || !token) {
    throw new Error('Provide GITHUB_REPOSITORY, a safe RELEASE_TAG, and GITHUB_TOKEN');
  }
  const api = `https://api.github.com/repos/${repository}`;
  const identity = `https://github.com/${repository}/.github/workflows/sign-release.yml@refs/heads/main`;
  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(300_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub ${init.method ?? 'GET'} ${url}: ${response.status} ${(await response.text()).slice(0, 1000)}`);
    }
    return response;
  };
  const findRelease = async (): Promise<Release> => {
    let match: Release | undefined;
    for (let page = 1; ; page++) {
      const data: unknown = await (await request(`${api}/releases?per_page=100&page=${page}`)).json();
      if (!Array.isArray(data)) throw new Error('Invalid release list from GitHub');
      for (const candidate of data.map(parseRelease)) {
        if (candidate.tag !== tag) continue;
        if (match) throw new Error(`Multiple releases match ${tag}; resolve the ambiguity before signing`);
        match = candidate;
      }
      if (data.length < 100) break;
    }
    if (!match) throw new Error(`Release ${tag} not found`);
    return match;
  };
  const release = await findRelease();
  const getRelease = async (): Promise<Release> =>
    parseRelease(await (await request(`${api}/releases/${release.id}`)).json());
  if (release.tag !== tag || (!release.draft && !allowPublished)) {
    throw new Error('Release tag does not match, or the release is published. Published releases require explicit opt-in.');
  }
  const listAssets = async (): Promise<Asset[]> => {
    const assets: Asset[] = [];
    for (let page = 1; ; page++) {
      const data: unknown = await (await request(`${api}/releases/${release.id}/assets?per_page=100&page=${page}`)).json();
      if (!Array.isArray(data)) throw new Error('Invalid asset list from GitHub');
      assets.push(...data.map(parseAsset));
      if (data.length < 100) break;
    }
    if (new Set(assets.map(asset => asset.name)).size !== assets.length) {
      throw new Error('Duplicate release asset names; rerun after release edits have finished');
    }
    return assets;
  };
  const assets = await listAssets();
  const payloads = assets.filter(asset => !metadataNames.has(asset.name));
  if (payloads.length === 0 || payloads.some(asset => asset.state !== 'uploaded' || asset.size === 0)) {
    throw new Error('Release must contain nonempty, fully uploaded payloads');
  }

  const checksums = new Map<string, string>();
  for (const asset of payloads) {
    const response = await request(`${api}/releases/assets/${asset.id}`, {
      headers: { Accept: 'application/octet-stream' },
    });
    if (!response.body) throw new Error(`No download body for ${asset.name}`);
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        size += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    const digest = hash.digest('hex');
    if (size !== asset.size || (asset.digest !== null && asset.digest !== `sha256:${digest}`)) {
      throw new Error(`Downloaded bytes do not match GitHub's size/digest for ${asset.name}`);
    }
    checksums.set(asset.name, digest);
  }
  const manifest = [...checksums.keys()].sort().map(name => `${checksums.get(name)}  ${name}\n`).join('');
  const directory = await mkdtemp(join(tmpdir(), 'aks-release-signing-'));
  const uploaded: Asset[] = [];
  const attemptedNames = new Set<string>();
  try {
    const manifestPath = join(directory, manifestName);
    const signaturePath = join(directory, signatureName);
    await writeFile(manifestPath, manifest);
    cosign(['sign-blob', '--yes', '--bundle', signaturePath, manifestPath]);
    cosign([
      'verify-blob', manifestPath, '--bundle', signaturePath,
      '--certificate-identity', identity,
      '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
    ]);
    const signature = await readFile(signaturePath);
    const current = await getRelease();
    if (JSON.stringify(current) !== JSON.stringify(release) || snapshot(await listAssets()) !== snapshot(assets)) {
      throw new Error('Release changed while checksums were being signed; nothing was uploaded');
    }

    // Remove the old signature first so a partially updated manifest is not advertised as signed.
    for (const name of [signatureName, manifestName]) {
      const previous = assets.find(asset => asset.name === name);
      if (previous) await request(`${api}/releases/assets/${previous.id}`, { method: 'DELETE' });
    }
    for (const [name, contents] of [
      [manifestName, Buffer.from(manifest)],
      [signatureName, signature],
    ] as const) {
      attemptedNames.add(name);
      const response = await request(
        `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: contents },
      );
      const asset = parseAsset(await response.json());
      uploaded.push(asset);
      if (asset.name !== name || asset.state !== 'uploaded' || asset.size !== contents.length) {
        throw new Error(`Unexpected uploaded asset response for ${name}`);
      }
      const attached = Buffer.from(await (await request(`${api}/releases/assets/${asset.id}`, {
        headers: { Accept: 'application/octet-stream' },
      })).arrayBuffer());
      if (!attached.equals(contents)) throw new Error(`Attached ${name} does not match the verified local file`);
    }
    const finalRelease = await getRelease();
    const finalAssets = await listAssets();
    if (JSON.stringify(finalRelease) !== JSON.stringify(release)
      || snapshot(finalAssets.filter(asset => !metadataNames.has(asset.name))) !== snapshot(payloads)
      || uploaded.some(asset => !finalAssets.some(currentAsset => currentAsset.id === asset.id && currentAsset.name === asset.name))) {
      throw new Error('Release changed during publication');
    }
    console.log(`Verified ${payloads.length} payloads and attached signed checksums to ${repository} ${tag}. Release publication status is unchanged.`);
  } catch (error) {
    const errors: unknown[] = [error];
    const cleanup = new Map(uploaded.map(asset => [asset.id, asset]));
    if (attemptedNames.size > 0) {
      // Failed POSTs can create assets without returning their IDs, including empty starter assets.
      try {
        const previousIds = new Set(assets.map(asset => asset.id));
        for (const asset of await listAssets()) {
          if (attemptedNames.has(asset.name) && !previousIds.has(asset.id)) {
            cleanup.set(asset.id, asset);
          }
        }
      } catch (reconcileError) {
        console.error('Could not reconcile failed signing uploads against release assets:', reconcileError);
        errors.push(reconcileError);
      }
    }
    for (const asset of [...cleanup.values()].reverse()) {
      try {
        await request(`${api}/releases/assets/${asset.id}`, { method: 'DELETE' });
      } catch (cleanupError) {
        console.error(`Could not remove incomplete signing metadata ${asset.name}:`, cleanupError);
        errors.push(cleanupError);
      }
    }
    throw new AggregateError(errors, 'Release signing failed; uploaded signing metadata was removed where possible');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.ALLOW_PUBLISHED !== 'true' && process.env.ALLOW_PUBLISHED !== 'false') {
      throw new Error('ALLOW_PUBLISHED must be true or false');
    }
    await signRelease({
      repository: process.env.GITHUB_REPOSITORY ?? '',
      tag: process.env.RELEASE_TAG ?? '',
      token: process.env.GITHUB_TOKEN ?? '',
      allowPublished: process.env.ALLOW_PUBLISHED === 'true',
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
