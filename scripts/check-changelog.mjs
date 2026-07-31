// Release guard: the version being released must have a CHANGELOG.md section.
//
// WHY IT IS ANCHORED THE WAY IT IS. An earlier version of this script compared
// CHANGELOG.md against package.json's version. That could never fire: this
// repository releases by cutting a `release/x.y.z` branch and tagging, and the
// version in package.json is not part of that process — tags 1.5.3 and 1.5.4
// both shipped with package.json still reading 1.5.2. A guard anchored to a
// value the release never changes is a guard that never runs.
//
// So the version under release is resolved from what actually defines it, in
// order of authority:
//   1. --version x.y.z            explicit (what CI passes)
//   2. GITHUB_REF                 refs/tags/x.y.z or refs/heads/release/x.y.z
//   3. the local git branch/tag   release/x.y.z, or the tag at HEAD
//   4. package.json               last resort, for a plain local build
//
// Dependency-free and standalone (no TypeScript, no bundler) so it runs in the
// Docker build too, where only node and the source tree exist.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const markdown = readFileSync(join(root, "CHANGELOG.md"), "utf8");

const SEMVER = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

function fromArgs() {
  const i = process.argv.indexOf("--version");
  if (i === -1) return null;
  const m = SEMVER.exec(process.argv[i + 1] ?? "");
  return m ? { version: m[1], source: "--version" } : null;
}

function fromRef(ref, label) {
  if (!ref) return null;
  const tag = /^refs\/tags\/(.+)$/.exec(ref);
  if (tag) {
    const m = SEMVER.exec(tag[1]);
    if (m) return { version: m[1], source: `${label} (tag ${tag[1]})` };
  }
  const branch = /release\/(.+)$/.exec(ref);
  if (branch) {
    const m = SEMVER.exec(branch[1]);
    if (m) return { version: m[1], source: `${label} (branch release/${branch[1]})` };
  }
  return null;
}

function fromGit() {
  const git = (...args) => {
    try {
      return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return ""; // no git, or not a repository — the Docker build case
    }
  };
  const found = fromRef(`refs/heads/${git("rev-parse", "--abbrev-ref", "HEAD")}`, "current branch");
  if (found) return found;
  const tag = git("tag", "--points-at", "HEAD").split("\n")[0];
  const m = SEMVER.exec(tag);
  return m ? { version: m[1], source: `tag at HEAD (${tag})` } : null;
}

const resolved =
  fromArgs() ??
  fromRef(process.env.GITHUB_REF, "GITHUB_REF") ??
  fromGit() ?? { version: pkg.version, source: "package.json" };

// ── Parse the changelog (keep in sync with lib/changelog.ts) ───────────────

const HEADING = /^##\s+\[?([^\]\s]+)\]?\s*(?:[—–-]\s*(\d{4}-\d{2}-\d{2}))?\s*$/;

const sections = [];
let current = null;
for (const raw of markdown.split(/\r?\n/)) {
  const line = raw.trim();
  const m = HEADING.exec(line);
  if (m) {
    const isUnreleased = /^unreleased$/i.test(m[1]);
    if (!m[2] && !isUnreleased) {
      current = null;
      continue;
    }
    current = { version: isUnreleased ? "unreleased" : m[1], date: m[2] ?? null, changes: [] };
    sections.push(current);
    continue;
  }
  if (current && /^[-*]\s+\S/.test(line)) current.changes.push(line);
}

const released = sections.filter((s) => s.date !== null && s.changes.length > 0);

function fail(message) {
  console.error(`\n✗ CHANGELOG.md is out of date.\n\n${message}\n`);
  process.exit(1);
}

// ── Checks ────────────────────────────────────────────────────────────────

if (released.length === 0) fail("CHANGELOG.md contains no released sections at all.");

const { version, source } = resolved;
const match = released.find((s) => s.version === version);

if (!match) {
  fail(
    `Releasing ${version} (from ${source}), but CHANGELOG.md has no section for it.\n\n` +
      `Add one at the top, above ${released[0].version}:\n\n` +
      `  ## [${version}] — ${new Date().toISOString().slice(0, 10)}\n\n` +
      `  - What changed in this release\n`,
  );
}

if (released[0].version !== version) {
  fail(
    `${version} is documented, but ${released[0].version} is listed above it.\n` +
      `Move the ${version} section to the top — the in-app list renders newest first.`,
  );
}

// package.json is not what gates a release here, but letting it drift is how
// the previous guard ended up inert. Report it rather than fail: a mismatch is
// bookkeeping, not a reason to block a build.
if (pkg.version !== version) {
  console.warn(
    `⚠ package.json says ${pkg.version} but ${version} is being released — ` +
      `set "version": "${version}" in package.json to keep tooling in step.`,
  );
}

const unreleased = sections.find((s) => s.version === "unreleased");
const extra = unreleased && unreleased.changes.length > 0 ? ` (plus ${unreleased.changes.length} unreleased)` : "";
console.log(`✓ CHANGELOG.md documents ${version}${extra} — resolved from ${source}`);
