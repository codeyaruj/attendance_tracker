import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const errors = [];
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const dependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
const forbiddenPackages = [
  "openai",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "firebase",
  "@supabase/supabase-js",
  "appwrite",
  "aws-sdk",
  "@aws-sdk/client-s3",
];
for (const name of forbiddenPackages) {
  if (dependencies[name])
    errors.push(`forbidden cloud/backend dependency: ${name}`);
}

const nextConfig = await readFile("next.config.ts", "utf8");
if (!/output:\s*["']export["']/.test(nextConfig))
  errors.push("Next.js static export is not enabled");
if (!/unoptimized:\s*true/.test(nextConfig))
  errors.push("server image optimisation is not disabled");
const headers = await readFile("public/_headers", "utf8");
for (const required of [
  "Content-Security-Policy:",
  "frame-ancestors 'none'",
  "X-Frame-Options: DENY",
  "X-Content-Type-Options: nosniff",
  "Strict-Transport-Security:",
]) {
  if (!headers.includes(required))
    errors.push(`public/_headers is missing ${required}`);
}
if (/default-src\s+\*/.test(headers) || headers.includes("'unsafe-eval'"))
  errors.push("CSP contains an unsafe wildcard or unsafe-eval");

const schema = await readFile("db/schema.ts", "utf8");
if (!/DATABASE_NAME\s*=\s*["']attendsafe["']/.test(schema))
  errors.push("IndexedDB name is no longer the stable attendsafe name");
const worker = await readFile("public/sw.js", "utf8");
for (const required of [
  "OWNED_CACHE_PREFIXES",
  'request.method !== "GET"',
  'cacheControl.includes("no-store")',
  'cacheControl.includes("private")',
  'url.pathname.startsWith("/api/")',
]) {
  if (!worker.includes(required))
    errors.push(`service-worker policy is missing ${required}`);
}
if (/indexedDB|deleteDatabase/i.test(worker))
  errors.push("service worker must not access or delete IndexedDB");

for (const path of ["app/api", "pages/api", "middleware.ts", "middleware.js"]) {
  try {
    await access(path);
    errors.push(`runtime server surface exists: ${path}`);
  } catch {
    /* Expected. */
  }
}
async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? sourceFiles(path)
          : /\.(?:ts|tsx|js|mjs)$/.test(path)
            ? [path]
            : [];
      }),
    )
  ).flat();
}
for (const directory of ["app", "components", "db", "hooks", "lib"]) {
  for (const path of await sourceFiles(directory)) {
    const source = await readFile(path, "utf8");
    if (/^[\t ]*["']use server["'];/m.test(source))
      errors.push(`server action directive found in ${path}`);
    if (
      /\b(?:OPENAI|ANTHROPIC|GEMINI|SUPABASE|FIREBASE|CLOUDFLARE_API)_\w+/.test(
        source,
      )
    )
      errors.push(`paid/cloud provider environment variable found in ${path}`);
    if (
      /indexedDB\.deleteDatabase|localStorage\.clear\(\)|sessionStorage\.clear\(\)/.test(
        source,
      )
    )
      errors.push(
        `automatic broad storage deletion primitive found in ${path}`,
      );
  }
}

if (errors.length) {
  process.stderr.write(
    `Security regression verification failed:\n- ${errors.join("\n- ")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  "Security architecture verified: static-only, local-first, stable IndexedDB, scoped caches, and required headers.\n",
);
