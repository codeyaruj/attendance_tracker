import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { CURRENT_BUILD_ID } from "@/lib/pwa/build-info";

const generatorUrl = pathToFileURL(
  `${process.cwd()}/scripts/generate-pwa-build.mjs`,
).href;

function resolveInSubprocess(environment: Record<string, string>) {
  const source = `
    const { resolveBuildId } = await import(${JSON.stringify(generatorUrl)});
    process.stdout.write(await resolveBuildId(${JSON.stringify(environment)}));
  `;
  return execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

describe("PWA build generation", () => {
  it("keeps generated worker, manifest, and client build IDs in sync", async () => {
    const worker = await readFile("public/sw.js", "utf8");
    const version = JSON.parse(
      await readFile("public/version.json", "utf8"),
    ) as { buildId: string };

    expect(version.buildId).toBe(CURRENT_BUILD_ID);
    expect(worker).toContain(`const BUILD_ID = "${CURRENT_BUILD_ID}"`);
    expect(worker).toContain("`attendsafe-shell-${CACHE_VERSION}`");
  });

  it("prefers the Cloudflare commit and stays stable for the same build", () => {
    const environment = {
      CF_PAGES_COMMIT_SHA: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
      GITHUB_SHA: "1111111111111111111111111111111111111111",
    };
    const first = resolveInSubprocess(environment);
    const second = resolveInSubprocess(environment);

    expect(first).toBe("abcdef0123456789abcdef0123456789");
    expect(second).toBe(first);
  });

  it("produces different service-worker source for different commits", async () => {
    const template = await readFile("pwa/sw-template.js", "utf8");
    const buildA = resolveInSubprocess({ CF_PAGES_COMMIT_SHA: "a".repeat(40) });
    const buildB = resolveInSubprocess({ CF_PAGES_COMMIT_SHA: "b".repeat(40) });

    expect(buildA).not.toBe(buildB);
    expect(template.replaceAll("__ATTENDSAFE_BUILD_ID__", buildA)).not.toBe(
      template.replaceAll("__ATTENDSAFE_BUILD_ID__", buildB),
    );
  });

  it("has a stable deterministic source fallback independent of timestamps", () => {
    const source = `
      const { deterministicSourceBuildId } = await import(${JSON.stringify(generatorUrl)});
      process.stdout.write(await deterministicSourceBuildId());
    `;
    const run = () =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", source],
        { cwd: process.cwd(), encoding: "utf8" },
      );
    expect(run()).toBe(run());
    expect(run()).toMatch(/^source-[a-f0-9]{20}$/);
  });
});
