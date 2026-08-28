#!/usr/bin/env node
// One-off migration: manifest v2 -> v3.
//
// v3 moves the last of the hardcoded copy into the manifest: the two lists
// shown on the about page (previously AboutComponent.educationItems and
// .skillsItems) and the contact details (previously literals in
// contact.component.html). The about section becomes an object so it can
// hold that copy alongside its frames.
//
// ABOUT and CONTACT below are verbatim snapshots of those components, so the
// migration reproduces both pages exactly.
//
// Usage:
//   node scripts/migrate-manifest-v3.js           # dry run
//   node scripts/migrate-manifest-v3.js --write
const { getManifest, saveManifest } = require('../server');

// The first line of each list is its heading, as the page renders it.
const ABOUT = {
  education: [
    'Education',
    'Kingston School of Art',
    'Foundation Diploma (2018-19) - Distinction',
    'Graphic design (BA) (2019-2023) - 1st Class',
  ],
  skills: [
    'Skills',
    'Camera Operator',
    'Adobe InDesign',
    'Adobe Photoshop',
    'Adobe Permier Pro',
    'Adobe After Effects',
    'Adobe Lightroom/Classic',
    'DaVinci Resolve',
  ],
};

const CONTACT = [
  { text: 'Louie Norman' },
  { text: 'louienorman.studio@gmail.com' },
  {
    text: '@__louienorman',
    url: 'https://www.instagram.com/__louienorman?igsh=YjY1N2ZvYjd6aXFy&utm_source=qr',
  },
  {
    text: 'LinkedIn',
    url: 'https://www.linkedin.com/in/louie-norman-26a625226?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=ios_app',
  },
];

const main = async () => {
  const bucketName = process.env.AWS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('AWS_BUCKET_NAME is not set');
  }

  const existing = await getManifest(bucketName);
  if (!existing) {
    throw new Error('No manifest found — run scripts/generate-manifest.js first');
  }

  // getManifest has already reshaped about into an object; only the copy,
  // which it defaults to empty, still needs filling in.
  const migrated = {
    ...existing,
    about: {
      frames: existing.about.frames,
      education: existing.about.education.length ? existing.about.education : ABOUT.education,
      skills: existing.about.skills.length ? existing.about.skills : ABOUT.skills,
    },
    contact: existing.contact.length ? existing.contact : CONTACT,
  };

  console.log(JSON.stringify({ about: migrated.about, contact: migrated.contact }, null, 2));
  console.log(`\nProjects: ${migrated.projects.length} (unchanged)`);
  console.log(`About frames: ${migrated.about.frames.length} (unchanged)`);
  console.log(`About lists: ${migrated.about.education.length} education, ${migrated.about.skills.length} skills`);
  console.log(`Contact items: ${migrated.contact.length} (${migrated.contact.filter(i => i.url).length} links)`);

  if (!process.argv.includes('--write')) {
    console.log('\nDry run — pass --write to upload.');
    return;
  }
  await saveManifest(bucketName, migrated);
  console.log('\nUploaded migrated assets/manifest.json');
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
