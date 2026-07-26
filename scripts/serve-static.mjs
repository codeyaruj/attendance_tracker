import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "out");
const port = Number.parseInt(process.argv[3] ?? "3000", 10);
const host = process.argv[4] ?? "127.0.0.1";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gz": "application/gzip",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; manifest-src 'self'; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; child-src 'self' blob:",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Permitted-Cross-Domain-Policies": "none",
};

async function existingFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return;
  const candidates = [candidate];
  if (decoded.endsWith("/")) candidates.push(join(candidate, "index.html"));
  if (!extname(candidate)) candidates.push(join(candidate, "index.html"));
  for (const path of candidates) {
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {
      // Try the next static-export path.
    }
  }
}

await access(root);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const file = await existingFile(url.pathname);
    if (!file) {
      response.writeHead(404, securityHeaders);
      response.end("Not found");
      return;
    }
    const headers = {
      ...securityHeaders,
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
    };
    if (url.pathname === "/sw.js") {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    }
    response.writeHead(200, headers);
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(500, securityHeaders);
    response.end("Static file error");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Static AttendSafe output: http://localhost:${port}\n`);
});
