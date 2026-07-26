import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const destination = new URL("../public/icons/", import.meta.url);
await mkdir(destination, { recursive: true });

async function icon(size, filename, padding = 0) {
  const radius = Math.round(size * 0.23);
  const dot = Math.round(size * 0.105);
  const inset = Math.round(size * padding);
  const svg = Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#176b52"/>
      <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${Math.max(1, radius - inset)}" fill="#176b52"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(size * 0.54 * (1 - padding))}" font-weight="800">A</text>
      <circle cx="${Math.round(size * (0.78 - padding / 3))}" cy="${Math.round(size * (0.78 - padding / 3))}" r="${Math.round(dot * (1 - padding))}" fill="#f1b84b" stroke="#ffffff" stroke-width="${Math.max(2, Math.round(size * 0.025))}"/>
    </svg>
  `);
  await sharp(svg)
    .png()
    .toFile(fileURLToPath(new URL(filename, destination)));
}

await icon(192, "icon-192.png");
await icon(512, "icon-512.png");
await icon(512, "icon-512-maskable.png", 0.12);
await icon(180, "apple-touch-icon.png");
await icon(32, "favicon-32.png");
