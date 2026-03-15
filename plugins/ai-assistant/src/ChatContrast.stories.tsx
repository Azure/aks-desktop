// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Box, createTheme, CssBaseline, ThemeProvider, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import ContentRenderer from './ContentRenderer';

/**
 * Stories to verify the contrast of the agent chat message bubbles.
 * Each story renders user and assistant messages with realistic content
 * in both light and dark themes.
 */

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    sidebar: { selectedBackground: '#555555' },
  },
});

// Approximate the Azure theme used in production
const azureTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#3F3682' },
    secondary: { main: '#ecebe9' },
    text: { primary: '#000000', secondary: '#323130' },
    background: { default: '#ffffff', paper: '#ffffff' },
    sidebar: { selectedBackground: '#c2c2c2' },
  },
});

interface MessageBubbleProps {
  sender: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  isSuccess?: boolean;
}

/** Renders a single message bubble matching the styling from textstream.tsx. */
const MessageBubble: React.FC<MessageBubbleProps> = ({
  sender,
  content,
  isError = false,
  isSuccess = false,
}) => {
  return (
    <Box
      sx={theme => {
        // Use theme.palette.sidebar.selectedBackground when available, with a sensible fallback
        const sidebarSelectedBackground =
          (theme.palette as any).sidebar?.selectedBackground ?? '#c2c2c2';

        const bubbleBg =
          sender === 'user'
            ? alpha(sidebarSelectedBackground, 0.75)
            : theme.palette.background.paper;

        return {
          mb: 2,
          p: 1.5,
          borderRadius: 1,
          bgcolor: bubbleBg,
          border: '1px solid',
          borderColor: isError ? 'error.main' : isSuccess ? 'success.main' : 'divider',
          color: theme.palette.getContrastText(bubbleBg),
          ml: sender === 'user' ? 3 : 0,
          mr: sender !== 'user' ? 3 : 0,
        };
      }}
    >
      <Typography variant="caption" sx={{ display: 'block', mb: 0.5, fontWeight: 'bold' }}>
        {sender === 'user' ? 'You' : 'AI Assistant'}
      </Typography>
      <Box sx={{ whiteSpace: 'unset' }}>
        {sender === 'user' ? content : <ContentRenderer content={content} />}
      </Box>
    </Box>
  );
};

const meta: Meta = {
  title: 'AIAssistant/ChatContrast',
  decorators: [
    (Story: any) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};
export default meta;

const conversationContent = {
  userMessage: 'How do I check the status of my pods?',
  assistantMarkdown: `You can check pod status with the following command:

\`\`\`bash
kubectl get pods --all-namespaces
\`\`\`

Here's what each status means:

| Status | Description |
|--------|-------------|
| Running | Pod is healthy |
| Pending | Waiting for scheduling |
| CrashLoopBackOff | Container keeps crashing |

> **Tip**: Use \`-o wide\` flag for more details including node assignment.`,
  assistantCodeBlock: `Here's a multi-line script to debug:

\`\`\`bash
# Get all failing pods
kubectl get pods --field-selector=status.phase!=Running -A

# Check events for errors
kubectl get events --sort-by='.lastTimestamp' | tail -20
\`\`\`

Run \`kubectl describe pod <name>\` for details on a specific pod.`,
};

// ── Standard conversations ───────────────────────────────────────────────────

/** Full conversation in default light theme. */
export const LightTheme: StoryFn = () => (
  <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
    <MessageBubble sender="user" content={conversationContent.userMessage} />
    <MessageBubble sender="assistant" content={conversationContent.assistantMarkdown} />
    <MessageBubble sender="user" content="Can you show me a debugging script?" />
    <MessageBubble sender="assistant" content={conversationContent.assistantCodeBlock} />
    <MessageBubble
      sender="assistant"
      content={JSON.stringify({ error: true, content: 'Failed to connect to cluster API server.' })}
      isError
    />
    <MessageBubble
      sender="assistant"
      content={JSON.stringify({ success: true, content: 'Scaled deployment to 5 replicas.' })}
      isSuccess
    />
  </Box>
);

/** Full conversation in dark theme - primary contrast verification. */
export const DarkTheme: StoryFn = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
      <MessageBubble sender="user" content={conversationContent.userMessage} />
      <MessageBubble sender="assistant" content={conversationContent.assistantMarkdown} />
      <MessageBubble sender="user" content="Can you show me a debugging script?" />
      <MessageBubble sender="assistant" content={conversationContent.assistantCodeBlock} />
      <MessageBubble
        sender="assistant"
        content={JSON.stringify({
          error: true,
          content: 'Failed to connect to cluster API server.',
        })}
        isError
      />
      <MessageBubble
        sender="assistant"
        content={JSON.stringify({ success: true, content: 'Scaled deployment to 5 replicas.' })}
        isSuccess
      />
    </Box>
  </ThemeProvider>
);

/** Full conversation in Azure theme (production colors). */
export const AzureTheme: StoryFn = () => (
  <ThemeProvider theme={azureTheme}>
    <CssBaseline />
    <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
      <MessageBubble sender="user" content={conversationContent.userMessage} />
      <MessageBubble sender="assistant" content={conversationContent.assistantMarkdown} />
      <MessageBubble sender="user" content="Can you show me a debugging script?" />
      <MessageBubble sender="assistant" content={conversationContent.assistantCodeBlock} />
      <MessageBubble
        sender="assistant"
        content={JSON.stringify({
          error: true,
          content: 'Failed to connect to cluster API server.',
        })}
        isError
      />
      <MessageBubble
        sender="assistant"
        content={JSON.stringify({ success: true, content: 'Scaled deployment to 5 replicas.' })}
        isSuccess
      />
    </Box>
  </ThemeProvider>
);

// ── Edge cases ───────────────────────────────────────────────────────────────

/** Very short single-word responses. */
export const ShortMessages: StoryFn = () => (
  <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
    <MessageBubble sender="user" content="Hello" />
    <MessageBubble
      sender="assistant"
      content="Hi! How can I help you with your AKS cluster today?"
    />
    <MessageBubble sender="user" content="Yes" />
    <MessageBubble sender="assistant" content="OK" />
  </Box>
);

/** Very long content that wraps extensively. */
export const LongContent: StoryFn = () => (
  <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
    <MessageBubble
      sender="user"
      content="I have a complex scenario where my AKS cluster in East US 2 region with 5 node pools running different VM sizes (Standard_DS2_v2, Standard_D4s_v3, Standard_E8s_v3, Standard_NC6s_v3, Standard_L8s_v2) is experiencing intermittent connectivity issues between pods in different node pools, and I need to troubleshoot the network policies, DNS resolution, and service mesh configuration that might be causing these problems. Can you help me step by step?"
    />
    <MessageBubble
      sender="assistant"
      content={`This is a complex networking scenario. Let me break it down systematically:

## 1. Network Policy Analysis

First, check if any network policies are blocking cross-node-pool traffic:

\`\`\`bash
# List all network policies across namespaces
kubectl get networkpolicies -A -o wide

# Check for any deny-all policies
kubectl get networkpolicies -A -o json | jq '.items[] | select(.spec.policyTypes[] == "Ingress") | {name: .metadata.name, namespace: .metadata.namespace}'
\`\`\`

## 2. DNS Resolution

Verify CoreDNS is functioning properly:

\`\`\`bash
# Check CoreDNS pods
kubectl -n kube-system get pods -l k8s-app=kube-dns

# Run a DNS test from a debug pod
kubectl run -it --rm --restart=Never dns-test --image=busybox -- nslookup kubernetes.default.svc.cluster.local
\`\`\`

## 3. Cross-Node Connectivity

Test pod-to-pod connectivity across node pools:

| Source Node Pool | Target Node Pool | Protocol | Result |
|-----------------|-----------------|----------|--------|
| Standard_DS2_v2 | Standard_D4s_v3 | TCP/80 | Pending test |
| Standard_DS2_v2 | Standard_E8s_v3 | TCP/443 | Pending test |
| Standard_D4s_v3 | Standard_NC6s_v3 | TCP/8080 | Pending test |
| Standard_NC6s_v3 | Standard_L8s_v2 | TCP/3306 | Pending test |

> **Important**: Make sure your Azure NSG rules allow inter-node communication on the required ports. AKS requires specific port ranges to be open between nodes.

## 4. Service Mesh Check

If you're using Istio or Linkerd:

\`\`\`bash
# Check sidecar injection status
kubectl get namespace --show-labels | grep istio-injection

# Verify mTLS configuration
istioctl analyze --all-namespaces
\`\`\``}
    />
  </Box>
);

/** Short messages in dark theme. */
export const ShortMessagesDark: StoryFn = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
      <MessageBubble sender="user" content="Hello" />
      <MessageBubble
        sender="assistant"
        content="Hi! How can I help you with your AKS cluster today?"
      />
      <MessageBubble sender="user" content="Yes" />
      <MessageBubble sender="assistant" content="OK" />
    </Box>
  </ThemeProvider>
);

/** Long content in dark theme - verify scrolling and wrapping with correct contrast. */
export const LongContentDark: StoryFn = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
      <MessageBubble
        sender="user"
        content="I have a complex scenario where my AKS cluster in East US 2 region with 5 node pools running different VM sizes is experiencing intermittent connectivity issues between pods in different node pools, and I need to troubleshoot the network policies, DNS resolution, and service mesh configuration."
      />
      <MessageBubble
        sender="assistant"
        content={`Let me help you debug this. First check network policies:

\`\`\`bash
kubectl get networkpolicies -A -o wide
kubectl get networkpolicies -A -o json | jq '.items[] | select(.spec.policyTypes[] == "Ingress")'
\`\`\`

| Source Pool | Target Pool | Status |
|------------|------------|--------|
| DS2_v2 | D4s_v3 | Pending |
| DS2_v2 | E8s_v3 | Pending |
| D4s_v3 | NC6s_v3 | Pending |

> **Note**: Ensure Azure NSG rules allow inter-node communication.`}
      />
    </Box>
  </ThemeProvider>
);

/** Multiple error and success states in sequence. */
export const ErrorAndSuccessStates: StoryFn = () => (
  <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
    <MessageBubble sender="user" content="Scale my deployment" />
    <MessageBubble
      sender="assistant"
      content={JSON.stringify({
        error: true,
        content:
          'Connection timeout: Unable to reach the Kubernetes API server at https://myaks-12345.hcp.eastus.azmk8s.io:443',
      })}
      isError
    />
    <MessageBubble sender="user" content="Try again" />
    <MessageBubble
      sender="assistant"
      content={JSON.stringify({
        error: true,
        content:
          'Permission denied: The current service principal does not have RBAC permissions to scale deployments in the production namespace.',
      })}
      isError
    />
    <MessageBubble sender="user" content="Use the admin kubeconfig" />
    <MessageBubble
      sender="assistant"
      content={JSON.stringify({
        success: true,
        content:
          'Successfully scaled deployment "api-server" from 3 to 5 replicas in namespace "production".',
      })}
      isSuccess
    />
    <MessageBubble
      sender="assistant"
      content={`Scaling is complete. Here's the current status:

| Deployment | Desired | Available | Ready |
|-----------|---------|-----------|-------|
| api-server | 5 | 5 | 5 |

All pods are running and healthy.`}
    />
  </Box>
);

/** Multiple error and success states in dark theme. */
export const ErrorAndSuccessStatesDark: StoryFn = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
      <MessageBubble sender="user" content="Scale my deployment" />
      <MessageBubble
        sender="assistant"
        content={JSON.stringify({
          error: true,
          content:
            'Connection timeout: Unable to reach the Kubernetes API server at https://myaks-12345.hcp.eastus.azmk8s.io:443',
        })}
        isError
      />
      <MessageBubble sender="user" content="Try again" />
      <MessageBubble
        sender="assistant"
        content={JSON.stringify({
          error: true,
          content:
            'Permission denied: The current service principal does not have RBAC permissions to scale deployments in the production namespace.',
        })}
        isError
      />
      <MessageBubble sender="user" content="Use the admin kubeconfig" />
      <MessageBubble
        sender="assistant"
        content={JSON.stringify({
          success: true,
          content:
            'Successfully scaled deployment "api-server" from 3 to 5 replicas in namespace "production".',
        })}
        isSuccess
      />
      <MessageBubble
        sender="assistant"
        content={`Scaling is complete. All pods are running and healthy.`}
      />
    </Box>
  </ThemeProvider>
);

/** YAML and Kubernetes resource content. */
export const KubernetesYAML: StoryFn = () => (
  <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
    <MessageBubble sender="user" content="Show me my deployment YAML" />
    <MessageBubble
      sender="assistant"
      content={`Here's your deployment configuration:

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: production
  labels:
    app: api-server
    version: v2.1.0
spec:
  replicas: 3
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
        image: myregistry.azurecr.io/api-server:v2.1.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            cpu: "250m"
            memory: "256Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"
\`\`\`

I notice you're not using \`readinessProbe\` or \`livenessProbe\`. I recommend adding them.`}
    />
  </Box>
);

/** Inline code and mixed formatting - verify inline code contrast. */
export const InlineCodeHeavy: StoryFn = () => (
  <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
    <MessageBubble sender="user" content="What kubectl commands should I know?" />
    <MessageBubble
      sender="assistant"
      content={`Here are the essential commands:

- \`kubectl get pods\` — list pods
- \`kubectl get svc\` — list services
- \`kubectl describe pod <name>\` — pod details
- \`kubectl logs <pod> -f\` — stream logs
- \`kubectl exec -it <pod> -- /bin/bash\` — exec into pod
- \`kubectl apply -f <file.yaml>\` — apply manifest
- \`kubectl delete pod <name>\` — delete a pod
- \`kubectl top nodes\` — resource usage
- \`kubectl get events --sort-by='.lastTimestamp'\` — recent events

Use \`kubectl config get-contexts\` to verify your current context is pointing to the right cluster.`}
    />
  </Box>
);

/** Inline code in dark theme - verify inline code background contrast. */
export const InlineCodeHeavyDark: StoryFn = () => (
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <Box sx={{ maxWidth: 700, p: 2, bgcolor: 'background.default' }}>
      <MessageBubble sender="user" content="What kubectl commands should I know?" />
      <MessageBubble
        sender="assistant"
        content={`Essential commands:

- \`kubectl get pods\` — list pods
- \`kubectl get svc\` — list services
- \`kubectl describe pod <name>\` — pod details
- \`kubectl logs <pod> -f\` — stream logs
- \`kubectl exec -it <pod> -- /bin/bash\` — exec into pod

Use \`kubectl config get-contexts\` to verify your current context.`}
      />
    </Box>
  </ThemeProvider>
);
