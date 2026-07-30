---
description: Bump the plugin's semantic version using commit-and-tag-version, based on Conventional Commits since the last release tag.
---

Perform a semantic-version release for this repo using the `commit-and-tag-version` dev package (already installed as a devDependency, wired to `npm run release`). Do not hand-parse `git log` yourself — let the tool do the commit classification, version bump, changelog, commit, and tag. Argument (optional): `$ARGUMENTS` may be `major`, `minor`, `patch`, or `dry-run`.

Follow these steps in order:

1. **Check working tree is clean.** Run `git status`. If there are uncommitted changes, stop and tell the user to commit or stash first (per the plugin-dev-workflow skill, work should already be committed before versioning).

2. **Detect the branch and decide the release mode.** Run `git branch --show-current`.
   - If the branch is `main` (or `master`), this is a **normal release** — no prerelease suffix.
   - Otherwise, this is a **branch release**: sanitize the branch name into a prerelease identifier by lowercasing it and replacing every run of non-alphanumeric characters with a single `-`, then trimming leading/trailing `-` (e.g. `fix/plugin-ui-sizing-and-cta-color` → `fix-plugin-ui-sizing-and-cta-color`). This identifier is passed to `commit-and-tag-version` via `--prerelease <identifier>`, which produces versions like `1.1.0-fix-plugin-ui-sizing-and-cta-color.0` instead of a bare `1.1.0`. This keeps branch-local bumps out of the main version sequence so two branches (or a branch and main) never collide on the same version number when merged.

3. **Preview first.** Run:
   ```
   npx commit-and-tag-version --dry-run
   ```
   (add `--prerelease <identifier>` from step 2 if this is a branch release)

   This prints the computed bump, the new version, and the changelog entry it would write, without touching any files. Show this output to the user.

   - If `$ARGUMENTS` is `dry-run`, stop here — do not proceed further.
   - If `$ARGUMENTS` is `major`, `minor`, or `patch`, re-run the dry-run with `--release-as $ARGUMENTS` (in addition to `--prerelease` if applicable) and show that instead, so the override is visible before committing to it.
   - If the dry-run reports no relevant commits (only `chore:`/`docs:`/etc. since the last tag), report that and stop without releasing.

4. **Run the plugin-dev-workflow build check** before finalizing anything: `npx tsc --noEmit`, `npx eslint .`, `npm run build`. Fix anything broken before proceeding.

5. **Apply the release**:
   ```
   npm run release
   ```
   (append `-- --prerelease <identifier>` if this is a branch release, and/or `--release-as $ARGUMENTS` if the user forced a bump type in step 3 — combine both if both apply, e.g. `npm run release -- --prerelease fix-plugin-ui-sizing-and-cta-color --release-as minor`)

   This bumps `version` in `package.json`/`package-lock.json`, updates `CHANGELOG.md`, commits as `chore(release): vX.Y.Z`, and creates the annotated tag `vX.Y.Z`. Config lives in `.versionrc.json`.

6. **Summarize** the release: old → new version, bump type, whether a branch prerelease identifier was applied, and the changelog entries. Ask the user before running `git push --follow-tags` — never push automatically.
