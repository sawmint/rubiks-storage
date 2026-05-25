---
name: deploy
description: Deploy changes to GitHub Pages for the Rubik's Storage project. Use this skill whenever code, styles, JSON data, or any other site file has been modified, after the user confirms they're done with the changes (or implicitly when a logical chunk of work is complete). Also use when the user says "push", "deploy", "publish", "update the site", "ship it", or asks how to get changes live. The skill commits, bumps the PWA cache version if asset files changed, and pushes to GitHub - which auto-triggers a Pages rebuild within ~30-60 seconds. Do NOT use for purely exploratory changes the user hasn't approved.
---

# Deploy Rubik's Storage to GitHub Pages

The project at `/home/arjun/WebstormProjects/Rubik's Storage/` is hosted as a PWA at `https://sawmint.github.io/rubiks-storage/`. This skill runs the deploy workflow after code changes.

## When to invoke

- After making any user-approved file modification in this repo
- When the user says: "push", "deploy", "publish", "update the site", "ship", "make it live", or similar
- After completing a logical chunk of work (don't deploy mid-task; wait until current task is done)

**Don't invoke if:**
- The change is purely a local-only file (`.claude/launch.json`, `package.json` scripts the user uses locally, etc.)
- The user explicitly said "don't push yet" or is mid-debug

## Workflow

Run these steps in order. Don't skip steps.

### 1. Verify there are changes to push

```bash
cd "/home/arjun/WebstormProjects/Rubik's Storage"
git status --short
```

If `git status` is empty, tell the user there's nothing to deploy and stop.

### 2. Bump the PWA cache version (only if asset files changed)

Asset files = anything that ends up cached by the service worker. Check `sw.js` `CORE_ASSETS` array for the canonical list, but in practice this means: `index.html`, `styles.css`, `*.js`, `rubiks-cube-algorithms.json`, `icon.svg`, `manifest.webmanifest`.

If any of those changed, edit `sw.js` and increment the version:

```js
const CACHE_VERSION = "rs-v1";  // -> "rs-v2", then "rs-v3", etc.
```

Why: this forces installed PWAs to fetch the new files on next open instead of serving the cached old version.

If only `README.md` or other non-cached files changed, skip the bump.

### 3. Commit with a descriptive message

```bash
git add -A
git commit -m "<short summary of what changed>"
```

Write the commit message yourself based on the actual changes - don't ask the user. Keep it under 70 chars on the subject line. Examples:
- `Add reset-stats button to header`
- `Fix mobile layout for OLL recognition grid`
- `Switch F2L case 4 to alternate algorithm`

### 4. Push

```bash
git push
```

The SSH alias `github-rubiks` in `~/.ssh/config` handles auth via the deploy key at `~/.ssh/rubiks-storage-deploy`. Plain `git push` just works.

### 5. Tell the user

Report back with:
- What was committed (commit hash + message, one line)
- That GitHub Pages will rebuild in ~30-60 seconds
- The URL: `https://sawmint.github.io/rubiks-storage/`
- If cache version was bumped: mention installed PWAs will pick up the change on their next open (or refresh)

## Troubleshooting

**`git push` fails with auth error:**
The SSH key at `~/.ssh/rubiks-storage-deploy` may have been deleted or the SSH config alias removed. Check `~/.ssh/config` for the `Host github-rubiks` block and `cat ~/.ssh/rubiks-storage-deploy.pub` for the key. If both gone, you'd need to regenerate and re-add as a deploy key in the repo settings. Do not try to set up alternative auth without telling the user.

**Push succeeds but Pages doesn't update:**
GitHub Pages takes 30-90 seconds to rebuild. Check `https://github.com/sawmint/rubiks-storage/actions` for the "pages build and deployment" workflow status. If it fails, the user will see the error there.

**Repo URL changes (e.g., user renames repo):**
Update the remote: `git remote set-url origin github-rubiks:<new-owner>/<new-repo>.git`. Also update this file with the new GitHub Pages URL.
