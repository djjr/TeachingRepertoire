#!/usr/bin/env node

/**
 * Migration script: Convert moreURL to resources array
 *
 * Before:
 *   moreURL: https://slides.com/djjr/flow
 *
 * After:
 *   resources:
 *     - tab: Slides
 *       url: https://slides.com/djjr/flow
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const COURSES_DIR = path.join(__dirname, '../courses');

function migrateFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data: frontmatter, content } = matter(raw);

  // Check if has moreURL
  if (!('moreURL' in frontmatter)) {
    return { skipped: true, reason: 'no moreURL' };
  }

  // Check if already has resources
  if (frontmatter.resources) {
    return { skipped: true, reason: 'already has resources' };
  }

  const moreURL = frontmatter.moreURL;

  // Remove moreURL
  delete frontmatter.moreURL;

  // Add resources array if URL is not empty
  if (moreURL && moreURL.trim()) {
    frontmatter.resources = [
      { tab: 'Slides', url: moreURL.trim() }
    ];
  }

  // Rebuild the file
  const newContent = matter.stringify(content, frontmatter);
  fs.writeFileSync(filePath, newContent);

  return {
    migrated: true,
    hadUrl: !!(moreURL && moreURL.trim())
  };
}

function findMarkdownFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip hidden folders, images, imagesMetadata, tabs
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') ||
          entry.name === 'images' ||
          entry.name === 'imagesMetadata' ||
          entry.name === 'tabs') {
        continue;
      }
      results = results.concat(findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
      results.push(fullPath);
    }
  }
  return results;
}

// Main
console.log('Migrating moreURL → resources...\n');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

if (dryRun) {
  console.log('DRY RUN - no files will be modified\n');
}

const files = findMarkdownFiles(COURSES_DIR);

let migrated = 0;
let skipped = 0;
let withUrl = 0;

for (const file of files) {
  const relativePath = path.relative(COURSES_DIR, file);

  if (dryRun) {
    const raw = fs.readFileSync(file, 'utf8');
    const { data } = matter(raw);
    if ('moreURL' in data && !data.resources) {
      console.log(`  Would migrate: ${relativePath}`);
      if (data.moreURL && data.moreURL.trim()) {
        console.log(`    → resources: [{ tab: Slides, url: ${data.moreURL} }]`);
      } else {
        console.log(`    → (empty moreURL, just removing)`);
      }
      migrated++;
    }
  } else {
    const result = migrateFile(file);
    if (result.migrated) {
      console.log(`  ✓ ${relativePath}${result.hadUrl ? ' (with Slides URL)' : ' (empty)'}`);
      migrated++;
      if (result.hadUrl) withUrl++;
    } else {
      skipped++;
    }
  }
}

console.log(`\n${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated} files`);
if (!dryRun) {
  console.log(`  With Slides URL: ${withUrl}`);
  console.log(`  Empty (removed): ${migrated - withUrl}`);
}
console.log(`Skipped: ${skipped} files`);
console.log('\nDone.');
