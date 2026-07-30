---
description: Bump the plugin's semantic version based on Conventional Commits since the last release tag, update package.json, and tag the release.
---

Perform a semantic-version release for this repo based on Conventional Commits. Argument (optional): `$ARGUMENTS` may be `major`, `minor`, `patch`, or `dry-run` to override the computed bump / preview without changing anything. If empty, compute the bump automatically.

Follow these steps in order:

1. **Check working tree is clean.** Run `git status`. If there are uncommitted changes, stop and tell the user to commit or stash first (per the plugin-dev-workflow skill, work should already be committed before versioning).

2. **Find the last release tag.**
   ```
   git describe --tags --abbrev=0 --match 'v*' 2>/dev/null
   ```
   If no tag exists, use the repo's first commit as the range start and treat the current `package.json` `version` as the baseline (default to `0.1.0` if it's still `1.0.0`/unset from a template).

3. **Collect commits since that tag** on the current branch:
   ```
   git log <last-tag>..HEAD --pretty=format:'%s%n%b%n---'
   ```

4. **Classify each commit** by its Conventional Commit type prefix (`type(scope)!: subject`):
   - Any commit with `BREAKING CHANGE:` in the body, or `!` right after the type/scope (e.g. `feat!:`, `fix(ui)!:`) → **major**
   - Else any `feat:` commit → **minor**
   - Else any `fix:` or `perf:` commit → **patch**
   - `refactor:`, `docs:`, `style:`, `test:`, `chore:`, `ci:`, `build:` alone → no bump on their own
   - If commits don't follow Conventional Commits at all, tell the user which ones and ask how to classify them rather than guessing.

5. **Determine the version bump**: major > minor > patch, using the highest-severity match found. If `$ARGUMENTS` is `major`, `minor`, or `patch`, use that instead of the computed value (but still show what was computed, so the override is visible). If nothing qualifies for a bump (only chore/docs/etc.), report that and stop without releasing.

6. **Compute the new version** from the current `version` field in `package.json` using standard semver rules (major resets minor/patch to 0, minor resets patch to 0).

7. **If `$ARGUMENTS` is `dry-run`**: print the computed bump type, old version, new version, and the categorized commit list, then stop — do not modify or commit anything.

8. **Apply the version bump**:
   - Update `version` in `package.json` (use `npm version <new-version> --no-git-tag-version` or edit directly).
   - Run the plugin-dev-workflow build check: `npx tsc --noEmit`, `npx eslint .`, `npm run build`. Fix anything broken before proceeding.

9. **Commit and tag**:
   ```
   git add package.json package-lock.json
   git commit -m "chore(release): vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```

10. **Summarize** the release: old → new version, bump type and why (which commits triggered it), and the changelog (grouped by feat/fix/other). Ask the user before running `git push` / `git push --tags` — never push automatically.
