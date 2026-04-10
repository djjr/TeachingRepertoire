# TeachingRepertoire / Cards

An interactive card-grid viewer for course materials. Markdown source files are compiled into JS data modules and displayed in a browser UI.

## Structure

```
cards/
├── courses/              # Source files (gitignored, Obsidian-synced)
│   └── <course-name>/
│       ├── _course.md    # Course metadata (id, title, subtitle)
│       └── NN-card.md    # Individual cards (frontmatter + markdown body)
├── build/                # Build tooling (gitignored except output)
│   ├── build.js          # Main build script
│   ├── process-images.js # Image processing helper
│   └── package.json
├── *-built.js            # Compiled output (committed to git)
├── courses.json          # Course index (committed to git)
└── index.html            # Single-page viewer app
```

## Workflow

**Edit** — Add/edit markdown files in `courses/<name>/`. Each file becomes a card.

**Build** — Compiles all courses into `*-built.js` files:
```bash
cd build && node build.js
```

**Preview** — Requires a local server (ES modules blocked over `file://`):
```bash
python3 -m http.server 8000
# or
npx serve .
```
Then open `http://localhost:8000`.

**Commit** — The built `.js` files and `courses.json` go into git; source `courses/` and `build/` tooling do not.

## Card frontmatter

```yaml
---
id: unique-id
title: Card Title
subtitle: Optional subtitle
type: session       # or: section
order: 1
resources: []
---
Markdown body here.
```

## Courses

| File | Title |
|------|-------|
| `ct` | Computational Reasoning |
| `hmia` | Human and Machine Intelligence Alignment |
| `hcd` | Human Centred Design |
| `ants-brains-cities-software` | Ants, Brains, Cities, and Software |
| `design-thinking-for-higher-education` | Design Thinking for Higher Education |

## Git / Obsidian

Obsidian syncs file content; git tracks history. They coexist — but Obsidian sync does not substitute for `git commit`. Commit and push here after making changes.
