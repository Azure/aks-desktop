#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * CLI script for setting up an AKS BareMetal test environment.
 *
 * Uses the same setup/teardown logic as the AKS Desktop UI.
 *
 * Usage:
 *   npx tsx scripts/baremetal-env.ts setup        --subscription <id> --username <user> --password <pass> --group-name rg-yourname-testing [options]
 *   npx tsx scripts/baremetal-env.ts teardown     --subscription <id> --group-name rg-yourname-testing
 *   npx tsx scripts/baremetal-env.ts deployaksarc --subscription <id> --group-name rg-yourname-testing [options]
 *
 * Options:
 *   --subscription      Azure subscription ID (required)
 *   --location          Azure region (default: southcentralus) — must support microsoft.azstackhci.operator
 *   --username          VM admin username (required for setup)
 *   --password          VM admin password (required for setup)
 *   --group-name        Resource group name (default: jumpstart-rg)
 *   --vm-name           VM name (default: jumpstartVM)
 *   --vm-size           VM size (default: Standard_E16s_v5)
 *   --vnet-name         Virtual network name (default: jumpstartVNet)
 *   --subnet-name       Subnet name (default: jumpstartSubnet)
 *   --appliance-name    Appliance name (default: <vmName>-appliance)
 *   --custom-location   Custom location name (default: <applianceName>-cl)
 *   --lnet-name         Logical network name (default: <applianceName>-lnet)
 *   --aks-cluster       AKS Arc cluster name (default: <vmName>-aksarc)
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---- Defaults (mirrored from components/BareMetal/environment.ts) ----

const BAREMETAL_ENV_DEFAULTS = {
  groupName: 'jumpstart-rg',
  location: 'southcentralus',
  vmName: 'jumpstartVM',
  vmSize: 'Standard_E16s_v5',
  vnetName: 'jumpstartVNet',
  subnetName: 'jumpstartSubnet',
};

const REQUIRED_PROVIDERS = [
  'Microsoft.Kubernetes',
  'Microsoft.KubernetesConfiguration',
  'Microsoft.ExtendedLocation',
  'Microsoft.ResourceConnector',
  'Microsoft.AzureStackHCI',
  'Microsoft.HybridConnectivity',
  'Microsoft.HybridContainerService',
];

// ---- Helpers ----

/** CLI flags whose following value is sensitive and must not appear in logs. */
const SENSITIVE_FLAGS = new Set(['--admin-password', '--password']);

/**
 * Executes a command synchronously (without a shell) and returns its stdout.
 *
 * Logs the command before execution, redacting values that follow any flag
 * listed in {@link SENSITIVE_FLAGS}. Using an args array instead of a shell
 * string prevents shell injection and avoids shell-quoting pitfalls.
 *
 * @param args - The command and its arguments as an array, e.g.
 *   `['az', 'group', 'create', '--name', 'my-rg']`.
 * @returns The stdout output of the command.
 * @throws {Error} If the command exits with a non-zero status.
 */
function run(args: string[]): string {
  const [cmd, ...cmdArgs] = args;
  const redacted = cmdArgs.map((arg, i) =>
    i > 0 && SENSITIVE_FLAGS.has(cmdArgs[i - 1]) ? '***' : arg
  );
  console.log(`  $ ${cmd} ${redacted.join(' ')}`);

  const result = spawnSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `Command exited with status ${result.status}`);
  }
  return result.stdout || '';
}

/**
 * Parses CLI arguments into a key-value map.
 *
 * Expects `--key value` pairs. Flags without a following value
 * (or followed by another flag) are ignored.
 *
 * @param argv - The argument array (typically `process.argv.slice(2)`).
 * @returns A record mapping argument names (without `--` prefix) to their values.
 */
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[argv[i].replace(/^--/, '')] = argv[i + 1];
      i++;
    }
  }
  return args;
}

/**
 * Returns the value for a required CLI argument, or exits the process with
 * an error message if the argument is missing.
 *
 * @param args - The parsed argument map from {@link parseArgs}.
 * @param key - The argument name to look up (without `--` prefix).
 * @returns The argument value.
 */
function required(args: Record<string, string>, key: string): string {
  if (!args[key]) {
    console.error(`Error: --${key} is required.`);
    process.exit(1);
  }
  return args[key];
}

/** Returns true if Microsoft Remote Desktop is installed (Mac App Store or Homebrew). */
function isMicrosoftRdpInstalled(): boolean {
  return (
    fs.existsSync('/Applications/Microsoft Remote Desktop.app') ||
    fs.existsSync(`${os.homedir()}/Applications/Microsoft Remote Desktop.app`)
  );
}

// ---- aksArc jumpstart repo ----

const AKSARC_REPO_URL = 'https://github.com/Azure/aksArc.git';
const AKSARC_LOCAL_DIR = path.join(os.homedir(), '.aksarc-jumpstart');

/**
 * Clones or fast-forward updates the aksArc repo to `~/.aksarc-jumpstart/`.
 * Returns the path to the `aksarc_jumpstart/` subdirectory.
 */
function ensureJumpstartRepo(): string {
  const jumpstartDir = path.join(AKSARC_LOCAL_DIR, 'aksarc_jumpstart');
  if (fs.existsSync(path.join(AKSARC_LOCAL_DIR, '.git'))) {
    console.log('  Updating aksArc repo...');
    run(['git', '-C', AKSARC_LOCAL_DIR, 'fetch', '--depth=1', '--quiet']);
    run(['git', '-C', AKSARC_LOCAL_DIR, 'reset', '--hard', 'FETCH_HEAD']);
  } else {
    console.log('  Cloning aksArc repo...');
    if (fs.existsSync(AKSARC_LOCAL_DIR)) {
      fs.rmSync(AKSARC_LOCAL_DIR, { recursive: true, force: true });
    }
    run(['git', 'clone', '--depth=1', AKSARC_REPO_URL, AKSARC_LOCAL_DIR]);
  }
  const sha = run(['git', '-C', AKSARC_LOCAL_DIR, 'rev-parse', '--short', 'HEAD']).trim();
  console.log(`  ✓ Repo ready at ${jumpstartDir} (commit ${sha})`);
  return jumpstartDir;
}

// ---- Commands ----

/**
 * Provisions an AKS BareMetal test environment in Azure.
 *
 * Performs the following steps:
 * 1. Registers required Azure resource providers.
 * 2. Creates a resource group.
 * 3. Creates a Windows Server 2022 VM with nested virtualisation support.
 * 4. Assigns a managed identity with Contributor role to the VM.
 * 5. Clones the aksArc jumpstart repo and runs 5 upstream init scripts on the VM
 *    via ARM deployments: initializes the data disk, installs DNS/DHCP/Hyper-V
 *    (triggers a VM restart), configures the post-restart environment, installs
 *    Azure CLI, and sets up MOC (triggers a second restart).
 *
 * @param args - Parsed CLI arguments. Required: `subscription`, `username`,
 *   `password`. Optional: `location`, `group-name`, `vm-name`, `vm-size`,
 *   `vnet-name`, `subnet-name`.
 */
function setup(args: Record<string, string>) {
  const subscription = required(args, 'subscription');
  const location = args['location'] || BAREMETAL_ENV_DEFAULTS.location;
  const username = required(args, 'username');
  const password = required(args, 'password');
  const groupName = args['group-name'] || BAREMETAL_ENV_DEFAULTS.groupName;
  const vmName = args['vm-name'] || BAREMETAL_ENV_DEFAULTS.vmName;
  const vmSize = args['vm-size'] || BAREMETAL_ENV_DEFAULTS.vmSize;
  const vnetName = args['vnet-name'] || BAREMETAL_ENV_DEFAULTS.vnetName;
  const subnetName = args['subnet-name'] || BAREMETAL_ENV_DEFAULTS.subnetName;

  console.log('\n=== AKS BareMetal Test Environment Setup ===\n');

  // Step 1: Register providers
  console.log('Step 1/5: Registering resource providers...');
  for (const provider of REQUIRED_PROVIDERS) {
    console.log(`  Registering ${provider}...`);
    run(['az', 'provider', 'register', '--namespace', provider, '--wait', '--subscription', subscription]);
  }
  console.log('  ✓ All providers registered.\n');

  // Step 2: Create resource group
  console.log('Step 2/5: Creating resource group...');
  run(['az', 'group', 'create', '--name', groupName, '--location', location, '--subscription', subscription]);
  console.log(`  ✓ Resource group '${groupName}' created.\n`);

  // Step 3: Create VM
  console.log('Step 3/5: Creating VM...');
  run([
    'az', 'vm', 'create',
    '--resource-group', groupName,
    '--name', vmName,
    '--image', 'MicrosoftWindowsServer:WindowsServer:2022-datacenter-azure-edition:latest',
    '--size', vmSize,
    '--admin-username', username,
    '--admin-password', password,
    '--vnet-name', vnetName,
    '--subnet', subnetName,
    '--public-ip-sku', 'Standard',
    // The upstream initializedisk.ps1 script requires a raw data disk to
    // initialize. Without it, $env:WorkingDir is never set and deployappliance
    // fails with "The given path's format is not supported."
    '--data-disk-sizes-gb', '1024',
    '--storage-sku', '0=Premium_LRS',
    '--subscription', subscription,
    '--output', 'json',
  ]);

  let publicIp = '';
  try {
    publicIp = run([
      'az', 'vm', 'list-ip-addresses',
      '--resource-group', groupName,
      '--name', vmName,
      '--subscription', subscription,
      '--query', '[0].virtualMachine.network.publicIpAddresses[0].ipAddress',
      '-o', 'tsv',
    ]).trim();
  } catch {
    // non-fatal — IP will be shown as a lookup instruction
  }

  console.log(`  ✓ VM '${vmName}' created.\n`);

  // Step 4: Assign managed identity + Contributor role
  console.log('Step 4/5: Assigning managed identity...');
  run(['az', 'vm', 'identity', 'assign', '--resource-group', groupName, '--name', vmName, '--subscription', subscription]);

  const principalId = run([
    'az', 'vm', 'show',
    '--resource-group', groupName,
    '--name', vmName,
    '--query', 'identity.principalId',
    '-o', 'tsv',
    '--subscription', subscription,
  ]).trim();

  if (principalId) {
    run([
      'az', 'role', 'assignment', 'create',
      '--assignee-object-id', principalId,
      '--assignee-principal-type', 'ServicePrincipal',
      '--role', 'Contributor',
      '--scope', `/subscriptions/${subscription}/resourceGroups/${groupName}`,
    ]);
  }
  console.log('  ✓ Managed identity assigned with Contributor role.\n');

  // Step 5/5: Clone jumpstart repo and run the 5 upstream init scripts on the VM.
  // These scripts: initialise the data disk (sets WorkingDir), install DNS/DHCP/Hyper-V
  // (triggers a VM restart), configure the post-restart environment, install Azure CLI,
  // and set up MOC (triggers a second VM restart, after which MOC installs automatically).
  console.log('Step 5/5: Running VM initialisation scripts...');
  const jumpstartDir = ensureJumpstartRepo();
  console.log('');

  const templatePath = path.join(jumpstartDir, 'configuration', 'executescript-template.json');
  // Use the Git-derived raw URL from the cloned repo so script URLs match the checked-out commit.
  const clonedSha = run(['git', '-C', AKSARC_LOCAL_DIR, 'rev-parse', 'HEAD']).trim();
  const scriptBaseUrl = `https://raw.githubusercontent.com/Azure/aksArc/${clonedSha}/aksarc_jumpstart/scripts`;
  const initScripts = ['initializedisk.ps1', '0.ps1', '1.ps1', 'deployazcli.ps1', 'deploymoc.ps1'];

  for (const [i, scriptName] of initScripts.entries()) {
    const scriptStem = scriptName.replace(/\.ps1$/, '');
    const deploymentName = `executescript-${vmName}-${scriptStem}`;
    const scriptUri = `${scriptBaseUrl}/${scriptName}`;
    const commandToExecute = `powershell.exe -ExecutionPolicy Unrestricted -File ${scriptName}`;
    console.log(`  [${i + 1}/${initScripts.length}] ${scriptName}...`);
    try {
      run([
        'az', 'deployment', 'group', 'create',
        '--name', deploymentName,
        '--resource-group', groupName,
        '--template-file', templatePath,
        '--parameters',
        `location=${location}`,
        `vmName=${vmName}`,
        `scriptFileUri=${scriptUri}`,
        `commandToExecute=${commandToExecute}`,
        '--subscription', subscription,
      ]);
      console.log(`    ✓ done.`);
    } catch {
      // Scripts that restart the VM (0.ps1, deploymoc.ps1) are expected to fail here.
      console.log(`    ⚠ ended (may have triggered a VM restart — this is normal).`);
    }
  }
  console.log('  ✓ Init scripts complete. MOC will install automatically on next VM boot.\n');

  console.log('=== Setup Complete ===');
  console.log(`Resource group: ${groupName}`);
  console.log(`VM: ${vmName}`);
  if (publicIp) {
    console.log(`VM public IP: ${publicIp}`);
  }
  console.log('');
  console.log('Next step — RDP into the VM (macOS):');
  console.log('');
  if (publicIp) {
    console.log(`  VM address: ${publicIp}`);
  } else {
    const ipCmd = `az vm list-ip-addresses -g ${groupName} -n ${vmName} --subscription ${subscription} -o tsv --query '[0].virtualMachine.network.publicIpAddresses[0].ipAddress'`;
    console.log(`  Get VM IP:  ${ipCmd}`);
  }
  console.log(`  Username:   ${username}`);
  console.log('  Password:   (the --password you supplied)');
  console.log('');
  const rdpInstalled = isMicrosoftRdpInstalled();
  if (!rdpInstalled) {
    console.log('  Microsoft Remote Desktop is required on macOS:');
    console.log('    brew install --cask microsoft-remote-desktop');
    console.log('    or install from the Mac App Store (search "Microsoft Remote Desktop")');
    console.log('');
  }
  if (publicIp) {
    const rdpFile = path.join(os.tmpdir(), `${vmName}.rdp`);
    const rdpContent = [
      `full address:s:${publicIp}:3389`,
      `username:s:${username}`,
      'authentication level:i:2',
      'prompt for credentials:i:0',
    ].join('\n');
    fs.writeFileSync(rdpFile, rdpContent);
    console.log('  Opening Microsoft Remote Desktop...');
    spawnSync('open', [rdpFile], { stdio: 'inherit' });
  } else {
    console.log('  Open Microsoft Remote Desktop, add a new PC using the IP above, and connect.');
  }
  console.log('');
  console.log('  Once Server Manager appears the VM is ready. Disconnect from RDP.');
  console.log('  Then wait ~3-5 min for MOC to finish initializing in the background.');
  console.log('');
  console.log('After MOC is ready, run:');
  console.log(`  npm run deployAksArc -- --subscription ${subscription} --group-name ${groupName}`);
}

/**
 * Prints macOS RDP instructions for the jumpstart VM.
 *
 * Looks up the VM's public IP from Azure and prints ready-to-use connection
 * options for Microsoft Remote Desktop.
 *
 * @param args - Parsed CLI arguments. Required: `subscription`, `username`.
 *   Optional: `group-name`, `vm-name`.
 */
function rdp(args: Record<string, string>) {
  const subscription = required(args, 'subscription');
  const username = required(args, 'username');
  const groupName = args['group-name'] || BAREMETAL_ENV_DEFAULTS.groupName;
  const vmName = args['vm-name'] || BAREMETAL_ENV_DEFAULTS.vmName;

  console.log('\n=== RDP Instructions ===\n');

  let publicIp = '';
  try {
    publicIp = run([
      'az', 'vm', 'list-ip-addresses',
      '--resource-group', groupName,
      '--name', vmName,
      '--subscription', subscription,
      '--query', '[0].virtualMachine.network.publicIpAddresses[0].ipAddress',
      '-o', 'tsv',
    ]).trim();
  } catch {
    // fall through — print lookup command instead
  }

  if (publicIp) {
    console.log(`VM address: ${publicIp}`);
  } else {
    console.log(
      `VM address: run: az vm list-ip-addresses -g ${groupName} -n ${vmName} --subscription ${subscription} -o tsv --query '[0].virtualMachine.network.publicIpAddresses[0].ipAddress'`
    );
  }
  console.log(`Username:   ${username}`);
  console.log('Password:   (the --password you supplied at setup)');
  console.log('');

  const rdpInstalled = isMicrosoftRdpInstalled();
  if (!rdpInstalled) {
    console.log('Step 1 — Install Microsoft Remote Desktop (required on macOS):');
    console.log('  brew install --cask microsoft-remote-desktop');
    console.log('  or install from the Mac App Store (search "Microsoft Remote Desktop")');
    console.log('');
    console.log('Step 2 — Connect:');
  } else {
    console.log('Connect:');
  }
  if (publicIp) {
    const rdpFile = path.join(os.tmpdir(), `${vmName}.rdp`);
    const rdpContent = [
      `full address:s:${publicIp}:3389`,
      `username:s:${username}`,
      'authentication level:i:2',
      'prompt for credentials:i:0',
    ].join('\n');
    fs.writeFileSync(rdpFile, rdpContent);
    console.log(`  open "${rdpFile}"`);
    spawnSync('open', [rdpFile], { stdio: 'inherit' });
    console.log('');
    console.log(`  Microsoft Remote Desktop will open. Look for "${vmName}" in the PCs list`);
    console.log('  and double-click it to connect. Enter your password when prompted.');
  } else {
    console.log('  Open Microsoft Remote Desktop, add a new PC with the IP above, then connect.');
  }
  console.log('');
  console.log('Once Server Manager appears the VM is ready. Disconnect — no action needed.');
  console.log('MOC installs automatically in the background (~2-3 min after VM boots).');
  console.log('');
  console.log('After RDP, run:');
  console.log(`  npm run deployAksArc -- --subscription ${subscription} --group-name ${groupName}`);
}

/**
 * Tears down an AKS BareMetal test environment by deleting its resource group.
 *
 * The deletion runs asynchronously (`--no-wait`) so this function returns
 * quickly while Azure removes the resources in the background.
 *
 * @param args - Parsed CLI arguments. Required: `subscription`.
 *   Optional: `group-name` (defaults to `jumpstart-rg`).
 */
function teardown(args: Record<string, string>) {
  const subscription = required(args, 'subscription');
  const groupName = args['group-name'] || BAREMETAL_ENV_DEFAULTS.groupName;

  console.log('\n=== AKS BareMetal Test Environment Teardown ===\n');
  console.log(`Deleting resource group '${groupName}'...`);
  run(['az', 'group', 'delete', '--name', groupName, '--subscription', subscription, '--yes', '--no-wait']);
  console.log(`  ✓ Resource group '${groupName}' deletion initiated.`);
  console.log('  This may take several minutes to complete.\n');
}

/**
 * Deploys AKS Arc components by delegating to the upstream `deployaksarc.sh`
 * from the aksArc jumpstart repo (cloned to `~/.aksarc-jumpstart/`).
 *
 * @param args - Parsed CLI arguments. Required: `subscription`.
 *   Optional: `location`, `group-name`, `vm-name`, `vnet-name`, `subnet-name`,
 *   `appliance-name`, `custom-location`, `lnet-name`, `aks-cluster`.
 */
function deployAksArc(args: Record<string, string>) {
  const subscription = required(args, 'subscription');
  const location = args['location'] || BAREMETAL_ENV_DEFAULTS.location;
  const groupName = args['group-name'] || BAREMETAL_ENV_DEFAULTS.groupName;
  const vmName = args['vm-name'] || BAREMETAL_ENV_DEFAULTS.vmName;
  const vnetName = args['vnet-name'] || BAREMETAL_ENV_DEFAULTS.vnetName;
  const subnetName = args['subnet-name'] || BAREMETAL_ENV_DEFAULTS.subnetName;

  console.log('\n=== AKS Arc Deployment ===\n');
  console.log('Cloning/updating aksArc jumpstart repo...');
  const jumpstartDir = ensureJumpstartRepo();
  console.log('');

  const script = path.join(jumpstartDir, 'deployaksarc.sh');
  run(['chmod', '+x', script]);

  const scriptArgs = [
    script,
    '--subscription', subscription,
    '--location', location,
    '--group-name', groupName,
    '--vm-name', vmName,
    '--vnet-name', vnetName,
    '--subnet-name', subnetName,
  ];
  if (args['appliance-name']) scriptArgs.push('--appliance-name', args['appliance-name']);
  if (args['custom-location']) scriptArgs.push('--custom-location', args['custom-location']);
  if (args['lnet-name']) scriptArgs.push('--lnet-name', args['lnet-name']);
  if (args['aks-cluster']) scriptArgs.push('--aks-cluster', args['aks-cluster']);

  const result = spawnSync('bash', scriptArgs, {
    stdio: 'inherit',
    cwd: jumpstartDir,
    encoding: 'utf8',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// ---- Main ----

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (command) {
  case 'setup':
    setup(args);
    break;
  case 'teardown':
    teardown(args);
    break;
  case 'deployaksarc':
    deployAksArc(args);
    break;
  case 'rdp':
    rdp(args);
    break;
  default:
    console.log('Usage:');
    console.log(
      '  npx tsx scripts/baremetal-env.ts setup        --subscription <id> --username <user> --password <pass> [--location <region>] [--vm-size <size>] [--group-name <name>]'
    );
    console.log(
      '  npx tsx scripts/baremetal-env.ts teardown     --subscription <id> [--group-name <name>]'
    );
    console.log(
      '  npx tsx scripts/baremetal-env.ts deployaksarc --subscription <id> --location <region> [options]'
    );
    console.log(
      '  npx tsx scripts/baremetal-env.ts rdp           --subscription <id> --username <user> [--group-name <name>] [--vm-name <name>]'
    );
    process.exit(command ? 1 : 0);
}
