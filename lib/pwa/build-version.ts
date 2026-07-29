import { CURRENT_BUILD, CURRENT_BUILD_ID } from "./build-info";

export type BuildVersion = {
  buildId: string;
  builtAt?: string;
};

export { CURRENT_BUILD, CURRENT_BUILD_ID };

export function validBuildVersion(value: unknown): value is BuildVersion {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BuildVersion>;
  return (
    typeof candidate.buildId === "string" &&
    candidate.buildId.length > 0 &&
    (candidate.builtAt === undefined || typeof candidate.builtAt === "string")
  );
}

export async function fetchDeployedBuild(
  fetcher: typeof fetch = fetch,
): Promise<BuildVersion> {
  const response = await fetcher(`/version.json?t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Version manifest is unavailable");
  const value: unknown = await response.json();
  if (!validBuildVersion(value)) throw new Error("Version manifest is invalid");
  return value;
}
