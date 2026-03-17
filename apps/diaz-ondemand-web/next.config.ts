import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias['@diaz/shared'] = path.resolve(process.cwd(), '../../packages/shared/dist/index.js');
    return config;
  },
};

export default nextConfig;
