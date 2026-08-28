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
const MANIFEST_VERSION = 3;
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
const titleCaseSlug = (slug) =>
  slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

const textList = (value) =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

// Fill in anything an older manifest predates, so a v1 document (projects
// without a name or dark mode, text frames without their copy) or a v2 one
// (about as a bare frame array, no contact details) still serves.
const upgradeManifest = (manifest) => {
  const about = Array.isArray(manifest.about) ? { frames: manifest.about } : (manifest.about ?? {});
  return {
    version: MANIFEST_VERSION,
    projects: (manifest.projects ?? []).map(project => ({
      slug: project.slug,
      name: typeof project.name === 'string' && project.name.trim() ? project.name : titleCaseSlug(project.slug),
      darkMode: project.darkMode === true,
      frames: (project.frames ?? []).map(frame => frame.type === 'text'
        ? { type: 'text', text: typeof frame.text === 'string' ? frame.text : '' }
        : { type: frame.type, key: frame.key }),
    })),
    about: {
      frames: (about.frames ?? []).map(frame => ({ type: frame.type, key: frame.key })),
      // Two lists shown beside the about images; the first line of each is
      // its heading, exactly as the page renders them.
      education: textList(about.education),
      skills: textList(about.skills),
    },
    contact: (manifest.contact ?? [])
      .filter(item => item && typeof item.text === 'string')
      .map(item => ({ text: item.text, ...(item.url ? { url: item.url } : {}) })),
  };
};

const getManifest = async (bucketName) => {
  try {
    const data = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: MANIFEST_KEY }));
    return upgradeManifest(JSON.parse(await data.Body.transformToString()));
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

// A legacy .pdf placeholder object becomes an explicit text frame, which
// carries its copy inline rather than pointing at an object.
const frameForKey = (key) => {
  const type = mediaTypeForKey(key);
  return type === 'text' ? { type, text: '' } : { type, key };
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
      project = { slug, name: titleCaseSlug(slug), darkMode: false, frames: [] };
      projects.push(project);
    }
    project.frames.push(frameForKey(key));
  }

  return {
    version: MANIFEST_VERSION,
    projects,
    about: { frames: aboutKeys.map(frameForKey), education: [], skills: [] },
    contact: [],
  };
};

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const MAX_NAME_LENGTH = 80;
const MAX_TEXT_LENGTH = 5000;

const isValidFrame = (frame, { allowText }) => {
  if (!frame || typeof frame !== 'object') {
    return false;
  }
  if (frame.type === 'text') {
    return allowText && typeof frame.text === 'string' && frame.text.length <= MAX_TEXT_LENGTH;
  }
  if (frame.type !== 'image' && frame.type !== 'video') {
    return false;
  }
  return typeof frame.key === 'string'
    && (frame.key.startsWith(PORTFOLIO_PREFIX) || frame.key.startsWith(ABOUT_PREFIX));
};

const isValidProject = (project) =>
  Boolean(project) && typeof project === 'object'
  && typeof project.slug === 'string' && SLUG_PATTERN.test(project.slug)
  && typeof project.name === 'string'
  && project.name.trim().length > 0 && project.name.length <= MAX_NAME_LENGTH
  && (project.darkMode === undefined || typeof project.darkMode === 'boolean')
  && Array.isArray(project.frames)
  && project.frames.every(frame => isValidFrame(frame, { allowText: true }));

const MAX_LIST_ITEMS = 40;

const isValidTextList = (value) =>
  Array.isArray(value)
  && value.length <= MAX_LIST_ITEMS
  && value.every(item => typeof item === 'string' && item.length <= MAX_NAME_LENGTH);

// Only links the browser can safely follow; Angular would refuse others anyway.
const isValidLink = (url) =>
  typeof url === 'string'
  && /^(https?:\/\/|mailto:)/.test(url)
  && url.length <= 500;

const isValidContactItem = (item) =>
  Boolean(item) && typeof item === 'object'
  && typeof item.text === 'string'
  && item.text.trim().length > 0 && item.text.length <= MAX_NAME_LENGTH
  && (item.url === undefined || isValidLink(item.url));

const isValidManifest = (manifest) => {
  if (!manifest || typeof manifest !== 'object'
      || manifest.version !== MANIFEST_VERSION
      || !Array.isArray(manifest.projects)
      || !manifest.about || typeof manifest.about !== 'object'
      || !Array.isArray(manifest.about.frames)
      || !isValidTextList(manifest.about.education)
      || !isValidTextList(manifest.about.skills)
      || !Array.isArray(manifest.contact)
      || manifest.contact.length > MAX_LIST_ITEMS) {
    return false;
  }
  const slugs = manifest.projects.map(project => project?.slug);
  if (new Set(slugs).size !== slugs.length) {
    return false;
  }
  return manifest.projects.every(isValidProject)
    && manifest.about.frames.every(frame => isValidFrame(frame, { allowText: false }))
    && manifest.contact.every(isValidContactItem);
};

// Strip anything beyond the fields the manifest owns (e.g. signed urls the
// admin client holds alongside each frame).
const normalizeFrame = (frame) =>
  frame.type === 'text'
    ? { type: 'text', text: frame.text }
    : { type: frame.type, key: frame.key };

const normalizeManifest = (manifest) => ({
  version: MANIFEST_VERSION,
  projects: manifest.projects.map(project => ({
    slug: project.slug,
    name: project.name.trim(),
    darkMode: project.darkMode === true,
    frames: project.frames.map(normalizeFrame),
  })),
  about: {
    frames: manifest.about.frames.map(normalizeFrame),
    education: manifest.about.education,
    skills: manifest.about.skills,
  },
  contact: manifest.contact.map(item => ({
    text: item.text.trim(),
    ...(item.url ? { url: item.url } : {}),
  })),
});

// One media item as consumed by the front-end. Text frames carry their copy
// instead of an object, so their url is null.
const mediaItem = async (bucketName, frame, project) => ({
  type: frame.type,
  project,
  text: frame.type === 'text' ? frame.text : null,
  url: frame.key
    ? await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: bucketName, Key: frame.key }),
        { expiresIn: SIGNED_URL_TTL_SECONDS }
      )
    : null,
});

// Projects in sidebar order, each with its frames in display order. A project
// with no frames is skipped so a half-built page never reaches the site.
const portfolioMedia = (bucketName, manifest) => Promise.all(
  manifest.projects
    .filter(project => project.frames.length > 0)
    .map(async project => ({
      slug: project.slug,
      name: project.name,
      darkMode: project.darkMode === true,
      frames: await Promise.all(project.frames.map(frame => mediaItem(bucketName, frame, project.slug))),
    }))
);

const aboutMedia = (bucketName, manifest) => Promise.all(
  manifest.about.frames.map(frame => mediaItem(bucketName, frame, null))
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

// Copy shown over the about images, and the contact details.
app.get('/api/about/text', sectionMediaHandler('about text', async (bucketName, manifest) => ({
  education: manifest.about.education,
  skills: manifest.about.skills,
})));
app.get('/api/contact', sectionMediaHandler('contact', async (bucketName, manifest) => manifest.contact));

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
        name: project.name,
        darkMode: project.darkMode === true,
        frames: await signFrames(bucketName, project.frames),
      }))),
      about: {
        frames: await signFrames(bucketName, manifest.about.frames),
        education: manifest.about.education,
        skills: manifest.about.skills,
      },
      contact: manifest.contact,
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
      // The slug need not exist yet: creating a page uploads its first file
      // before the project is added to the manifest.
      if (typeof project !== 'string' || !SLUG_PATTERN.test(project)) {
        return res.status(400).json({ error: 'Invalid project' });
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
        about: {
          ...manifest.about,
          frames: manifest.about.frames.filter(frame => frame.key !== key),
        },
      });
    }
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    res.json({ deleted: key });
  } catch (error) {
    console.error('Error deleting media:', error);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

// Remove a page and every object belonging to it.
app.delete('/api/admin/projects/:slug', requireAdmin, async (req, res) => {
  try {
    const bucketName = process.env.AWS_BUCKET_NAME;
    const { slug } = req.params;
    if (!SLUG_PATTERN.test(slug)) {
      return res.status(400).json({ error: 'Invalid page' });
    }
    const manifest = await getManifest(bucketName);
    if (!manifest?.projects.some(project => project.slug === slug)) {
      return res.status(404).json({ error: 'Unknown page' });
    }
    await saveManifest(bucketName, {
      ...manifest,
      projects: manifest.projects.filter(project => project.slug !== slug),
    });
    // Clear the folder itself, so a page of the same name starts empty.
    const keys = await listAllKeys(bucketName, `${PORTFOLIO_PREFIX}${slug}/`);
    await Promise.all(keys.map(key =>
      s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))));
    res.json({ deleted: slug, objects: keys.length });
  } catch (error) {
    console.error('Error deleting page:', error);
    res.status(500).json({ error: 'Failed to delete page' });
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
