/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle for small Docker images.
  output: "standalone",
  webpack: (config) => {
    // @techstark/opencv-js (Emscripten) references Node core modules behind
    // runtime guards; stub them out for the browser bundle.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    // Import markdown as a plain string. CHANGELOG.md is pulled into the app
    // this way so the release notes it shows are literally the file in the
    // repository — no generated copy that can fall behind a release.
    config.module.rules.push({ test: /\.md$/, type: "asset/source" });

    return config;
  },
};

export default nextConfig;
