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
   gh api --method PUT repos/Azure/aks-desktop-e2e/collaborators/illume \
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
   `AcrPush` alone does not permit Tasks. Record resource IDs and ownership.

```sh
export AKSD_E2E_REPOSITORY=Azure/aks-desktop-e2e
export AKSD_E2E_BRANCH=aksd-acr-e2e
export AKSD_E2E_ACR_RESOURCE_ID='/subscriptions/<guid>/resourceGroups/<group>/providers/Microsoft.ContainerRegistry/registries/<name>'
export AKSD_E2E_ACR_LOGIN_SERVER='<name>.azurecr.io'
export AKSD_E2E_EXCLUSIVE_REGISTRY=1
npm run test:e2e:azure -- --suite acr
```

Read-only preflight checks repository Write/secret-metadata access, branch,
bootstrap and registry metadata, plus controller Azure permissions. It grants
nothing and never probes deletion. Conditional policies, token restrictions and
the workflow's OIDC identity still require validation by actual execution.

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
cleanup), and sixty minutes overall. Windows `az.cmd` is supported.

Evidence goes to `out/acr-e2e/<unique-id>/`: `publication.json` and per-scenario
`evidence.json`/`acr.log` when available. It records source revision/dirty state,
fixture/run IDs, verdicts and redacted logs. Offline passes or skips do not prove
live acceptance.

## Build runtime contract

Both product paths share the standard-library Python runner, published unchanged
with fixtures. It uploads context, schedules/polls ACR Tasks (`2019-04-01`), reads
logs and cancels unfinished work on failure/cancellation; only success permits
deployment. Registry ARM IDs are preferred; legacy name lookup never uses the
cluster's resource group. Builds use HTTP, not `az acr build`, but Azure CLI token
acquisition, `azure/login` and the product's AKS context setup remain.

Dockerfile-specific ignore rules override context rules. Overrides, relocated
Dockerfiles and selected ignore symlinks produce a regular root `.dockerignore`,
including when the symlink target is excluded. External Dockerfiles use flat
`.aksd-acr.Dockerfile`/`.aksd-acr.Dockerfile.dockerignore` staging paths, excluded
from `COPY` without a synthetic parent directory. Dockerfile aliases use the
selected name for sidecar lookup/archive identity, validating the resolved target
separately. Selected targets must stay in the checkout and outside `.git`;
in-context ignore symlinks must stay relative and inside the context. Invalid
selected ignore directories/dangling symlinks fail before upload instead of
falling back to context rules.

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
  unexpected concurrent changes. Fixtures, branch history and evidence are retained.

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
