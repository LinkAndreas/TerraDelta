// Release guard: package.json's version must have a matching CHANGELOG.md
// section. Runs on `prebuild`, so a release that bumps the version without
// writing its release notes fails the build instead of shipping an in-app
// changelog that silently omits the version the user is looking at.
//
// Deliberately dependency-free and standalone (no TypeScript, no bundler) so
// it also runs inside the Docker build, where only node and the source tree
// are available.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const markdown = readFileSync(join(root, "CHANGELOG.md"), "utf8");

// Keep in sync with the parser in lib/changelog.ts.
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

const fail = (msg) => {
  console.error(`\n✗ CHANGELOG.md is out of date.\n\n${msg}\n`);
  process.exit(1);
};

const released = sections.filter((s) => s.date !== null && s.changes.length > 0);
const match = released.find((s) => s.version === version);

if (!match) {
  fail(
    `package.json is at version ${version}, but CHANGELOG.md has no released\n` +
      `section for it.\n\n` +
      `Add one above the existing entries:\n\n` +
      `  ## [${version}] — ${new Date().toISOString().slice(0, 10)}\n\n` +
      `  - What changed in this release\n\n` +
      (released[0]
        ? `Newest section currently present: ${released[0].version} (${released[0].date}).`
        : `No released sections found at all.`),
  );
}

// The released sections should read newest-first, since that is the order the
// in-app list renders them in.
if (released[0].version !== version) {
  fail(
    `Version ${version} is documented, but ${released[0].version} is listed above it.\n` +
      `Move the ${version} section to the top so the newest release is first.`,
  );
}

const unreleased = sections.find((s) => s.version === "unreleased");
const extra = unreleased ? ` (plus ${unreleased.changes.length} unreleased)` : "";
console.log(`✓ CHANGELOG.md documents v${version}${extra}`);
