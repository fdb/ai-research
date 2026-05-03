# PR Preview Deployments — Working Notes

## Goal

Set up GitHub Pages so every pull request gets its own live preview at
`https://<owner>.github.io/<repo>/pr-<num>/`, with the URL posted to the PR
and the directory cleaned up when the PR closes.

## Repo shape

- Static site, no build step — root has `index.html`, projects in subfolders
  (e.g. `font-format-explorer/`).
- `main` is the source branch.
- No prior workflows in `.github/workflows/`.

## Design decisions

### Branch model: `gh-pages` as the publish branch

Two viable options for hosting previews:

1. **`gh-pages` branch** with `pr-<num>/` subfolders. Pages source = `gh-pages`
   branch, root.
2. **GitHub Pages "preview" environments** (deploy via `actions/deploy-pages`).
   Cleaner, but only one site per Pages environment — to host both the live
   site and N PR previews you'd still need per-PR paths somewhere, and the
   "single deployment" model fights that.

Picked option 1 — it's the well-trodden path, the URL pattern the user asked
for, and it works without juggling multiple environments.

### Two workflows, one publish branch

- `deploy.yml` — on push to `main`, sync the site into the **root** of
  `gh-pages` while preserving any `pr-*/` directories that exist.
- `pr-preview.yml` — on `pull_request` (opened/reopened/synchronize/closed):
  - deploy or update `pr-<num>/` on `gh-pages`
  - sticky-comment the URL onto the PR
  - on `closed`, delete `pr-<num>/` and update the comment

Splitting them keeps each workflow focused and the concurrency groups simple.

### Concurrency

- Main deploy uses `group: gh-pages` (serial) so two pushes to main don't race
  each other on the publish branch.
- PR preview uses `group: pr-preview-${{ pr.number }}` with
  `cancel-in-progress: true` — a new push to a PR cancels the in-flight build
  for that PR, but doesn't block other PRs.
- Main and PR jobs can still race each other on the publish branch (different
  groups). `JamesIves/github-pages-deploy-action` retries on push conflicts,
  which handles it. If we wanted strict serialization we'd put both in the
  same `gh-pages` group at the cost of throughput.

### Preserving previews on main deploy

Default `gh-pages` deploy actions clean the publish branch before writing the
new tree, which would nuke every `pr-*/` directory. `JamesIves/github-pages-deploy-action`
exposes `clean-exclude` for exactly this — keep `pr-*` on main deploys.

### Forks: skip, don't fail

`pull_request` from a fork gives the workflow a read-only `GITHUB_TOKEN` —
deploy will fail. Both jobs gate on
`github.event.pull_request.head.repo.full_name == github.repository`
so fork PRs are skipped silently rather than producing red Xs on every push.

`pull_request_target` would let fork PRs deploy but it runs **trusted**
workflow code with **untrusted** PR content's write token — checking out
`head.sha` and running anything from it is a known supply-chain footgun.
Not worth it for a static-site preview.

### Sticky comments

`marocchino/sticky-pull-request-comment` keeps a single comment per PR
identified by a `header:` key, edited in place on each redeploy. Beats
spamming the PR with one comment per push.

## Things I considered and dropped

- **`rossjrw/pr-preview-action`** — purpose-built for this exact pattern.
  Solid choice if you want a one-liner. I went hand-rolled because the user's
  spec was specific (`pr-<num>/`, not the action's `pr-preview/pr-<num>/`)
  and the workflow is short enough to read top-to-bottom.
- **Pages preview environments via `actions/deploy-pages`** — see above; one
  deployment per environment doesn't fit the "many concurrent PR previews +
  live site" model.
- **Single workflow with three jobs** — readable but harder to reason about
  triggers. Two files maps 1:1 to two responsibilities.

## Manual setup the workflow can't do

GitHub Pages source has to be configured once in the repo Settings:
**Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `gh-pages` / `(root)`**. Documented this in the README.

The first run of `deploy.yml` creates the `gh-pages` branch if it doesn't
exist (the deploy action handles that).
