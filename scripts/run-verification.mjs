import { spawnSync } from "node:child_process";

const mode = process.argv[2] ?? "verify";
if (!new Set(["verify", "release"]).has(mode)) {
  throw new Error(
    'Usage: node scripts/run-verification.mjs "verify"|"release"',
  );
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const common = [
  ["format:check"],
  ["lint"],
  ["typecheck"],
  ["test"],
  ["test:coverage"],
  ["build"],
  ["verify:static"],
  ["verify:security"],
  ["verify:build-policy"],
  ["verify:assets"],
];
const releaseOnly = [
  ["audit:dependencies"],
  ["scan:secrets"],
  ["test:e2e"],
  ["test:e2e:responsive"],
  ["test:e2e:cross-browser"],
  ["test:installation"],
  ["test:pwa"],
];
const commands =
  mode === "release"
    ? [["install", "--frozen-lockfile"], ...common, ...releaseOnly]
    : common;

for (const args of commands) {
  process.stdout.write(`\n> pnpm ${args.join(" ")}\n`);
  const result = spawnSync(pnpm, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_SITE_URL:
        process.env.NEXT_PUBLIC_SITE_URL ??
        "https://attendance.example.pages.dev",
      TZ: process.env.TZ ?? "UTC",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
