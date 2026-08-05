# Staying in sync with upstream

This repo is a content fork of [tmustier/pi-for-excel](https://github.com/tmustier/pi-for-excel), created as a copy rather than a GitHub-native fork — there's no shared git history (`git merge-base` against `upstream/main` returns nothing). That rules out `git merge upstream/main` or GitHub's "Sync fork" button; new upstream work has to be reviewed commit-by-commit and re-applied by hand where it's still relevant.

## Two layers of upstream

- **`@earendil-works/pi-agent-core` / `pi-ai` / `pi-web-ui`** — the npm packages upstream itself depends on. Kept current automatically by the `pi-stack` Dependabot group (`.github/dependabot.yml`) and auto-merged by `.github/workflows/dependabot-pi-automerge.yml` once CI is green.
- **tmustier/pi-for-excel source itself** — the actual add-in code this repo diverged from (UI layer, tools, auth, deployment). No package manager tracks this; that's what this process covers.

## The automated check

[`.github/workflows/upstream-sync-check.yml`](../.github/workflows/upstream-sync-check.yml) runs weekly (and on demand via `workflow_dispatch`):

1. Fetches `upstream/main` from `tmustier/pi-for-excel`.
2. Diffs it against the SHA recorded in [`.github/upstream-sync-state.txt`](../.github/upstream-sync-state.txt) — the last commit someone actually reviewed.
3. If there's anything new and no `upstream-sync`-labeled issue is already open, it files one with the commit list and a compare link.

## Triage process

1. Read each commit in the tracking issue. Cross-check against [docs/upstream-divergences.md](upstream-divergences.md) — if it touches something we deliberately diverged on, that doc explains why and whether the divergence should hold.
2. Port anything still relevant on a normal branch, through a normal PR — CI (`ci.yml`) runs the same lint/typecheck/test/build/manifest-validate gate as any other change here. There's no shortcut for upstream ports; unrelated histories mean cherry-picking won't apply cleanly, so re-implement by hand.
3. In that PR, bump `.github/upstream-sync-state.txt` to the new upstream SHA (the issue body has it) so the next scheduled run starts from where you left off.
4. Close the tracking issue once its commits are triaged — porting everything isn't required, explicitly deciding "not applicable" for a commit is a valid outcome, just note why in the issue before closing.
