# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The only project so far is `stream-platform/`: a static, Twitch-style "Browse" page mockup (top nav, collapsible recommended-channels sidebar, 3D hero carousel, stream/category card shelves) themed in a warm sepia palette with a fountain-pen logo. Plain HTML/CSS/vanilla JS — no framework, no build step, no package manager, no tests, no linter.

## Running

Open `stream-platform/index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server -d stream-platform 8000
```

## Architecture

- **`index.html`** is a static shell. All content regions are empty containers identified by id (`#channelList`, `#heroStage`, `#liveGrid`, `#categoryGrid`, `#chatGrid`) that `app.js` fills.
- **`app.js`** holds mock data (`STREAMS`, `CATEGORIES` — marked to be replaced by a real API) and renders everything via template-literal strings assigned to `innerHTML`. Shared helpers: `$` (querySelector), `fmtViewers` (e.g. `48K`, `1.3K`) and `avatar(s)`.
  - There are no images: stream thumbnails and category art are a flat mocha brown (`--thumb-bg` on `.thumb`); avatars are colored from each item's `hue` field via `avatar`. New stream items need a `hue`.
  - Hero carousel: `layoutHero()` positions every slide absolutely using its signed, wrapped distance from `heroIndex` (translate/scale/z-index/opacity set inline); `.is-center` marks the active slide. Navigation goes through `goTo(i)`.
- **`styles.css`** uses BEM-style class names (`block__element--modifier`, `is-*` state classes). All colors and layout sizes are CSS custom properties on `:root` (`--accent`, `--bg*`, `--text*`, `--nav-h`, `--side-w`, ...); change the theme there rather than hard-coding colors.
  - Sidebar collapse is a `side-collapsed` class toggled on `<body>`; the CSS hides labels and shrinks the sidebar/main offset from that.
  - Responsive breakpoints at 1200px, 920px, 600px, plus a `prefers-reduced-motion` block at the end of the file.
