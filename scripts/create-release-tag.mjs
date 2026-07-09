import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const actionPackage = JSON.parse(
  readFileSync(
    new URL("../packages/action/package.json", import.meta.url),
    "utf8",
  ),
);
const version = actionPackage.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid @gitppou/action version: ${version}`);
}

if (version === "0.0.0") {
  console.log("@gitppou/action version is 0.0.0; skipping tag creation.");
  process.exit(0);
}

const tag = `v${version}`;

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return typeof output === "string" ? output.trim() : "";
}

function commandSucceeds(command, args) {
  try {
    run(command, args);
    return true;
  } catch {
    return false;
  }
}

const remoteTagExists = commandSucceeds("git", [
  "ls-remote",
  "--exit-code",
  "--tags",
  "origin",
  `refs/tags/${tag}`,
]);

if (remoteTagExists) {
  console.log(`${tag} already exists on origin; skipping.`);
  process.exit(0);
}

run("git", ["config", "user.name", "github-actions[bot]"]);
run("git", [
  "config",
  "user.email",
  "41898282+github-actions[bot]@users.noreply.github.com",
]);

const localTagExists = commandSucceeds("git", [
  "rev-parse",
  "--verify",
  `refs/tags/${tag}`,
]);

if (!localTagExists) {
  run("git", ["tag", "-a", tag, "-m", `Release ${tag}`], { stdio: "inherit" });
}

run("git", ["push", "origin", tag], { stdio: "inherit" });
