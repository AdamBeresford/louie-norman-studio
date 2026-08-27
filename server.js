const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const SIGNED_URL_TTL_SECONDS = 86400;

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
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
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

// Display order is the lexicographic order of the object keys; the sort makes
// that explicit rather than relying on how S3 happens to return the listing.
const listSectionMedia = async (bucketName, prefix) => {
  const keys = (await listAllKeys(bucketName, prefix))
    .filter(key => mediaTypeForKey(key))
    .sort();
  return Promise.all(keys.map(async key => ({
    type: mediaTypeForKey(key),
    project: projectForKey(key, prefix),
    url: await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucketName, Key: key }),
      { expiresIn: SIGNED_URL_TTL_SECONDS }
    ),
  })));
};

const sectionMediaHandler = (prefix) => async (req, res) => {
  try {
    const media = await listSectionMedia(process.env.AWS_BUCKET_NAME, prefix);
    res.json(media);
  } catch (error) {
    console.error(`Error listing S3 objects for prefix ${prefix}:`, error);
    res.status(500).json({ error: 'Failed to load media' });
  }
};

// Define API routes BEFORE the catch-all route
app.get('/api/portfolio/images', sectionMediaHandler('assets/portfolio/'));
app.get('/api/about/images', sectionMediaHandler('assets/about/'));

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

module.exports = { mediaTypeForKey, projectForKey };
