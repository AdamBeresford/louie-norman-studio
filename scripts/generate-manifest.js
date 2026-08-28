#!/usr/bin/env node
// One-off migration: generate assets/manifest.json from the current bucket
// contents, preserving the existing (lexicographic) display order exactly.
// Legacy .pdf placeholder objects become explicit text frames.
//
// Usage:
//   node scripts/generate-manifest.js           # dry run, prints the manifest
//   node scripts/generate-manifest.js --write   # upload (refuses to overwrite)
//   node scripts/generate-manifest.js --write --force
const { getManifest, saveManifest, buildManifestFromListing } = require('../server');

const main = async () => {
  const bucketName = process.env.AWS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('AWS_BUCKET_NAME is not set');
  }

  const write = process.argv.includes('--write');
  const force = process.argv.includes('--force');

  const manifest = await buildManifestFromListing(bucketName);
  console.log(JSON.stringify(manifest, null, 2));

  if (!write) {
    console.log('\nDry run — pass --write to upload.');
    return;
  }
  if (!force && await getManifest(bucketName)) {
    console.error('\nassets/manifest.json already exists — pass --force to overwrite.');
    process.exitCode = 1;
    return;
  }
  await saveManifest(bucketName, manifest);
  console.log('\nUploaded assets/manifest.json');
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
