# Azure live tests

Use one entry point and one live-test guard for tests that access Azure:

```sh
npm run test:e2e:azure                 # REST parity, then GitHub Actions/ACR acceptance
npm run test:e2e:azure -- --suite rest # read-only REST/CLI parity only
npm run test:e2e:azure -- --suite acr  # GitHub workflow/ACR acceptance only
```

The command sets `AZ_LIVE_TESTS=1` in its child processes. Live suites skip when
that variable is absent, even if `az` is logged in. The old
`RUN_AKS_DESKTOP_E2E` guard is not supported. Configuration variables are still
suite-specific; sharing the opt-in does not make every suite require GitHub.
Selected-suite configuration is checked before either suite starts.

Normal unit tests and CI never invoke this command. Once selected, missing
configuration or a failed suite is an error. ACR tests report an explicit skip
when the read-only preflight identifies insufficient controller permissions,
before publishing files or dispatching builds. Skips are not acceptance evidence.
Transport errors, invalid responses and failures after preflight remain errors.
Tests run sequentially, and a failure stops later suites.

## REST parity

Run `az login` against the approved subscription first. Optionally set
`AZ_LIVE_SUBSCRIPTION` to select a subscription explicitly. The REST suite
compares tokens, resource-group listings and AKS cluster listings with Azure CLI
and checks an expected ARM error. It does not create resources or prove
long-running operations work.

This suite uses the plugin's existing Vitest runner; no root Vitest dependency
or new test framework is required.
It selects only `az-http.live.test.ts`, not every live test in that directory.
Provider-registration tests can mutate subscription state and create/delete test
resource groups; run them separately using [their setup instructions](../live/README.md).

## Generated ACR builds

These are Node test-runner tests, executed with the repository's existing `tsx`.
GitHub Actions is the system under test, not another test framework. No browser,
Kubernetes cluster, or new test dependencies are needed.

```sh
npm run test:e2e:acr:helpers          # offline harness tests; also in test:build
npm run test:e2e:azure -- --suite acr # explicitly authorized live sandbox tests
```

The live file checks production runtime publication first, then runs four
serial build scenarios and their assertions. Concrete
GitHub/ACR helpers handle external operations; focused offline tests cover
workflow adaptation, mutation guards, image verification, and dispatch recovery.
There is no separate scenario engine or fake-clock framework.

## Runtime under test

Both generated workflow paths publish the same standard-library Python runner.
It uploads the selected Docker build context, schedules an ACR Tasks build using
API version `2019-04-01`, polls its status, retrieves logs, and cancels unfinished
work on failure or workflow cancellation. Only a successful remote build permits
deployment. The selected registry's ARM ID is preferred; legacy name-only
configuration uses ARM registry discovery, never the cluster's resource group.
The uploaded root `.dockerignore` is normalized to the selected Dockerfile's
effective rules when an override or relocated Dockerfile is used. This preserves
ignore precedence with legacy ACR builders as well as BuildKit; external staging
files are excluded from `COPY` by both root and Dockerfile-specific rules.
Relocated Dockerfiles use reserved root-level `.aksd-acr.Dockerfile` and
`.aksd-acr.Dockerfile.dockerignore` paths, avoiding an empty staging directory
that legacy Docker can otherwise retain in `COPY .`.
Normalization preserves the selected ignore file's context-symlink boundary
checks and rejects directory paths before any source upload.

The existing `azure/login` OIDC setup and `azure/aks-set-context` remain. Token
acquisition still uses `az account get-access-token`; the resource build itself
uses HTTP, not `az acr build`. This is not a removal of all runner-side CLI
dependencies.

The runner's focused executable tests require local Python 3:

```sh
npm --prefix plugins/aks-desktop run test:unit -- src/components/GitHubPipeline/utils/acrTasks
```

## Sandbox setup

**Live tests publish commits, start billable builds, cancel work, and delete test
images. Use dedicated resources and only one controller at a time.** Missing
configuration is an error. Running the dedicated E2E command is the opt-in; the
npm script sets the shared guard so generic test discovery still skips live
execution. Normal unit tests and CI never invoke this command.
The tests never create cloud resources,
identities, repositories, credentials, or repository secrets.

1. Install and authenticate `gh` and `az`, and install `actionlint`.
   On Windows the harness supports the Azure CLI's `az.cmd` entry point using
   escaped batch arguments; native commands and other platforms execute directly.
   The controller identity needs ACR run read/log/cancel and image read/delete
   permissions, independent of the workflow's OIDC identity.
2. Use a dedicated repository with Actions enabled and a non-default branch
   named `aksd-acr-e2e` (or `aksd-acr-e2e-<suffix>`). The publishing credential
   needs Contents/Workflows write and Actions read/write. Classic OAuth/PAT
   credentials need `repo` plus `workflow` scopes.
   The project's dedicated private sandbox is
   [`Azure/aks-desktop-e2e`](https://github.com/Azure/aks-desktop-e2e); access is
   restricted to approved collaborators. Do not run these tests in the
   `Azure/aks-desktop` source repository or overwrite shared production secrets.
   Repository **Write** access is sufficient; Admin is not required for normal
   workflow publication, dispatch or repository-secret API access. Fine-grained
   credentials additionally need the relevant Contents, Workflows, Actions and
   Secrets permissions.

   An existing repository administrator can grant `illume` direct Write access:

   ```sh
   gh api --method PUT repos/Azure/aks-desktop-e2e/collaborators/illume \
     -f permission=push
   ```

   This sets the direct repository role and may replace an existing direct role;
   it does not change organization or team memberships. Other collaborators
   should substitute their approved GitHub login. The test controller can check
   its effective access without printing credentials:

   ```sh
   gh api repos/Azure/aks-desktop-e2e --jq .permissions
   ```

   `push` must be `true`; `admin` may be `false`. The preflight also checks access
   to repository-secret metadata and effective Azure run read/log/cancel and
   image read/delete permissions, including separate image data actions for
   ABAC-enabled registries. It never grants access or probes deletion by
   modifying a resource. Conditional policies, token permissions not exposed by
   these reads, and the workflow's separate OIDC identity are still validated
   by actual execution rather than assumed to work.

3. On its **default branch**, install this harmless dispatch bootstrap at
   `.github/workflows/aksd-acr-e2e.yml` so GitHub recognizes the workflow:

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

   The tests write only the E2E branch, atomically and without force-updating it.

4. Set that repository's `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and
   `AZURE_SUBSCRIPTION_ID` secrets for the production `azure/login` OIDC setup.
   Trust the actual subject for the E2E branch; do not use client secrets.
   New repositories can include immutable owner/repository IDs in that subject;
   use the exact claim emitted by GitHub instead of assuming the older
   `repo:owner/name:ref:...` format. Personal repositories may also be rejected
   by tenant policy even when resource permissions are sufficient.
5. Reserve a public-cloud ACR in a **dedicated test resource group**, reachable
   from GitHub-hosted runners, with **no concurrent builds**.
   The runner needs Tasks Contributor and appropriate image
   permissions; ABAC registries require additional repository roles. See
   [Microsoft's role reference][roles]. `AcrPush` alone does not permit Tasks.

```sh
export AKSD_E2E_REPOSITORY=Azure/aks-desktop-e2e
export AKSD_E2E_BRANCH=aksd-acr-e2e
export AKSD_E2E_ACR_RESOURCE_ID='/subscriptions/<guid>/resourceGroups/<group>/providers/Microsoft.ContainerRegistry/registries/<name>'
export AKSD_E2E_ACR_LOGIN_SERVER='<name>.azurecr.io'
export AKSD_E2E_EXCLUSIVE_REGISTRY=1
npm run test:e2e:azure -- --suite acr
```

Before fixture generation or remote writes, the tests check controller access,
the branch, bootstrap, and registry metadata. Authorized runs then generate and
lint all fixture workflows. The workflow uses the same
generated Python runner files as the product, published unchanged with each
fixture. The controller rejects any regression back to `az acr build`.

## Resource ownership and cleanup

Current suites do not provision Azure resources. The REST suite is read-only;
the ACR suite reuses an explicitly supplied test registry. It cancels identified
test work and deletes only its uniquely named test images. It never deletes the
registry, resource group, identity, role assignments, repository, or branch.

Destructive cleanup fails closed:

- GitHub cancellation re-reads the run and checks its exact fixture commit,
  dedicated branch, workflow path and dispatch event before sending cancellation.
- Registry run IDs are validated, and dispatch is refused while another ACR run
  is active. Multiple newly observed runs remain an error, not permission to
  cancel unknown work.
- Image deletion requires the immutable digest reported by that scenario's ACR
  run. Cleanup checks for unexpected aliases, refuses a moved tag, deletes by
  digest rather than tag, and verifies both digest and fixture tag are absent.
  Shared/ambiguous manifests are left for manual inspection with a cleanup error.
- An explicitly reported missing registry artifact is an idempotent no-op only
  after absence checks; authorization, transport and service failures are not
  treated as absence.
- GitHub and ACR recovery have separate bounded polling budgets. Failure in one
  cannot consume the other's recovery budget or turn the original test into a pass.
- Publication recovery repairs only its own unique outdated-file marker. An
  unexpected concurrent change is preserved and reported, never overwritten.

The registry must still be dedicated and exclusive: tag metadata checks and
manifest deletion are not an atomic lock against other writers. Do not share it
with production or concurrently publish additional aliases into test repositories.

Provision the ACR and any disposable identities in a separate, uniquely named
test resource group rather than a production or shared application group. Record
its exact subscription, resource-group/resource IDs, owner, and purpose before
testing. Keep reusable GitHub/OIDC bindings separate from disposable resources;
do not overwrite repository secrets belonging to other workflows.

After retaining evidence and confirming no workflow/build is active, the owner
must inspect that group's contents before deleting it. Delete only a group
created for these tests and verify deletion has completed. Never infer ownership
from a name prefix or delete an existing group merely because its registry was
used by the suite. Failed teardown remains a failure needing investigation.

Automatic resource provisioning is a follow-up, not part of this PR. That
wrapper should create one run-owned, tagged resource group, retain a durable
ownership receipt, and clean up on normal exit and catchable interruption. It
must check the subscription and ownership before deletion, preserve test errors
alongside cleanup errors, and verify resource-group absence. Existing-resource
mode must never delete the supplied group. Role-assignment authority and an
approved preconfigured GitHub OIDC identity remain prerequisites.

Neither a cleanup wrapper nor a new resource group bypasses tenant OIDC policy.
SIGKILL, host loss, locks, revoked permissions, and service outages can prevent
automatic cleanup, so an explicit receipt-based recovery path is required.

## Assertions

The tests call the real `generateDeployWorkflow`. A test-only adapter preserves
`buildImage`, environment, concurrency, and dependent-job conditions. It disables
push triggers and replaces actual deployment steps with a harmless sentinel.
This proves **ACR build behavior and deployment gating**, not an AKS deployment.
The existing unit snapshot still covers the actual deployment job.

| Scenario                    | Required evidence                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime publication         | The real production publisher installs the bundle, republishes unchanged existing files, and replaces a deliberately outdated artifact using current target-branch SHAs. Every generated file's content and Git blob SHA are checked. |
| Nested-context success      | ACR and GitHub success; sentinel succeeds; exact fixture-SHA tag resolves to an image digest; unique build-log proof that nested files, build argument, and ignore rules were verified.                                               |
| External-Dockerfile success | The selected Dockerfile is outside the nested context; its specific ignore file overrides conflicting root rules. The same success checks pass, and staged `.aksd-acr.Dockerfile*` files cannot enter `COPY .` output.                |
| Failure                     | ACR `Failed`, GitHub failure, sentinel skipped, missing-file signature in build logs, no output image.                                                                                                                                |
| Cancellation                | After ACR is `Running`, cancel **GitHub only**; observe ACR `Canceled`, GitHub cancelled and a skipped/cancelled deployment job with no steps. No output image from the slow fixture.                                                 |

Publication runs before billable builds. It uses the production
`publishAcrBuildFiles` with an authenticated GitHub client, not the test harness's
Git-tree publisher. A temporary outdated artifact is repaired on failure; repair
cannot turn a failed acceptance check into a pass. The existing Git-tree
publisher then atomically installs each generated workflow plus its fixtures.

The success fixture requests `buildArguments: { E2E_MARKER: <unique marker> }`.
Its Dockerfile verifies the nested context, ignore rules, and argument during
the ACR build, then emits a unique success marker only after all checks pass.
The final image copies that verified context. The controller requires the marker
in the actual build logs and verifies the image tag/digest through ACR.
Both success variants share this Dockerfile and additionally reject `.aksd-acr`
and both `.aksd-acr.Dockerfile*` staging files
in the copied context. No local Docker daemon, container execution, or registry password is needed.
The cancellation fixture sleeps five minutes to allow observation.

Each build case has a twelve-minute polling budget and separate bounded cleanup.
Local commands have a one-minute deadline; Windows Azure CLI timeout/overflow
also terminates the owned process tree with a separate five-second cleanup bound.
Cleanup failure remains an explicit diagnostic rather than an indefinite pipe wait.
Evidence in `out/acr-e2e/<unique-id>/<scenario>/` records the source revision,
dirty state, actual fixture commit SHA, verdict, and sanitized logs.
`publication.json` records the production-publisher verdict before build
dispatch. The suite's overall timeout is sixty minutes; external requests are
bounded separately.

## Recovery and limitations

The verdict is recorded before emergency cleanup. Cleanup cannot satisfy the
cancellation assertion. Accepted dispatches with lost responses are rediscovered
with bounded polling, not a single listing. If GitHub or ACR work remains
unresolved, cleanup fails and subsequent scenarios do not start.

Multiple new ACR runs violate the exclusive-registry contract: the tests refuse
to cancel unknown work. Cleanup deletes only the identified test image; it never
deletes the repository, registry, branch, or evidence.

Runner loss, controller termination, or scheduling responses lost beyond the
recovery window cannot guarantee orphan-free cleanup. Use server-side build
timeouts and inspect the sandbox after interruptions. Do not rely on `always()`
steps or publish tokens/SAS URLs as evidence.

Agent instructions remain unit-tested rather than waiting for nondeterministic
agent output. Both paths publish the same generated build runner; there is no
separate E2E implementation of the ACR build.
Passing offline tests does not mean the REST migration or live cases pass.

[roles]: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-directory-reference
