import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const runAudit = (args) =>
  spawnSync(pnpm, ["audit", ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
const production = runAudit(["--prod", "--json"]);
if (production.error) throw production.error;
if (production.status !== 0) {
  process.stderr.write(
    "Production dependency audit found vulnerabilities or failed to run.\n",
  );
  process.exit(production.status ?? 1);
}

const full = runAudit(["--json"]);
if (full.error) throw full.error;
let report;
try {
  report = JSON.parse(full.stdout);
} catch {
  process.stderr.write("Dependency audit did not return valid JSON.\n");
  process.exit(1);
}
const configuration = JSON.parse(
  await readFile("security/dependency-audit-exceptions.json", "utf8"),
);
const today = new Date().toISOString().slice(0, 10);
const exceptions = new Map(
  configuration.exceptions.map((item) => [item.githubAdvisoryId, item]),
);
const blocking = [];
const accepted = [];
for (const advisory of Object.values(report.advisories ?? {})) {
  if (!new Set(["high", "critical"]).has(advisory.severity)) continue;
  const exception = exceptions.get(advisory.github_advisory_id);
  const devOnly = advisory.findings?.every((finding) => finding.dev === true);
  if (
    !exception ||
    exception.package !== advisory.module_name ||
    exception.expiresAt < today ||
    (exception.devOnly && !devOnly)
  ) {
    blocking.push(
      `${advisory.github_advisory_id} (${advisory.module_name}, ${advisory.severity})`,
    );
  } else {
    accepted.push(
      `${advisory.github_advisory_id} (${advisory.module_name}, dev-only, expires ${exception.expiresAt})`,
    );
  }
}
if (blocking.length) {
  process.stderr.write(
    `Blocking dependency advisories:\n- ${blocking.join("\n- ")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  "Production dependency audit: no known vulnerabilities.\n",
);
process.stdout.write(
  accepted.length
    ? `Documented temporary development exceptions:\n- ${accepted.join("\n- ")}\n`
    : "Full dependency audit: no high or critical findings.\n",
);
