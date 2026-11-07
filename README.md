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

In an article, embed lines from any GitHub file (they load through emgithub and follow the light/dark theme):

```html
<div class="gh-embed" data-target="https://github.com/OWNER/REPO/blob/COMMIT/path/to/file.cpp#L10-L29"></div>
```

Add `data-max-height="420"` to cap the height of long snippets.
