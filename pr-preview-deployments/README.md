# PR Preview Deployments via GitHub Pages

Every pull request gets its own live preview at
`https://<owner>.github.io/<repo>/pr-<num>/`. The URL is posted on the PR and
the directory is deleted when the PR closes. The live site on `main` keeps
working alongside the previews.

## How it works

```
                 push to main                    pull_request
                      │                                │
                      ▼                                ▼
        .github/workflows/deploy.yml      .github/workflows/pr-preview.yml
                      │                                │
                      ▼                                ▼
              gh-pages branch ◄────────── pr-<num>/ subfolder
                      │
                      ▼
        https://<owner>.github.io/<repo>/
        https://<owner>.github.io/<repo>/pr-<num>/
```

Two workflows write to a single `gh-pages` branch:

- **`deploy.yml`** runs on push to `main`. It rsyncs the repo (minus `.git`
  and `.github`) into the **root** of `gh-pages`, but excludes `pr-*/` from
  the clean step so PR previews survive.
- **`pr-preview.yml`** runs on `pull_request` events:
  - `opened` / `reopened` / `synchronize` → publish to `pr-<num>/` and post
    (or update) a sticky comment with the preview URL.
  - `closed` → delete `pr-<num>/` from `gh-pages` and update the comment.

GitHub Pages serves the branch, so as soon as either workflow pushes, the URL
is live (typically within a minute).

## One-time setup

1. **Enable Pages from the `gh-pages` branch.**
   Repo → Settings → Pages → *Build and deployment*:
   - Source: **Deploy from a branch**
   - Branch: **`gh-pages`** / **`/ (root)`**

   (The first run of `deploy.yml` creates the branch if it doesn't exist.)

2. **Confirm Actions can push.**
   Repo → Settings → Actions → General → *Workflow permissions*:
   - **Read and write permissions** must be enabled, otherwise the deploy
     action can't push to `gh-pages`.

3. **Merge `deploy.yml` to `main` first.** That populates the root of
   `gh-pages` so the live site is up before any PR previews land.

No secrets to configure — the built-in `GITHUB_TOKEN` is sufficient.

## File layout

```
.github/workflows/
├── deploy.yml        # main → gh-pages root (preserves pr-*/)
└── pr-preview.yml    # PR  → gh-pages/pr-<num>/  (+ cleanup on close)
```

The site itself doesn't change: whatever lives at the repo root is what gets
published. Add a build step before the *Stage site* step in either workflow
if that ever stops being true.

## Behaviour, by event

| Event                       | Result                                                                |
| --------------------------- | --------------------------------------------------------------------- |
| Push to `main`              | Root of `gh-pages` updated. `pr-*/` directories untouched.            |
| PR opened / new commit      | `pr-<num>/` (re)deployed. Sticky comment updated with URL + SHA.      |
| PR closed (merged or not)   | `pr-<num>/` deleted from `gh-pages`. Sticky comment marks it removed. |
| PR from a fork              | Skipped silently — see *Forks* below.                                 |

The PR preview job uses `concurrency: pr-preview-<num>` with
`cancel-in-progress: true`, so rapid pushes to a PR don't pile up — only the
latest commit's preview gets published.

## Design choices

**`gh-pages` branch over Pages preview environments.** GitHub's newer
`actions/deploy-pages` flow assumes one deployment per environment, which
fights the "live site + N concurrent PR previews" model. The classic
branch-with-subfolders pattern handles many concurrent previews trivially and
matches the URL the user asked for.

**Hand-rolled over `rossjrw/pr-preview-action`.** That action does this job
well — it's a reasonable swap-in. The hand-rolled version is short enough to
read top-to-bottom and uses the user's exact `pr-<num>/` path (the action
defaults to `pr-preview/pr-<num>/`).

**`clean-exclude: pr-*` on the main deploy.** Without this, every push to
`main` would wipe every active preview. With it, main and PR jobs can write
to disjoint subtrees of the same branch without stepping on each other.

**Sticky comments via `marocchino/sticky-pull-request-comment`.** A single
edited-in-place comment per PR (keyed by `header: pr-preview`) instead of one
new comment per push.

**Forks are skipped, not failed.** `pull_request` from a fork only gives the
workflow a read-only `GITHUB_TOKEN`, so a deploy attempt would fail. Both
jobs gate on
`github.event.pull_request.head.repo.full_name == github.repository`. The
alternative — `pull_request_target` — would run trusted workflow code with
write privileges against untrusted PR content, which is a known
supply-chain hazard for anything beyond a trivially safe build. Not worth it
for a static-site preview.

## Caveats

- **Forks don't get auto-previews.** External contributors need a maintainer
  to push their branch to the repo (or trigger a manual deploy from `main`)
  to get a preview. That's the safe default.
- **Two jobs share one branch.** Main deploys and PR deploys run in
  different concurrency groups, so they can race. `JamesIves/github-pages-deploy-action`
  retries on push conflicts, which has been enough in practice. If that
  becomes flaky, move both into the same `gh-pages` group at the cost of
  serializing all deploys.
- **`gh-pages` history grows forever.** Each deploy is a new commit. For a
  small site this is fine; for a large one, periodically squash the branch
  or set `single-commit: true` on the deploy action (note: this destroys
  history, including in-flight `pr-*/` directories — only safe with
  per-deploy preservation logic).
- **Pages cache.** The Pages CDN can take ~30-60s to reflect new pushes; the
  workflow finishes before the URL is necessarily live.

## Files in this project folder

- `notes.md` — working notes from setting this up.
- `README.md` — this report.
- `index.html` — minimal landing page (so the site card on the root index
  doesn't 404 on GitHub Pages).

The actual workflows live in [`.github/workflows/`](../.github/workflows/) at
the repo root, since that's where GitHub looks for them.
