#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COURSES_DIR = path.join(__dirname, '../courses');
const THUMB_WIDTH = 200;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// Optional EXIF support
let ExifParser;
try {
  ExifParser = require('exif-parser');
} catch (e) {
  console.warn('exif-parser not installed. EXIF extraction disabled.');
  console.warn('To enable: npm install exif-parser');
}

function titleFromFilename(filename) {
  // Remove extension, replace separators with spaces, title case
  const name = path.basename(filename, path.extname(filename));
  return name
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase to spaces
    .replace(/\s+/g, ' ')
    .trim();
}

function slugFromFilename(filename) {
  // Handle full paths - include directory structure in slug
  const ext = path.extname(filename);
  const withoutExt = filename.slice(0, -ext.length || undefined);
  return withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function extractExif(imagePath) {
  if (!ExifParser) return {};

  try {
    const ext = path.extname(imagePath).toLowerCase();
    // EXIF only in JPEG/TIFF typically
    if (ext !== '.jpg' && ext !== '.jpeg') return {};

    const buffer = fs.readFileSync(imagePath);
    const parser = ExifParser.create(buffer);
    const result = parser.parse();

    return {
      width: result.imageSize?.width,
      height: result.imageSize?.height,
      dateTaken: result.tags?.DateTimeOriginal
        ? new Date(result.tags.DateTimeOriginal * 1000).toISOString().split('T')[0]
        : null,
      camera: result.tags?.Model || null,
      cameraMake: result.tags?.Make || null,
    };
  } catch (e) {
    // EXIF parsing failed, not a problem
    return {};
  }
}

function getImageDimensions(imagePath) {
  try {
    // Use sips (macOS) to get dimensions
    const output = execSync(`sips -g pixelWidth -g pixelHeight "${imagePath}" 2>/dev/null`, { encoding: 'utf8' });
    const widthMatch = output.match(/pixelWidth:\s*(\d+)/);
    const heightMatch = output.match(/pixelHeight:\s*(\d+)/);
    return {
      width: widthMatch ? parseInt(widthMatch[1]) : null,
      height: heightMatch ? parseInt(heightMatch[1]) : null
    };
  } catch (e) {
    return {};
  }
}

function generateThumbnail(imagePath, thumbPath) {
  try {
    const ext = path.extname(imagePath).toLowerCase();

    // Copy the file first
    fs.copyFileSync(imagePath, thumbPath);

    // Use sips (macOS) to resize - works for jpg, png, gif
    execSync(`sips -Z ${THUMB_WIDTH} "${thumbPath}" 2>/dev/null`, { encoding: 'utf8' });

    return true;
  } catch (e) {
    console.warn(`    Could not generate thumbnail: ${e.message}`);
    // Clean up failed thumbnail
    try { fs.unlinkSync(thumbPath); } catch {}
    return false;
  }
}

async function processImage(imagePath, metadataDir, imagesDir, relativePath) {
  const filename = path.basename(imagePath);
  const slug = slugFromFilename(relativePath); // Include subdir in slug for uniqueness
  const ext = path.extname(filename);
  const metadataPath = path.join(metadataDir, `${slug}.md`);

  // Skip if metadata already exists
  if (fs.existsSync(metadataPath)) {
    console.log(`    Skipping ${relativePath} (metadata exists)`);
    return { skipped: true, filename, slug, relativePath };
  }

  console.log(`    Processing ${relativePath}...`);

  // Extract tags from subdirectory path
  const dirPath = path.dirname(relativePath);
  const tagsFromPath = dirPath && dirPath !== '.'
    ? dirPath.split(path.sep).filter(Boolean)
    : [];

  // Get dimensions
  const dimensions = getImageDimensions(imagePath);

  // Extract EXIF
  const exif = await extractExif(imagePath);

  // Generate thumbnail (in same directory as original)
  const imageDir = path.dirname(imagePath);
  const thumbFilename = `${path.basename(filename, ext)}-thumb${ext}`;
  const thumbPath = path.join(imageDir, thumbFilename);
  const thumbGenerated = generateThumbnail(imagePath, thumbPath);

  // Relative path for thumbnail (from imagesMetadata to images/subdir/)
  const thumbRelativePath = dirPath && dirPath !== '.'
    ? path.join(dirPath, thumbFilename)
    : thumbFilename;

  // Create metadata markdown
  const title = titleFromFilename(filename);
  const now = new Date().toISOString().split('T')[0];

  const frontmatter = {
    title,
    filename: relativePath, // Include subdir path
    thumbnail: thumbGenerated ? thumbRelativePath : null,
    width: dimensions.width || exif.width || null,
    height: dimensions.height || exif.height || null,
    alt: '',
    description: '',
    source: '',
    license: '',
    tags: [],
    dateTaken: exif.dateTaken || null,
    camera: exif.camera ? `${exif.cameraMake || ''} ${exif.camera}`.trim() : null,
    dateProcessed: now,
  };

  // Remove null values for cleaner output
  Object.keys(frontmatter).forEach(key => {
    if (frontmatter[key] === null) delete frontmatter[key];
  });

  // Encode spaces in path for markdown image link (Obsidian handles other chars natively)
  const encodedPath = relativePath.split(path.sep).map(p => p.replace(/ /g, '%20')).join('/');

  const markdown = `---
title: "${frontmatter.title}"
filename: "${frontmatter.filename}"
${frontmatter.thumbnail ? `thumbnail: "${frontmatter.thumbnail}"` : '# thumbnail: (generation failed)'}
${frontmatter.width ? `width: ${frontmatter.width}` : '# width:'}
${frontmatter.height ? `height: ${frontmatter.height}` : '# height:'}
alt: ""
description: ""
source: ""
license: ""
tags: [${tagsFromPath.map(t => `"${t}"`).join(', ')}]
${frontmatter.dateTaken ? `dateTaken: "${frontmatter.dateTaken}"` : '# dateTaken:'}
${frontmatter.camera ? `camera: "${frontmatter.camera}"` : '# camera:'}
dateProcessed: "${now}"
---

![${title}](../images/${encodedPath})
`;

  fs.writeFileSync(metadataPath, markdown);

  return { skipped: false, filename, slug, title, thumbnail: thumbFilename };
}

async function generateGallery(metadataDir, imagesDir, courseName, processedImages) {
  const galleryPath = path.join(metadataDir, '_gallery.md');

  // Get all metadata files
  const metadataFiles = fs.readdirSync(metadataDir)
    .filter(f => f.endsWith('.md') && f !== '_gallery.md')
    .sort();

  let galleryContent = `---
title: "${courseName} Image Gallery"
type: gallery
---

# Image Gallery

${metadataFiles.length} images in this collection.

| Thumbnail | Title | File |
|-----------|-------|------|
`;

  for (const mdFile of metadataFiles) {
    const slug = path.basename(mdFile, '.md');
    const mdPath = path.join(metadataDir, mdFile);
    const content = fs.readFileSync(mdPath, 'utf8');

    // Extract title from frontmatter
    const titleMatch = content.match(/^title:\s*"?([^"\n]+)"?/m);
    const title = titleMatch ? titleMatch[1] : slug;

    // Extract filename from frontmatter
    const filenameMatch = content.match(/^filename:\s*"?([^"\n]+)"?/m);
    const filename = filenameMatch ? filenameMatch[1] : '';

    // Extract thumbnail from frontmatter
    const thumbMatch = content.match(/^thumbnail:\s*"?([^"\n]+)"?/m);
    const thumbnail = thumbMatch ? thumbMatch[1] : null;

    // Encode spaces in thumbnail path (Obsidian handles other chars natively)
    const encodedThumb = thumbnail
      ? thumbnail.replace(/ /g, '%20')
      : null;
    const thumbImg = encodedThumb
      ? `![](../images/${encodedThumb})`
      : '(no thumb)';

    galleryContent += `| ${thumbImg} | [[${slug}\\|${title}]] | ${filename} |\n`;
  }

  fs.writeFileSync(galleryPath, galleryContent);
  console.log(`    ✓ Gallery: ${galleryPath}`);
}

async function processCourse(courseDir) {
  const courseName = path.basename(courseDir);
  const imagesDir = path.join(courseDir, 'images');
  const metadataDir = path.join(courseDir, 'imagesMetadata');

  // Check if images directory exists
  if (!fs.existsSync(imagesDir)) {
    return;
  }

  console.log(`\n${courseName}/images/`);

  // Create metadata directory if needed
  if (!fs.existsSync(metadataDir)) {
    fs.mkdirSync(metadataDir, { recursive: true });
    console.log(`    Created imagesMetadata/`);
  }

  // Find all images recursively
  function findImages(dir, baseDir = dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(findImages(fullPath, baseDir));
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext) && !entry.name.includes('-thumb')) {
          const relativePath = path.relative(baseDir, fullPath);
          results.push({ fullPath, relativePath });
        }
      }
    }
    return results;
  }

  const images = findImages(imagesDir);

  if (images.length === 0) {
    console.log('    No images found');
    return;
  }

  console.log(`    Found ${images.length} images`);

  // Process each image
  const processed = [];
  for (const { fullPath, relativePath } of images) {
    const result = await processImage(fullPath, metadataDir, imagesDir, relativePath);
    processed.push(result);
  }

  const newCount = processed.filter(p => !p.skipped).length;
  const skipCount = processed.filter(p => p.skipped).length;
  console.log(`    ✓ Processed: ${newCount} new, ${skipCount} skipped`);

  // Generate gallery
  await generateGallery(metadataDir, imagesDir, courseName, processed);
}

async function main() {
  console.log('Processing course images...');

  const args = process.argv.slice(2);
  const targetCourse = args[0];

  const courseDirs = fs.readdirSync(COURSES_DIR)
    .map(d => path.join(COURSES_DIR, d))
    .filter(d => fs.statSync(d).isDirectory())
    .filter(d => !path.basename(d).startsWith('.'))
    .filter(d => !targetCourse || path.basename(d) === targetCourse);

  for (const courseDir of courseDirs) {
    await processCourse(courseDir);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
