const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Heroku terminates TLS at its router; trust it so req.ip and secure
// cookies see the real client connection.
app.set('trust proxy', 1);

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

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

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

// ---------------------------------------------------------------------------
// Admin authentication
//
// There is a single admin user (the site owner). Logging in with the admin
// password — checked against the bcrypt hash in ADMIN_PASSWORD_HASH — sets a
// signed httpOnly session cookie, and the write endpoints require it. The
// server-side check is the security boundary; the admin UI is only a client.
// ---------------------------------------------------------------------------
const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

const isProduction = process.env.NODE_ENV === 'production';
const adminConfigured = () => Boolean(process.env.ADMIN_PASSWORD_HASH && process.env.SESSION_SECRET);

const signSession = (expiresAt) =>
  crypto.createHmac('sha256', process.env.SESSION_SECRET).update(String(expiresAt)).digest('hex');

const createSessionToken = () => {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${expiresAt}.${signSession(expiresAt)}`;
};

const isValidSessionToken = (token) => {
  if (!adminConfigured() || typeof token !== 'string') {
    return false;
  }
  const [expiresAt, signature] = token.split('.');
  if (!/^\d+$/.test(expiresAt ?? '') || !signature || Number(expiresAt) < Date.now()) {
    return false;
  }
  const expected = Buffer.from(signSession(expiresAt));
  const provided = Buffer.from(signature);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
};

const isAuthenticated = (req) => isValidSessionToken(req.cookies?.[SESSION_COOKIE]);

const requireAdmin = (req, res, next) => {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
};

// Small in-memory brute-force guard: after too many failed attempts an IP is
// locked out for a while. State resets on restart, which is fine here.
const loginFailures = new Map();

const loginLocked = (ip) => {
  const entry = loginFailures.get(ip);
  return Boolean(entry?.lockedUntil && entry.lockedUntil > Date.now());
};

const recordLoginFailure = (ip) => {
  const entry = loginFailures.get(ip) ?? { count: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    entry.count = 0;
  }
  loginFailures.set(ip, entry);
};

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

const SLUG_PATTERN = /^[a-z0-9-]+$/;

const isValidFrame = (frame, { allowText }) => {
  if (!frame || typeof frame !== 'object') {
    return false;
  }
  if (frame.type === 'text') {
    return allowText;
  }
  if (frame.type !== 'image' && frame.type !== 'video') {
    return false;
  }
  return typeof frame.key === 'string'
    && (frame.key.startsWith(PORTFOLIO_PREFIX) || frame.key.startsWith(ABOUT_PREFIX));
};

const isValidManifest = (manifest) =>
  Boolean(manifest) && typeof manifest === 'object'
  && manifest.version === 1
  && Array.isArray(manifest.projects)
  && manifest.projects.every(project =>
    project && typeof project === 'object'
    && typeof project.slug === 'string' && SLUG_PATTERN.test(project.slug)
    && Array.isArray(project.frames)
    && project.frames.every(frame => isValidFrame(frame, { allowText: true })))
  && Array.isArray(manifest.about)
  && manifest.about.every(frame => isValidFrame(frame, { allowText: false }));

// Strip anything beyond the fields the manifest owns (e.g. signed urls the
// admin client holds alongside each frame).
const normalizeFrame = (frame) =>
  frame.type === 'text' ? { type: 'text' } : { type: frame.type, key: frame.key };

const normalizeManifest = (manifest) => ({
  version: 1,
  projects: manifest.projects.map(project => ({
    slug: project.slug,
    frames: project.frames.map(normalizeFrame),
  })),
  about: manifest.about.map(normalizeFrame),
});

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

app.post('/api/admin/login', async (req, res) => {
  if (!adminConfigured()) {
    return res.status(503).json({ error: 'Admin is not configured' });
  }
  if (loginLocked(req.ip)) {
    return res.status(429).json({ error: 'Too many attempts, try again later' });
  }
  const password = req.body?.password;
  const passwordOk = typeof password === 'string'
    && await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
  if (!passwordOk) {
    recordLoginFailure(req.ip);
    return res.status(401).json({ error: 'Wrong password' });
  }
  loginFailures.delete(req.ip);
  res.cookie(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    maxAge: SESSION_TTL_MS,
  });
  res.json({ authenticated: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ authenticated: false });
});

app.get('/api/admin/session', (req, res) => {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true });
});

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 300;

const signFrames = (bucketName, frames) => Promise.all(frames.map(async frame => (
  frame.key
    ? {
        ...normalizeFrame(frame),
        url: await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: bucketName, Key: frame.key }),
          { expiresIn: SIGNED_URL_TTL_SECONDS }
        ),
      }
    : normalizeFrame(frame)
)));

// The manifest with a signed url attached to every keyed frame — what the
// admin UI edits.
app.get('/api/admin/media', requireAdmin, async (req, res) => {
  try {
    const bucketName = process.env.AWS_BUCKET_NAME;
    const manifest = (await getManifest(bucketName)) ?? await buildManifestFromListing(bucketName);
    res.json({
      version: manifest.version,
      projects: await Promise.all(manifest.projects.map(async project => ({
        slug: project.slug,
        frames: await signFrames(bucketName, project.frames),
      }))),
      about: await signFrames(bucketName, manifest.about),
    });
  } catch (error) {
    console.error('Error building admin media:', error);
    res.status(500).json({ error: 'Failed to load media' });
  }
});

// Presigned POST so the browser uploads straight to S3 — large videos never
// pass through this server (Heroku kills requests at 30s). The returned key
// is only displayed once the client adds it to the manifest.
app.post('/api/admin/upload-url', requireAdmin, async (req, res) => {
  try {
    const bucketName = process.env.AWS_BUCKET_NAME;
    const { section, project, filename, contentType } = req.body ?? {};

    const extension = typeof filename === 'string' ? path.extname(filename).toLowerCase() : '';
    const type = MEDIA_TYPE_BY_EXTENSION[extension];
    if (type !== 'image' && type !== 'video') {
      return res.status(400).json({ error: 'Unsupported file type' });
    }
    if (typeof contentType !== 'string' || !contentType.startsWith(`${type}/`)) {
      return res.status(400).json({ error: 'Content type does not match file extension' });
    }

    let prefix;
    if (section === 'about') {
      prefix = ABOUT_PREFIX;
    } else if (section === 'portfolio') {
      const manifest = (await getManifest(bucketName)) ?? await buildManifestFromListing(bucketName);
      if (typeof project !== 'string' || !manifest.projects.some(candidate => candidate.slug === project)) {
        return res.status(400).json({ error: 'Unknown project' });
      }
      prefix = `${PORTFOLIO_PREFIX}${project}/`;
    } else {
      return res.status(400).json({ error: 'Unknown section' });
    }

    // Filenames carry no meaning any more (order lives in the manifest); keep
    // a sanitised base for readability and add a suffix to avoid collisions.
    const base = path.basename(filename, extension)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'media';
    const key = `${prefix}${base}-${crypto.randomBytes(4).toString('hex')}${extension}`;

    const { url, fields } = await createPresignedPost(s3Client, {
      Bucket: bucketName,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_UPLOAD_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: UPLOAD_URL_TTL_SECONDS,
    });
    res.json({ url, fields, key, type });
  } catch (error) {
    console.error('Error creating upload url:', error);
    res.status(500).json({ error: 'Failed to create upload url' });
  }
});

// Replace the manifest — how the admin UI persists reorders, additions and
// removals. The saved manifest is normalised to only the fields it owns.
app.put('/api/admin/manifest', requireAdmin, async (req, res) => {
  try {
    if (!isValidManifest(req.body)) {
      return res.status(400).json({ error: 'Invalid manifest' });
    }
    const manifest = normalizeManifest(req.body);
    await saveManifest(process.env.AWS_BUCKET_NAME, manifest);
    res.json(manifest);
  } catch (error) {
    console.error('Error saving manifest:', error);
    res.status(500).json({ error: 'Failed to save manifest' });
  }
});

// Delete a media object and drop any manifest frames referencing it.
app.delete('/api/admin/media', requireAdmin, async (req, res) => {
  try {
    const bucketName = process.env.AWS_BUCKET_NAME;
    const key = req.body?.key;
    if (typeof key !== 'string'
        || !(key.startsWith(PORTFOLIO_PREFIX) || key.startsWith(ABOUT_PREFIX))
        || key === MANIFEST_KEY) {
      return res.status(400).json({ error: 'Invalid key' });
    }
    const manifest = await getManifest(bucketName);
    if (manifest) {
      await saveManifest(bucketName, {
        ...manifest,
        projects: manifest.projects.map(project => ({
          ...project,
          frames: project.frames.filter(frame => frame.key !== key),
        })),
        about: manifest.about.filter(frame => frame.key !== key),
      });
    }
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    res.json({ deleted: key });
  } catch (error) {
    console.error('Error deleting media:', error);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

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
