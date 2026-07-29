import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

describe("static PWA configuration", () => {
  it("publishes an installable manifest with distinct required icons", async () => {
    const value = manifest();
    expect(value).toMatchObject({
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
    });
    const icons = value.icons ?? [];
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icons/icon-192.png",
          sizes: "192x192",
        }),
        expect.objectContaining({
          src: "/icons/icon-512.png",
          sizes: "512x512",
        }),
        expect.objectContaining({
          src: "/icons/icon-512-maskable.png",
          purpose: "maskable",
        }),
      ]),
    );
    await Promise.all(
      [
        "public/icons/icon-192.png",
        "public/icons/icon-512.png",
        "public/icons/icon-512-maskable.png",
        "public/icons/apple-touch-icon.png",
        "public/icons/favicon-32.png",
      ].map((path) => access(path)),
    );
  });

  it("commits restrictive static-host security headers", async () => {
    const headers = await readFile("public/_headers", "utf8");
    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain(
      "Referrer-Policy: strict-origin-when-cross-origin",
    );
    expect(headers).toContain("Permissions-Policy:");
    expect(headers).toContain("Strict-Transport-Security:");
    expect(headers).not.toMatch(/default-src\s+\*/);
    expect(headers).not.toContain("'unsafe-eval'");
    expect(headers).toMatch(
      /\/version\.json[\s\S]*Cache-Control: no-cache, no-store, must-revalidate/,
    );
  });

  it("uses positive cache allowlists and protects private content", async () => {
    const worker = await readFile("public/sw.js", "utf8");
    const version = JSON.parse(
      await readFile("public/version.json", "utf8"),
    ) as { buildId: string };
    expect(worker).toContain(`const BUILD_ID = "${version.buildId}"`);
    expect(worker).toContain("const CACHE_VERSION = `build-${BUILD_ID}`");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('cacheControl.includes("no-store")');
    expect(worker).toContain('cacheControl.includes("private")');
    expect(worker).toContain('disposition.includes("attachment")');
    expect(worker).toContain('request.method !== "GET"');
    expect(worker).toContain('url.protocol === "blob:"');
    expect(worker).toContain('url.protocol === "data:"');
    expect(worker).toContain('url.pathname.includes("backup")');
    expect(worker).toContain("ownedCache(name) && !ACTIVE_CACHES.has(name)");
    expect(worker).toContain('event.data?.type === "SKIP_WAITING"');
    expect(worker).toContain('url.pathname === "/sw.js"');
    expect(worker).toContain('url.pathname === "/version.json"');
    expect(worker).toContain('fetch(request, { cache: "no-store" })');
    expect(worker).not.toContain(
      "caches.keys().then((keys) => Promise.all(keys.map",
    );
  });
});
