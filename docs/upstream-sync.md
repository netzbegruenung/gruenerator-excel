# Staying in sync with upstream

This repo shares full git history with [tmustier/pi-for-excel](https://github.com/tmustier/pi-for-excel) — it was created by cloning it and repointing `origin`, not via GitHub's "Fork" button, so GitHub doesn't show it as a fork (`fork: false` in the API, no "Sync fork" button) and there's no native contribute-back path. But `git merge-base gruenerator upstream/main` resolves to a real shared commit, so plain `git merge upstream/main` works exactly like it would on a native fork.

## Two layers of upstream

- **`@earendil-works/pi-agent-core` / `pi-ai` / `pi-web-ui`** — the npm packages upstream itself depends on. Kept current automatically by the `pi-stack` Dependabot group (`.github/dependabot.yml`) and auto-merged by `.github/workflows/dependabot-pi-automerge.yml` once CI is green. This repo can (and has) moved ahead of upstream's own pinned versions here — check `package.json` on both sides before assuming a type/lint failure is something upstream already fixed; it may be a regression from being *ahead*, not behind.
- **tmustier/pi-for-excel source itself** — the actual add-in code this repo diverged from (UI layer, tools, auth, deployment). That's what this process covers.

## The automated check

[`.github/workflows/upstream-sync-check.yml`](../.github/workflows/upstream-sync-check.yml) runs weekly (and on demand via `workflow_dispatch`):

1. Fetches `upstream/main` from `tmustier/pi-for-excel`.
2. Computes `git merge-base HEAD upstream/main` and diffs upstream past that point — no separate state file to keep in sync; once something's actually merged, the merge-base moves forward on its own.
3. If there's anything new and no `upstream-sync`-labeled PR/issue is already open:
   - Attempts `git merge upstream/main` on a throwaway branch.
   - **Clean merge** → pushes the branch and opens a PR against `gruenerator` directly. CI and the required review on `gruenerator` gate it like any other change.
   - **Conflict** → aborts the merge and files a tracking issue instead, with the commit list and manual-resolution steps.

## Manual sync

You don't need to wait for the schedule — this works like any other fork:

```bash
git remote add upstream https://github.com/tmustier/pi-for-excel.git   # once
git fetch upstream main
git checkout -b upstream-sync/manual gruenerator
git merge upstream/main
```

Cross-check conflicts (or anything that merges cleanly but looks suspicious) against [docs/upstream-divergences.md](upstream-divergences.md) — a textually clean merge can still silently reintroduce something we deliberately diverged on (the pi-web-ui removal, the Grünerator gateway, etc.). Open a PR as usual; there's no shortcut around CI + review for upstream merges.

## Why not a native GitHub fork?

Recreating this repo as a real `gh repo fork` would get the "forked from" badge and native "Sync fork" button, but this repo is deeply wired into production (`ghcr.io/netzbegruenung/gruenerator-excel` image name, the `gruenerator-docker` Salt state, CORS/CSP allowlists — see [DEPLOYMENT.md](../DEPLOYMENT.md)) plus branch protection, Dependabot/secret-scanning state, and CI secrets that would all need re-creating. Not worth the production risk for a cosmetic badge, since the functional part (real `git merge`) already works without it. If you need to send a fix back to tmustier/pi-for-excel, make a separate, disposable `gh repo fork` of it just for that PR — it doesn't need any of our Grünerator-specific history.
