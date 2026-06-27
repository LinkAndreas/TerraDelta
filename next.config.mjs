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
    return config;
  },
};

export default nextConfig;
