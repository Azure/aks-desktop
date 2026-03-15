// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { _testing } from './agent/aksAgentManager';
import ContentRenderer from './ContentRenderer';

const { extractAIAnswer } = _testing;

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    sidebar: { selectedBackground: '#555555' },
  },
});

const meta: Meta<typeof ContentRenderer> = {
  title: 'AIAssistant/ContentRenderer',
  component: ContentRenderer,
  decorators: [
    (Story: any) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};
export default meta;

// ── Light theme stories ──────────────────────────────────────────────────────

/** Simple markdown text with headings and paragraphs. */
export const MarkdownText: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`# Cluster Overview

Your AKS cluster is running **3 nodes** in the \`eastus\` region.

## Node Pools

The default node pool uses \`Standard_DS2_v2\` instances.

### Recommendations

- Consider enabling autoscaling for cost optimization
- Review your pod disruption budgets
- Check resource quotas in each namespace`}
  />
);

/** Code blocks in both inline and block styles. */
export const CodeBlocks: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`To check your cluster status, run \`kubectl get nodes\` in your terminal.

Here's a more detailed command:

\`\`\`bash
kubectl get pods --all-namespaces -o wide
\`\`\`

You can also check the cluster info:

\`\`\`
kubectl cluster-info
Kubernetes control plane is running at https://myaks-dns-12345678.hcp.eastus.azmk8s.io:443
CoreDNS is running at https://myaks-dns-12345678.hcp.eastus.azmk8s.io:443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy
\`\`\``}
  />
);

/** Table content with GFM tables. */
export const TableContent: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`## Pod Status

| Pod Name | Status | Restarts | Age |
|----------|--------|----------|-----|
| api-server-7d8f9 | Running | 0 | 2d |
| worker-abc12 | Running | 1 | 5d |
| frontend-xyz98 | CrashLoopBackOff | 15 | 1d |
| db-migration-job | Completed | 0 | 3h |
| monitoring-agent | Running | 0 | 7d |
| cache-redis-0 | Running | 2 | 4d |
| ingress-nginx-abc | Running | 0 | 10d |`}
  />
);

/** Blockquote and mixed content. */
export const BlockquoteContent: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`## Important Notes

> **Warning**: The cluster is running low on memory. Consider scaling up your node pool or optimizing resource requests.

Here are the current resource limits:

> CPU: 85% utilized
> Memory: 92% utilized
> Storage: 45% utilized

These values exceed the recommended threshold of 80%.`}
  />
);

/** Error JSON response. */
export const ErrorResponse: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={JSON.stringify({
      error: true,
      content:
        'Failed to connect to the Kubernetes API server. Please check your credentials and network connectivity.',
    })}
  />
);

/** Success JSON response. */
export const SuccessResponse: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={JSON.stringify({
      success: true,
      content: 'Successfully scaled deployment api-server to 5 replicas.',
    })}
  />
);

/** Links to Kubernetes resources. */
export const LinksContent: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`Check out the [Kubernetes documentation](https://kubernetes.io/docs/) for more details.

You can also review your [AKS best practices](https://learn.microsoft.com/en-us/azure/aks/best-practices) guide.`}
  />
);

/** Mixed content with multiple element types. */
export const MixedContent: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`# Troubleshooting Guide

Your pod \`frontend-xyz98\` is in a **CrashLoopBackOff** state. Here's what to check:

## Step 1: Check Logs

\`\`\`bash
kubectl logs frontend-xyz98 --previous
\`\`\`

## Step 2: Describe the Pod

| Field | Value |
|-------|-------|
| Status | CrashLoopBackOff |
| Restarts | 15 |
| Last Exit Code | 137 (OOMKilled) |

> **Note**: Exit code 137 typically indicates the container was killed due to exceeding its memory limit.

## Step 3: Increase Memory

Update the resource limits in your deployment:

1. Edit the deployment YAML
2. Increase \`resources.limits.memory\`
3. Apply the changes with \`kubectl apply\``}
  />
);

// ── Dark theme stories ───────────────────────────────────────────────────────

/** Code blocks rendered in dark theme - verifies contrast. */
export const CodeBlocksDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={`To check your cluster status, run \`kubectl get nodes\` in your terminal.

Here's a more detailed command:

\`\`\`bash
kubectl get pods --all-namespaces -o wide
\`\`\`

You can also check the cluster info:

\`\`\`
kubectl cluster-info
Kubernetes control plane is running at https://myaks-dns-12345678.hcp.eastus.azmk8s.io:443
CoreDNS is running at https://myaks-dns-12345678.hcp.eastus.azmk8s.io:443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy
\`\`\``}
    />
  </ThemeProvider>
);

/** Mixed content rendered in dark theme - verifies contrast across all element types. */
export const MixedContentDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={`# Dark Theme Contrast Check

Your pod \`frontend-xyz98\` is in a **CrashLoopBackOff** state.

## Table

| Pod Name | Status | Restarts |
|----------|--------|----------|
| api-server-7d8f9 | Running | 0 |
| frontend-xyz98 | CrashLoopBackOff | 15 |

> **Note**: Exit code 137 typically indicates OOMKilled.

\`\`\`bash
kubectl logs frontend-xyz98 --previous
\`\`\`

Check the [docs](https://kubernetes.io/docs/) for more.`}
    />
  </ThemeProvider>
);

/** Error and success alerts in dark theme. */
export const AlertsDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <div>
      <ContentRenderer
        onYamlDetected={noopYamlDetected}
        content={JSON.stringify({
          error: true,
          content: 'Failed to connect to the Kubernetes API server.',
        })}
      />
      <br />
      <ContentRenderer
        onYamlDetected={noopYamlDetected}
        content={JSON.stringify({ success: true, content: 'Successfully scaled deployment.' })}
      />
    </div>
  </ThemeProvider>
);

// ── Edge cases ───────────────────────────────────────────────────────────────

/** Empty string content - should not crash. */
export const EmptyContent: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer onYamlDetected={noopYamlDetected} content="" />
);

/** Plain text with no markdown formatting. */
export const PlainText: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content="This is just plain text with no formatting at all. No bold, no code, no links."
  />
);

/** Content with only inline code - many backtick segments. */
export const InlineCodeOnly: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content="Run `kubectl get pods`, then `kubectl describe pod my-pod`, check `kubectl logs my-pod -f`, and use `kubectl exec -it my-pod -- /bin/bash` to debug."
  />
);

/** Inline code in dark theme - verify inline backtick contrast. */
export const InlineCodeOnlyDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content="Run `kubectl get pods`, then `kubectl describe pod my-pod`, check `kubectl logs my-pod -f`, and use `kubectl exec -it my-pod -- /bin/bash` to debug."
    />
  </ThemeProvider>
);

/** YAML code block (Kubernetes resource). */
export const YamlCodeBlock: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`Here's a sample deployment:

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.21
        ports:
        - containerPort: 80
\`\`\``}
  />
);

/** YAML code block in dark theme. */
export const YamlCodeBlockDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={`Here's a sample deployment:

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.21
        ports:
        - containerPort: 80
\`\`\``}
    />
  </ThemeProvider>
);

/** Deeply nested markdown - headings, lists, bold, inline code together. */
export const DeeplyNestedContent: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`# Level 1

## Level 2

### Level 3

- Item with **bold** and \`inline code\`
  - Nested item with [a link](https://example.com)
    - Deeply nested with \`more code\`

1. First **ordered** item
2. Second item with \`kubectl get ns\`
3. Third item

> A blockquote with **bold text** and \`code\` inside.
>
> > Nested blockquote for emphasis.`}
  />
);

/** Very long unbroken strings and URLs. */
export const LongUnbrokenStrings: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`The error log contains the following message:

\`\`\`
E0312 21:02:19.886Z controller/manager.go:123 ReconciliationError: unable to reconcile resource aksmanagedcluster/myverylongclustername-in-eastus2-production-environment with the expected state, timeout exceeded after 300 seconds of continuous polling
\`\`\`

Check https://learn.microsoft.com/en-us/azure/aks/troubleshooting-common-issues-with-very-long-urls-that-might-break-layouts for more details.`}
  />
);

/** Multiple sequential code blocks of different languages. */
export const MultipleCodeBlocks: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`First, check with bash:

\`\`\`bash
kubectl get pods -n production
\`\`\`

Then look at the JSON output:

\`\`\`json
{
  "apiVersion": "v1",
  "kind": "Pod",
  "metadata": {
    "name": "api-server-7d8f9",
    "namespace": "production"
  },
  "status": {
    "phase": "Running"
  }
}
\`\`\`

And the YAML manifest:

\`\`\`yaml
apiVersion: v1
kind: Service
metadata:
  name: api-server
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 8080
\`\`\``}
  />
);

/** Multiple code blocks in dark theme. */
export const MultipleCodeBlocksDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={`Check with bash:

\`\`\`bash
kubectl get pods -n production
\`\`\`

JSON output:

\`\`\`json
{
  "apiVersion": "v1",
  "kind": "Pod",
  "status": { "phase": "Running" }
}
\`\`\`

YAML manifest:

\`\`\`yaml
apiVersion: v1
kind: Service
metadata:
  name: api-server
\`\`\``}
    />
  </ThemeProvider>
);

/** YAML code blocks rendered as interactive Monaco editors via YamlDisplay.
 *  Passing onYamlDetected enables the editor rendering path. */
// eslint-disable-next-line no-unused-vars
const noopYamlDetected = (_yaml: string, _resourceType: string) => {};

export const YamlEditorDisplay: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={`Here is a Deployment manifest:

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
    spec:
      containers:
        - name: api-server
          image: myregistry/api-server:latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
\`\`\`

And the corresponding Service:

\`\`\`yaml
apiVersion: v1
kind: Service
metadata:
  name: api-server
  namespace: production
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: api-server
\`\`\``}
  />
);

// ── Real-world agent response stories (raw exec output → extractAIAnswer → render) ──
// These stories feed raw terminal output (matching real dev console captures) through
// the extractAIAnswer parsing pipeline, then render the result. All identifiers are
// redacted to generic values.

const rawPodStatus = [
  '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
  "python /app/aks-agent.py ask 'what pods are running?'",
  '\x1b[?2004l',
  "Loaded models: ['gpt-4']",
  'Task List:',
  '+------+------------------+---------+',
  '| ID   | Description      | Status  |',
  '+------+------------------+---------+',
  '| t1   | Check pods       | [~] in_progress |',
  '+------+------------------+---------+',
  'AI: Here are the running pods in the `kube-system` namespace:',
  '',
  '| Pod Name | Status | Restarts |',
  '|----------|--------|----------|',
  '| coredns-7c6bf4f | Running | 0 |',
  '| kube-proxy-abc12 | Running | 0 |',
  '| metrics-server-xyz | Running | 2 |',
  '',
  'All pods are healthy.',
  'root@aks-agent-abc1234def-x9y8z:/app#',
].join('\n');

/** Raw exec output → parsed: pod status table with markdown formatting. */
export const RealWorldPodStatus: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer onYamlDetected={noopYamlDetected} content={extractAIAnswer(rawPodStatus)} />
);

const rawCrashDiagnosis = [
  '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
  "python /app/aks-agent.py ask 'why is my pod crashing?'",
  '\x1b[?2004l',
  "Loaded models: ['gpt-4']",
  '+------+-------------------+-------------------+',
  '| t1   | Check pod status  | [✓] completed     |',
  '| t2   | Get pod logs      | [✓] completed     |',
  '+------+-------------------+-------------------+',
  'AI: Your pod `web-app-6f8b9c4d7-x2k9p` is in a **CrashLoopBackOff** state. Here is what I found:',
  '',
  '## Root Cause',
  '',
  'The container is failing because it cannot connect to the database. The logs show:',
  '',
  '```',
  'Error: connect ECONNREFUSED 10.0.0.5:5432',
  '    at TCPConnectWrap.afterConnect [as oncomplete]',
  '```',
  '',
  '## Recommended Steps',
  '',
  '1. Check if the database pod is running: `kubectl get pods -l app=postgres`',
  '2. Verify the service endpoint: `kubectl get endpoints postgres-svc`',
  '3. Check network policies that might block traffic between namespaces',
  '',
  '> **Note**: The pod has restarted 15 times in the last hour.',
  'root@aks-agent-abc1234def-x9y8z:/app#',
].join('\n');

/** Raw exec output → parsed: diagnostic info with headings, code blocks, lists. */
export const RealWorldCrashDiagnosis: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer onYamlDetected={noopYamlDetected} content={extractAIAnswer(rawCrashDiagnosis)} />
);

/** Same crash diagnosis in dark theme. */
export const RealWorldCrashDiagnosisDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={extractAIAnswer(rawCrashDiagnosis)}
    />
  </ThemeProvider>
);

const rawBestPractices = [
  '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
  "python /app/aks-agent.py ask 'IMPORTANT INSTRUCTIONS:",
  '\x1b[?2004l',
  '\x1b[?2004h>',
  '- When returning any YAML content, always wrap it inside a markdown code block using ```yaml ... ``` so it renders properly.',
  '\x1b[?2004l',
  '\x1b[?2004h>',
  '- The conversation history below shows all previously asked questions and your answers.',
  '\x1b[?2004l',
  '\x1b[?2004h>',
  'Now answer the following new question:',
  '\x1b[?2004l',
  '\x1b[?2004h>',
  "what best practices should I follow for AKS?'",
  '\x1b[?2004l',
  "Loaded models: ['gpt-4']",
  'AI: Here are the key best practices for AKS:',
  '',
  '- **Use managed identities** instead of service principals for authentication',
  '- **Enable Azure Policy** to enforce organizational standards',
  '- **Configure autoscaling** for both cluster and pods:',
  '  - Cluster Autoscaler for node pools',
  '  - Horizontal Pod Autoscaler (HPA) for workloads',
  '- **Use Azure CNI** networking for better integration with VNets',
  '- **Enable monitoring** with Container Insights and Prometheus',
  '- **Implement network policies** to control pod-to-pod traffic',
  '- **Use node pools** to separate system and user workloads',
  '',
  'For more details, see the [AKS best practices documentation](https://learn.microsoft.com/en-us/azure/aks/best-practices).',
  'root@aks-agent-abc1234def-x9y8z:/app#',
].join('\n');

/** Raw exec output → parsed: bullet list with conversation history echo stripped. */
export const RealWorldBestPractices: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer onYamlDetected={noopYamlDetected} content={extractAIAnswer(rawBestPractices)} />
);

const rawMultiResource = [
  '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
  "python /app/aks-agent.py ask 'create a complete app with deployment and service'",
  '\x1b[?2004l',
  "Loaded models: ['gpt-4']",
  '| t1 | Create resources | [✓] completed |',
  'AI: Here is a complete application setup with a Deployment and Service:',
  '',
  '### Deployment',
  '',
  '```yaml',
  'apiVersion: apps/v1',
  'kind: Deployment',
  'metadata:',
  '  name: web-app',
  '  labels:',
  '    app: web-app',
  'spec:',
  '  replicas: 2',
  '  selector:',
  '    matchLabels:',
  '      app: web-app',
  '  template:',
  '    metadata:',
  '      labels:',
  '        app: web-app',
  '    spec:',
  '      containers:',
  '      - name: web',
  '        image: myregistry.azurecr.io/web-app:latest',
  '        ports:',
  '        - containerPort: 3000',
  '        resources:',
  '          requests:',
  '            cpu: 100m',
  '            memory: 128Mi',
  '          limits:',
  '            cpu: 250m',
  '            memory: 256Mi',
  '```',
  '',
  '### Service',
  '',
  '```yaml',
  'apiVersion: v1',
  'kind: Service',
  'metadata:',
  '  name: web-app-svc',
  'spec:',
  '  type: LoadBalancer',
  '  selector:',
  '    app: web-app',
  '  ports:',
  '  - port: 80',
  '    targetPort: 3000',
  '```',
  '',
  'Apply both with: `kubectl apply -f app.yaml`',
  'root@aks-agent-abc1234def-x9y8z:/app#',
].join('\n');

/** Raw exec output → parsed: multiple YAML resources with headings. */
export const RealWorldMultiResource: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer onYamlDetected={noopYamlDetected} content={extractAIAnswer(rawMultiResource)} />
);

/** Same multi-resource in dark theme. */
export const RealWorldMultiResourceDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={extractAIAnswer(rawMultiResource)}
    />
  </ThemeProvider>
);

const rawBareYamlService = [
  '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
  "python /app/aks-agent.py ask 'create a service'",
  '\x1b[?2004l',
  "\x1b[1mLoaded models:\x1b[0m [\x1b[32m'gpt-4'\x1b[0m]",
  '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
  '┃ Task List                       ┃',
  '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
  '| t1 | Create service | [✓] completed |',
  '\x1b[1mAI:\x1b[0m Here is a Service:',
  '',
  'apiVersion: v1',
  'kind: Service',
  'metadata:',
  '  name: my-service',
  '  namespace: default',
  'spec:',
  '  type: LoadBalancer',
  '  selector:',
  '    app: nginx',
  '  ports:',
  '  - protocol: TCP',
  '    port: 80',
  '    targetPort: 8080',
  '',
  'This Service exposes your application on port 80.',
  'root@aks-agent-abc1234def-x9y8z:/app#',
].join('\n');

/** Raw exec output → parsed: bare YAML (no code fences) auto-wrapped by parser. */
export const RealWorldBareYamlService: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={extractAIAnswer(rawBareYamlService)}
  />
);

const rawPythonDeploymentAdvice = [
  'stty -echo',
  '\x1b[?2004l',
  '\x1b[?2004hroot@aks-agent-redacted:/app# ',
  '\x1b[?2004l',
  '',
  '\x1b[?2004h',
  '> ',
  '\x1b[?2004l',
  '',
  '\x1b[?2004h> ',
  '\x1b[?2004l',
  '',
  "Loaded models: ['azure/gpt-5.x']",
  '✅ Toolset core_investigation',
  '✅ Toolset internet',
  'Received session ID: mcp-session-REDACTED',
  'Negotiated protocol version: 2025-06-18',
  '✅ Toolset aks_mcp',
  'Using 3 datasources (toolsets). To refresh: use flag `--refresh-toolsets`',
  'NO ENABLED LOGGING TOOLSET',
  'Using model: azure/gpt-5.x (272,000 total tokens, 54,400 output tokens)',
  'This tool uses AI to generate responses and may not always be accurate.',
  'User: IMPORTANT INSTRUCTIONS:',
  '- When returning any YAML content, always wrap it inside a markdown code block',
  'using ```yaml ... ``` so it renders properly.',
  '- The conversation history below shows all previously asked questions and your',
  'answers. Keep that context in mind and answer accordingly — do not repeat',
  'information already provided unless the user explicitly asks for it.',
  'Now answer the following new question:',
  'How do I deploy a python application?',
  'The AI requested 1 tool call(s).',
  'Running tool #1 TodoWrite: Update investigation tasks',
  'Task List:',
  '+----+--------------------------------------+-----------------+',
  '| ID | Content                              | Status          |',
  '+----+--------------------------------------+-----------------+',
  '| 1  | Clarify deployment target           | [~] in_progress |',
  '| 2  | Provide deployment examples         | [ ] pending     |',
  '| 3  | Include runtime best practices      | [ ] pending     |',
  '| 4  | Final review                        | [ ] pending     |',
  '+----+--------------------------------------+-----------------+',
  'Finished #1 in 0.00s, output length: 787 characters (12 lines) - /show 1 to',
  'view contents',
  '',
  '\x1b[1;96mAI:\x1b[0m ',
  'Which deployment target do you mean?',
  '',
  '\x1b[1;33m 1 \x1b[0m\x1b[1mKubernetes (AKS)\x1b[0m (Deployment/Service/Ingress YAML)',
  '\x1b[1;33m 2 \x1b[0m\x1b[1mContainer on a VM\x1b[0m (Dockerfile + \x1b[1;36;40mdocker run\x1b[0m or compose)',
  '\x1b[1;33m 3 \x1b[0m\x1b[1mPaaS\x1b[0m (Azure App Service / Container Apps / Cloud Run / Heroku-like)',
  '\x1b[1;33m 4 \x1b[0m\x1b[1mBare VM\x1b[0m (systemd + nginx + venv)',
  '',
  'Reply with: \x1b[1mtarget + framework\x1b[0m (e.g., “AKS + FastAPI” or “Docker VM + Flask”)',
  'and \x1b[1mhow it should be exposed\x1b[0m (public HTTP, internal-only, background',
  'worker/cron).',
  '',
  'While you answer, here’s a solid default pattern that works almost everywhere:',
  '',
  '                 \x1b[1;4mPython web app deployment checklist (generic)\x1b[0m',
  '',
  '\x1b[1;33m • \x1b[0mCreate \x1b[1;36;40mrequirements.txt\x1b[0m (or \x1b[1;36;40mpyproject.toml\x1b[0m)',
  '\x1b[1;33m • \x1b[0mAdd a production server:',
  '\x1b[1;33m   \x1b[0m\x1b[1;33m • \x1b[0m\x1b[1mFlask/Django (WSGI):\x1b[0m \x1b[1;36;40mgunicorn\x1b[0m',
  '\x1b[1;33m   \x1b[0m\x1b[1;33m • \x1b[0m\x1b[1mFastAPI/Starlette (ASGI):\x1b[0m \x1b[1;36;40muvicorn\x1b[0m (often behind gunicorn worker)',
  '\x1b[1;33m • \x1b[0mRead config from \x1b[1menv vars\x1b[0m (no secrets in code)',
  '\x1b[1;33m • \x1b[0mAdd \x1b[1;36;40m/healthz\x1b[0m endpoint for health checks',
  '\x1b[1;33m • \x1b[0mPin Python version (e.g., \x1b[1;36;40mpython:3.12-slim\x1b[0m)',
  '',
  '          \x1b[1;4mExample: containerize (works for AKS, any container runtime)\x1b[0m',
  '',
  '\x1b[1mDockerfile (FastAPI example)\x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[96;40mFROM\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40mpython:3.12-slim\x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mWORKDIR\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m/app\x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mCOPY\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mrequirements.txt\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mRUN\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mpip install --no-cache-dir -r requirements.txt\x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mCOPY\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mEXPOSE\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m8000\x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mCMD\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m[\x1b[0m\x1b[93;40m"uvicorn"\x1b[0m\x1b[97;40m, "main:app", "--host", "0.0.0.0", "--port", "8000"]\x1b[0m',
  '',
  'Build + run:',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mdocker build -t myapp:latest .\x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40mdocker run --rm -p 8000:8000 myapp:latest\x1b[0m',
  '',
  'I can give you the exact \x1b[1mKubernetes YAML\x1b[0m (Deployment/Service/Ingress) or',
  '\x1b[1msystemd/nginx\x1b[0m setup once you confirm the target.',
  '\x1b[?2004hroot@aks-agent-redacted:/app# ',
].join('\n');

/** Raw exec output → parsed: terminal-formatted guidance normalized into markdown lists and code blocks. */
export const RealWorldPythonDeploymentAdvice: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={extractAIAnswer(rawPythonDeploymentAdvice)}
  />
);

// Real-world Java deployment response with Rich terminal-formatted Dockerfile
// and multi-document YAML code blocks (Namespace + Deployment + Service).
// Each code line has [40m (black bg) ANSI formatting and blank lines between
// every line from terminal chunk boundaries.
const rawJavaDeployTerminal = [
  'stty -echo',
  '\x1b[?2004l',
  '\x1b[?2004hroot@aks-agent-846df6ffb-tz9xn:/app# ',
  '\x1b[?2004l',
  '',
  '\x1b[?2004h',
  '> ',
  '\x1b[?2004l',
  '',
  "Loaded models: \x1b[1m[\x1b[0m\x1b[32m'azure/gpt-5-2'\x1b[0m\x1b[1m]\x1b[0m",
  '\u2705 Toolset core_investigation',
  'Using \x1b[1;36m4\x1b[0m datasources',
  'NO ENABLED LOGGING TOOLSET',
  '\x1b[1;97mUser:\x1b[0m IMPORTANT INSTRUCTIONS:',
  'Now answer: Show me an example java application deploy on kubernetes?',
  'The AI requested \x1b[1;36m1\x1b[0m tool call.',
  'Running tool #1 TodoWrite: Update tasks',
  'Task List:',
  '+----+----------------------------+---------------+',
  '| ID | Content                    | Status        |',
  '+----+----------------------------+---------------+',
  '| t1 | Create K8s YAML            | completed     |',
  '+----+----------------------------+---------------+',
  '  Finished #1 in 0.00s',
  '\x1b[1;96mAI:\x1b[0m ',
  "Here's a minimal, production-ready example for deploying a Java (Spring Boot)   ",
  '',
  "app on Kubernetes. Adjust health probe paths if you don't use Spring Boot       ",
  '',
  'Actuator.                                                                       ',
  '',
  '',
  'Dockerfile (multi-stage build):                                                 ',
  '',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40m# syntax=docker/dockerfile:1\x1b[0m\x1b[40m                                                  \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mFROM maven:3.9-eclipse-temurin-17 AS build\x1b[0m\x1b[40m                                    \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mWORKDIR /src\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mCOPY pom.xml .\x1b[0m\x1b[40m                                                                \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mRUN mvn -B -q -DskipTests dependency:go-offline\x1b[0m\x1b[40m                               \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mCOPY src ./src\x1b[0m\x1b[40m                                                                \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mRUN mvn -B -q -DskipTests package\x1b[0m\x1b[40m                                             \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mFROM eclipse-temurin:17-jre\x1b[0m\x1b[40m                                                   \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mWORKDIR /app\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mCOPY --from=build /src/target/app.jar ./app.jar\x1b[0m\x1b[40m                               \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mEXPOSE 8080\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[97;40mCMD ["bash","-lc","java $JAVA_OPTS -jar app.jar"]\x1b[0m\x1b[40m                              \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  '',
  'Kubernetes manifests (Deployment + Service):                                    ',
  '',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mNamespace                                                               \x1b[0m\x1b[40m \x1b[0m',
  '',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mdemo                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mapps/v1                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mDeployment                                                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mjava-hello                                                            \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mspec\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mreplicas\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m2                                                                 \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mService                                                                 \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mjava-hello                                                            \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mspec\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mtype\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mClusterIP                                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mports\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                      \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m    \x1b[0m\x1b[40m-\x1b[0m\x1b[97;40m \x1b[0m\x1b[91;40mport\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m80                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m      \x1b[0m\x1b[91;40mtargetPort\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m8080                                                        \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  'Build/push and deploy:                                                          ',
  '',
  '\x1b[1;33m \u2022 \x1b[0mBuild: docker build -t ghcr.io/yourorg/java-hello:1.0.0 .                    ',
  '\x1b[1;33m \u2022 \x1b[0mPush: docker login ghcr.io; docker push ghcr.io/yourorg/java-hello:1.0.0     ',
  '\x1b[1;33m \u2022 \x1b[0mApply: kubectl apply -f k8s.yaml                                             ',
  '',
  'Notes:                                                                          ',
  '',
  '\x1b[1;33m \u2022 \x1b[0mFor HPA to work, install metrics-server in the cluster.                      ',
  '',
  '\x1b[?2004hroot@aks-agent-846df6ffb-tz9xn:/app# ',
].join('\r\n');

export const RealWorldJavaDeployTerminal: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={extractAIAnswer(rawJavaDeployTerminal)}
  />
);

export const RealWorldJavaDeployTerminalDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={extractAIAnswer(rawJavaDeployTerminal)}
    />
  </ThemeProvider>
);

// ── Real-world Java deploy with Option A / Option B structure ──

const rawJavaDeployOptionAB = [
  'stty -echo',
  '\x1b[?2004l',
  '\x1b[?2004hroot@aks-agent-649f94dbb9-whtf8:/app# ',
  '\x1b[?2004l',
  '',
  '\x1b[?2004h> ',
  '\x1b[?2004l',
  '',
  "Loaded models: \x1b[1m[\x1b[0m\x1b[32m'azure/gpt-5.2'\x1b[0m\x1b[1m]\x1b[0m",
  '\u2705 Toolset core_investigation',
  '\u2705 Toolset aks_mcp',
  'Using \x1b[1;36m3\x1b[0m datasources',
  'NO ENABLED LOGGING TOOLSET',
  '\x1b[1;97mUser:\x1b[0m IMPORTANT INSTRUCTIONS:',
  'Now answer the following new question:',
  'Show me how to deploy an example java application on kubernetes?',
  'The AI requested \x1b[1;36m1\x1b[0m tool call.',
  'Running tool #\x1b[1;36m1\x1b[0m \x1b[1mTodoWrite\x1b[0m: Update investigation tasks',
  'Task List:',
  '+----+----------+---------------+',
  '| ID | Content  | Status        |',
  '+----+----------+---------------+',
  '| 1  | Deploy   | completed     |',
  '+----+----------+---------------+',
  '  Finished #1 in 0.00s',
  '',
  '\x1b[1;96mAI:\x1b[0m ',
  '     \x1b[1mOption A (fastest): deploy a prebuilt example Java (Spring Boot) image\x1b[0m     ',
  '',
  'Apply this manifest:                                                            ',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mNamespace                                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mjava-demo                                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mapps/v1                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mDeployment                                                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mspring-boot-demo                                                      \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mnamespace\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mjava-demo                                                        \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mspec\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mreplicas\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m2                                                                 \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mselector\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m    \x1b[0m\x1b[91;40mmatchLabels\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m      \x1b[0m\x1b[91;40mapp\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mspring-boot-demo                                                   \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mService                                                                 \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mspring-boot-demo                                                      \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mspec\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mselector\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m    \x1b[0m\x1b[91;40mapp\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mspring-boot-demo                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mports\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                      \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m    \x1b[0m\x1b[40m-\x1b[0m\x1b[97;40m \x1b[0m\x1b[91;40mport\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m80                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m      \x1b[0m\x1b[91;40mtargetPort\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m8080                                                        \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mtype\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mClusterIP                                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  'Run:                                                                            ',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40mkubectl\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapply\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-f\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapp.yaml\x1b[0m\x1b[40m                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40mkubectl\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mget\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mpods\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-n\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mjava-demo\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-w\x1b[0m\x1b[40m                                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40mkubectl\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mport-forward\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-n\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mjava-demo\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40msvc/spring-boot-demo\x1b[0m\x1b[97;40m \x1b[0m\x1b[37;40m8080\x1b[0m\x1b[97;40m:80\x1b[0m\x1b[40m                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# then open http://localhost:8080\x1b[0m\x1b[40m                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  '',
  '\x1b[33m\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\x1b[0m',
  '            \x1b[1mOption B: build your own tiny Java app image + deploy it\x1b[0m            ',
  '',
  '\x1b[1m1) Minimal Spring Boot app + Dockerfile\x1b[0m                                         ',
  '',
  'Use Spring Initializr (Web dependency), then add a controller like:             ',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[92;40m@RestController\x1b[0m\x1b[40m                                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mclass\x1b[0m\x1b[97;40m \x1b[0m\x1b[92;40mHelloController\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m{\x1b[0m\x1b[40m                                                       \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[92;40m@GetMapping\x1b[0m\x1b[97;40m(\x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40m/\x1b[0m\x1b[93;40m"\x1b[0m\x1b[97;40m)\x1b[0m\x1b[40m                                                            \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[97;40mString\x1b[0m\x1b[97;40m \x1b[0m\x1b[92;40mhello\x1b[0m\x1b[97;40m(\x1b[0m\x1b[97;40m)\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m{\x1b[0m\x1b[97;40m \x1b[0m\x1b[96;40mreturn\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40mhello from k8s\x1b[0m\x1b[93;40m"\x1b[0m\x1b[97;40m;\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m}\x1b[0m\x1b[40m                                 \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m}\x1b[0m\x1b[40m                                                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  'Dockerfile (builds and runs jar):                                               ',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mFROM\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40meclipse-temurin:21-jdk\x1b[0m\x1b[97;40m \x1b[0m\x1b[96;40mAS\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40mbuild\x1b[0m\x1b[40m                                          \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mWORKDIR\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m/src\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mCOPY\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m\x1b[40m                                                                      \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mRUN\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m./mvnw\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-q\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-DskipTests\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mpackage\x1b[0m\x1b[40m                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[40m                                                                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mFROM\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40meclipse-temurin:21-jre\x1b[0m\x1b[40m                                                   \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mWORKDIR\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m/app\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mCOPY\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m--from\x1b[0m\x1b[91;40m=\x1b[0m\x1b[97;40mbuild\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m/src/target/*.jar\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m/app/app.jar\x1b[0m\x1b[40m                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mEXPOSE\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m8080\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[96;40mENTRYPOINT\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m[\x1b[0m\x1b[93;40m"java"\x1b[0m\x1b[97;40m,\x1b[0m\x1b[93;40m"-jar"\x1b[0m\x1b[97;40m,\x1b[0m\x1b[93;40m"/app/app.jar"\x1b[0m\x1b[97;40m]\x1b[0m\x1b[40m                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  '\x1b[1m2) Build + push\x1b[0m                                                                 ',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40mdocker\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mbuild\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-t\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m<your-registry>/<your-repo>/spring-boot-demo:1.0\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m\x1b[40m            \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40mdocker\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mpush\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m<your-registry>/<your-repo>/spring-boot-demo:1.0\x1b[0m\x1b[40m                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  '\x1b[1m3) Update Deployment image\x1b[0m In the Deployment above, set:                        ',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mimage\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m<your-registry>/<your-repo>/spring-boot-demo:1.0                       \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  'Then:                                                                           ',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40mkubectl\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapply\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-f\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapp.yaml\x1b[0m\x1b[40m                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  '\x1b[?2004hroot@aks-agent-649f94dbb9-whtf8:/app# ',
].join('\r\n');

export const RealWorldJavaDeployOptionAB: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={extractAIAnswer(rawJavaDeployOptionAB)}
  />
);

export const RealWorldJavaDeployOptionABDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={extractAIAnswer(rawJavaDeployOptionAB)}
    />
  </ThemeProvider>
);

// ─── Story: Kubernetes deployment with bare curl command ─────────────────────

const rawK8sDeployWithCurl = [
  'stty -echo',
  '\x1b[?2004l',
  '\x1b[?2004hroot@aks-agent-pod:/app# ',
  '\x1b[?2004l\r',
  '\x1b[?2004h> ',
  '\x1b[?2004l\r',
  '\x1b[1;96mAI:\x1b[0m ',
  "Here's how to deploy an nginx web server and test it:",
  '',
  '```yaml',
  'apiVersion: apps/v1',
  'kind: Deployment',
  'metadata:',
  '  name: nginx-demo',
  '  namespace: default',
  'spec:',
  '  replicas: 2',
  '  selector:',
  '    matchLabels:',
  '      app: nginx-demo',
  '  template:',
  '    metadata:',
  '      labels:',
  '        app: nginx-demo',
  '    spec:',
  '      containers:',
  '        - name: nginx',
  '          image: nginx:1.25-alpine',
  '          ports:',
  '            - containerPort: 80',
  '          resources:',
  '            requests:',
  '              cpu: 50m',
  '              memory: 64Mi',
  '            limits:',
  '              cpu: 200m',
  '              memory: 128Mi',
  '---',
  'apiVersion: v1',
  'kind: Service',
  'metadata:',
  '  name: nginx-demo',
  '  namespace: default',
  'spec:',
  '  selector:',
  '    app: nginx-demo',
  '  ports:',
  '    - port: 80',
  '      targetPort: 80',
  '  type: ClusterIP',
  '```',
  '',
  'Apply and verify:',
  '',
  'kubectl apply -f nginx-demo.yaml',
  'kubectl get pods -l app=nginx-demo -w',
  'kubectl port-forward svc/nginx-demo 8080:80',
  '',
  'Test the service:',
  '',
  'curl http://localhost:8080',
  'curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/healthz',
  '',
  'You should see the default nginx welcome page and a 200 status code.',
  '\x1b[?2004hroot@aks-agent-pod:/app# ',
].join('\r\n');

export const RealWorldK8sDeployWithCurl: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={extractAIAnswer(rawK8sDeployWithCurl)}
  />
);

export const RealWorldK8sDeployWithCurlDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={extractAIAnswer(rawK8sDeployWithCurl)}
    />
  </ThemeProvider>
);

// ─── Story: Large microservice YAML with terminal-wrapped values ─────────────

const rawMicroserviceYaml = [
  'stty -echo',
  '\x1b[?2004l',
  '\x1b[?2004hroot@aks-agent-649f94dbb9-whtf8:/app# ',
  '\x1b[?2004l\r',
  '\x1b[?2004h> ',
  '\x1b[?2004l\r',
  '\x1b[1;96mAI:\x1b[0m ',
  'Below is a single (large) multi-document YAML example for a "complicated"       ',
  'microservice setup: multiple namespaces, shared config, secrets, several        ',
  'microservices, HPAs, PDBs, NetworkPolicies, an Ingress, a CronJob, and a Job.   ',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# --------------------------------------------------------\x1b[0m\x1b[40m                    \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# Namespaces\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# --------------------------------------------------------\x1b[0m\x1b[40m                    \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mNamespace                                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mplatform                                                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mNamespace                                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mapps                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[40m                                                                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# --------------------------------------------------------\x1b[0m\x1b[40m                    \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# Shared config/secrets\x1b[0m\x1b[40m                                                       \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# --------------------------------------------------------\x1b[0m\x1b[40m                    \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mConfigMap                                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mglobal-config                                                         \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mnamespace\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mapps                                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mdata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mLOG_LEVEL\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40minfo\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mOTEL_EXPORTER_OTLP_ENDPOINT\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40mhttp://otel-collector.observability.svc.cluster.local:4317\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mSecret                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mdb-credentials                                                        \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mtype\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mOpaque                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mstringData\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mPOSTGRES_USER\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40mappuser\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mPOSTGRES_PASSWORD\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40mreplace-me\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  'If you want it even more "realistic complicated", tell me what stack you want   ',
  "included (Istio/Linkerd, Kafka, etc.) and I'll tailor the example.              ",
  '',
  '\x1b[?2004hroot@aks-agent-649f94dbb9-whtf8:/app# ',
].join('\r\n');

export const RealWorldMicroserviceYaml: StoryFn<typeof ContentRenderer> = () => (
  <ContentRenderer
    onYamlDetected={noopYamlDetected}
    content={extractAIAnswer(rawMicroserviceYaml)}
  />
);

export const RealWorldMicroserviceYamlDark: StoryFn<typeof ContentRenderer> = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <ContentRenderer
      onYamlDetected={noopYamlDetected}
      content={extractAIAnswer(rawMicroserviceYaml)}
    />
  </ThemeProvider>
);
