import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const rootDir = new URL('..', import.meta.url);
const designSourcePath = new URL('figma/design-source.json', rootDir);
const figmaDir = new URL('figma/', rootDir);
const publicFigmaDir = new URL('public/figma/', rootDir);

const env = {
  token: process.env.FIGMA_TOKEN,
  fileKey: process.env.FIGMA_FILE_KEY,
  desktopNodeId: process.env.FIGMA_DESKTOP_NODE_ID,
  mobileNodeId: process.env.FIGMA_MOBILE_NODE_ID,
};

const designSource = JSON.parse(await readFile(designSourcePath, 'utf8'));
const fileKey = env.fileKey || designSource.fileKey;
const nodes = {
  desktop: env.desktopNodeId || designSource.frames.desktop.nodeId,
  mobile: env.mobileNodeId || designSource.frames.mobile.nodeId,
};

if (!env.token) {
  throw new Error(
    'Missing FIGMA_TOKEN. Copy .env.example to .env, set FIGMA_TOKEN, then run `pnpm sync:figma` with the env loaded.',
  );
}

const headers = { 'X-Figma-Token': env.token };

async function figmaGet(endpoint, params = {}) {
  const url = new URL(`https://api.figma.com/v1/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Figma API ${response.status} for ${url.pathname}: ${body}`);
  }
  return response.json();
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, data);
}

await mkdir(figmaDir, { recursive: true });
await mkdir(publicFigmaDir, { recursive: true });

const nodeIds = Object.values(nodes);
const [file, nodeData, imageData] = await Promise.all([
  figmaGet(`files/${fileKey}`),
  figmaGet(`files/${fileKey}/nodes`, { ids: nodeIds.join(',') }),
  figmaGet(`images/${fileKey}`, {
    ids: nodeIds.join(','),
    format: 'png',
    scale: '2',
  }),
]);

await writeFile(
  new URL('figma/file.json', rootDir),
  `${JSON.stringify(
    {
      name: file.name,
      lastModified: file.lastModified,
      version: file.version,
      document: {
        id: file.document.id,
        name: file.document.name,
        type: file.document.type,
      },
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  new URL('figma/nodes.json', rootDir),
  `${JSON.stringify(
    {
      syncedAt: new Date().toISOString(),
      fileKey,
      nodes,
      data: nodeData.nodes,
    },
    null,
    2,
  )}\n`,
);

const exported = {};
for (const [name, nodeId] of Object.entries(nodes)) {
  const imageUrl = imageData.images[nodeId];
  if (!imageUrl) continue;
  const outputPath = path.join(publicFigmaDir.pathname, `${name}.png`);
  await download(imageUrl, outputPath);
  exported[name] = `/figma/${name}.png`;
}

await writeFile(
  new URL('figma/sync-summary.json', rootDir),
  `${JSON.stringify(
    {
      syncedAt: new Date().toISOString(),
      fileKey,
      nodes,
      exported,
    },
    null,
    2,
  )}\n`,
);

console.log(`Synced Figma file ${fileKey}`);
console.log(`Wrote ${Object.keys(exported).length} screenshots to public/figma/`);
