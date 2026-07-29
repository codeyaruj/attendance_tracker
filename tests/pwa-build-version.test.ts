import { describe, expect, it, vi } from "vitest";

import { fetchDeployedBuild, validBuildVersion } from "@/lib/pwa/build-version";

describe("deployed PWA build metadata", () => {
  it("validates only a non-empty public build ID", () => {
    expect(validBuildVersion({ buildId: "build-b" })).toBe(true);
    expect(
      validBuildVersion({
        buildId: "build-b",
        builtAt: "2026-07-29T00:00:00Z",
      }),
    ).toBe(true);
    expect(validBuildVersion({ buildId: "" })).toBe(false);
    expect(validBuildVersion({ buildId: 123 })).toBe(false);
    expect(validBuildVersion(null)).toBe(false);
  });

  it("bypasses caches and rejects malformed manifests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ buildId: "build-b" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fetchDeployedBuild(fetcher)).resolves.toEqual({
      buildId: "build-b",
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^\/version\.json\?t=\d+$/),
      expect.objectContaining({ cache: "no-store" }),
    );

    fetcher.mockResolvedValueOnce(new Response("{}"));
    await expect(fetchDeployedBuild(fetcher)).rejects.toThrow(
      "Version manifest is invalid",
    );
  });
});
