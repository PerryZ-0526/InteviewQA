/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  webpack: (config, { dev }) => {
    if (dev) {
      // categories/ tags/ project/ 是运行时 fs 读取的数据文件，写入时排除出 watcher
      // 防止 Claude Code CLI 生成新文件时引发 chunk 损坏。
      // 注意：只排除仓库根目录下的数据目录，不能误伤 admin/app/api/categories/** 等路由源码。
      const repoRoot = path.resolve(__dirname, '..').replace(/[\\/]/g, '[/\\\\]');
      config.watchOptions = {
        ...config.watchOptions,
        ignored: new RegExp(
          `^${repoRoot}[/\\\\](?:categories|tags|project)[/\\\\]|^${repoRoot}[/\\\\]README\\.md$` +
            `|^${repoRoot}[/\\\\]admin[/\\\\](?:tasks[/\\\\]|logs\\.jsonl$)`
        ),
      };
    }
    return config;
  },
};

module.exports = nextConfig;
