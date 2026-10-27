// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { request } from 'node:https';
import { parse } from 'yaml';
import { azRequest } from '../azure/az-http';
import type { AzureLiveResourceGroup } from './azureLiveTestUtils';

/** Minimal live Kubernetes response used to prove namespace retention/deletion. */
interface TestNamespace {
  /** Namespace identity and labels, if returned by the apiserver. */
  metadata?: {
    /** Kubernetes namespace name. */
    name?: string;
    /** Namespace labels, including any ARM/project ownership markers. */
    labels?: Record<string, string>;
  };
}

/**
 * Acquires ephemeral admin certificates for direct, CA-verified Kubernetes REST reads.
 * @param run - Disposable managed AKS run context with its created cluster name.
 * @returns A reader taking a namespace name and resolving metadata on HTTP 200 or
 * undefined on 404. Each read rejects other statuses, malformed JSON or a 30-second
 * timeout. Credentials stay in memory; no kubeconfig/private key is written to disk.
 * @throws If ARM denies admin credentials or returns incomplete/malformed kubeconfig.
 */
export async function getLiveNamespaceReader(
  run: AzureLiveResourceGroup & { clusterName: string }
) {
  const credentials = await azRequest<{ kubeconfigs?: Array<{ value?: string }> }>({
    ...run,
    url: `${run.resourceGroupId}/providers/Microsoft.ContainerService/managedClusters/${run.clusterName}/listClusterAdminCredential`,
    method: 'POST',
    apiVersion: '2026-01-01',
  });
  const value = credentials?.kubeconfigs?.[0]?.value;
  if (!value) throw new Error('ARM returned no test cluster admin kubeconfig');
  let config: {
    clusters?: Array<{ cluster?: { server?: string; 'certificate-authority-data'?: string } }>;
    users?: Array<{ user?: { 'client-certificate-data'?: string; 'client-key-data'?: string } }>;
  };
  try {
    config = parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    throw new Error('ARM returned an invalid test kubeconfig');
  }
  const cluster = config.clusters?.[0]?.cluster;
  const user = config.users?.[0]?.user;
  if (
    !cluster?.server?.startsWith('https:') ||
    !cluster['certificate-authority-data'] ||
    !user?.['client-certificate-data'] ||
    !user['client-key-data']
  ) {
    throw new Error('Test kubeconfig is missing its HTTPS endpoint or certificates');
  }
  const tls = {
    ca: Buffer.from(cluster['certificate-authority-data'], 'base64'),
    cert: Buffer.from(user['client-certificate-data'], 'base64'),
    key: Buffer.from(user['client-key-data'], 'base64'),
    rejectUnauthorized: true,
    agent: false as const,
  };
  const server = cluster.server;
  return (namespace: string) =>
    new Promise<TestNamespace | undefined>((resolve, reject) => {
      const req = request(
        new URL(`/api/v1/namespaces/${encodeURIComponent(namespace)}`, server),
        tls,
        res => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (data: string) => {
            body += data;
          });
          res.on('error', reject);
          res.on('end', () => {
            if (res.statusCode === 404) return resolve(undefined);
            if (res.statusCode !== 200)
              return reject(new Error(`Kubernetes test read failed: HTTP ${res.statusCode}`));
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error('Invalid Kubernetes namespace response'));
            }
          });
        }
      );
      const timer = setTimeout(
        () => req.destroy(new Error('Kubernetes test read timed out')),
        30_000
      );
      req.on('close', () => clearTimeout(timer));
      req.on('error', reject);
      req.end();
    });
}
