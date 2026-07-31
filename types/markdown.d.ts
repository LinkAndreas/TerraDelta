// Raw text imports of markdown, enabled by the `asset/source` webpack rule in
// next.config.mjs. Used to pull CHANGELOG.md into the app as its own source of
// truth (see lib/changelog.ts).
declare module "*.md" {
  const content: string;
  export default content;
}
