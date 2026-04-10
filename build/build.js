#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const matter = require('gray-matter');
const { marked } = require('marked');

// Configure marked renderer
marked.use({
  renderer: {
    link(href, title, text) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image(href, title, text) {
      // marked v12+ passes an object, not individual args
      const imgHref = typeof href === 'object' ? href.href : href;
      const imgTitle = typeof href === 'object' ? href.title : title;
      const imgText = typeof href === 'object' ? href.text : text;

      // Detect base64 images and replace with warning
      if (imgHref && imgHref.startsWith('data:')) {
        const altInfo = imgText ? ` (alt: "${imgText}")` : '';
        console.warn(`    ⚠ Base64 image skipped${altInfo}`);
        return `<div style="padding: 12px; margin: 8px 0; background: rgba(255,150,50,0.15); border: 1px solid rgba(255,150,50,0.4); border-radius: 8px; font-size: 0.85em;">
          ⚠️ <strong>Base64 image omitted</strong>${altInfo}<br>
          <span style="opacity: 0.7;">Replace with a web URL for this image to display.</span>
        </div>`;
      }
      // Normal image
      const titleAttr = imgTitle ? ` title="${imgTitle}"` : '';
      const altAttr = imgText ? ` alt="${imgText}"` : '';
      return `<img src="${imgHref}"${altAttr}${titleAttr}>`;
    }
  }
});

const COURSES_DIR = path.join(__dirname, '../courses');
const DIST_DIR = path.join(__dirname, '..');  // Output to cards/ directory

function buildCourse(courseDir) {
  const courseName = path.basename(courseDir);

  // Load course metadata from _course.md (frontmatter) or _course.yaml
  let courseMeta;
  const courseMdPath = path.join(courseDir, '_course.md');
  const courseYamlPath = path.join(courseDir, '_course.yaml');

  if (fs.existsSync(courseMdPath)) {
    const raw = fs.readFileSync(courseMdPath, 'utf8');
    const { data } = matter(raw);
    courseMeta = data;
  } else if (fs.existsSync(courseYamlPath)) {
    courseMeta = yaml.load(fs.readFileSync(courseYamlPath, 'utf8'));
  } else {
    console.warn(`  Skipping ${courseName}: no _course.md or _course.yaml found`);
    return;
  }

  // Find all sessions - either .md files or folders containing .md files
  const entries = fs.readdirSync(courseDir, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    // Skip special files/folders
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    if (entry.name === 'images' || entry.name === 'imagesMetadata') continue;

    if (entry.isFile() && entry.name.endsWith('.md')) {
      // Simple session: just a .md file
      sessions.push({
        type: 'simple',
        name: entry.name,
        mdPath: path.join(courseDir, entry.name),
        folderPath: null
      });
    } else if (entry.isDirectory()) {
      // Folder-based session: look for matching .md file inside
      const folderPath = path.join(courseDir, entry.name);
      const possibleMdFile = path.join(folderPath, `${entry.name}.md`);

      if (fs.existsSync(possibleMdFile)) {
        sessions.push({
          type: 'folder',
          name: entry.name,
          mdPath: possibleMdFile,
          folderPath: folderPath
        });
      }
    }
  }

  const cards = [];

  for (const session of sessions) {
    const raw = fs.readFileSync(session.mdPath, 'utf8');
    const { data: frontmatter, content } = matter(raw);

    // Build tabs array
    const tabs = [];

    // Tab 1: Main session content (always first, labeled with session title)
    const sessionTitle = frontmatter.title || 'Untitled';
    tabs.push({
      label: sessionTitle,
      type: 'markdown',
      content: content.trim()
    });

    // Tab 2+: External resources from frontmatter
    const resources = frontmatter.resources || [];
    for (const resource of resources) {
      if (resource.url && resource.tab) {
        tabs.push({
          label: resource.tab,
          type: 'iframe',
          url: resource.url
        });
      }
    }

    // Tab 3+: Local files from tabs/ folder (if folder-based session)
    if (session.folderPath) {
      const tabsDir = path.join(session.folderPath, 'tabs');
      if (fs.existsSync(tabsDir)) {
        const tabFiles = fs.readdirSync(tabsDir)
          .filter(f => f.endsWith('.md') && !f.startsWith('_'))
          .sort();

        for (const tabFile of tabFiles) {
          // Derive label from filename
          const label = path.basename(tabFile, '.md')
            .replace(/[-_]/g, ' ')
            .replace(/^\d+\s*/, ''); // Remove leading numbers

          // Read the markdown content
          const tabPath = path.join(tabsDir, tabFile);
          const tabContent = fs.readFileSync(tabPath, 'utf8');

          tabs.push({
            label: label || tabFile,
            type: 'markdown',
            content: tabContent.trim()
          });
        }
      }
    }

    // Build card object
    cards.push({
      id: frontmatter.id || path.basename(session.name, '.md'),
      title: sessionTitle,
      subtitle: frontmatter.subtitle || '',
      type: frontmatter.type || courseMeta.defaultType || 'session',
      order: frontmatter.order ?? cards.length + 1,
      tabs: tabs,
      // Keep legacy fields for backward compatibility
      pageContentHtml: marked(content.trim()),
      moreURL: resources.length > 0 ? resources[0].url : ''
    });
  }

  // Sort by order
  cards.sort((a, b) => a.order - b.order);

  // Generate card app JS module
  const output = generateCardAppModule(courseMeta, cards);
  const outputPath = path.join(DIST_DIR, `${courseName}-built.js`);
  fs.writeFileSync(outputPath, output);
  console.log(`  ✓ ${outputPath} (${cards.length} cards)`);
}

function generateCardAppModule(meta, cards) {
  // Pretty-print cards with proper escaping
  const cardsJson = JSON.stringify(cards, null, 2);

  return `// ${meta.id}.js
// Generated from Obsidian vault - do not edit directly
// Source: courses/${meta.id}/

export const collectionTitle = ${JSON.stringify(meta.title)};
export const collectionSubtitle = ${JSON.stringify(meta.subtitle || '')};
export const cardsData = ${cardsJson};
`;
}

// --- Main ---
const args = process.argv.slice(2);
const watchMode = args.includes('--watch') || args.includes('-w');
const targetCourse = args.find(a => !a.startsWith('-'));

function getCourseDirs() {
  return fs.readdirSync(COURSES_DIR)
    .map(d => path.join(COURSES_DIR, d))
    .filter(d => fs.statSync(d).isDirectory())
    .filter(d => !targetCourse || path.basename(d) === targetCourse);
}

function buildAll() {
  const courseDirs = getCourseDirs();
  if (courseDirs.length === 0) {
    console.log('No courses found in', COURSES_DIR);
    return;
  }
  for (const courseDir of courseDirs) {
    console.log(`${path.basename(courseDir)}/`);
    buildCourse(courseDir);
  }
}

// Build manifest of all courses
function buildManifest() {
  const courseDirs = getCourseDirs();
  const courses = [];

  for (const courseDir of courseDirs) {
    const courseName = path.basename(courseDir);
    const courseMdPath = path.join(courseDir, '_course.md');
    const courseYamlPath = path.join(courseDir, '_course.yaml');

    let courseMeta;
    if (fs.existsSync(courseMdPath)) {
      const raw = fs.readFileSync(courseMdPath, 'utf8');
      const { data } = matter(raw);
      courseMeta = data;
    } else if (fs.existsSync(courseYamlPath)) {
      courseMeta = yaml.load(fs.readFileSync(courseYamlPath, 'utf8'));
    }

    if (courseMeta && courseMeta.title) {
      courses.push({
        file: `${courseName}-built`,
        title: courseMeta.title,
        subtitle: courseMeta.subtitle || ''
      });
    }
  }

  // Sort alphabetically by title
  courses.sort((a, b) => a.title.localeCompare(b.title));

  const manifestPath = path.join(DIST_DIR, 'courses.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ courses }, null, 2));
  console.log(`✓ ${manifestPath} (${courses.length} courses)\n`);
}

// Initial build
console.log('Building courses...\n');
buildManifest();
buildAll();
console.log('\nDone.');

// Watch mode
if (watchMode) {
  console.log('\nWatching for changes... (Ctrl+C to stop)\n');

  const courseDirs = getCourseDirs();

  for (const courseDir of courseDirs) {
    const courseName = path.basename(courseDir);

    // fs.watch monitors a directory for file changes
    // It calls the callback whenever a file is created, modified, or deleted
    // recursive: true catches changes in subdirectories like tabs/
    fs.watch(courseDir, { recursive: true }, (eventType, filename) => {
      // Only rebuild for markdown file changes
      if (!filename || !filename.endsWith('.md')) return;

      // Debounce: ignore rapid successive events (editors often trigger multiple)
      const now = Date.now();
      if (!fs.watch.lastBuild) fs.watch.lastBuild = {};
      if (now - (fs.watch.lastBuild[courseName] || 0) < 1000) return;
      fs.watch.lastBuild[courseName] = now;

      console.log(`[${new Date().toLocaleTimeString()}] ${filename} changed → rebuilding ${courseName}/`);

      // Retry logic: if build fails (e.g., file mid-save), wait and retry once
      try {
        buildCourse(courseDir);
        console.log('  ✓ Ready\n');
      } catch (err) {
        console.log(`  ⚠ Build failed, retrying in 1s...`);
        setTimeout(() => {
          try {
            buildCourse(courseDir);
            console.log('  ✓ Ready (retry succeeded)\n');
          } catch (retryErr) {
            console.error(`  ✗ Build failed: ${retryErr.message}\n`);
          }
        }, 1000);
      }
    });

    console.log(`  Watching: ${courseName}/`);
  }
}
