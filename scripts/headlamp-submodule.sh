#!/bin/bash

# Simplified script to update the Headlamp submodule to a given upstream ref (branch|tag|commit)
# WITHOUT adding or configuring a git remote. It fetches directly from the canonical upstream
# repository URL into FETCH_HEAD and then replays/positions the local state.
#
# Copyright (c) Microsoft Corporation. 
# Licensed under the Apache 2.0.
#
# Usage:
#   ./headlamp-submodule.sh <ref>           # update submodule to upstream ref (no commit)
#   ./headlamp-submodule.sh --commit <ref>  # commit current submodule pointer (no update)
#   ./headlamp-submodule.sh --reset         # reset worktree to recorded commit in superproject
#   (Order-insensitive: <ref> --commit works too.)
#
# Behavior:
#   - With only <ref>: fetch/rebase submodule onto upstream ref (no commit).
#   - With --commit <ref>: DO NOT update; just create a commit recording current pointer, using <ref> in message.
#     (Assumes you've already updated the submodule to that ref.)
#   - With --reset: restore submodule worktree to the superproject's recorded commit.
#
# Constraints:
#   - --commit requires a <ref>.
#   - --commit cannot be combined with --reset.
#   - You cannot specify more than one <ref>.
#
# <ref> may be: branch name (e.g. main), tag (e.g. v0.35.0), or commit SHA/abbrev.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <ref>|--reset|--commit <ref>" >&2
    exit 1
fi

MODE=""
REF=""
COMMIT_FLAG=false
RESET_FLAG=false

while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 <ref>|--reset|--commit <ref>" >&2
            exit 0 ;;
        --commit)
            COMMIT_FLAG=true ;;
        --reset|reset)
            RESET_FLAG=true ;;
        --*)
            echo "Unknown option: $1" >&2; exit 1 ;;
        *)
            if [ -z "$REF" ]; then
                REF="$1"
            else
                echo "Error: multiple refs specified ($REF, $1)." >&2; exit 1
            fi ;;
    esac
    shift
done

if $COMMIT_FLAG && $RESET_FLAG; then
    echo "Error: --commit cannot be combined with --reset." >&2
    exit 1
fi

if $COMMIT_FLAG && [ -z "$REF" ]; then
    echo "Error: --commit requires a <ref>." >&2
    exit 1
fi

if $RESET_FLAG; then
    MODE="reset"
elif $COMMIT_FLAG; then
    MODE="commit-only"
else
    if [ -z "$REF" ]; then
        echo "Error: missing <ref>." >&2; exit 1
    fi
    MODE="update"
fi

if [ "$MODE" = "reset" ]; then
    echo "[info] Resetting headlamp submodule to superproject recorded commit"
elif [ "$MODE" = "commit-only" ]; then
    echo "[info] Commit-only mode: committing current submodule pointer (no update). Ref: $REF"
else
    echo "[info] Updating headlamp submodule to ref: $REF"
fi

cd "$ROOT_DIR"

# Ensure submodule is initialized
if [ ! -d headlamp ] || [ ! -f headlamp/.git ] && [ ! -d headlamp/.git ]; then
    echo "[info] Initializing headlamp submodule..."
    git submodule update --init headlamp
fi

cd headlamp

if [ "$MODE" = "reset" ]; then
    # Warn if dirty
    if [ -n "$(git status --porcelain)" ]; then
        echo "[warn] You have local changes inside submodule that will be overwritten by reset." >&2
    fi
    cd "$ROOT_DIR"
    # Use --checkout to ensure worktree matches the recorded commit
    git submodule update --init --checkout headlamp
    cd headlamp
elif [ "$MODE" = "commit-only" ]; then
    echo "[info] Skipping update (commit-only)."
else
    HEADLAMP_URL="${HEADLAMP_URL:-https://github.com/kubernetes-sigs/headlamp.git}"
    echo "[info] Resolving upstream ref '$REF' from $HEADLAMP_URL"

    # Pull + rebase the downstream changes
    if git pull --rebase "$HEADLAMP_URL" "$REF"; then
        echo "[info] Rebase complete."
    else
        echo "[conflict] Rebase stopped due to conflicts." >&2
        echo "Resolve, then run: git rebase --continue (or --abort) inside headlamp/" >&2
        exit 1
    fi
fi

CURRENT_DESC=$(git log --oneline -1)
echo "[info] Headlamp now at: $CURRENT_DESC"

cd "$ROOT_DIR"
git add headlamp

if [ "$MODE" = "reset" ]; then
    echo "[done] Submodule reset to recorded commit (no commit created)."
elif [ "$MODE" = "commit-only" ]; then
    # Stage pointer and commit if changed, message includes ref.
    if git diff --cached --quiet headlamp; then
        git add headlamp
    fi
    if git diff --cached --quiet headlamp; then
        echo "[info] No submodule change to commit.";
    else
        MSG="headlamp: rebase to $REF"
        if git commit -m "$MSG"; then
            echo "[done] $MSG"
        else
            echo "[warn] Commit failed; please review." >&2
        fi
    fi
else
    echo "[done] Submodule updated. Commit when ready:";
    echo "  git commit -m 'headlamp: rebase to $REF'"
fi
