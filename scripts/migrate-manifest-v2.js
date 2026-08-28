#!/usr/bin/env node
// One-off migration: manifest v1 -> v2.
//
// v2 makes the manifest the source of truth for project metadata that used to
// be hardcoded in the front-end's ProjectService: the sidebar order and name
// of each project, its dark-mode flag, and the copy shown on its text frame.
//
// PROJECTS below is a verbatim snapshot of that ProjectService, kept here so
// the migration reproduces the live site exactly — sidebar order included,
// which v1 did not carry (it listed projects alphabetically).
//
// Usage:
//   node scripts/migrate-manifest-v2.js           # dry run
//   node scripts/migrate-manifest-v2.js --write
const { getManifest, saveManifest } = require('../server');

const PROJECTS = [
  {
    name: 'From Stone to Stone',
    slug: 'from-stone-to-stone',
    text: 'Richard Long is both an artist and a hiker. Whilst walking, he crafts uncomplicated sculptures' +
          ' in distant locations. These pieces serve as subtle indications of his time spent there.' +
          ' Knowing that in time the land will take his sculptures back.\n\n' +
          'This documentary follows a walk from the perspective of Richard Long. We witness the' +
          ' landscape just as he would, experiencing it from his unique perspective. As he walks' +
          ' through his cherished local spot, Dartmoor National Park, Richard Long leaves a gentle' +
          ' reminder of his presence.'
  },
  {
    name: 'Bangers',
    slug: 'short-bangers',
    text: 'Coming Soon'
  },
  {
    name: 'Jimmy and Jill',
    slug: 'jimmy-and-jill',
    text: 'Parkgate is on the Wirral Peninsula of Cheshire, a small village road that looks over North' +
          ' Wales, separated by the salt marshes of The River Dee. My grandparents Jimmy and Jill' +
          ' moved here in their early 20s and started their lives together here. When I was a young boy I' +
          ' used to visit Parkgate and remember the place very fondly. St.Thomas’s being one of these' +
          ' places, a church my grandparents saved from destruction, renovated and built a community' +
          ' around.\n\n' +
          'After ten years, I revisited this memory for the first time. I went back to explore the' +
          ' community they had touched and the legacy Jimmy and Jill both left behind.'
  },
  {
    name: 'UnDance',
    slug: 'un-dance',
    darkMode: true,
    text: 'In collaboration with ‘Studio Wayne McGregor’ - The modern ballet studio, Undance was' +
          ' created to encourage (non)dancers to engage in undancing through Interactive projection.'
  },
  {
    name: 'Rio Ferdinand Foundation',
    slug: 'rio-ferdinand-foundation',
    darkMode: true,
    text: '15-5 is an archive to celebrate The Rio Ferdinand Foundation’s 10 year anniversary. The Rio' +
          ' Ferdinand Foundation was founded in 2011 to help underprivileged kids get a fighting start' +
          ' towards their future. For the archive we aimed to track their progression of their events to the' +
          ' present day.'
  },
  {
    name: 'Interface',
    slug: 'interface',
    text: 'A study of the relationship between water and stone'
  },
];

const migrate = (manifest) => {
  const bySlug = new Map(manifest.projects.map(project => [project.slug, project]));

  // Sidebar order comes from PROJECTS; anything in the bucket but not listed
  // there keeps its existing position at the end.
  const ordered = [
    ...PROJECTS.map(config => config.slug).filter(slug => bySlug.has(slug)),
    ...manifest.projects.map(project => project.slug).filter(slug => !PROJECTS.some(c => c.slug === slug)),
  ];

  return {
    version: 2,
    projects: ordered.map(slug => {
      const project = bySlug.get(slug);
      const config = PROJECTS.find(candidate => candidate.slug === slug);
      return {
        slug,
        name: config?.name ?? project.name,
        darkMode: config?.darkMode === true,
        frames: project.frames.map(frame => frame.type === 'text'
          ? { type: 'text', text: config?.text ?? '' }
          : { type: frame.type, key: frame.key }),
      };
    }),
    about: manifest.about.map(frame => ({ type: frame.type, key: frame.key })),
  };
};

const main = async () => {
  const bucketName = process.env.AWS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('AWS_BUCKET_NAME is not set');
  }

  const existing = await getManifest(bucketName);
  if (!existing) {
    throw new Error('No manifest found — run scripts/generate-manifest.js first');
  }

  const migrated = migrate(existing);
  console.log(JSON.stringify(migrated, null, 2));

  const textFrames = migrated.projects.flatMap(p => p.frames.filter(f => f.type === 'text'));
  console.log(`\nProjects: ${migrated.projects.length}`);
  console.log(`Sidebar order: ${migrated.projects.map(p => p.name).join(' | ')}`);
  console.log(`Text frames: ${textFrames.length}, empty: ${textFrames.filter(f => !f.text).length}`);

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
