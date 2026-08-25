/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace-Packages werden als TypeScript-Quelle mitkompiliert.
  transpilePackages: ['@palantir/contracts', '@palantir/validation'],
  eslint: {
    dirs: ['src'],
  },
};

export default nextConfig;
