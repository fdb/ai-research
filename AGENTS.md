Start by creating a new folder for your work with an appropriate name.

Create a notes.md file in that folder and append notes to it as you work, tracking what you tried and anything you learned along the way.

Build a README.md report at the end of the investigation.

For every experiment, we are trying to make an **explorable explanation** — a single self-contained interactive HTML page that lets the reader produce the phenomenon themselves rather than just read about it. See [EXPLORABLE_EXPLANATIONS.md](EXPLORABLE_EXPLANATIONS.md) for what that means in practice and when a different shape is appropriate. All experiments share a common visual system defined in [STYLE.md](STYLE.md) — read it before designing the page.

Your final commit should include just that folder and selected items from its contents:

- The notes.md and README.md files
- Any code you wrote along the way
- If you checked out and modified an existing repo, the output of "git diff" against that modified repo saved as a file - but not a copy of the full repo
- If appropriate, any binary files you created along the way provided they are less than 2MB in size

Do NOT include full copies of code that you fetched as part of your investigation. Your final commit should include only new files you created or diffs showing changes you made to existing code.

Don't create a _summary.md file - these are added automatically after you commit your changes.

Add an entry for the project to the root `index.html`. Inside the `.project-list` container, add a `.project-card` link with a title and one-line subtitle that points to the project's folder (e.g. `href="my-experiment/"`). Update the `.section-header` count accordingly. Follow the existing card markup as a template.
