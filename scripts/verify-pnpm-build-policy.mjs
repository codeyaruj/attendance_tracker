import { readFile } from "node:fs/promises";

const errors = [];
const workspace = await readFile("pnpm-workspace.yaml", "utf8");
const lockfile = await readFile("pnpm-lock.yaml", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));

if (/\t/.test(workspace)) errors.push("pnpm-workspace.yaml contains tabs");
if (/set this to|placeholder|TODO/i.test(workspace)) {
  errors.push("pnpm-workspace.yaml contains placeholder text");
}
if (/^ignoredBuiltDependencies:/m.test(workspace)) {
  errors.push("pnpm-workspace.yaml still uses ignoredBuiltDependencies");
}
if (packageJson.pnpm?.ignoredBuiltDependencies) {
  errors.push("package.json still uses pnpm.ignoredBuiltDependencies");
}

const lines = workspace.split(/\r?\n/);
const allowBuildsIndex = lines.findIndex((line) => line === "allowBuilds:");
const classifications = new Map();
if (allowBuildsIndex < 0) {
  errors.push("pnpm-workspace.yaml is missing allowBuilds");
} else {
  for (const line of lines.slice(allowBuildsIndex + 1)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!line.startsWith("  ")) break;
    const match = line.match(/^  ["']?([a-zA-Z0-9@/_.-]+)["']?: (true|false)$/);
    if (!match) {
      errors.push(`invalid allowBuilds entry: ${line.trim()}`);
      continue;
    }
    classifications.set(match[1], match[2] === "true");
  }
}

const expected = new Map([
  ["@google/genai", false],
  ["esbuild", true],
  ["protobufjs", false],
  ["sharp", true],
  ["tesseract.js", false],
  ["unrs-resolver", true],
  ["workerd", true],
]);
for (const [name, allowed] of expected) {
  if (classifications.get(name) !== allowed) {
    errors.push(`${name} must be explicitly classified as ${allowed}`);
  }
  if (
    !lockfile.includes(`\n  ${name}@`) &&
    !lockfile.includes(`\n  '${name}@`) &&
    !lockfile.includes(`\n  "${name}@`)
  ) {
    errors.push(`${name} is classified but is not present in pnpm-lock.yaml`);
  }
}
for (const name of classifications.keys()) {
  if (!expected.has(name)) errors.push(`unreviewed allowBuilds entry: ${name}`);
}

if (errors.length) {
  process.stderr.write(
    `pnpm build policy verification failed:\n- ${errors.join("\n- ")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  "pnpm build policy verified: required scripts allowed, reviewed dependency scripts blocked, and no legacy ignore list remains.\n",
);
