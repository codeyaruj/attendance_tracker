import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const patterns = [
  ["private key", new RegExp("BEGIN " + "(?:RSA |EC |OPENSSH )?PRIVATE KEY")],
  ["GitHub token", /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/],
  ["GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{50,}/],
  ["OpenAI-style key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}/],
  [
    "credentialed database URL",
    /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@/i,
  ],
  [
    "Cloudflare token assignment",
    /CLOUDFLARE_API_TOKEN\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/,
  ],
];
const git = (args) =>
  spawnSync("git", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
const listed = git([
  "ls-files",
  "-z",
  "--cached",
  "--others",
  "--exclude-standard",
]);
if (listed.status !== 0)
  throw new Error("Could not enumerate tracked files for secret scanning.");
const findings = [];
for (const path of listed.stdout.split("\0").filter(Boolean)) {
  const content = await readFile(path);
  if (content.length > 5 * 1024 * 1024 || content.includes(0)) continue;
  const text = content.toString("utf8");
  for (const [name, pattern] of patterns)
    if (pattern.test(text)) findings.push(`${name} in ${path}`);
}
let historyScanned = false;
if (process.argv.includes("--history")) {
  const history = git([
    "log",
    "--all",
    "--format=commit:%H",
    "-p",
    "--no-ext-diff",
    "--no-color",
  ]);
  if (history.status !== 0)
    throw new Error("Git-history secret scan failed to run.");
  historyScanned = true;
  for (const [name, pattern] of patterns)
    if (pattern.test(history.stdout)) findings.push(`${name} in Git history`);
}
if (findings.length) {
  process.stderr.write(
    `Potential secrets detected (values redacted):\n- ${[...new Set(findings)].join("\n- ")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `Secret scan passed for tracked and untracked source${historyScanned ? " plus complete reachable Git history" : ""}; findings are always redacted.\n`,
);
