import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve("out");
const MB = 1024 * 1024;
const limits = {
  totalJavaScript: 8 * MB,
  largestJavaScript: 2 * MB,
  pdfWorker: 3 * MB,
  ocrWorker: 512 * 1024,
  ocrCoreTotal: 16 * MB,
  languageModel: 5 * MB,
  ocrTotal: 22 * MB,
  largestCachedAsset: 8 * MB,
  precacheEntries: 20,
};

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    }),
  );
  return nested.flat();
}
const all = await files(root);
const sizes = new Map(
  await Promise.all(all.map(async (path) => [path, (await stat(path)).size])),
);
const js = all.filter(
  (path) => path.includes("/_next/static/") && path.endsWith(".js"),
);
const totalJs = js.reduce((sum, path) => sum + sizes.get(path), 0);
const largestJsPath = js.sort((a, b) => sizes.get(b) - sizes.get(a))[0];
const ocr = all.filter((path) => path.includes("/ocr-assets/"));
const core = ocr.filter((path) => path.includes("/core/"));
const sizeOf = (suffix) =>
  sizes.get(all.find((path) => path.endsWith(suffix))) ?? 0;
const report = {
  totalJavaScript: totalJs,
  largestJavaScript: sizes.get(largestJsPath) ?? 0,
  pdfWorker: sizeOf("pdf.worker.min.mjs"),
  ocrWorker: sizeOf("worker.min.js"),
  ocrCoreTotal: core.reduce((sum, path) => sum + sizes.get(path), 0),
  languageModel: sizeOf("eng.traineddata.gz"),
  ocrTotal: ocr.reduce((sum, path) => sum + sizes.get(path), 0),
  largestCachedAsset: Math.max(...ocr.map((path) => sizes.get(path)), 0),
};
const worker = await readFile(join(root, "sw.js"), "utf8");
const shell = worker.match(/const INSTALL_SHELL = \[([\s\S]*?)\];/)?.[1] ?? "";
const precacheEntries = [...shell.matchAll(/^\s*"\//gm)].length;
const failures = Object.entries(report)
  .filter(([key, value]) => value > limits[key])
  .map(
    ([key, value]) =>
      `${key} is ${(value / MB).toFixed(2)} MB; limit ${(limits[key] / MB).toFixed(2)} MB`,
  );
if (precacheEntries > limits.precacheEntries) {
  failures.push(
    `precacheEntries is ${precacheEntries}; limit ${limits.precacheEntries}`,
  );
}

process.stdout.write(
  [
    `Application JavaScript: ${(totalJs / MB).toFixed(2)} MB total`,
    `Largest JavaScript chunk: ${basename(largestJsPath ?? "none")} (${((sizes.get(largestJsPath) ?? 0) / MB).toFixed(2)} MB)`,
    `PDF.js worker: ${(report.pdfWorker / MB).toFixed(2)} MB`,
    `Tesseract worker: ${(report.ocrWorker / MB).toFixed(2)} MB`,
    `Tesseract core loaders: ${(report.ocrCoreTotal / MB).toFixed(2)} MB`,
    `OCR language model: ${(report.languageModel / MB).toFixed(2)} MB`,
    `Runtime OCR cache ceiling: ${(report.ocrTotal / MB).toFixed(2)} MB`,
    `Largest runtime-cached asset: ${(report.largestCachedAsset / MB).toFixed(2)} MB`,
    `Application-shell precache entries: ${precacheEntries}`,
  ].join("\n") + "\n",
);
if (failures.length > 0) {
  process.stderr.write(
    `Asset-size verification failed:\n- ${failures.join("\n- ")}\n`,
  );
  process.exit(1);
}
