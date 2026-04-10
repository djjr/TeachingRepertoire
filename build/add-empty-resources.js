#!/usr/bin/env node

/**
 * Add empty resources array to files that don't have one
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const COURSES_DIR = path.join(__dirname, '../courses');

function addResources(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data: frontmatter, content } = matter(raw);

  // Skip if already has resources
  if ('resources' in frontmatter) {
    return { skipped: true, reason: 'already has resources' };
  }

  // Add empty resources array
  frontmatter.resources = [];

  // Rebuild the file
  const newContent = matter.stringify(content, frontmatter);
  fs.writeFileSync(filePath, newContent);

  return { added: true };
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
console.log('Adding empty resources to files without it...\n');

const files = findMarkdownFiles(COURSES_DIR);

let added = 0;
let skipped = 0;

for (const file of files) {
  const relativePath = path.relative(COURSES_DIR, file);
  const result = addResources(file);

  if (result.added) {
    console.log(`  ✓ ${relativePath}`);
    added++;
  } else {
    skipped++;
  }
}

console.log(`\nAdded resources: ${added} files`);
console.log(`Already had resources: ${skipped} files`);
console.log('\nDone.');
