import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const projectRoot = new URL("../", import.meta.url);
const outputRoot = new URL("public/ocr-assets/", projectRoot);
const coreOutput = new URL("core/", outputRoot);
const langOutput = new URL("lang/", outputRoot);

const tesseractRoot = dirname(require.resolve("tesseract.js/package.json"));
const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const englishRoot = dirname(
  require.resolve("@tesseract.js-data/eng/package.json"),
);
const coreRoot = dirname(
  require.resolve("tesseract.js-core/package.json", {
    paths: [tesseractRoot],
  }),
);

await Promise.all([
  mkdir(outputRoot, { recursive: true }),
  mkdir(coreOutput, { recursive: true }),
  mkdir(langOutput, { recursive: true }),
]);

const assets = [
  [
    join(tesseractRoot, "dist/worker.min.js"),
    new URL("worker.min.js", outputRoot),
  ],
  [
    join(pdfRoot, "build/pdf.worker.min.mjs"),
    new URL("pdf.worker.min.mjs", outputRoot),
  ],
  [
    join(englishRoot, "4.0.0_best_int/eng.traineddata.gz"),
    new URL("eng.traineddata.gz", langOutput),
  ],
  ...[
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
  ].map((filename) => [
    join(coreRoot, filename),
    new URL(filename, coreOutput),
  ]),
];

await Promise.all(
  assets.map(([source, destination]) => copyFile(source, destination)),
);
