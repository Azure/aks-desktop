import { runCommand } from '@kinvolk/headlamp-plugin/lib';
import { clusterRequest, stream } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

declare const pluginRunCommand: typeof runCommand;

/**
 * Escape a string for safe use inside a bash single-quoted argument.
 * Single quotes prevent all shell interpretation (no variable expansion,
 * no command substitution). The only special case is the single quote
 * itself, which is handled by ending the string, adding an escaped
 * single quote, and starting a new single-quoted string.
 */
export function shellEscapeSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Base system prompt prepended before every AKS agent question.
 * Instructs the LLM to return YAML inside markdown code blocks and
 * to honour the conversation history that follows.
 */
export const BASE_AKS_AGENT_PROMPT = `IMPORTANT INSTRUCTIONS:
- When returning any YAML content, always wrap it inside a markdown code block using \`\`\`yaml ... \`\`\` so it renders properly.
- The conversation history below shows all previously asked questions and your answers. Keep that context in mind and answer accordingly — do not repeat information already provided unless the user explicitly asks for it.
`;

/** Represents a single exchange (question + answer) from the conversation history. */
export interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Builds the full prompt sent to the AKS agent:
 *   BASE_AKS_AGENT_PROMPT + conversation history + current question
 */
export function buildEnrichedPrompt(
  question: string,
  conversationHistory: ConversationEntry[]
): string {
  let enriched = BASE_AKS_AGENT_PROMPT;

  // Append prior conversation turns so the agent has full context
  if (conversationHistory.length > 0) {
    enriched += '\n--- CONVERSATION HISTORY ---\n';
    for (const entry of conversationHistory) {
      const label = entry.role === 'user' ? 'User' : 'Assistant';
      enriched += `${label}: ${entry.content}\n\n`;
    }
    enriched += '--- END OF CONVERSATION HISTORY ---\n\n';
  }

  enriched += `Now answer the following new question:\n${question}`;
  return enriched;
}

/** Info about a discovered AKS agent pod. */
export interface AksAgentPodInfo {
  namespace: string;
  podName: string;
  containerName: string;
}

/** A single thinking step shown to the user while the agent is working. */
export interface AgentThinkingStep {
  id: number;
  /** User-friendly description */
  label: string;
  /** Current state of this step */
  status: 'pending' | 'running' | 'completed';
  /** epoch millis when the step was created / last updated */
  timestamp: number;
  /**
   * Phase this step belongs to.
   * - 'init'      → toolset / model loading
   * - 'planning'  → TodoWrite task list items
   * - 'executing' → kubectl / tool calls
   */
  phase: 'init' | 'planning' | 'executing';
}

/** Callback invoked repeatedly as the agent streams thinking progress. */
export type AgentProgressCallback = (steps: AgentThinkingStep[]) => void;

/**
 * Allowed commands that can be executed via pluginRunCommand.
 * Only 'az' is needed for AKS cluster discovery.
 */
const ALLOWED_COMMANDS = new Set(['az']);

/**
 * Allowed first-level subcommands for the az CLI.
 * Only 'aks' operations are permitted.
 */
const ALLOWED_AZ_SUBCOMMANDS = new Set(['aks']);

/**
 * Runs a local command asynchronously using pluginRunCommand.
 * Restricted to allowed commands and subcommands to prevent arbitrary execution.
 */
function runCommandAsync(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise(resolve => {
    try {
      if (!ALLOWED_COMMANDS.has(command)) {
        resolve({ stdout: '', stderr: `Command not allowed: ${command}` });
        return;
      }

      if (command === 'az' && (args.length === 0 || !ALLOWED_AZ_SUBCOMMANDS.has(args[0]))) {
        resolve({ stdout: '', stderr: `az subcommand not allowed: ${args[0] ?? '(none)'}` });
        return;
      }

      if (typeof pluginRunCommand === 'undefined') {
        resolve({
          stdout: '',
          stderr:
            'pluginRunCommand is not available. This feature requires the desktop version of Headlamp.',
        });
        return;
      }

      //@ts-ignore - pluginRunCommand accepts 'az' but type def is narrower
      const cmd = pluginRunCommand(command, args, {});
      let stdout = '';
      let stderr = '';

      cmd.stdout.on('data', (data: string) => (stdout += data));
      cmd.stderr.on('data', (data: string) => (stderr += data));
      cmd.on('exit', () => resolve({ stdout, stderr }));
      cmd.on('error', (code: number) =>
        resolve({ stdout: '', stderr: `Command execution error: ${code}` })
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      resolve({ stdout: '', stderr: `Failed to execute command: ${errorMessage}` });
    }
  });
}

/**
 * Fetches AKS cluster info from the Headlamp backend config endpoint.
 * Returns objects with { name, server } filtered to AKS clusters (server contains .azmk8s.io).
 */
export async function getClustersFromHeadlampConfig(): Promise<
  Array<{ name: string; server: string }>
> {
  try {
    const response = await fetch('http://localhost:4466/config');
    if (!response.ok) return [];
    const data = await response.json();
    // clusters is an array: [{ name, server, ... }, ...]
    if (Array.isArray(data.clusters)) {
      return data.clusters
        .filter((c: any) => {
          if (!c.server || typeof c.server !== 'string') {
            return false;
          }
          let urlString = c.server as string;
          try {
            // Ensure we have a scheme so that URL parsing works even if server is just a host.
            const hasScheme = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(urlString);
            if (!hasScheme) {
              urlString = 'https://' + urlString;
            }
            const parsed = new URL(urlString);
            const hostname = parsed.hostname.toLowerCase();
            return hostname === 'azmk8s.io' || hostname.endsWith('.azmk8s.io');
          } catch {
            // If the URL cannot be parsed, treat it as not an AKS cluster.
            return false;
          }
        })
        .map((c: any) => ({ name: c.name as string, server: c.server as string }))
        .filter(c => c.name);
    }
    return [];
  } catch (error) {
    console.error('[AKS Agent] Failed to fetch clusters from headlamp config:', error);
    return [];
  }
}

/**
 * Checks if the AKS agent is installed on a cluster by looking for pods
 * whose names start with "aks-" using the Headlamp Kubernetes API proxy.
 * Returns pod info (namespace, podName, containerName) or null if not found.
 */
export async function checkAksAgentInstalled(clusterName: string): Promise<AksAgentPodInfo | null> {
  try {
    // Check running pods across all namespaces for aks- prefix
    const podsResponse = await clusterRequest('/api/v1/pods', {
      method: 'GET',
      cluster: clusterName,
      isJSON: true,
      headers: {
        Accept: 'application/json',
      },
    });

    if (podsResponse?.items) {
      const aksPod = podsResponse.items.find(
        (p: any) =>
          p.metadata?.name?.toLowerCase().startsWith('aks-') && p.status?.phase === 'Running'
      );
      if (aksPod) {
        const namespace = aksPod.metadata?.namespace || 'default';
        const podName = aksPod.metadata?.name;
        // Use the first container in the pod
        const containerName = aksPod.spec?.containers?.[0]?.name || 'aks-agent';
        console.log(
          `[AKS Agent] Found agent pod: ${podName} in namespace: ${namespace}, container: ${containerName}`
        );
        return { namespace, podName, containerName };
      }
    }

    return null;
  } catch (error) {
    console.error(`[AKS Agent] Failed to check AKS agent on cluster "${clusterName}":`, error);
    return null;
  }
}

/**
 * Finds the Azure resource group and AKS cluster name using az CLI.
 * Strategy (in order):
 *  1. FQDN match against az aks list (most reliable — handles renamed kubeconfig contexts)
 *  2. Name match (case-insensitive)
 *  3. If only one AKS cluster exists in the subscription, use it directly
 */
export async function getClusterResourceGroup(
  clusterName: string,
  serverUrl?: string
): Promise<{ resourceGroup: string; aksClusterName: string } | null> {
  // Extract hostname (FQDN) from the server URL
  let fqdn: string | null = null;
  if (serverUrl) {
    try {
      fqdn = new URL(serverUrl).hostname;
    } catch {
      // ignore malformed URL
    }
  }

  try {
    const { stdout, stderr } = await runCommandAsync('az', ['aks', 'list', '-o', 'json']);

    if (!stdout) {
      console.error('[AKS Agent] az aks list returned no output. stderr:', stderr);
      return null;
    }

    let allClusters: any[];
    try {
      allClusters = JSON.parse(stdout);
    } catch {
      console.error('[AKS Agent] Failed to parse az aks list output:', stdout);
      return null;
    }

    if (!Array.isArray(allClusters) || allClusters.length === 0) {
      console.warn('[AKS Agent] az aks list returned no clusters');
      return null;
    }

    // 1. Match by FQDN (server URL hostname) — works even when context name differs from Azure name
    if (fqdn) {
      const match = allClusters.find(c => c.fqdn === fqdn || c.privateFqdn === fqdn);
      if (match) {
        return { resourceGroup: match.resourceGroup, aksClusterName: match.name };
      }
    }

    // 2. Match by cluster name (case-insensitive)
    const nameMatch = allClusters.find(
      c => c.name === clusterName || c.name.toLowerCase() === clusterName.toLowerCase()
    );
    if (nameMatch) {
      return { resourceGroup: nameMatch.resourceGroup, aksClusterName: nameMatch.name };
    }

    // 3. Only one AKS cluster in the subscription — use it directly
    if (allClusters.length === 1) {
      console.info(
        `[AKS Agent] No name/FQDN match for "${clusterName}", using the only available cluster: ${allClusters[0].name}`
      );
      return { resourceGroup: allClusters[0].resourceGroup, aksClusterName: allClusters[0].name };
    }

    console.warn(
      `[AKS Agent] Could not match cluster "${clusterName}" (fqdn: ${fqdn}) among ${allClusters.length} clusters:`,
      allClusters.map(c => ({ name: c.name, fqdn: c.fqdn }))
    );
    return null;
  } catch (error) {
    console.error('[AKS Agent] Failed to get cluster resource group:', error);
    return null;
  }
}

/** Strip ANSI/VT100 escape sequences and carriage returns from terminal output. */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') // CSI sequences (colors, cursor, bracketed paste)
    .replace(/\x1b[()][AB012]/g, '') // Character set selection
    .replace(/\r/g, ''); // Carriage returns
}

/**
 * Convert Unicode bullet characters (•, ·, ▪, –) to markdown list syntax
 * so that ReactMarkdown renders them as proper bullet points.
 * Preserves any leading indentation so nested lists render correctly.
 */
function normalizeBullets(text: string): string {
  return text.replace(/^(\s*)[•·▪▸–]\s+/gm, '$1- ');
}

/**
 * Check whether a trimmed line looks like YAML content (key-value,
 * list item, comment, flow-mapping shorthand, etc.).
 */
function looksLikeYaml(trimmed: string): boolean {
  if (trimmed === '' || trimmed.startsWith('#')) return true;
  // YAML document separator (exactly ---) and document end marker (exactly ...)
  if (trimmed === '---' || trimmed === '...') return true;
  // key: or key:  (with optional value)
  if (/^[\w][\w.\/-]*:\s?/.test(trimmed)) return true;
  // quoted key
  if (/^["'][^"']+["']:\s?/.test(trimmed)) return true;
  // list item:  - something
  if (/^-\s/.test(trimmed) || trimmed === '-') return true;
  // flow mapping/sequence: { ... } or [ ... ]
  if (/^[{\[]/.test(trimmed)) return true;
  // continuation value (indented scalar, e.g. multiline string)
  return false;
}

/**
 * Detect contiguous blocks of bare YAML (not already inside markdown code
 * fences) and wrap each one in ```yaml / ``` so that ReactMarkdown routes
 * them through CodeComponent → YamlDisplay.
 *
 * The detection starts when a line matching `apiVersion:` is found outside
 * of a code fence. It then collects all following YAML-shaped lines (or
 * single blank lines) and stops at two consecutive blanks or a line that
 * is clearly not YAML.
 */
function wrapBareYamlBlocks(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;
  let inCodeFence = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track existing code fences
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      result.push(line);
      i++;
      continue;
    }
    if (inCodeFence) {
      result.push(line);
      i++;
      continue;
    }

    // Detect start of a bare YAML block: apiVersion: (with optional value)
    if (/^\s*apiVersion:\s*/.test(line)) {
      const yamlLines: string[] = [];
      let j = i;
      let consecutiveBlanks = 0;

      while (j < lines.length) {
        const yl = lines[j];
        const yt = yl.trim();

        if (yt === '') {
          consecutiveBlanks++;
          if (consecutiveBlanks >= 2) break; // two blank lines = end of block
          yamlLines.push(yl);
          j++;
          continue;
        }
        consecutiveBlanks = 0;

        if (j === i || looksLikeYaml(yt)) {
          yamlLines.push(yl);
          j++;
        } else {
          break;
        }
      }

      // Trim trailing blank lines from the YAML block
      while (yamlLines.length > 0 && yamlLines[yamlLines.length - 1].trim() === '') {
        yamlLines.pop();
      }

      if (yamlLines.length > 0) {
        // Dedent: strip the common leading whitespace (from Rich's 1-space padding)
        const nonBlank = yamlLines.filter(l => l.trim() !== '');
        const minIndent = nonBlank.reduce((min, l) => {
          const indent = l.match(/^(\s*)/)?.[1].length ?? 0;
          return Math.min(min, indent);
        }, Infinity);
        const shift = minIndent === Infinity ? 0 : minIndent;
        const dedented = yamlLines.map(l => (l.trim() === '' ? '' : l.slice(shift)));

        result.push('```yaml');
        result.push(...dedented);
        result.push('```');
        i = j;
      } else {
        result.push(line);
        i++;
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Clean up Rich terminal UI decorations and terminal line-padding:
 *  - Remove Rich panel border lines  (┏━━━┓ / ┗━━━┛)
 *  - Unwrap Rich panel content lines (┃  text  ┃  →  text)
 *  - Trim trailing whitespace that the terminal pads every line to 80 chars
 *  - Restore newlines between terminal lines that were concatenated without \n
 *    (terminal auto-wrap leaves no explicit newline at column 80)
 */
function cleanTerminalFormatting(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    const rTrimmed = line.trimEnd(); // trailing 80-char padding removed

    // Track code-fence boundaries — never alter content inside fences
    if (/^\s*```/.test(rTrimmed)) {
      inCodeFence = !inCodeFence;
      result.push(rTrimmed);
      continue;
    }
    if (inCodeFence) {
      result.push(rTrimmed);
      continue;
    }

    const stripped = rTrimmed.trimStart(); // leading indentation removed (for box detection only)

    // Drop Rich panel border lines — may be indented: ┏━━━━┓ and ┗━━━━┛
    if (/^[┏┗][━\s]*[┓┛]$/.test(stripped)) continue;

    // Drop Rich horizontal rule lines — only pure box-drawing chars, at least 4 wide
    if (/^[─━═]{4,}$/.test(stripped)) continue;

    // Unwrap Rich panel content lines — preserve internal indentation
    // ┃   text   ┃  →  text  (trimming only the outer box characters + 1 space padding)
    if (stripped.startsWith('┃')) {
      const inner = stripped
        .replace(/^┃\s?/, '') // remove leading ┃ and at most one space
        .replace(/\s?┃$/, ''); // remove trailing ┃ and at most one space
      if (inner) {
        result.push(inner);
      }
      continue;
    }

    result.push(rTrimmed);
  }

  return result.join('\n');
}

/**
 * Patterns that match agent infrastructure / tool-call noise lines.
 * These lines are emitted by the aks-agent CLI during processing and
 * should never appear in the final user-visible answer.
 */
const AGENT_NOISE_PATTERNS: RegExp[] = [
  // Shell prompt lines: root@aks-agent-...:...#
  /^root@[^:]*:[^#]*#/,
  // The python command we exec'd into the pod
  /^python\s+\/app\/aks-agent\.py/,
  // Task-list table decorations (borders, header, data rows, section header)
  // Matches +---+, +====+, and mixed variants like +-=+-+
  /^Task List:\s*$/,
  /^\+[-+=]+\+$/,
  /^\|\s*ID\s*\|/,
  /^\|\s*t\d+\s*\|/,
  // /show N hints
  /^\s*-\s*\/show\s+\d+\s+to view contents/,
  // Echo of the user's question (User: ...)
  /^User:\s+/,
  // Echo of assistant's answer from conversation history
  /^Assistant:\s+/,
  // Enriched prompt markers from echoed command
  /^IMPORTANT INSTRUCTIONS:\s*$/,
  /^---\s*(CONVERSATION HISTORY|END OF CONVERSATION HISTORY)\s*---\s*$/,
  /^Now answer the following new question:\s*$/,
  // Table remnant lines: only pipes, plus, dashes, equals, whitespace — but must contain at
  // least one pipe or plus to avoid matching YAML list items ("- foo") or markdown hr ("---")
  /^[\s|+=\-]*[|+][\s|+=\-]*$/,
];

/** Return true if a trimmed line matches any agent-noise pattern. */
function isAgentNoiseLine(trimmedLine: string): boolean {
  return AGENT_NOISE_PATTERNS.some(re => re.test(trimmedLine));
}

/**
 * Strip all agent infrastructure noise from an array of lines.
 * Also collapses runs of consecutive blank lines into a single blank line.
 */
function stripAgentNoise(lines: string[]): string[] {
  const cleaned: string[] = [];
  let prevBlank = false;
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track code-fence boundaries — never strip lines inside fences
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      prevBlank = false;
      cleaned.push(line);
      continue;
    }
    if (inCodeFence) {
      cleaned.push(line);
      continue;
    }

    // Drop noise lines
    if (isAgentNoiseLine(trimmed)) continue;

    // Collapse multiple blank lines
    if (trimmed === '') {
      if (prevBlank) continue;
      prevBlank = true;
    } else {
      prevBlank = false;
    }

    cleaned.push(line);
  }

  return cleaned;
}

/**
 * Remove the echoed command block from output lines.
 * When tty echo is active, the entire multi-line `python /app/aks-agent.py ask '…'`
 * command is echoed line-by-line.  The first line matches the python invocation and
 * subsequent lines are bash PS2 continuation prompt lines starting with "> ".
 * This helper strips that block so it doesn't leak into the extracted answer.
 */
function stripCommandEcho(lines: string[]): string[] {
  const cmdIdx = lines.findIndex(l => /python\s+\/app\/aks-agent\.py/.test(l));
  if (cmdIdx < 0) return lines;

  // Skip the command line and all subsequent bash continuation prompt lines
  let end = cmdIdx + 1;
  while (end < lines.length && /^\s*>/.test(lines[end])) {
    end++;
  }

  return [...lines.slice(0, cmdIdx), ...lines.slice(end)];
}

/**
 * Extract the AI's final answer from the full raw exec output.
 * Finds the "AI:" line and returns everything after it, stripped of any
 * trailing bash prompt, agent tool-call noise, and Rich terminal decorations.
 * Converts Unicode bullets to markdown syntax.
 */
function extractAIAnswer(rawOutput: string): string {
  // Split the raw output into terminal line chunks (each chunk = one terminal line)
  // and reassemble with proper \n separators, trimming 80-char padding as we go.
  const normalised = rawOutput
    .split('\n')
    .map(l => stripAnsi(l).trimEnd())
    .join('\n');

  // Strip the echoed command block before parsing — when tty echo is on,
  // the entire multi-line command (including conversation history) is echoed
  // back through stdout as the python invocation line followed by bash
  // continuation prompt lines ("> ...").
  const lines = stripCommandEcho(normalised.split('\n'));

  // Locate the "AI:" line — it may be alone or have content after the colon
  const aiLineIdx = lines.findIndex(l => /^AI:\s*$/.test(l.trim()) || /^AI:\s+\S/.test(l));

  let contentLines: string[];

  if (aiLineIdx >= 0) {
    const aiLine = lines[aiLineIdx];

    if (/^AI:\s*$/.test(aiLine.trim())) {
      // "AI:" alone on its own line — content starts on the next line
      contentLines = lines.slice(aiLineIdx + 1);
    } else {
      // "AI: content…" on the same line — strip the prefix and keep the rest
      contentLines = [aiLine.replace(/^AI:\s+/, ''), ...lines.slice(aiLineIdx + 1)];
    }
  } else {
    // Fallback: use all lines (will be cleaned below)
    contentLines = [...lines];
  }

  // Strip agent infrastructure noise from content lines
  contentLines = stripAgentNoise(contentLines);

  // Drop trailing blank lines and bash-prompt line(s).
  while (contentLines.length > 0) {
    const last = contentLines[contentLines.length - 1].trim();
    if (last === '' || /^root@/.test(last)) {
      contentLines.pop();
    } else {
      break;
    }
  }

  // Drop leading blank lines
  while (contentLines.length > 0 && contentLines[0].trim() === '') {
    contentLines.shift();
  }

  const result = contentLines.join('\n').trim();
  return wrapBareYamlBlocks(normalizeBullets(cleanTerminalFormatting(result)));
}

// ─── Real-time thinking-step parser ──────────────────────────────────────────

/**
 * Convert a raw "Running tool #N ToolName: description" line into a
 * user-friendly label for the executing phase.
 */
function friendlyToolLabel(rawToolLine: string): string {
  const match = rawToolLine.match(/^Running tool\s+#\d+\s+(.+)/);
  if (!match) return 'Running tool';

  const toolPart = match[1].trim();

  if (/^call_kubectl/i.test(toolPart)) return null as any; // tracked via task table, skip
  if (/^TodoWrite/i.test(toolPart)) return null as any; // handled separately, skip
  if (/^web_search/i.test(toolPart)) return 'Searching the web';
  if (/^read_file|file_read/i.test(toolPart)) return 'Reading file';

  const colonIdx = toolPart.indexOf(':');
  const name = colonIdx > 0 ? toolPart.slice(0, colonIdx).trim() : toolPart;
  return `Running ${name}`;
}

/**
 * Extract a task description + status from a task-list table row.
 * Returns { content, status } or null.
 *
 * Input examples:
 *   `| t1 | List all pods across all namespaces in AKS cluster | [~] in_progress |`
 *   `| t2 | Filter pods whose name contains 'gadget'           | [✓] completed   |`
 *   `| t3 | Verify and present the matching pods                | [ ] pending     |`
 */
function extractTaskRow(
  line: string
): { content: string; status: 'pending' | 'in_progress' | 'completed' } | null {
  const m = line.match(
    /^\|\s*t\d+\s*\|\s*(.*?)\s*\|\s*\[(.)\]\s*(pending|in_progress|completed)\s*\|$/
  );
  if (!m) return null;
  const statusMap: Record<string, 'pending' | 'in_progress' | 'completed'> = {
    ' ': 'pending',
    '~': 'in_progress',
    '✓': 'completed',
  };
  return { content: m[1].trim(), status: statusMap[m[2]] || (m[3] as any) };
}

/**
 * State tracker for building thinking steps from streaming output.
 * Call `processLine()` for each new line and read `steps` for current state.
 *
 * Phases:
 *  init      – model loading, toolset loading
 *  planning  – TodoWrite task items (the actual investigation plan)
 *  executing – kubectl and other tool calls
 */
class ThinkingStepTracker {
  steps: AgentThinkingStep[] = [];
  private nextId = 1;
  /** Map of tool call # → step id so we can mark them completed */
  private toolIdMap = new Map<number, number>();
  /** Track which task labels we've already added (by content) */
  private knownTasks = new Map<string, number>(); // content → step id
  /** Buffer for task-table rows that wrap across multiple terminal lines */
  private partialTaskRow = '';

  /** Process a single cleaned (ANSI-stripped, trimmed-end) line. Returns true if steps changed. */
  processLine(line: string): boolean {
    const trimmed = line.trim();

    // ── Handle partial (wrapped) task-table row buffering ──
    if (this.partialTaskRow) {
      // Blank line, table border, table header, or new task row → abandon partial, fall through
      if (!trimmed || /^\+[-+=]+\+$/.test(trimmed) || /^\|\s*(ID|t\d+)\s*\|/.test(trimmed)) {
        this.partialTaskRow = '';
        // Fall through to normal processing below
      } else {
        // Continuation of the wrapped row — join, collapse whitespace, try to parse
        const joined = (this.partialTaskRow + ' ' + trimmed).replace(/\s+/g, ' ').trim();
        const taskRow = extractTaskRow(joined);
        if (taskRow) {
          this.partialTaskRow = '';
          return this.applyTaskRow(taskRow);
        }
        // If the joined text ends with `|` but still didn't match, give up
        if (/\|\s*$/.test(trimmed)) {
          this.partialTaskRow = '';
        }
        return false;
      }
    }

    if (!trimmed) return false;
    let changed = false;

    // ── Init phase: model loading ──
    const modelMatch = trimmed.match(/^Loaded models:\s*\[(.+)\]/);
    if (modelMatch) {
      const models = modelMatch[1].replace(/'/g, '').trim();
      this.steps.push({
        id: this.nextId++,
        label: `Model: ${models}`,
        status: 'completed',
        phase: 'init',
        timestamp: Date.now(),
      });
      return true;
    }

    // ── Init phase: toolset loaded ──
    const toolsetMatch = trimmed.match(/^[✅⚠️❌]\s*Toolset\s+(.+)/);
    if (toolsetMatch) {
      const toolsetName = toolsetMatch[1].trim();
      this.steps.push({
        id: this.nextId++,
        label: `Toolset: ${toolsetName}`,
        status: 'completed',
        phase: 'init',
        timestamp: Date.now(),
      });
      return true;
    }

    // ── Init phase: Using model line (marks init as done) ──
    if (/^Using model:/i.test(trimmed)) {
      // We don't add a step but we mark all init steps completed (they should be already)
      return false;
    }

    // ── "Thinking..." indicator ──
    if (/^Thinking\.{3}$/i.test(trimmed)) {
      // Don't add a separate step; the planning phase will start shortly
      return false;
    }

    // ── Planning phase: task-list rows ──
    const taskRow = extractTaskRow(trimmed);
    if (taskRow) {
      return this.applyTaskRow(taskRow);
    }
    // Start buffering if this looks like a partial (wrapped) task row
    if (/^\|\s*t\d+\s*\|/.test(trimmed)) {
      this.partialTaskRow = trimmed;
      return false;
    }

    // ── Executing phase: Running tool #N ──
    const runMatch = trimmed.match(/^Running tool\s+#(\d+)\s+/);
    if (runMatch) {
      const toolNum = parseInt(runMatch[1], 10);
      // Skip TodoWrite and kubectl tools — they're tracked via the task table
      if (/TodoWrite/i.test(trimmed) || /call_kubectl/i.test(trimmed)) {
        // Still record the tool number so we can mark it finished without noise
        this.toolIdMap.set(toolNum, -1);
        return false;
      }
      const label = friendlyToolLabel(trimmed);
      if (!label) return false; // friendlyToolLabel returns null for TodoWrite
      const stepId = this.nextId++;
      this.toolIdMap.set(toolNum, stepId);
      this.steps.push({
        id: stepId,
        label,
        status: 'running',
        phase: 'executing',
        timestamp: Date.now(),
      });
      return true;
    }

    // ── Executing phase: Finished #N ──
    const finMatch = trimmed.match(/^Finished\s+#(\d+)\s+in\b/);
    if (finMatch) {
      const toolNum = parseInt(finMatch[1], 10);
      const stepId = this.toolIdMap.get(toolNum);
      if (stepId !== null && stepId !== undefined && stepId !== -1) {
        const step = this.steps.find(s => s.id === stepId);
        if (step && step.status !== 'completed') {
          step.status = 'completed';
          step.timestamp = Date.now();
          changed = true;
        }
      }
      return changed;
    }

    return false;
  }

  /** Apply a parsed task row to the steps list. Returns true if steps changed. */
  private applyTaskRow(taskRow: {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }): boolean {
    const existingId = this.knownTasks.get(taskRow.content);
    if (existingId !== undefined) {
      // Update existing task step
      const step = this.steps.find(s => s.id === existingId);
      if (step) {
        const newStatus: AgentThinkingStep['status'] =
          taskRow.status === 'completed'
            ? 'completed'
            : taskRow.status === 'in_progress'
            ? 'running'
            : 'pending';
        if (newStatus !== step.status) {
          step.status = newStatus;
          step.timestamp = Date.now();
          return true;
        }
      }
      return false;
    }
    // New task
    const stepStatus: AgentThinkingStep['status'] =
      taskRow.status === 'completed'
        ? 'completed'
        : taskRow.status === 'in_progress'
        ? 'running'
        : 'pending';
    const sid = this.nextId++;
    this.knownTasks.set(taskRow.content, sid);
    this.steps.push({
      id: sid,
      label: taskRow.content,
      status: stepStatus,
      phase: 'planning',
      timestamp: Date.now(),
    });
    return true;
  }
}

/**
 * Runs a question against the AKS agent pod by exec-ing directly into it
 * via the Kubernetes exec API (WebSocket) through Headlamp's proxy.
 * Returns only the final AI answer (clean, no ANSI codes, bullets normalised).
 *
 * The underlying exec WebSocket session is **reused** across questions to the
 * same cluster/pod so that subsequent questions skip the connection setup
 * overhead.  Call `destroyAgentSession()` to tear down the cached session
 * (e.g. on cluster change or chat-history clear).
 *
 * @param onProgress — optional callback invoked with an updated array of
 *   thinking steps every time a new step is detected in the agent stream.
 */
export async function runAksAgent(
  question: string,
  podInfo: AksAgentPodInfo,
  clusterName: string,
  onProgress?: AgentProgressCallback,
  conversationHistory: ConversationEntry[] = []
): Promise<string> {
  console.log(
    `[AKS Agent] Exec into pod ${podInfo.podName} in namespace ${podInfo.namespace}, cluster ${clusterName}`
  );

  // Build the enriched prompt with base instructions + conversation history
  const enrichedPrompt = buildEnrichedPrompt(question, conversationHistory);

  // Get or create a persistent session for this cluster+pod
  const session = getOrCreateSession(clusterName, podInfo);
  const result = await session.ask(enrichedPrompt, onProgress);

  if (result && result.trim().length > 0) {
    const answer = extractAIAnswer(result);
    console.log(`[AKS Agent] Exec succeeded, extracted answer length: ${answer.length}`);
    if (answer) {
      return answer;
    }
    // extractAIAnswer stripped everything — the agent ran but produced no
    // user-visible answer.  Return a generic message instead of raw noise.
    console.warn('[AKS Agent] extractAIAnswer returned empty — agent output had no AI answer.');
    return 'The agent processed the request but did not produce a final answer. Please try again.';
  }

  throw new Error('No response received from AKS agent pod.');
}

// ─── Persistent Agent Session ────────────────────────────────────────────────

/** Idle timeout: resets every time data arrives.  Only fires on silence. */
const IDLE_TIMEOUT_MS = 120_000; // 2 min
/** Hard wall-clock cap per question so a stuck stream cannot run forever. */
const MAX_WALL_TIMEOUT_MS = 600_000; // 10 min

/** Module-level cached session. */
let activeSession: AgentSession | null = null;

/**
 * Destroy the cached agent exec session.
 * Call this when the user changes cluster or clears chat history so that
 * the next question opens a fresh connection.
 */
export function destroyAgentSession(): void {
  if (activeSession) {
    console.log('[AKS Agent] Destroying cached agent session');
    activeSession.destroy();
    activeSession = null;
  }
}

/**
 * Return an existing session if it matches the requested cluster+pod and is
 * still alive, otherwise create a fresh one.
 */
function getOrCreateSession(clusterName: string, podInfo: AksAgentPodInfo): AgentSession {
  if (
    activeSession &&
    activeSession.isAlive &&
    activeSession.clusterName === clusterName &&
    activeSession.podName === podInfo.podName
  ) {
    console.log('[AKS Agent] Reusing existing exec session');
    return activeSession;
  }

  // Tear down stale session if any
  destroyAgentSession();

  console.log('[AKS Agent] Creating new exec session');
  const session = new AgentSession(clusterName, podInfo);
  session.connect();
  activeSession = session;
  return session;
}

/**
 * Manages a persistent WebSocket exec session to an AKS agent pod.
 *
 * The session opens an interactive bash shell on the pod via the Kubernetes
 * exec API.  Each call to `ask()` sends a `python /app/aks-agent.py ask …
 * --no-interactive` command over stdin and collects the answer.  Between
 * questions the bash shell (and the WebSocket) remain open so the next
 * question avoids the connection-setup overhead.
 */
class AgentSession {
  readonly clusterName: string;
  readonly podName: string;
  private podInfo: AksAgentPodInfo;
  private streamHandle: any = null;
  private _alive = false;
  /** True once the initial bash prompt has been received. */
  private bashReady = false;
  /** True once `stty -echo` has been confirmed active. */
  private echoDisabled = false;
  /** True while `stty -echo` has been sent but not yet confirmed. */
  private sttyInFlight = false;

  // ── Per-question state ──────────────────────────────────────────────────
  private output = '';
  private errorOutput = '';
  private questionResolved = false;
  private commandSent = false;
  private pendingCommand: string | null = null;
  private pendingResolve: ((value: string) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private wallTimer: ReturnType<typeof setTimeout> | null = null;
  private tracker: ThinkingStepTracker | null = null;
  private onProgress: AgentProgressCallback | null = null;

  constructor(clusterName: string, podInfo: AksAgentPodInfo) {
    this.clusterName = clusterName;
    this.podName = podInfo.podName;
    this.podInfo = podInfo;
  }

  get isAlive(): boolean {
    return this._alive;
  }

  // ── Connection setup ────────────────────────────────────────────────────

  /** Open the exec WebSocket to the pod's bash shell. */
  connect(): void {
    const { namespace, podName, containerName } = this.podInfo;
    const command = ['bash'];
    const commandStr = command.map(c => '&command=' + encodeURIComponent(c)).join('');
    const url = `/api/v1/namespaces/${namespace}/pods/${podName}/exec?container=${encodeURIComponent(
      containerName
    )}${commandStr}&stdin=1&stderr=1&stdout=1&tty=1`;

    console.log(`[AKS Agent] Session exec URL: ${url}`);

    const additionalProtocols = [
      'v4.channel.k8s.io',
      'v3.channel.k8s.io',
      'v2.channel.k8s.io',
      'channel.k8s.io',
    ];

    this._alive = true;

    this.streamHandle = stream(url, (data: ArrayBuffer | string) => this.handleData(data), {
      isJson: false,
      additionalProtocols,
      cluster: this.clusterName,
      reconnectOnFailure: false,
      failCb: () => this.handleConnectionFailure(),
    });
  }

  // ── Question lifecycle ──────────────────────────────────────────────────

  /**
   * Send a question to the agent and return the raw output.
   * Only one question can be in-flight at a time.
   */
  ask(question: string, onProgress?: AgentProgressCallback): Promise<string> {
    if (!this._alive) {
      return Promise.reject(new Error('Agent session is not alive'));
    }
    if (this.pendingResolve) {
      return Promise.reject(new Error('A question is already in progress'));
    }

    return new Promise<string>((resolve, reject) => {
      // Reset per-question state
      this.output = '';
      this.errorOutput = '';
      this.questionResolved = false;
      this.commandSent = false;
      this.pendingCommand = null;
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.tracker = onProgress ? new ThinkingStepTracker() : null;
      this.onProgress = onProgress ?? null;

      const escapedQuestion = shellEscapeSingleQuote(question);
      const pythonCommand = `python /app/aks-agent.py ask ${escapedQuestion} --no-interactive`;

      if (this.bashReady) {
        // Bash is already at its prompt — send immediately
        this.sendStdin(pythonCommand + '\n');
        this.commandSent = true;
        console.log('[AKS Agent] Sent command on existing session');
      } else {
        // First question — wait for initial bash prompt to trigger sending
        this.pendingCommand = pythonCommand;
        console.log('[AKS Agent] Waiting for bash prompt before sending command');
      }

      this.startIdleTimer();
      this.startWallTimer();
    });
  }

  /** Tear down the session and close the WebSocket. */
  destroy(): void {
    this._alive = false;
    this.clearTimers();

    // Reject any in-flight question
    if (this.pendingReject && !this.questionResolved) {
      this.questionResolved = true;
      this.pendingReject(new Error('Agent session destroyed'));
    }
    this.pendingResolve = null;
    this.pendingReject = null;

    if (this.streamHandle) {
      try {
        this.streamHandle.cancel();
      } catch {
        /* ignore */
      }
      this.streamHandle = null;
    }
  }

  // ── Data handling ───────────────────────────────────────────────────────

  private handleData(data: ArrayBuffer | string): void {
    if (!this._alive) return;

    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      const channel = bytes[0];
      const text = new TextDecoder().decode(bytes.slice(1));

      this.handleChannel(channel, text);
    } else {
      // Plain string data (base64 protocol)
      console.log('[AKS Agent] string data from exec:', data);
      this.output += data;
    }
  }

  private handleChannel(channel: number, text: string): void {
    if (channel === 1) {
      this.handleStdout(text);
    } else if (channel === 2) {
      this.handleStderr(text);
    } else if (channel === 3) {
      this.handleStatusChannel();
    }
  }

  private handleStdout(text: string): void {
    // ── Phase 0: Disable terminal echo on very first stdout ──
    // Sending `stty -echo` prevents the TTY from echoing multi-line commands
    // back through stdout, which would otherwise pollute the output with the
    // full conversation history embedded in the prompt.
    if (!this.echoDisabled) {
      if (!this.sttyInFlight) {
        // First stdout ever (initial bash prompt) — send stty -echo
        this.sendStdin('stty -echo\n');
        this.sttyInFlight = true;
        console.log('[AKS Agent] Sent stty -echo to disable terminal echo');
        return;
      }
      // Waiting for stty to complete — look for the bash prompt
      const plainStty = stripAnsi(text);
      if (/root@[^:]+:[^#]*#\s*$/.test(plainStty.trim())) {
        this.echoDisabled = true;
        this.bashReady = true;
        console.log('[AKS Agent] Terminal echo disabled, bash ready');
        // If ask() has already queued a command, send it now
        if (!this.commandSent && this.pendingCommand) {
          this.sendStdin(this.pendingCommand + '\n');
          this.commandSent = true;
          this.pendingCommand = null;
          console.log('[AKS Agent] Sent initial command after echo disabled');
        }
      }
      return; // Don't add stty-related output to command output
    }

    // ── First-time initialisation (fallback): send the stored command when bash is ready
    if (!this.bashReady && !this.commandSent && this.pendingCommand) {
      const socket = this.getSocket();
      if (socket && socket.readyState === WebSocket.OPEN) {
        this.sendStdin(this.pendingCommand + '\n');
        this.commandSent = true;
        this.bashReady = true;
        this.pendingCommand = null;
        console.log('[AKS Agent] Sent initial command after bash prompt');
      }
    }

    // If no question in flight, ignore (e.g. stray bash output between questions)
    if (this.questionResolved || !this.pendingResolve) return;

    this.resetIdleTimer();
    console.log('[AKS Agent] stdout chunk from exec:', text);

    // Ensure each terminal line chunk is newline-terminated.
    this.output += text.endsWith('\n') ? text : text + '\n';

    // Feed each line to the thinking-step tracker for live progress
    if (this.tracker && this.onProgress) {
      const chunkLines = stripAnsi(text).split('\n');
      let anyChanged = false;
      for (const cl of chunkLines) {
        if (this.tracker.processLine(cl)) anyChanged = true;
      }
      if (anyChanged) {
        this.onProgress([...this.tracker.steps]);
      }
    }

    // Detect the returning bash prompt — the command has finished.
    // Only close once we've already seen "AI:" in the output.
    const plainText = stripAnsi(text);
    if (
      this.commandSent &&
      this.output.includes('AI:') &&
      /root@[^:]+:[^#]*#\s*$/.test(plainText.trim())
    ) {
      console.log('[AKS Agent] Bash prompt detected after AI answer — question complete.');
      this.resolveCurrentQuestion(this.output);
    }
  }

  private handleStderr(text: string): void {
    if (this.questionResolved || !this.pendingResolve) return;
    this.resetIdleTimer();
    this.errorOutput += text;
    console.warn(`[AKS Agent] exec stderr: ${text}`);
  }

  private handleStatusChannel(): void {
    // Status channel — the exec process exited (bash terminated).
    // The session is no longer usable.
    console.log(
      `[AKS Agent] Exec completed via status channel. stdout length: ${this.output.length}, stderr length: ${this.errorOutput.length}`
    );
    this._alive = false;

    if (!this.questionResolved && this.pendingResolve) {
      this.resolveCurrentQuestion(this.output || this.errorOutput);
    }
  }

  private handleConnectionFailure(): void {
    this._alive = false;
    this.clearTimers();
    console.warn(
      `[AKS Agent] WebSocket closed. stdout: ${this.output.length}, stderr: ${this.errorOutput.length}`
    );

    if (!this.questionResolved && this.pendingResolve) {
      if (this.output.trim()) {
        this.resolveCurrentQuestion(this.output);
      } else if (this.errorOutput.trim()) {
        this.questionResolved = true;
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject?.(new Error(`AKS agent error: ${this.errorOutput.trim()}`));
      } else {
        this.questionResolved = true;
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject?.(new Error('WebSocket connection to agent pod failed'));
      }
    }

    // Invalidate so next call creates a fresh session
    if (activeSession === this) {
      activeSession = null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Resolve the in-flight question Promise and reset per-question state. */
  private resolveCurrentQuestion(result: string): void {
    this.clearTimers();
    this.questionResolved = true;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.tracker = null;
    this.onProgress = null;
    resolve?.(result);
  }

  /** Send text to stdin of the exec session. */
  private sendStdin(text: string): void {
    const socket = this.getSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('[AKS Agent] Cannot send stdin — socket not open');
      return;
    }
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    const buffer = new Uint8Array([0, ...encoded]); // 0 = stdin channel
    socket.send(buffer);
  }

  private getSocket(): WebSocket | null {
    try {
      return this.streamHandle?.getSocket?.() ?? null;
    } catch {
      return null;
    }
  }

  // ── Timers ──────────────────────────────────────────────────────────────

  private startIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (!this.questionResolved && this.pendingResolve) {
        if (this.output.trim()) {
          console.log('[AKS Agent] Idle timeout — returning partial output');
          this.resolveCurrentQuestion(this.output);
        } else {
          this.questionResolved = true;
          const reject = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          reject?.(new Error(`Exec timed out after ${IDLE_TIMEOUT_MS / 1000}s of inactivity`));
        }
      }
    }, IDLE_TIMEOUT_MS);
  }

  private resetIdleTimer(): void {
    this.startIdleTimer();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private startWallTimer(): void {
    this.clearWallTimer();
    this.wallTimer = setTimeout(() => {
      if (!this.questionResolved && this.pendingResolve) {
        this.clearIdleTimer();
        if (this.output.trim()) {
          console.log('[AKS Agent] Wall-clock timeout — returning partial output');
          this.resolveCurrentQuestion(this.output);
        } else {
          this.questionResolved = true;
          const reject = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          reject?.(new Error(`Exec timed out after ${MAX_WALL_TIMEOUT_MS / 1000}s total`));
        }
      }
    }, MAX_WALL_TIMEOUT_MS);
  }

  private clearWallTimer(): void {
    if (this.wallTimer) {
      clearTimeout(this.wallTimer);
      this.wallTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearIdleTimer();
    this.clearWallTimer();
  }
}

// Exported for testing — these are internal parsing helpers that
// need thorough test coverage for correctness.
export const _testing = {
  stripAnsi,
  normalizeBullets,
  looksLikeYaml,
  wrapBareYamlBlocks,
  cleanTerminalFormatting,
  stripAgentNoise,
  isAgentNoiseLine,
  extractAIAnswer,
  ThinkingStepTracker,
  extractTaskRow,
  friendlyToolLabel,
  stripCommandEcho,
};
