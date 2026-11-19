# Azure live tests

Run from the repository root with project and plugin dependencies installed:

```sh
npm run test:e2e:azure                # REST parity, then ACR acceptance (--suite all)
npm run test:e2e:azure -- --suite rest # read-only REST/CLI parity
npm run test:e2e:azure -- --suite acr  # billable GitHub Actions/ACR tests
npm run test:e2e:acr:helpers          # offline controller tests; also in test:build
```

The live command sets `AZ_LIVE_TESTS=1` only in child processes. Without that guard,
live tests skip even when `az` is logged in; `RUN_AKS_DESKTOP_E2E` is unsupported.
Ordinary tests and CI do not opt in. Configuration is suite-specific and checked
before either selected suite starts; a failed suite stops later suites.

ACR permission shortfalls recognized by read-only preflight produce a skip before
remote writes. **A skip is not acceptance evidence.** Missing configuration,
invalid responses, transport errors and failures after preflight remain errors.

Local tests of the emitted runner require `python3` on `PATH`:

```sh
npm --prefix plugins/aks-desktop run test:unit -- src/components/GitHubPipeline/utils/acrTasks
```

## Read-only REST suite

Log in with `az login` against the approved subscription. Optional
`AZ_LIVE_SUBSCRIPTION` selects it explicitly; otherwise the CLI account is used.
The plugin's Vitest runner executes only `az-http.live.test.ts`: token acquisition,
resource-group/AKS listing parity with Azure CLI, and an expected ARM error.
It creates no resources and does not prove long-running operations.

Mutating provider-registration tests are **not** included; run them separately
using [their setup instructions](../live/README.md).

## ACR sandbox setup

**Tests publish commits, start billable builds, cancel work and delete images.
Use dedicated resources and one controller at a time. Nothing is provisioned
automatically.** No browser, local Docker daemon or AKS cluster is needed.

1. Install/authenticate `gh` and `az`; install `actionlint`. The local controller
   needs registry/run read, log/cancel and image read/delete permissions, including
   image data actions for ABAC registries. This is separate from the workflow's
   OIDC identity.
2. Use an Actions-enabled dedicated repository, preferably the private
   [`Azure/aks-desktop-e2e`](https://github.com/Azure/aks-desktop-e2e) sandbox
   (approved collaborators only), **not `Azure/aks-desktop`**. Create a non-default
   `aksd-acr-e2e` or `aksd-acr-e2e-<suffix>` branch.
   Repository **Write** is enough; Admin is not required. Classic credentials
   need `repo` and `workflow` scopes; fine-grained credentials need Contents and
   Workflows write, Actions read/write and Secrets metadata read.

   An existing admin can grant Write; substitute the approved collaborator login.
   This may replace an existing direct role, not organization/team membership:

   ```sh
   gh api --method PUT 'repos/Azure/aks-desktop-e2e/collaborators/<approved-collaborator-login>' \
     -f permission=push
   gh api repos/Azure/aks-desktop-e2e --jq .permissions
   ```

   Verify `push: true`; `admin: false` is fine.

3. Install this bootstrap on the repository's **default branch**, at
   `.github/workflows/aksd-acr-e2e.yml`, so GitHub recognizes dispatches:

   ```yaml
   name: ACR E2E bootstrap
   on:
     workflow_dispatch:
   permissions: {}
   jobs:
     bootstrap:
       runs-on: ubuntu-latest
       steps:
         - run: echo "Dispatch the dedicated E2E branch"
   ```

4. Configure repository secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and
   `AZURE_SUBSCRIPTION_ID` for `azure/login` OIDC; do not use client secrets.
   Trust the **exact GitHub subject for the E2E branch**: newer repositories may
   include immutable owner/repository IDs. Tenant policy can reject personal
   repositories regardless of resource permissions. Do not overwrite secrets
   belonging to other workflows.
5. Supply a public-cloud ACR in a **dedicated test resource group**, reachable
   from GitHub-hosted runners, with no concurrent builds. Grant the workflow
   identity Tasks and image permissions appropriate to its [RBAC/ABAC mode][roles];
   `AcrPush` alone does not permit Tasks. Registry-scoped `Container Registry Tasks
Contributor` also grants the runtime's ARM registry metadata read; setup does not
   require an additional `Reader` assignment ([permission details][tasks-permissions]).
   Record resource IDs and ownership.

[tasks-permissions]: https://learn.microsoft.com/azure/container-registry/tasks-agent-pools-permission-migration#check-effective-permission-on-each-pool

```sh
export AKSD_E2E_REPOSITORY=Azure/aks-desktop-e2e
export AKSD_E2E_BRANCH=aksd-acr-e2e
export AKSD_E2E_ACR_RESOURCE_ID='/subscriptions/<guid>/resourceGroups/<group>/providers/Microsoft.ContainerRegistry/registries/<name>'
export AKSD_E2E_ACR_LOGIN_SERVER='<actual-login-prefix>.azurecr.io'
export AKSD_E2E_EXCLUSIVE_REGISTRY=1
npm run test:e2e:azure -- --suite acr
```

Read-only preflight checks repository Write/secret-metadata access, branch,
bootstrap and registry metadata, plus controller Azure permissions. It grants
nothing and never probes deletion. Conditional policies, token restrictions and
the workflow's OIDC identity still require validation by actual execution.

Use the registry's actual login server, including its Domain Name Label suffix
when enabled (for example, `myregistry-abc123.azurecr.io`), not a host guessed from
its ARM name. Preflight requires an exact match with registry metadata before
any mutations. The generated workflow uses the login prefix; controller ARM/CLI
operations retain the registry name from the resource ID.

## ACR acceptance coverage

Tests use the real `generateDeployWorkflow`, preserving the build job,
environment, concurrency and deployment dependencies. Push triggers are disabled;
deployment steps become a harmless sentinel. This proves **remote builds and
deployment gating, not AKS deployment**. Agent instructions remain unit-tested.
Fixtures are actionlint-checked and published to the E2E branch without force.

| Check                              | Required evidence                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime publication, before builds | Production publisher verifies bundle contents/blob SHAs, repeat publication and deliberate outdated-file repair.                              |
| Nested-context success             | ACR/GitHub success, sentinel runs, fixture-SHA image/digest verified; unique log marker proves context, ignore rules and build argument.      |
| External Dockerfile                | Same success checks; sidecar overrides conflicting root rules; staging files stay out of `COPY .`.                                            |
| Deliberate failure                 | ACR `Failed`, GitHub failure, missing-file log, deployment unstarted, no image.                                                               |
| Cancellation                       | Cancel **GitHub only** after ACR `Running`; observe ACR `Canceled`, GitHub cancelled, deployment skipped/cancelled with zero steps, no image. |

Budgets: twelve minutes per build case, one minute of recovery per service,
one minute per controller command (plus up to five seconds of Windows process-tree
cleanup), and sixty minutes for normal work. Recovery has a separate thirty-minute
command budget; the outer test reserves another 34m10s beyond normal work so
recovery is not cut off by the test timeout. Windows `az.cmd` is supported.

Evidence goes to `out/acr-e2e/<unique-id>/`: `publication.json` and per-scenario
`evidence.json`/`acr.log` when available. It records source revision/dirty state,
fixture/run IDs, verdicts and redacted logs. Offline passes or skips do not prove
live acceptance.

## Build runtime contract

Both product paths share the standard-library Python runner, published unchanged
with fixtures. It uploads context, schedules/polls ACR Tasks (`2019-04-01`, using
`2025-03-01-preview` with `[caller]` source-registry credentials for `scheduleRun`
when the registry uses `AbacRepositoryPermissions`), reads logs and cancels
unfinished work on failure/cancellation; only success permits deployment. Registry ARM IDs are preferred; legacy name lookup never uses the
cluster's resource group. Builds use HTTP, not `az acr build`, but Azure CLI token
acquisition, `azure/login` and the product's AKS context setup remain.
Build and cancellation steps launch Python in isolated mode (`python3 -I`), so
checkout helpers and `PYTHONPATH` cannot shadow standard-library imports.
Generated deterministic workflows share editable workflow-level registry, image,
Dockerfile and context settings between build, cancellation and deployment.
Existing agent setup is checked for current instructions and runtime files before
triggering a new task. Outdated setup requires an upgrade PR to be merged first;
custom guidance is preserved, and ambiguous legacy customizations require manual migration.
The exact unmodified pre-REST generated agent template is recognized and upgraded;
customized unmarked CLI-era instructions remain a manual migration to avoid
guessing which repository-owned text is safe to replace.
Repository-owned setup workflows keep their tool steps, services, runner choices,
and permissions unchanged; REST migration does not impose stock tool versions.
If the setup YAML is malformed or generated deployment sections cannot be
identified safely, the upgrade stops with a manual-migration error instead of
replacing repository-wide configuration. Generated deployment
regions are refreshed and verified together for cluster, namespace, workflow
defaults, validation, and registry settings; selecting no registry cannot retain
an earlier managed ACR build block.
Setup verification reads the workflow, agent instructions, and runtime files at
one immutable commit. It rechecks the selected branch tip afterward and stops
with a retry instruction if that branch moved, rather than suggesting an upgrade.
Lookup/read failures remain errors.
Setup readiness is tracked separately from file existence, so review actions
explicitly distinguish upgrading setup from triggering the agent. Merge polling
is tied to the selected PR number. Selecting a different registry invalidates
the previous permission setup and requires user-confirmed identity and kubelet
permission revalidation before continuing.
Every resumed review, including fast and fast-with-AI paths, requires fresh, scoped
identity and registry/pull checks. Fast-path secret publication is also gated on
that current-session proof; agent setup-file verification remains agent-only.
The agent review distinguishes first-time creation from upgrades and lists the
configured executable runtime files as well as the agent files.
Saved registry-ID-only configurations
return to registry selection on resume or retry without discarding other settings
or pending setup PR tracking.
Saved pipeline identities are resolved by client ID and revalidated in their
actual resource group; lookup failures never create a replacement identity.
Role setup checks unconditional direct and inherited assignments before creating
missing grants, including kubelet `AcrPull`. Lookups use object IDs without
Microsoft Graph principal-name queries, are shared per scope within one setup call,
and fail explicitly if assignments cannot be read. They do not prove live image
pull access or evaluate custom-role equivalence.
Identity and federation CLI calls pass resource groups with `--resource-group=...`,
so valid leading-hyphen group names are treated as values, not options.
For clusters positively identified as using a service principal, registry-pull
access requires explicit operator acknowledgement rather than an impossible
managed-kubelet lookup. Managed-identity failures and metadata/API errors still
block setup; acknowledgement is not proof of a successful live image pull.
Agent draft checks are debounced and do not persist default application names.
Fast-path review does not depend on agent setup-file reads; agent submission
always verifies the latest draft again.
If a registry ARM ID is supplied, the configured name/login host must identify
that registry. Domain Name Label hosts are verified against ARM `loginServer`,
not guessed from the registry name; deployment retains the configured host.
Name-only discovery also requires an exact login-host match, never just an ARM-name
match, before uploading sources or scheduling a build.
Every ID-backed build with a configured host reads registry metadata, even when
that host prefix equals the ARM name. The workflow identity therefore needs
`Microsoft.ContainerRegistry/registries/read` as well as its Tasks/image permissions.
An unrelated name fails before upload/scheduling; update or clear the ID too.
Deployment generation requires the actual login server. Saved configurations
containing only an ARM registry ID must reselect the registry rather than derive
an image hostname that may be wrong for Domain Name Label registries.
Validation runs before repository secret writes as well as PR generation, so an
unusable saved configuration cannot replace repository-wide authentication settings.
Build arguments escape dollar signs in JSON before YAML generation, preserving
literal `${{ ... }}` strings instead of evaluating them as Actions expressions.
Workflow, manifest, agent, and runtime Contents writes to a branch are sequential.
Runtime publication starts only after the preceding files settle; an error stops
later writes rather than racing additional commits against branch cleanup.

Ignore rules are decoded from their original bytes and split only on LF; embedded
carriage returns and Unicode separators remain literal filename characters.
Dockerfile-specific ignore rules override context rules. Original root ignore,
selected sidecar, and Dockerfile bytes remain build-visible without rewriting.
Selected file symlinks are materialized from validated targets. Dockerfile aliases
use the selected name for sidecar lookup, validating the resolved target separately.
Selected targets must stay in the checkout and outside `.git`;
in-context ignore symlinks must stay relative and inside the context. Invalid
selected ignore directories/dangling symlinks fail before upload instead of
falling back to context rules.
Plain contexts retain `DockerBuildRequest`. Sidecar, relocated-Dockerfile and
selected-ignore-symlink cases use an inline `EncodedTaskRunRequest` with a native
`build:` step, explicit `DOCKER_BUILDKIT=1`, and a success-dependent `push:` step.
This creates no persistent Task resource. Flat `.aksd-acr.Dockerfile` and
`.aksd-acr.Dockerfile.dockerignore` staging files carry the selected Dockerfile and
effective rules; those rules exclude the two synthetic paths, not the original
repository files. No root ignore file is synthesized. The task has a one-hour
combined build/push timeout; the client and workflow retain their own bounds.

The native build step retains ACR's image-dependency/digest reporting path.
Offline tests exercise uploaded archive bytes, shell arguments, request shape,
and failure/cancellation behavior; COPY checks and scanner checks are simulations,
not a real remote builder run. Live acceptance must verify BuildKit/frontend
availability, original-file COPY bytes, build arguments (including spaces and `$`),
and run `outputImages`/digest metadata before claiming this path accepted.
Excluded directories are pruned when no exception or forced Dockerfile path
could require a descendant; broad wildcard exceptions retain conservative traversal.
Ordinary context symlinks are archived as links without resolving or following
their targets, including outside-context, absolute, dangling, or cyclic targets.
Ignore rules apply to the link's own path; target contents are not uploaded.
As with the legacy CLI packager, version-control metadata is excluded by default:
`.git`, `.gitignore`, `.bzr`, `bzrignore`, `.hg`, `.hgignore`, and `.svn`.
ARM failures identify the operation and include bounded, redacted error details.
Error-body reads are capped at 64 KiB; storage error bodies are not logged.
Definite scheduling rejections (4xx other than 408/429) clear pending scheduling
state so cancellation does not invent an uncertain accepted run. Transport
failures, 408/429, server errors, and failures after acceptance retain recovery
state and do not trigger blind scheduling retries.

## Cleanup and recovery

The suite cancels identified work and deletes only its test-image manifests.
It never creates/deletes supplied registries, resource groups, identities, role
assignments, GitHub repositories/branches or repository secrets.

- Cancellation validates the exact GitHub run/fixture SHA, branch, workflow and
  dispatch event. Active pre-existing ACR work blocks dispatch; ambiguous new runs
  are an error, not permission to cancel unknown work.
- Image deletion requires the run-reported immutable digest. Extra aliases or
  moved tags block deletion; cleanup deletes by digest and verifies digest/tag
  absence. Only confirmed missing artifacts are idempotent; auth/network/service
  failures remain errors. Metadata checks are **not an atomic lock**: keep the
  registry exclusive.
- Verdicts are saved before cleanup; recovery cannot turn failure into a pass or
  establish cancellation success. Lost dispatch responses get bounded discovery,
  with independent GitHub/ACR recovery budgets. Unresolved cleanup stops later cases.
- Publication repair replaces only its own unique outdated-file marker, preserving
  unexpected concurrent changes. The verified marker SHA is a required publisher
  precondition and Contents writes remain conditional on that SHA. Fixtures,
  branch history and evidence are retained.
- Ctrl+C/SIGTERM cooperatively stops new work, records failure, and runs bounded
  recovery before exit. The controller uses IPC on Windows as well as Unix;
  repeated signals do not interrupt recovery. Forced termination of the owned
  child is a last resort after 34m10s, not a cleanup guarantee after runner loss.
  Publication checks stop between settled requests and still repair their own
  outdated marker. Each Octokit request has a fresh one-minute abort deadline.
  Runtime publication checks interruption between every settled artifact read
  and write; only explicit marker repair proceeds after interruption.

Resource provisioning/teardown is the owner's responsibility. Keep reusable OIDC
bindings separate from disposable resources. After retaining evidence and
confirming no workflow/build is active, inspect the recorded subscription/group
contents; delete only a test group you created and verify absence. Never infer
ownership from a prefix or from supplying its registry.

Hard termination, runner loss, lost responses, revoked permissions and outages can
leave work behind. Inspect the sandbox/evidence and resolve it before another run;
server-side timeouts and `always()` steps do not guarantee cleanup. Never publish
tokens or SAS URLs as evidence.

[roles]: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-directory-reference
