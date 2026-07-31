// In-app release notes, read straight from CHANGELOG.md at build time.
//
// The earlier version of this file held a hand-generated COPY of the release
// history, derived once from the git tags. That copy could only ever be
// correct at the moment it was written: cutting a release left it silently
// stale, with nothing to catch it. So the direction is inverted here —
// CHANGELOG.md is the single source of truth that a human edits as part of the
// release, and this module only parses it. There is nothing to regenerate and
// nothing that can drift.
//
// Two things keep it honest:
//   • the markdown is imported (webpack `asset/source`, see next.config.mjs),
//     so the notes that ship are literally the file in the repository;
//   • scripts/check-changelog.mjs runs on `prebuild` and fails the build when
//     package.json's version has no matching section — a release that forgets
//     its changelog entry cannot be built.

import pkg from "../package.json";
import changelogMarkdown from "../CHANGELOG.md";

export interface ChangelogEntry {
  version: string;
  // ISO date of the release, or null while the section is still "Unreleased".
  date: string | null;
  changes: string[];
}

// Single source of truth for the running version.
export const APP_VERSION: string = pkg.version;

// Section heading: "## [1.5.2] — 2026-07-30", "## [Unreleased]".
// Brackets are optional and the date separator may be an em dash, en dash or
// hyphen — Keep a Changelog is a convention, not a grammar, and a release note
// should not fail to appear because someone typed the wrong dash.
const HEADING = /^##\s+\[?([^\]\s]+)\]?\s*(?:[—–-]\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const BULLET = /^[-*]\s+(.*)$/;

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();

    const heading = HEADING.exec(line);
    if (heading) {
      const version = heading[1];
      const date = heading[2] ?? null;
      // Prose headings like "## When cutting a release" are not versions: a
      // section only counts once it carries a date or is the explicit
      // Unreleased marker.
      const isUnreleased = /^unreleased$/i.test(version);
      if (!date && !isUnreleased) {
        current = null;
        continue;
      }
      current = { version: isUnreleased ? "unreleased" : version, date, changes: [] };
      entries.push(current);
      continue;
    }

    if (!current) continue;
    const bullet = BULLET.exec(line);
    if (bullet && bullet[1].trim()) current.changes.push(bullet[1].trim());
  }

  // A section with no bullets carries no information — drop it rather than
  // render an empty block. An "Unreleased" heading left behind after a release
  // is the normal case.
  return entries.filter((e) => e.changes.length > 0);
}

export const CHANGELOG: ChangelogEntry[] = parseChangelog(changelogMarkdown);

// The newest entry that has actually been released — what the footer shows.
export const LATEST_RELEASE: ChangelogEntry | undefined = CHANGELOG.find((e) => e.date !== null);

// True when the running build carries changes not yet in a tagged release.
export const HAS_UNRELEASED = CHANGELOG.some((e) => e.date === null);
