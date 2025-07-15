# Maintenance

This document outlines the maintenance procedures for this project.

## Headlamp Fork

AKS desktop uses Headlamp as a base project. We maintain a fork of Headlamp to
implement features and fixes that are specific to AKS desktop. This fork is kept as a branch
`headlamp-downstream`, and is set up as a git submodule in this project's repository. This
ensures flexibility.

This fork is meant to be kept in sync with the upstream Headlamp project as much as possible,
meaning the downstream changes we make should be minimal and focused on AKS desktop-specific needs
that do not make sense to contribute back upstream.

### Types of Changes

We aim to keep our downstream changes to a minimum. Before implementing a change, we evaluate whether it can be achieved through configuration or customization options provided by Headlamp. If a feature can be implemented without modifying the core codebase, e.g. by leveraging Headlamp's plugin system, we prefer that approach.

Our downstream changes to the Headlamp project can be categorized into two types:

1. **AKS desktop Only**: These are changes that are specific to AKS desktop and do not make sense to contribute back to the Headlamp project. Examples include:
  - Custom branding or theming specific to AKS desktop.
  - Features that are tightly coupled with AKS desktop's architecture or user experience.

  We can lower the number of these changes by leveraging Headlamp's plugin system and configuration options wherever possible. When something is not possible through these means, we do implement them downstream and
  we work with upstream to understand if such changes can be made possible by expanding the plugin system or adding configuration options.

2. **Upstreamable Contributions**: These are changes that are beneficial to the broader Headlamp community and can be contributed back upstream. Examples include:
  - Bug fixes that address issues in the Headlamp project.
  - Performance improvements or optimizations.
  - New features that enhance the overall functionality of Headlamp and are not specific to AKS desktop.

  We actively seek to contribute these changes back to the Headlamp project through pull requests in a timely manner. The quicker we can get these changes merged upstream, the less they will deviate from the main codebase and the lower the maintenance burden we have to carry downstream.

### Git Commit Conventions

To help with the maintenance of our Headlamp fork, we follow specific git commit conventions to clearly indicate the nature of each change. This helps in identifying which changes are AKS desktop specific and which are intended for upstream contribution.

1. **AKS desktop Specific Changes**: These commits should be prefixed with `aksd:` to indicate that they are specific to the AKS desktop fork. For example:
  ```
  aksd: Add custom branding for AKS desktop
  ```

2. **Upstream Contributions**: These commits should be prefixed with `upstreamable:` to indicate that they are intended for contribution back to the Headlamp project. For example:
  ```
  upstreamable: Avoid crash in Headlamp plugin system
  ```

By following these conventions, we can maintain clarity in our commit history and facilitate the process of syncing with the upstream Headlamp project.

### Syncing with Upstream

To keep our fork in sync with the upstream Headlamp project, we regularly rebase our Headlamp fork against the latest upstream release. This helps to minimize merge conflicts and ensures that we are benefiting from the latest features and fixes in Headlamp.

When rebasing, we carefully review each commit to ensure that our downstream changes do not conflict with upstream changes. Upstreamable changes done since the last rebase, should hopefully be already merged upstream, but if not, we will need to reapply them on top of the latest upstream changes.

Ideally, we aim to rebase our fork regularly **up to 2 weeks** after the new upstream release.

#### Rebasing Steps

This section illustrates the steps to rebase our Headlamp fork against the latest upstream release.

0. **Set up a remote for the upstream Headlamp repository** (if not already done):
  ```bash
  git remote add headlamp-repo https://github.com/kubernetes-sigs/headlamp.git
  ```

1. **Move to a new branch based on the new Headlamp version**:
  ```bash
  git fetch headlamp-repo
  git checkout -b new-headlamp-downstream headlamp-repo/vX.Y.Z
  ```

2. **Check what is the last common commit with upstream in our current fork**:
  ```bash
  git merge-base headlamp-downstream vX.Y.Z # Headlamp's latest release tag, fetched from the previous step
  ```

  This command will output a commit hash, e.g. `abc1234`. This is the last common commit between our fork and the upstream release.

3. **Cherry-pick all our downstream changes since that commit**:
  First, keep a list of the commits that will be cherry-picked at hand. This is useful if you will need to skip some commits or pause the process for a while. You can get this list by running:
  ```bash
  git log --oneline abc1234..headlamp-downstream # Replace abc1234 with the actual commit hash from the previous step
  ```

  Then, start the cherry-pick process:
  ```bash
  git cherry-pick abc1234..headlamp-downstream # Replace abc1234 with the actual commit hash from the previous step
  ```

  This command will apply all commits from our current `headlamp-downstream` branch that are not in the upstream release.

4. **Resolve any conflicts**:
  If there are any conflicts during the cherry-pick process, Git will pause and allow you to resolve them. You can use your preferred text editor or IDE to fix the conflicts, then use:
  ```bash
  git cherry-pick --continue
  ```

  If a commit cannot be applied because it's functionality is already present upstream (just in a different form), you can skip it using:
  ```bash
  git cherry-pick --skip
  ```

_Important:_ Why do we use `cherry-pick` instead of `rebase`? Because `rebase` does the above automatically but, if there are conflicts and we choose to leave the fixing for later, it leaves the branch in a state that is hard to recover from, or we end up calling `cherry-pick --abort`, losing the progress on previously rebased commits. With `cherry-pick`, if we need to leave fixing conflicts for later, we can just abort the cherry-pick and return to our original branch.

#### Finalizing the Rebase

Once all commits have been successfully cherry-picked and any conflicts resolved, we need to finalize the rebase process. This typically involves:

1. **Create a testing branch**:
  ```bash
  git checkout -b test-new-headlamp-version
  ```

2. **Update the submodule in the main repository**:
  Assuming we have our new `new-headlamp-downstream` branch ready after the rebase, we need to update the submodule reference in the main repository to point to this new branch. From the root of the main repository, run:
  ```bash
  cd headlamp # The directory where the Headlamp submodule is located
  git checkout new-headlamp-downstream
  cd ../..
  git add ./headlamp
  git commit -m "Update Headlamp submodule to rebased on vX.Y.Z"
  git push origin test-new-headlamp-version
  ```

3. **Test the changes**:
  Thoroughly test the changes in the `test-new-headlamp-version` branch to ensure that everything is functioning as expected with the new Headlamp version.

4. **Merge into main branch**:
  Once testing is complete and everything is verified to be working correctly, update the `headlamp-downstream` branch to point to the new changes:
  ```bash
  git push origin +new-headlamp-downstream:headlamp-downstream
  ```

  And then merge the `test-new-headlamp-version` branch into the main branch (e.g., `main` or `master`):
  ```bash
  git checkout main
  git merge test-new-headlamp-version
  git push origin main
  ```

5. **Clean up**:
  After the merge, you can delete the temporary branches created during the rebase process:
  ```bash
  git branch -d new-headlamp-downstream
  git branch -d test-new-headlamp-version
  ```

By following these steps, we ensure that our Headlamp fork remains up-to-date with the latest upstream changes while preserving our AKS desktop-specific modifications.

## Code Quality

For for downstream changes in the Headlamp fork, and for changes in the main repository, we
should all follow best practices to ensure high code quality and maintainability. This includes:

Follow atomic commits and PRs, with clear messages, and keep changes small and focused. This
makes it easier to review, test, and revert changes if necessary.

Atomic commits are commits that contain a single logical change. This means that each commit should
be self-contained and should not depend on other commits. This makes it easier to understand the
history of the project and to revert changes if necessary. This is not about one commit per PR, nor one file change per commit, but about one logical change per commit. E.g. if a PR implements a new feature, it may contain multiple commits, but each commit should implement a single aspect of that feature.

Each commit (not just each PR) should build and pass all tests. This ensures that the project is always in a
working state and will help with bisecting issues.

When writing commit messages, follow these guidelines:
- Use the imperative mood in the subject line (e.g., "Fix bug" instead of "Fixed bug" or "Fixes bug").
- Limit the subject line and body to 72 characters or less.
- Use the body to explain what and why vs. how.
