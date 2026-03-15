// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Box, Button, createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React, { useEffect, useRef, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Prompt } from './ai/manager';
import TextStreamContainer from './textstream';

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    sidebar: { selectedBackground: '#c2c2c2' },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    sidebar: { selectedBackground: '#555555' },
  },
});

const meta: Meta = {
  title: 'AIAssistant/TextStreamScrolling',
  decorators: [
    (Story: any) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};
export default meta;

// ── Helpers ──────────────────────────────────────────────────────────────────

const longAssistantResponse = `Here's a comprehensive guide to debugging your AKS cluster networking issues:

## 1. Check Pod Network Connectivity

\`\`\`bash
# List all pods with their IPs and nodes
kubectl get pods -A -o wide

# Test connectivity from a debug pod
kubectl run debug --image=busybox --restart=Never -- sleep 3600
kubectl exec -it debug -- wget -qO- http://my-service.default.svc.cluster.local
\`\`\`

## 2. Inspect Network Policies

\`\`\`bash
# List all network policies
kubectl get networkpolicies -A

# Describe a specific policy
kubectl describe networkpolicy my-policy -n my-namespace
\`\`\`

## 3. Verify DNS Resolution

\`\`\`bash
# Test DNS from inside a pod
kubectl exec -it debug -- nslookup kubernetes.default.svc.cluster.local
kubectl exec -it debug -- nslookup my-service.my-namespace.svc.cluster.local
\`\`\`

## 4. Check Node-Level Networking

| Check | Command | Expected |
|-------|---------|----------|
| Node status | \`kubectl get nodes\` | All Ready |
| CNI pods | \`kubectl get pods -n kube-system -l component=azure-cni\` | All Running |
| CoreDNS | \`kubectl get pods -n kube-system -l k8s-app=kube-dns\` | All Running |
| kube-proxy | \`kubectl get pods -n kube-system -l component=kube-proxy\` | All Running |

## 5. Review Azure NSG Rules

Make sure your Network Security Groups allow traffic between:
- Pod CIDR ranges across node pools
- Service CIDR range
- Node-to-node communication on required ports

> **Important**: After any NSG changes, it may take up to 5 minutes for rules to propagate fully.`;

const previousConversation: Prompt[] = [
  { role: 'user', content: 'How do I set up monitoring for my AKS cluster?' },
  {
    role: 'assistant',
    content: `You can enable Azure Monitor for containers using:

\`\`\`bash
az aks enable-addons --resource-group myResourceGroup --name myAKSCluster --addons monitoring
\`\`\`

This will install the monitoring agent on all nodes and start collecting metrics and logs.`,
  },
  { role: 'user', content: 'What about Prometheus?' },
  {
    role: 'assistant',
    content: `For Prometheus, you have several options:

1. **Azure Managed Prometheus** — recommended for AKS:
\`\`\`bash
az aks update --resource-group myRG --name myCluster --enable-azure-monitor-metrics
\`\`\`

2. **Self-managed Prometheus** using Helm:
\`\`\`bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack
\`\`\`

Both options integrate with Grafana for dashboards.`,
  },
  { role: 'user', content: 'How do I check my cluster networking?' },
];

// Short follow-up questions used to simulate a realistic multi-turn conversation
const followUpQuestions = [
  'How do I check my cluster networking?',
  'How do I troubleshoot DNS issues in AKS?',
  'What about network policy debugging?',
  'How do I monitor network traffic between pods?',
];

// Long user questions with YAML to test scroll behavior for tall user messages
const longUserQuestions = [
  `I'm trying to deploy this configuration but it keeps failing. Can you help me debug it?

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: production
  labels:
    app: my-app
    version: v2.1.0
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
        version: v2.1.0
    spec:
      containers:
      - name: my-app
        image: myregistry.azurecr.io/my-app:v2.1.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        readinessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
\`\`\`

The pods keep getting OOMKilled after about 5 minutes of running.`,

  `I have this network policy but traffic is still getting through when it shouldn't be:

\`\`\`yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: secure-api
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: frontend
    - podSelector:
        matchLabels:
          role: api-gateway
    ports:
    - protocol: TCP
      port: 443
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: database
    ports:
    - protocol: TCP
      port: 5432
\`\`\`

Pods in the \`staging\` namespace can still reach the \`secure-api\` pods on port 443. What am I doing wrong?`,
];

const longQuestionResponses = [
  `The OOMKilled issue is clear from your deployment spec. Your container has a memory limit of **512Mi** but the app is exceeding that.

## Diagnosis

\`\`\`bash
# Check the OOMKilled events
kubectl describe pod -l app=my-app -n production | grep -A 5 "Last State"

# Monitor real-time memory usage
kubectl top pods -l app=my-app -n production
\`\`\`

## Solutions

1. **Increase the memory limit** — if your app genuinely needs more memory:
\`\`\`yaml
resources:
  limits:
    memory: "1Gi"  # Increase from 512Mi
\`\`\`

2. **Check for memory leaks** — profile your app's heap:
\`\`\`bash
kubectl exec -it <pod-name> -n production -- /bin/sh -c "curl localhost:8080/debug/pprof/heap > /tmp/heap"
kubectl cp production/<pod-name>:/tmp/heap ./heap.prof
\`\`\`

3. **Add a VPA** to auto-tune resources:
\`\`\`bash
kubectl apply -f - <<EOF
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
spec:
  targetRef:
    apiVersion: "apps/v1"
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Auto"
EOF
\`\`\`

> **Tip**: Start by checking \`kubectl top pods\` to see actual usage patterns before raising limits.`,

  `The issue is with your \`ingress.from\` rules — you're using two separate selectors which creates an **OR** condition instead of **AND**.

## The Problem

\`\`\`yaml
ingress:
- from:
  - namespaceSelector:      # Rule 1: ANY pod from 'frontend' namespace
      matchLabels:
        name: frontend
  - podSelector:             # Rule 2: ANY pod with role=api-gateway in SAME namespace
      matchLabels:
        role: api-gateway
\`\`\`

These are **two separate rules** (OR). Any pod from the \`frontend\` namespace OR any pod labeled \`role: api-gateway\` in the \`production\` namespace can connect.

## The Fix

Combine them into a **single rule** (AND):

\`\`\`yaml
ingress:
- from:
  - namespaceSelector:
      matchLabels:
        name: frontend
    podSelector:            # Same list item = AND condition
      matchLabels:
        role: api-gateway
\`\`\`

Now only pods that are **both** in the \`frontend\` namespace **and** labeled \`role: api-gateway\` can connect.

Verify with:
\`\`\`bash
# Test from staging (should be blocked)
kubectl exec -n staging test-pod -- curl -s --max-time 3 https://secure-api.production:443

# Test from frontend with correct label (should work)
kubectl exec -n frontend -l role=api-gateway test-pod -- curl -s https://secure-api.production:443
\`\`\``,
];

// ── Stories ──────────────────────────────────────────────────────────────────

/**
 * Demonstrates that when a new agent response arrives, the viewport scrolls
 * to the **top** of the response rather than the bottom.
 * Click "Ask & Get Response" to simulate sending a question and receiving a
 * long response. Works for multiple sequential clicks — each click adds
 * a user question (scrolls to bottom) then an agent response (scrolls to top
 * of the response, with the user's question visible for context).
 */
export const ScrollToTopOfResponse: StoryFn = () => {
  const [history, setHistory] = useState<Prompt[]>(
    previousConversation.slice(0, -1) // start without the trailing user question
  );
  const [isLoading, setIsLoading] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const addExchange = () => {
    const question = followUpQuestions[questionIndex % followUpQuestions.length];
    // Add user question first (triggers scroll to bottom)
    setHistory(prev => [...prev, { role: 'user', content: question }]);
    setIsLoading(true);
    // Short delay to simulate loading, then add assistant response
    timerRef.current = setTimeout(() => {
      setHistory(prev => [...prev, { role: 'assistant', content: longAssistantResponse }]);
      setIsLoading(false);
      setQuestionIndex(i => i + 1);
    }, 500);
  };

  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: 500, maxWidth: 700 }}>
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <TextStreamContainer history={history} isLoading={isLoading} apiError={null} />
        </Box>
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button variant="contained" onClick={addExchange} disabled={isLoading}>
            Ask &amp; Get Response
          </Button>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

/**
 * Same test in dark theme. The viewport should scroll to the top of the new
 * agent response when "Ask & Get Response" is clicked.
 */
export const ScrollToTopOfResponseDark: StoryFn = () => {
  const [history, setHistory] = useState<Prompt[]>(previousConversation.slice(0, -1));
  const [isLoading, setIsLoading] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const addExchange = () => {
    const question = followUpQuestions[questionIndex % followUpQuestions.length];
    setHistory(prev => [...prev, { role: 'user', content: question }]);
    setIsLoading(true);
    timerRef.current = setTimeout(() => {
      setHistory(prev => [...prev, { role: 'assistant', content: longAssistantResponse }]);
      setIsLoading(false);
      setQuestionIndex(i => i + 1);
    }, 500);
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: 500, maxWidth: 700 }}>
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <TextStreamContainer history={history} isLoading={isLoading} apiError={null} />
        </Box>
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button variant="contained" onClick={addExchange} disabled={isLoading}>
            Ask &amp; Get Response
          </Button>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

/**
 * Multi-step conversation: click repeatedly to add alternating user questions
 * and agent responses. Each agent response should scroll to show its top.
 */
export const MultiStepConversation: StoryFn = () => {
  const exchanges: Array<{ user: string; assistant: string }> = [
    {
      user: 'How do I scale my deployment?',
      assistant: `To scale a deployment, use:

\`\`\`bash
kubectl scale deployment my-app --replicas=5
\`\`\`

Or use Horizontal Pod Autoscaler:

\`\`\`bash
kubectl autoscale deployment my-app --min=2 --max=10 --cpu-percent=80
\`\`\`

Check the current state with:
\`\`\`bash
kubectl get hpa
\`\`\``,
    },
    {
      user: 'What if the pods are stuck in Pending?',
      assistant: `Pods stuck in **Pending** usually mean the scheduler can't find a suitable node. Common causes:

## Resource Constraints
\`\`\`bash
# Check node resource usage
kubectl top nodes

# Check pod resource requests
kubectl describe pod <pod-name> | grep -A 5 "Requests"
\`\`\`

## Node Affinity / Taints
\`\`\`bash
# Check node taints
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints

# Check pending pod events
kubectl describe pod <pending-pod> | tail -20
\`\`\`

| Cause | Solution |
|-------|----------|
| Insufficient CPU | Add nodes or reduce requests |
| Insufficient memory | Add nodes or reduce requests |
| Node taint | Add toleration to pod spec |
| Node selector mismatch | Update node labels or pod selector |
| PVC pending | Check storage class and PV availability |`,
    },
    {
      user: 'How do I add more nodes?',
      assistant: `You can scale your node pool with the Azure CLI:

\`\`\`bash
# Scale an existing node pool
az aks nodepool scale \\
  --resource-group myResourceGroup \\
  --cluster-name myAKSCluster \\
  --name mynodepool \\
  --node-count 5

# Or enable cluster autoscaler
az aks nodepool update \\
  --resource-group myResourceGroup \\
  --cluster-name myAKSCluster \\
  --name mynodepool \\
  --enable-cluster-autoscaler \\
  --min-count 2 \\
  --max-count 10
\`\`\`

> **Tip**: The cluster autoscaler checks every 10 seconds for pending pods that can't be scheduled and scales up nodes accordingly.`,
    },
  ];

  const [history, setHistory] = useState<Prompt[]>([
    { role: 'user', content: 'Hello, I need help with AKS.' },
    {
      role: 'assistant',
      content: "Hi! I'm ready to help you with your AKS cluster. What do you need?",
    },
  ]);
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const addNextExchange = () => {
    if (step >= exchanges.length) return;
    const exchange = exchanges[step];

    // Add user message
    setHistory(prev => [...prev, { role: 'user', content: exchange.user }]);

    // Add assistant response after a short delay
    setIsLoading(true);
    timerRef.current = setTimeout(() => {
      setHistory(prev => [...prev, { role: 'assistant', content: exchange.assistant }]);
      setIsLoading(false);
      setStep(s => s + 1);
    }, 600);
  };

  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: 500, maxWidth: 700 }}>
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <TextStreamContainer history={history} isLoading={isLoading} apiError={null} />
        </Box>
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button
            variant="contained"
            onClick={addNextExchange}
            disabled={isLoading || step >= exchanges.length}
          >
            {step < exchanges.length
              ? `Send Next Question (${step + 1}/${exchanges.length})`
              : 'Conversation Complete'}
          </Button>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

/**
 * Tests scroll behavior with long user questions containing YAML.
 * For tall questions that exceed 30% of viewport height, the viewport should
 * scroll to the bottom of the user question (showing the tail of what they
 * asked) plus the start of the response.
 */
export const LongUserQuestionsWithYAML: StoryFn = () => {
  const [history, setHistory] = useState<Prompt[]>([
    { role: 'user', content: 'How do I get started with AKS?' },
    {
      role: 'assistant',
      content: `To get started with AKS, create a cluster using the Azure CLI:

\`\`\`bash
az aks create --resource-group myRG --name myCluster --node-count 3
az aks get-credentials --resource-group myRG --name myCluster
kubectl get nodes
\`\`\`

Let me know if you need help with deployments or networking!`,
    },
  ]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const addExchange = () => {
    const question = longUserQuestions[questionIndex % longUserQuestions.length];
    const response = longQuestionResponses[questionIndex % longQuestionResponses.length];

    // Add long user question
    setHistory(prev => [...prev, { role: 'user', content: question }]);
    setIsLoading(true);

    // Simulate a realistic slow AI response (3 seconds)
    timerRef.current = setTimeout(() => {
      setHistory(prev => [...prev, { role: 'assistant', content: response }]);
      setIsLoading(false);
      setQuestionIndex(i => i + 1);
    }, 3000);
  };

  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: 500, maxWidth: 700 }}>
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <TextStreamContainer history={history} isLoading={isLoading} apiError={null} />
        </Box>
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button variant="contained" onClick={addExchange} disabled={isLoading}>
            {isLoading ? 'Waiting for AI response...' : 'Send Long YAML Question'}
          </Button>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

/**
 * Simulates realistic slow AI response times (2-5 seconds) to verify that
 * the loading indicator is shown and the viewport handles the transition
 * correctly when the response finally arrives.
 */
export const SlowResponsesWithLoader: StoryFn = () => {
  const exchanges: Array<{ user: string; assistant: string; delayMs: number }> = [
    {
      user: 'How do I check my cluster health?',
      assistant: `Here's how to check your AKS cluster health:

\`\`\`bash
# Overall cluster status
az aks show --resource-group myRG --name myCluster --query "provisioningState"

# Node health
kubectl get nodes
kubectl describe nodes | grep -A 5 "Conditions"

# System pod health
kubectl get pods -n kube-system
\`\`\`

If any nodes show **NotReady**, check the kubelet logs on that node.`,
      delayMs: 2000,
    },
    {
      user: longUserQuestions[0], // Long YAML question
      assistant: longQuestionResponses[0],
      delayMs: 4000,
    },
    {
      user: 'What ports does AKS need open?',
      assistant: `AKS requires these ports for proper operation:

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 | TCP | Kubernetes API server |
| 10250 | TCP | Kubelet API |
| 10255 | TCP | Kubelet read-only |
| 30000-32767 | TCP | NodePort services |

\`\`\`bash
# Verify API server connectivity
kubectl cluster-info

# Check if you can reach the API
curl -k https://<api-server-url>:443/healthz
\`\`\``,
      delayMs: 3000,
    },
    {
      user: longUserQuestions[1], // Long network policy question
      assistant: longQuestionResponses[1],
      delayMs: 5000,
    },
  ];

  const [history, setHistory] = useState<Prompt[]>([
    { role: 'user', content: 'Hello, I need help debugging my AKS cluster.' },
    {
      role: 'assistant',
      content: "Hi! I can help with AKS debugging. What's the issue you're experiencing?",
    },
  ]);
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const addNextExchange = () => {
    if (step >= exchanges.length) return;
    const exchange = exchanges[step];

    // Add user message
    setHistory(prev => [...prev, { role: 'user', content: exchange.user }]);
    setIsLoading(true);

    // Simulate slow AI response with variable delay
    timerRef.current = setTimeout(() => {
      setHistory(prev => [...prev, { role: 'assistant', content: exchange.assistant }]);
      setIsLoading(false);
      setStep(s => s + 1);
    }, exchange.delayMs);
  };

  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: 500, maxWidth: 700 }}>
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <TextStreamContainer history={history} isLoading={isLoading} apiError={null} />
        </Box>
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button
            variant="contained"
            onClick={addNextExchange}
            disabled={isLoading || step >= exchanges.length}
          >
            {isLoading
              ? `Waiting for AI... (~${
                  exchanges[Math.min(step, exchanges.length - 1)].delayMs / 1000
                }s)`
              : step < exchanges.length
              ? `Send Question ${step + 1}/${exchanges.length}${
                  step === 1 || step === 3 ? ' (Long YAML)' : ''
                }`
              : 'All Questions Answered'}
          </Button>
        </Box>
      </Box>
    </ThemeProvider>
  );
};
