# AKS destkop AI Assistant

The AKS desktop AI Assistant is a plugin that integrates AI capabilities directly into AKS desktop. It provides a conversational interface to interact with your Kubernetes clusters, helping you manage resources, troubleshoot issues, and understand complex configurations through natural language.

The assistant is context-aware, meaning it uses information about your cluster to provide more relevant and accurate responses..

**IMPORTANT:** This plugin is in alpha state and is disabled by default. You must enable the preview in Settings before using it.

This is based on the Headlamp AI assistant.

## Getting Started

The AI Assistant is **disabled by default**. To enable it:

1. Open the AKS Desktop application.
2. Navigate to **Settings > Plugins > ai-assistant**.
3. Toggle **Enable AI Assistant (Preview)** to on.
4. Configure at least one AI model provider (see [Supported Providers](#supported-providers) below).

Once enabled, an AI Assistant button will appear in the app bar. Click it to open the conversational panel.

## Key Features

- **Conversational Kubernetes Management**: Interact with your cluster using natural language. Ask questions, get explanations, and issue commands.
- **Context-Aware Assistance**: The AI has access to cluster information, making its responses relevant to your current setup.
- **Multi-Provider Support**: Choose from a wide range of AI providers.
- **Configurable Tools**: Fine-tune the AI's capabilities by enabling or disabling specific tools, like direct Kubernetes API access.
- **Resource Generation**: Ask the AI to generate Kubernetes YAML manifests for deployments, services, and more.
- **In-depth Analysis**: Get help diagnosing issues, understanding resource configurations, and interpreting logs.
- **AKS Agent Integration**: On AKS clusters with the aks-agent installed, the assistant can exec into the agent pod for deeper cluster analysis.

## Supported Providers

The plugin supports multiple AI providers, allowing you to choose the one that best fits your needs:

- **OpenAI** (GPT models)
- **Azure OpenAI Service**
- **Anthropic** (Claude models)
- **Mistral AI**
- **Google** (Gemini models)
- **Local Models** (via Ollama)

You will need to provide your own API keys and endpoint information for the provider you choose to use. Please note that using AI providers may incur costs, so check the pricing details of your chosen provider.

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
cd plugins/ai-assistant
npm install
```

### Commands

| Command          | Description              |
| ---------------- | ------------------------ |
| `npm run tsc`    | Type checking            |
| `npm run lint`   | ESLint check             |
| `npm run format` | Prettier formatting      |
| `npm run build`  | Build plugin             |
| `npm test`       | Run tests                |
| `npm start`      | Start development server |

### Testing

Tests use [vitest](https://vitest.dev/) and are located alongside source files with a `.test.ts` or `.test.tsx` suffix:

- `src/agent/aksAgentManager.test.ts` — Unit tests for shell escaping, prompt building, and security restrictions.
- `src/index.test.tsx` — Plugin registration tests.

Run tests with:

```bash
npm test
```

### Security

The plugin includes several security measures:

- **Command restriction**: The `runCommandAsync` helper only allows explicitly allowlisted commands (`az aks`).
- **Shell injection prevention**: User input passed to the AKS agent pod is escaped using single-quote wrapping to prevent shell interpretation.
- **Preview gating**: The plugin is disabled by default and must be explicitly enabled by the user.
