import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const destination = new URL("../public/icons/", import.meta.url);
await mkdir(destination, { recursive: true });

for (const size of [192, 512]) {
  const radius = Math.round(size * 0.23);
  const dot = Math.round(size * 0.105);
  const svg = Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#176b52"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(size * 0.54)}" font-weight="800">A</text>
      <circle cx="${Math.round(size * 0.78)}" cy="${Math.round(size * 0.78)}" r="${dot}" fill="#f1b84b" stroke="#ffffff" stroke-width="${Math.max(5, Math.round(size * 0.025))}"/>
    </svg>
  `);
  await sharp(svg)
    .png()
    .toFile(fileURLToPath(new URL(`icon-${size}.png`, destination)));
}
