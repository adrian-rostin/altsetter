// Renders public/favicon.svg into the PNG / ICO icons browsers and phones ask for.
// Run with: npm run icons
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile('public/favicon.svg');
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

// iOS rounds the corners itself, so fill them instead of leaving them transparent.
const apple = await sharp(await png(180))
  .flatten({ background: '#171512' })
  .png()
  .toBuffer();
await writeFile('public/apple-touch-icon.png', apple);
await writeFile('public/icon-512.png', await png(512));

// favicon.ico for browsers that request it directly: a single 32×32 PNG inside an ICO container.
const ico32 = await png(32);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // image count
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(ico32.length, 14); // image size
header.writeUInt32LE(22, 18); // image offset
await writeFile('public/favicon.ico', Buffer.concat([header, ico32]));

console.log('Icons written to public/.');
