/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev }) => {
    if (dev) {
      // categories/ and tags/ are data files read at runtime via fs.readFile.
      // Exclude them from webpack's file watcher to prevent chunk corruption
      // when Claude Code CLI writes new files during generate.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/categories/**',
          '**/tags/**',
          '**/project/**',
          '**/README.md',
        ],
      };
    }
    return config;
  },
};

module.exports = nextConfig;
