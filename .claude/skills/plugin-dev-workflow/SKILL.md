---
name: plugin-dev-workflow
description: Use this skill whenever doing development work on this Figma plugin (amino-helps) — implementing a new requirement/feature, fixing a bug, or otherwise editing code.ts, ui.html, manifest.json, or other plugin source. Governs branching, committing, and build/error-checking discipline for this repo. Load it BEFORE starting a new requirement and again before/after making edits.
---

# Plugin dev workflow

This repo is a Figma plugin (TypeScript `code.ts` → bundled `code.js` via esbuild, plus `ui.html`). Follow this workflow for every piece of dev work, no exceptions.

## 1. New requirement → new branch

Before starting work on any new requirement, feature, or fix:

1. Check current status first: `git status` (never branch away from uncommitted work — see rule 2 first if there is any).
2. Make sure you're branching from the latest `main`:
   ```
   git checkout main
   git pull
   ```
3. Create a new branch named for the work, using a conventional prefix:
   - `feature/<short-description>` for new requirements/features
   - `fix/<short-description>` for bug fixes
   - `chore/<short-description>` for tooling/maintenance
   ```
   git checkout -b feature/<short-description>
   ```

Never keep implementing unrelated requirements on the same branch. One branch per requirement/fix.

## 2. Commit after every implementation or fix

As soon as a requirement is implemented, or a fix is verified working:

1. Stage only the relevant files (avoid `git add -A` blindly — check `git status`/`git diff` first).
2. Commit using a **Conventional Commits** message, since commit history drives semantic versioning via `/version`:
   - `feat: ...` — new feature/requirement (minor bump)
   - `fix: ...` — bug fix (patch bump)
   - `perf: ...` — performance improvement (patch bump)
   - `refactor:`, `docs:`, `style:`, `test:`, `chore:`, `ci:` — no version bump
   - Add `!` after the type (e.g. `feat!:`) or a `BREAKING CHANGE:` footer for breaking changes (major bump)
3. Do not batch multiple unrelated requirements/fixes into one commit. Commit each logical unit of work separately, right after it's implemented and verified (step 3 below).
4. Never commit before the build/error check in step 3 passes.

## 3. Always check for errors and build before committing

After making any change to `code.ts`, `ui.html`, or `manifest.json`, before considering the work done or committing:

1. Type-check (esbuild strips types without checking them, so this step is required to catch type errors):
   ```
   npx tsc --noEmit
   ```
2. Lint:
   ```
   npx eslint .
   ```
3. Build the plugin:
   ```
   npm run build
   ```
4. Fix any errors/warnings surfaced by any of the three steps above before moving on. Do not commit code that fails type-check, lint, or build.

Only once all three pass should the change be committed (rule 2) or, for a completed requirement, considered ready for `/version`.
