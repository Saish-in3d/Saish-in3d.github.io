# Saish Sakharkar

Personal site, built with Jekyll and served by GitHub Pages.

## Writing an article

Add a Markdown file to `_posts/` named `YYYY-MM-DD-your-title.md`:

```markdown
---
layout: post
title: "Your title"
---

Your text here.
```

Push to `main` and it appears in the Articles list on the home page.

## Editing

- Colors and fonts: `assets/css/style.css` (dark theme at the top, light theme below it)
- Home page: `index.html`
- Project details for later: `_data/projects.yml`

## Embedding code from GitHub

In an article, embed lines from any GitHub file. They load straight from GitHub and use the site's code colors in both themes:

```html
<div class="gh-embed" data-target="https://github.com/OWNER/REPO/blob/COMMIT/path/to/file.cpp#L10-L29"></div>
```

Add `data-max-height="420"` to cap the height of long snippets.

## Diagrams

Excalidraw diagrams live in `assets/diagrams/` as SVGs exported from the Excalidraw files in BlogVault. In an article:

```html
<figure class="diagram"><a href="/assets/diagrams/NAME.svg"><img src="/assets/diagrams/NAME.svg" alt="Description" loading="lazy"></a></figure>
```

They switch to Excalidraw's dark style automatically in dark mode.
