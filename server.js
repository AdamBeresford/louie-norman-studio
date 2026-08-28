const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const SIGNED_URL_TTL_SECONDS = 86400;

const MANIFEST_KEY = 'assets/manifest.json';
const PORTFOLIO_PREFIX = 'assets/portfolio/';
const ABOUT_PREFIX = 'assets/about/';

// Media types recognised by the front-end, keyed by file extension.
// A .pdf object is a placeholder frame rendered by the front-end as a text box.
const MEDIA_TYPE_BY_EXTENSION = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.pdf': 'text',
};

// Set up CORS configuration
app.use(cors({
  origin: 'https://www.louienorman.com', // Allow only your domain
  optionsSuccessStatus: 200
}));

// Serve static files from the Angular app
app.use(express.static(path.join(__dirname, 'public/browser')));

// Enable hsts on domain
app.use('/', helmet.hsts({
  maxAge: 31536000, // 1 year in seconds
  includeSubDomains: true,
  preload: true
}));

// Set up the S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
});

const mediaTypeForKey = (key) => MEDIA_TYPE_BY_EXTENSION[path.extname(key).toLowerCase()];

// Objects live one folder deep under the section prefix
// (e.g. assets/portfolio/<project>/<file>); objects directly under the
// prefix (e.g. assets/about/<file>) belong to no project.
const projectForKey = (key, prefix) => {
  const segments = key.slice(prefix.length).split('/');
  return segments.length > 1 ? segments[0] : null;
};

// List every object key under a prefix, following pagination.
const listAllKeys = async (bucketName, prefix) => {
  const keys = [];
  let continuationToken;
  do {
    const data = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const item of data.Contents ?? []) {
      keys.push(item.Key);
    }
    continuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
};

// The manifest (assets/manifest.json in the bucket) is the source of truth
// for which media is shown and in what order: frame array order is display
// order, so reordering is a manifest edit rather than an object rename.
// Returns null when no manifest has been generated yet.
const getManifest = async (bucketName) => {
  try {
    const data = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: MANIFEST_KEY }));
    return JSON.parse(await data.Body.transformToString());
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
};

const saveManifest = async (bucketName, manifest) => {
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: MANIFEST_KEY,
    Body: JSON.stringify(manifest, null, 2),
    ContentType: 'application/json',
  }));
};

// A legacy .pdf placeholder object becomes an explicit text frame; the
// front-end renders the project's copy for it, so it needs no object key.
const frameForKey = (key) => {
  const type = mediaTypeForKey(key);
  return type === 'text' ? { type } : { type, key };
};

// Recreate the manifest structure from a raw bucket listing, preserving the
// legacy lexicographic key order. Used as the fallback when no manifest
// exists yet, and by scripts/generate-manifest.js for the initial migration.
const buildManifestFromListing = async (bucketName) => {
  const portfolioKeys = (await listAllKeys(bucketName, PORTFOLIO_PREFIX)).filter(mediaTypeForKey).sort();
  const aboutKeys = (await listAllKeys(bucketName, ABOUT_PREFIX)).filter(mediaTypeForKey).sort();

  const projects = [];
  for (const key of portfolioKeys) {
    const slug = projectForKey(key, PORTFOLIO_PREFIX);
    if (!slug) {
      continue;
    }
    let project = projects.find(candidate => candidate.slug === slug);
    if (!project) {
      project = { slug, frames: [] };
      projects.push(project);
    }
    project.frames.push(frameForKey(key));
  }

  return {
    version: 1,
    projects,
    about: aboutKeys.map(frameForKey),
  };
};

// One media item as consumed by the front-end. Text frames carry no object,
// so their url is null.
const mediaItem = async (bucketName, frame, project) => ({
  type: frame.type,
  project,
  url: frame.key
    ? await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: bucketName, Key: frame.key }),
        { expiresIn: SIGNED_URL_TTL_SECONDS }
      )
    : null,
});

const portfolioMedia = (bucketName, manifest) => Promise.all(
  manifest.projects.flatMap(project =>
    project.frames.map(frame => mediaItem(bucketName, frame, project.slug)))
);

const aboutMedia = (bucketName, manifest) => Promise.all(
  manifest.about.map(frame => mediaItem(bucketName, frame, null))
);

const sectionMediaHandler = (section, buildMedia) => async (req, res) => {
  try {
    const bucketName = process.env.AWS_BUCKET_NAME;
    const manifest = (await getManifest(bucketName)) ?? await buildManifestFromListing(bucketName);
    res.json(await buildMedia(bucketName, manifest));
  } catch (error) {
    console.error(`Error building ${section} media:`, error);
    res.status(500).json({ error: 'Failed to load media' });
  }
};

// Define API routes BEFORE the catch-all route
app.get('/api/portfolio/images', sectionMediaHandler('portfolio', portfolioMedia));
app.get('/api/about/images', sectionMediaHandler('about', aboutMedia));

// Catch-all route to serve the Angular app's index.html file
app.get('/*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public/browser/index.html'));
});

// Start the server
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server is running on port:${port}`);
  });
}

module.exports = {
  mediaTypeForKey,
  projectForKey,
  getManifest,
  saveManifest,
  buildManifestFromListing,
};
