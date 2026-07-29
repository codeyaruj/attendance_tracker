import { access, readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve("out");
const required = [
  "index.html",
  "today/index.html",
  "dashboard/index.html",
  "timetable/index.html",
  "skip-planner/index.html",
  "history/index.html",
  "settings/index.html",
  "manifest.webmanifest",
  "sw.js",
  "version.json",
  "_headers",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "ocr-assets/pdf.worker.min.mjs",
  "ocr-assets/worker.min.js",
  "ocr-assets/lang/eng.traineddata.gz",
  "ocr-assets/core/tesseract-core-lstm.wasm.js",
  "ocr-assets/core/tesseract-core-simd-lstm.wasm.js",
  "ocr-assets/core/tesseract-core-relaxedsimd-lstm.wasm.js",
];
const errors = [];

for (const path of required) {
  try {
    const info = await stat(join(root, path));
    if (!info.isFile() || info.size === 0) errors.push(`${path} is empty`);
  } catch {
    errors.push(`${path} is missing`);
  }
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    }),
  );
  return nested.flat();
}

try {
  await access(root);
  // Third-party bundles can contain harmless development URLs in package
  // metadata (Tesseract does). Canonical deployment URLs live in generated
  // HTML/route metadata/manifest files, so those are the correct regression
  // boundary for accidental localhost output.
  const textExtensions = new Set([".html", ".json", ".txt", ".webmanifest"]);
  for (const path of await files(root)) {
    if (!textExtensions.has(extname(path)) || path.includes("/ocr-assets/"))
      continue;
    const contents = await readFile(path, "utf8");
    if (/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(contents)) {
      errors.push(
        `${relative(root, path)} contains a localhost production URL`,
      );
    }
    if (/\/api\/(?:extract|timetable|attendance|backup)/i.test(contents)) {
      errors.push(
        `${relative(root, path)} references a forbidden application API`,
      );
    }
  }
} catch {
  errors.push("out/ does not exist; run pnpm build first");
}

for (const forbidden of [
  "app/api",
  "pages/api",
  "middleware.ts",
  "middleware.js",
]) {
  try {
    await access(forbidden);
    errors.push(
      `${forbidden} is incompatible with the browser-only architecture`,
    );
  } catch {
    // Expected.
  }
}

if (errors.length > 0) {
  process.stderr.write(
    `Static output verification failed:\n- ${errors.join("\n- ")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `Static output verified: ${required.length} required files and all exported routes are present.\n`,
);
