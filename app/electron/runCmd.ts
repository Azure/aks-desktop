/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Portions (c) Microsoft Corp.

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { BrowserWindow, dialog } from 'electron';
import { IpcMainEvent } from 'electron/main';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'path';
import i18n from './i18next.config';
import { defaultPluginsDir, defaultUserPluginsDir } from './plugin-management';
import { loadSettings, saveSettings, SETTINGS_PATH } from './settings';

/**
 * Active AKS Hybrid & Edge proxy children (`az connectedk8s proxy`), owned by
 * the app layer and keyed by cluster name. The main process is the single
 * source of truth for proxy lifecycle: start is idempotent per cluster, stop
 * kills by cluster, and all are killed on app quit — so a proxy (and the
 * `arcProxy` daemon it spawns on 127.0.0.1:47011) never orphans to launchd and
 * keeps serving the cluster after the app closes.
 *
 * `group` is true when the child was spawned detached (its own process group),
 * so it can be group-killed to also stop that grandchild daemon.
 */
const proxiesByCluster = new Map<
  string,
  { child: ChildProcessWithoutNullStreams; group: boolean }
>();

/**
 * Clusters whose proxy start is in-flight but not yet tracked in
 * `proxiesByCluster` (the child isn't registered until after `spawn`, and the
 * start path is async). Reserved synchronously so back-to-back start IPC events
 * can't both pass the idempotency guard and launch duplicate proxies.
 */
const startingProxies = new Set<string>();

/**
 * Clusters for which a Stop arrived while their proxy start was still in-flight
 * (present in `startingProxies` but not yet tracked). The proxy is torn down the
 * moment it becomes tracked after spawn, so an in-flight start can't outlive a
 * Stop request.
 */
const stopRequestedProxies = new Set<string>();

/** Whether a proxy is already running for the given cluster. */
export function hasProxyForCluster(cluster: string): boolean {
  return proxiesByCluster.has(cluster);
}

/**
 * Sends `signal` to a tracked proxy. Detached children are signalled as a whole
 * process group (negative pid) so the daemon they launched (arcProxy) is
 * included; others are signalled directly. Best-effort and synchronous.
 */
function signalChildEntry(
  { child, group }: { child: ChildProcessWithoutNullStreams; group: boolean },
  signal: NodeJS.Signals
): void {
  const pid = child.pid;
  if (!pid) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      // Windows has no POSIX process groups, so `process.kill(-pid)` fails with
      // EINVAL and can't reach the daemon (arcProxy) the CLI spawned. Kill the
      // whole child tree with taskkill (/T = tree, /F = force). Windows has no
      // reliable graceful console signal, so both SIGTERM and SIGKILL map to a
      // forced tree kill here.
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
      // taskkill exits non-zero if the tree is already gone; ignore spawn errors
      // so a best-effort teardown never throws.
      killer.on('error', () => {});
    } else if (group) {
      process.kill(-pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (err) {
    // ESRCH = process/group already exited, which is the expected outcome for a
    // teardown — ignore it. Anything else (EPERM, EINVAL) means the kill
    // genuinely failed and a proxy may be orphaned, so surface it.
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
      console.error(`[AKS][main] failed to ${signal} proxy pid ${pid}:`, err);
    }
  }
}

/**
 * Stops the proxy for a specific cluster, if any.
 *
 * Targets the whole tree — `az connectedk8s proxy` + the `arcProxy` daemon it
 * spawns — because arcProxy is what actually serves the cluster on
 * 127.0.0.1:47011, so signalling only the CLI leaves the cluster reachable and
 * Stop appears to do nothing.
 *
 * Cross-platform behaviour differs (see {@link signalChildEntry}):
 *  - **POSIX**: a graceful `SIGTERM` to the process group so arcProxy closes its
 *    listener and releases the port cleanly, with a `SIGKILL` fallback a few
 *    seconds later only if something ignored the SIGTERM. (An abrupt SIGKILL
 *    leaves arcProxy in a bad state and a subsequent Start can't reconnect.)
 *  - **Windows**: no process-group signalling and no reliable graceful console
 *    signal, so both calls force-kill the tree with `taskkill /T /F`; the port
 *    is released on process exit rather than a graceful listener close.
 */
export function stopProxyForCluster(cluster: string): void {
  const entry = proxiesByCluster.get(cluster);
  if (!entry) {
    return;
  }
  // Intentionally keep the entry tracked until the child actually exits (the
  // `untrack()` handler removes it on exit). Removing it here would make
  // hasProxyForCluster() false while the process is still shutting down, letting
  // a quick Start spawn a second proxy and fight over the port/arcProxy daemon.

  // POSIX: graceful group stop (CLI + arcProxy). Windows: forced taskkill tree
  // stop — see signalChildEntry for the platform split.
  signalChildEntry(entry, 'SIGTERM');

  // Force-kill fallback a few seconds later, only if the child hasn't already
  // exited — avoids ESRCH noise and, more importantly, signalling a reused PID.
  // The timer is cancelled when the child exits (the common case after SIGTERM).
  const killTimer = setTimeout(() => {
    if (entry.child.exitCode === null && entry.child.signalCode === null) {
      signalChildEntry(entry, 'SIGKILL');
    }
  }, 4000);
  entry.child.once('exit', () => clearTimeout(killTimer));
}

/**
 * Kills every tracked proxy. Intended to run from the app's `before-quit`
 * handler so proxies don't survive the app.
 */
export function killAllProxies(): void {
  for (const entry of proxiesByCluster.values()) {
    // On quit, force-kill for a guaranteed teardown (no time to wait on a
    // graceful shutdown as the app is exiting).
    signalChildEntry(entry, 'SIGKILL');
  }
  proxiesByCluster.clear();
}

/**
 * Data sent from the renderer process when a 'run-command' event is emitted.
 */
interface CommandData {
  /** The unique ID of the command. */
  id: string;
  /** The command to run. */
  command: string;
  /** The arguments to pass to the command. */
  args: string[];
  /**
   * Options to pass to the command.
   * See https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options
   */
  options: {};
  /** The permission secrets for the command. */
  permissionSecrets: Record<string, number>;
}

/**
 * Ask the user with an electron dialog if they want to allow the command
 * to be executed.
 * @param command - The command to show in the dialog.
 * @param mainWindow - The main window to show the dialog on.
 *
 * @returns true if the user allows the command to be executed, false otherwise.
 */
function confirmCommandDialog(command: string, mainWindow: BrowserWindow): boolean {
  if (mainWindow === null) {
    return false;
  }
  const resp = dialog.showMessageBoxSync(mainWindow, {
    title: i18n.t('Consent to command being run'),
    message: i18n.t('Allow this local command to be executed? Your choice will be saved.'),
    detail: command,
    type: 'question',
    buttons: [i18n.t('Allow'), i18n.t('Deny')],
  });

  return resp === 0;
}

/**
 * Checks if the user has already consented to running the command.
 *
 * If the user has not consented, a dialog is shown to ask for consent.
 *
 * @param command - The command to check.
 * @param args - The arguments to the command.
 * @returns true if the user has consented to running the command, false otherwise.
 */
function checkCommandConsent(command: string, args: string[], mainWindow: BrowserWindow): boolean {
  const settings = loadSettings(SETTINGS_PATH);
  const confirmedCommands = settings?.confirmedCommands;

  // Build the consent key: command + (first arg if present)
  let consentKey = command;
  if (args && args.length > 0) {
    consentKey += ' ' + args[0];
  }

  const savedCommand: boolean | undefined = confirmedCommands
    ? confirmedCommands[consentKey]
    : undefined;

  if (savedCommand === false) {
    console.error(`Invalid command: ${consentKey}, command not allowed by users choice`);
    return false;
  } else if (savedCommand === undefined) {
    const commandChoice = confirmCommandDialog(consentKey, mainWindow);
    if (settings?.confirmedCommands === undefined) {
      settings.confirmedCommands = {};
    }
    settings.confirmedCommands[consentKey] = commandChoice;
    saveSettings(SETTINGS_PATH, settings);
  }
  return true;
}

const COMMANDS_WITH_CONSENT = {
  headlamp_minikube: [
    'minikube start',
    'minikube stop',
    'minikube delete',
    'minikube status',
    'minikube service',
    'minikube logs',
    'minikube addons',
    'minikube ssh',
    'scriptjs headlamp_minikubeprerelease/manage-minikube.js',
    'scriptjs headlamp_minikube/manage-minikube.js',
    'scriptjs minikube/manage-minikube.js',
  ],
  aks_desktop: [
    'az',
    'az --version',
    'az version',
    'az login',
    'az logout',
    'az config',
    'az aks',
    'az connectedk8s',
    'az aksarc',
    'az extension',
    'az feature',
    'az provider',
    'az account',
    'az role',
    'az graph',
    'az acr',
    'az group',
    'az vm',
    'az login',
    'az alerts-management',
    'az monitor',
    'kubectl top',
    'kubectl config',
  ],
  headlamp_ai_assistant: ['gh auth', 'az account', 'az cognitiveservices'],
  ai_assistant: ['gh auth', 'az account', 'az cognitiveservices'],
};

/**
 * Adds the runCmd consent for the plugin.
 *
 * This is used to give consent to the plugin to run commands when the plugin is installed.
 * So the user is not presented with many consent requests.
 *
 * @param pluginInfo artifacthub plugin info
 */
export function addRunCmdConsent(pluginInfo: { name: string }): void {
  const settings = loadSettings(SETTINGS_PATH);
  if (!settings.confirmedCommands) {
    settings.confirmedCommands = {};
  }
  let commands: string[] = [];
  const pluginIsMinikube =
    pluginInfo.name === 'headlamp_minikube' ||
    pluginInfo.name === 'headlamp_minikubeprerelease' ||
    (process.env.NODE_ENV === 'development' && pluginInfo.name === 'minikube');

  if (pluginIsMinikube) {
    commands = COMMANDS_WITH_CONSENT.headlamp_minikube;
  }

  const pluginIsHeadlampAiAssistant =
    pluginInfo.name === 'headlamp_ai-assistant' ||
    pluginInfo.name === 'headlamp_ai-assistantprerelease' ||
    (process.env.NODE_ENV === 'development' && pluginInfo.name === 'ai-assistant');
  if (pluginIsHeadlampAiAssistant) {
    commands = COMMANDS_WITH_CONSENT.headlamp_ai_assistant;
  }

  const pluginIsAksDesktop = pluginInfo.name === 'aks-desktop';
  if (pluginIsAksDesktop) {
    commands = COMMANDS_WITH_CONSENT.aks_desktop;
  }

  const pluginIsAiAssistant = pluginInfo.name === 'ai-assistant';
  if (pluginIsAiAssistant) {
    commands = COMMANDS_WITH_CONSENT.ai_assistant;
  }

  for (const command of commands) {
    if (!settings.confirmedCommands[command]) {
      settings.confirmedCommands[command] = true;
    }
  }

  saveSettings(SETTINGS_PATH, settings);
}

/**
 * Adds the runCmd consent for the plugin.
 *
 * @param pluginName The package.json name of the plugin.
 */
export function removeRunCmdConsent(pluginName: string): void {
  const settings = loadSettings(SETTINGS_PATH);
  if (!settings.confirmedCommands) {
    return;
  }
  let commands: string[] = [];
  if (
    pluginName === '@headlamp-k8s/minikubeprerelease' ||
    pluginName === '@headlamp-k8s/minikube'
  ) {
    commands = COMMANDS_WITH_CONSENT.headlamp_minikube;
  }
  if (pluginName === 'ai-assistant') {
    commands = COMMANDS_WITH_CONSENT.ai_assistant;
  }
  if (
    pluginName === '@headlamp-k8s/ai-assistant' ||
    pluginName === '@headlamp-k8s/ai-assistantprerelease'
  ) {
    commands = COMMANDS_WITH_CONSENT.headlamp_ai_assistant;
  }
  for (const command of commands) {
    delete settings.confirmedCommands[command];
  }

  saveSettings(SETTINGS_PATH, settings);
}

/**
 * Check if the command has the correct permission secret.
 * If the command is 'scriptjs', it checks for a specific script path.
 *
 * @returns [permissionsValid, permissionError]
 */
export function checkPermissionSecret(
  commandData: CommandData,
  permissionSecrets: Record<string, number>
): [boolean, string] {
  let permissionName = 'runCmd-' + commandData.command;
  if (commandData.command === 'scriptjs') {
    const pluginPathNormalized = commandData.args[0]?.replace(/plugins[\\/]/, 'plugins/');
    permissionName = 'runCmd-' + commandData.command + '-' + pluginPathNormalized;
  }
  if (
    permissionSecrets[permissionName] === undefined ||
    permissionSecrets[permissionName] !== commandData.permissionSecrets[permissionName]
  ) {
    return [false, `No permission secret found for command: ${permissionName}, cannot run command`];
  }
  return [true, ''];
}

/**
 * Returns the path to a script in the plugins directory.
 * @param scriptName script relative to plugins folder. "headlamp-k8s-minikube/bin/manage-minikube.js"
 */
function getPluginsScriptPath(scriptName: string) {
  const userPlugins = defaultUserPluginsDir();
  if (fs.existsSync(path.join(userPlugins, scriptName))) {
    return path.join(userPlugins, scriptName);
  }

  const devPlugins = defaultPluginsDir();
  if (fs.existsSync(path.join(devPlugins, scriptName))) {
    return path.join(devPlugins, scriptName);
  }

  const shippedPlugins = path.join(process.resourcesPath, '.plugins');
  if (fs.existsSync(path.join(shippedPlugins, scriptName))) {
    return path.join(shippedPlugins, scriptName);
  }

  return path.join(devPlugins, scriptName);
}

/**
 * Execute a command with shell environment support.
 * This is a reusable utility that can be used by other modules.
 *
 * @param command - The command to execute
 * @param args - Command arguments
 * @param options - Additional spawn options (optional)
 * @returns Promise with stdout, stderr, and exit code
 */
export async function executeCommandWithShellEnv(
  command: string,
  args: string[],
  options: Record<string, any> = {}
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise(async (resolve, reject) => {
    try {
      // Get the shell environment including PATH
      const { getShellEnvironment } = await import('./main');
      const shellEnv = await getShellEnvironment();

      // On Windows, use shell
      const useShell = process.platform === 'win32';

      const child = spawn(command, args, {
        ...options,
        shell: useShell,
        env: {
          ...shellEnv,
          ...options.env,
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('exit', (code: number | null) => {
        resolve({ stdout, stderr, code });
      });

      child.on('error', (error: Error) => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Handles 'run-command' events from the renderer process.
 *
 * Spawns the requested command and sends 'command-stdout',
 * 'command-stderr', and 'command-exit' events back to the renderer
 * process with the command's output and exit code.
 *
 * @param event - The event object.
 * @param eventData - The data sent from the renderer process.
 * @param mainWindow - The main browser window.
 * @param permissionSecrets - The permission secrets required for the command to run.
 *                            Checks against eventData.permissionSecrets.
 */
export async function handleRunCommand(
  event: IpcMainEvent,
  eventData: CommandDataPartial,
  mainWindow: BrowserWindow | null,
  permissionSecrets: Record<string, number>
): Promise<void> {
  if (mainWindow === null) {
    console.error('Main window is null, cannot run command');
    return;
  }
  const [isValid, errorMessage] = validateCommandData(eventData);
  if (!isValid) {
    console.error(errorMessage);
    if (eventData.id) {
      event.sender.send('command-exit', eventData.id, -1);
    }
    return;
  }
  const commandData = eventData as CommandData;

  const [permissionsValid, permissionError] = checkPermissionSecret(commandData, permissionSecrets);
  if (!permissionsValid) {
    console.error(permissionError);
    event.sender.send('command-exit', commandData.id, -2);
    return;
  }
  if (!checkCommandConsent(commandData.command, commandData.args, mainWindow)) {
    event.sender.send('command-exit', commandData.id, -3);
    return;
  }

  // Get the command and args to run. With the correct paths for "scriptjs" commands.
  // scriptjs commands are scripts run with the compiled app, or with "Electron" in dev mode.
  // On Windows, .js files need to be explicitly run with node
  let command = commandData.command;
  let args = commandData.args;

  if (commandData.command === 'scriptjs') {
    command = process.execPath;
    args = [getPluginsScriptPath(commandData.args[0]), ...commandData.args.slice(1)];
  }

  // If the command is 'scriptjs', we pass the HEADLAMP_RUN_SCRIPT=true
  // env var so that the Headlamp or Electron process runs the script.

  // Get the shell environment including PATH
  // This will initialize the shell environment on first call if needed
  const { getShellEnvironment } = await import('./main');
  const shellEnv = await getShellEnvironment();

  // On Windows, use shell
  // https://stackoverflow.com/questions/37459717/error-spawn-enoent-on-windows
  const useShell = process.platform === 'win32';
  if (useShell) {
    console.log('Using shell on Windows');
  }

  const child: ChildProcessWithoutNullStreams = spawn(command, args, {
    ...commandData.options,
    shell: useShell,
    env: {
      ...shellEnv,
      ...(commandData.command === 'scriptjs' ? { HEADLAMP_RUN_SCRIPT: 'true' } : {}),
    },
  });

  // When the caller tags the command with a `cluster` (the AKS Hybrid & Edge
  // proxy does, via handleStartProxy), track the child by cluster so the app
  // layer owns its lifecycle — stop-by-cluster and kill-on-quit. Such commands
  // are spawned `detached: true`, making the child a process-group leader we can
  // group-kill to also stop the daemon it launches (arcProxy).
  const proxyCluster = (commandData.options as { cluster?: string })?.cluster;
  const isDetached = !!(commandData.options as { detached?: boolean })?.detached;
  // Only lifecycle-manage the actual `az connectedk8s proxy` invocation. Guarding
  // on the command keeps an unrelated run-command that happens to set
  // options.cluster from being tracked (and later killed) as if it were a proxy.
  const isAksProxyCommand = command === 'az' && args[0] === 'connectedk8s' && args[1] === 'proxy';
  if (proxyCluster && isAksProxyCommand && !proxiesByCluster.has(proxyCluster)) {
    proxiesByCluster.set(proxyCluster, { child, group: isDetached });
    // A Stop that arrived while this proxy was still starting can now be honored,
    // now that the child exists and is tracked.
    if (stopRequestedProxies.delete(proxyCluster)) {
      stopProxyForCluster(proxyCluster);
    }
  }
  const untrack = () => {
    // Guard: only clear if this exact child is still the tracked one, so a late
    // exit from a replaced proxy can't evict a newer one.
    if (proxyCluster && proxiesByCluster.get(proxyCluster)?.child === child) {
      proxiesByCluster.delete(proxyCluster);
    }
  };

  child.stdout.on('data', (data: string | Buffer) => {
    event.sender.send('command-stdout', commandData.id, data.toString());
  });

  child.stderr.on('data', (data: string | Buffer) => {
    event.sender.send('command-stderr', commandData.id, data.toString());
  });

  child.on('error', (err: Error) => {
    untrack();
    event.sender.send('command-stderr', commandData.id, err.message);
    event.sender.send('command-exit', commandData.id, -1);
  });

  child.on('exit', (code: number | null) => {
    untrack();
    event.sender.send('command-exit', commandData.id, code);
  });
}

/**
 * Runs a script, using the compiled app, or Electron in dev mode.
 *
 * This is needed to run the "scriptjs" commands, as a way of running
 * node js scripts without requiring node to also be installed.
 */
export function runScript() {
  const baseDir = path.resolve(defaultPluginsDir());
  const userPluginsDir = path.resolve(defaultUserPluginsDir());
  const staticPluginsDir = path.resolve(path.join(process.resourcesPath, '.plugins'));
  const scriptPath = path.resolve(process.argv[1]);

  if (
    !scriptPath.startsWith(baseDir) &&
    !scriptPath.startsWith(userPluginsDir) &&
    !scriptPath.startsWith(staticPluginsDir)
  ) {
    console.error(
      `Invalid script path: ${scriptPath}. Must be within ${baseDir}, ${userPluginsDir}, or ${staticPluginsDir}.`
    );
    process.exit(1);
  }

  import(scriptPath);
}

/**
 * @returns a random number between 0 and 1, like Math.random(),
 * but using the web crypto API for better randomness.
 */
function cryptoRandom() {
  const array = new Uint32Array(1);
  crypto.webcrypto.getRandomValues(array);
  return array[0] / (0xffffffff + 1);
}

/**
 * Sets up the IPC handlers for running commands.
 * Called in the main process to handle 'run-command' events.
 *
 * @param mainWindow - The main browser window.
 * @param ipcMain - The IPC main instance.
 */
export function setupRunCmdHandlers(mainWindow: BrowserWindow | null, ipcMain: Electron.IpcMain) {
  if (mainWindow === null) {
    console.error('Main window is null, cannot set up run command handlers');
    return;
  }

  // We only send the plugin permission secrets once. So any code can't just request them again.
  // This means that if the secrets are requested before the plugins are loaded, then
  // they will not be sent until the next time the app is reloaded.
  let pluginPermissionSecretsSent = false;
  const permissionSecrets = {
    'runCmd-minikube': cryptoRandom(),
    'runCmd-scriptjs-minikube/manage-minikube.js': cryptoRandom(),
    'runCmd-scriptjs-headlamp_minikube/manage-minikube.js': cryptoRandom(),
    'runCmd-scriptjs-headlamp_minikubeprerelease/manage-minikube.js': cryptoRandom(),
    'runCmd-az': cryptoRandom(),
    'runCmd-kubectl': cryptoRandom(),
    'runCmd-gh': cryptoRandom(),
  };

  ipcMain.on('request-plugin-permission-secrets', function giveSecrets() {
    if (!pluginPermissionSecretsSent) {
      pluginPermissionSecretsSent = true;
      mainWindow?.webContents.send('plugin-permission-secrets', permissionSecrets);
    }
  });

  // Only allow sending secrets again when the Electron main window reloads (not just URL changes).
  mainWindow?.webContents.on('did-frame-finish-load', (event, isMainFrame) => {
    if (isMainFrame) {
      pluginPermissionSecretsSent = false;
    }
  });

  ipcMain.on(
    'run-command',
    async (event, eventData) =>
      await handleRunCommand(event, eventData, mainWindow, permissionSecrets)
  );

  // Starts the AKS Hybrid & Edge proxy for a cluster. App-layer owned and
  // idempotent: if a proxy is already running for the cluster this is a no-op,
  // so a duplicate Start never launches a second `az connectedk8s proxy` (which
  // would bounce the shared arcProxy daemon). Delegates to the run-command path
  // so the existing consent / permission-secret checks and child streaming
  // apply; the child is spawned detached and tracked by cluster.
  ipcMain.on('start-aks-hybrid-edge-proxy', async (event, eventData) => {
    const { cluster, subscriptionId, resourceGroup } = (eventData ?? {}) as {
      cluster?: string;
      subscriptionId?: string;
      resourceGroup?: string;
    };
    console.log(
      `[AKS][main] start-aks-hybrid-edge-proxy received: cluster=${cluster} ` +
        `alreadyRunning=${cluster ? hasProxyForCluster(cluster) : 'n/a'}`
    );
    if (
      !cluster ||
      !subscriptionId ||
      !resourceGroup ||
      hasProxyForCluster(cluster) ||
      startingProxies.has(cluster)
    ) {
      return;
    }
    // Reserve synchronously: the child isn't tracked in proxiesByCluster until
    // after spawn (inside the async handleRunCommand below), so without this a
    // second back-to-back event could pass the guard and launch a duplicate.
    startingProxies.add(cluster);
    // Drop any stale stop-request from a previous start so it can't tear down
    // this fresh one.
    stopRequestedProxies.delete(cluster);
    const commandData: CommandData = {
      id: `aks-hybrid-edge-proxy:${cluster}:${cryptoRandom()}`,
      command: 'az',
      args: [
        'connectedk8s',
        'proxy',
        '--subscription',
        subscriptionId,
        '--resource-group',
        resourceGroup,
        '--name',
        cluster,
      ],
      // `cluster` tags the child for cluster-keyed tracking; `detached` makes it
      // a process-group leader so it (and arcProxy) can be group-killed.
      options: { detached: true, cluster },
      permissionSecrets,
    };
    // Log only the cluster, not the full arg list — it carries the Azure
    // subscription id and resource group, which can be sensitive and may end up
    // in diagnostic bundles.
    console.log(`[AKS][main] spawning proxy for cluster=${cluster}`);
    try {
      await handleRunCommand(event, commandData, mainWindow, permissionSecrets);
    } finally {
      // Once spawned, proxiesByCluster owns the idempotency guard; drop the
      // in-flight reservation (also clears it if the start failed before spawn).
      startingProxies.delete(cluster);
    }
  });

  // Stops the AKS Hybrid & Edge proxy for a cluster: signals the tracked child
  // (and its arcProxy daemon); it stays tracked until it actually exits. Keyed by
  // cluster name, so it works even after a renderer reload (which has no memory
  // of the command id).
  ipcMain.on('stop-aks-hybrid-edge-proxy', (_event, eventData) => {
    const cluster = (eventData as { cluster?: unknown })?.cluster;
    console.log(
      `[AKS][main] stop-aks-hybrid-edge-proxy received: cluster=${String(cluster)} ` +
        `tracked=${typeof cluster === 'string' ? hasProxyForCluster(cluster) : 'n/a'}`
    );
    if (typeof cluster === 'string') {
      if (hasProxyForCluster(cluster)) {
        stopProxyForCluster(cluster);
      } else if (startingProxies.has(cluster)) {
        // Start is in-flight but not yet tracked; mark it so the proxy is torn
        // down the moment it's tracked after spawn, instead of coming up anyway.
        stopRequestedProxies.add(cluster);
      }
    }
  });
}

/**
 * Like CommandData, but everything is optional because it's not validated yet.
 */
type CommandDataPartial = Partial<CommandData>;

/**
 * Checks to see if it's what we expect.
 */
export function validateCommandData(eventData: CommandDataPartial): [boolean, string] {
  if (!eventData || typeof eventData !== 'object' || eventData === null) {
    return [false, `Invalid eventData data received: ${eventData}`];
  }
  if (typeof eventData.command !== 'string' || !eventData.command) {
    return [false, `Invalid eventData.command: ${eventData.command}`];
  }
  if (!Array.isArray(eventData.args)) {
    return [false, `Invalid eventData.args: ${eventData.args}`];
  }
  if (typeof eventData.options !== 'object' || eventData.options === null) {
    return [false, `Invalid eventData.options: ${eventData.options}`];
  }
  if (typeof eventData.permissionSecrets !== 'object' || eventData.permissionSecrets === null) {
    return [
      false,
      `Invalid permission secrets, it is not an object: ${typeof eventData.permissionSecrets}`,
    ];
  }
  for (const [key, value] of Object.entries(eventData.permissionSecrets)) {
    if (typeof value !== 'number') {
      return [false, `Invalid permission secret for ${key}: ${typeof value}`];
    }
  }

  // Added 'kubectl' for AKS desktop downstream integration (aks-desktop patch)
  const validCommands = [
    'minikube',
    'az',
    'kubectl',
    'scriptjs',
    'gh',
    'kubelogin',
    'gh',
    'register-aks-cluster.js',
  ];

  if (!validCommands.includes(eventData.command)) {
    return [
      false,
      `Invalid command: ${eventData.command}, only valid commands are: ${JSON.stringify(
        validCommands
      )}`,
    ];
  }

  return [true, ''];
}
