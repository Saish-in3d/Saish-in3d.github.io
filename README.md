# saish.in3d.in

Personal site with projects, portfolio and articles. Built with Jekyll and served by GitHub Pages.

## Editing

| To change | Edit |
|---|---|
| Project list (Projects page and "Current work" on home) | `_data/projects.yml` |
| Portfolio pieces | `portfolio.html`; put images in `assets/img/` and swap each placeholder `div` for an `<img>` |
| Colors and type | `assets/css/style.css` (variables at the top) |
| Hero shader | `assets/js/hero.js` |

## Writing an article

Add a Markdown file to `_posts/` named `YYYY-MM-DD-your-title.md`:

```markdown
---
layout: post
title: "Your title"
tags: [unreal, shaders]
---

Your text here.
```

Push to `main` and it appears on the Articles page within a minute or two.

## Custom domain

The `CNAME` file sets the domain to `saish.in3d.in`. DNS for `in3d.in` needs a CNAME record `saish` pointing to `saish-in3d.github.io`.
