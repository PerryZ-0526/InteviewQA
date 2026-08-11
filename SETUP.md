# 环境搭建与启动

## 依赖

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)（新建题目时需要）

## 前端管理后台

项目根目录没有 `package.json`，必须进入 `admin` 目录后再操作。

首次启动（需要安装依赖）：

```bash
cd admin
npm install
npm run dev
```

后续启动：

```bash
cd admin
npm run dev
```

启动后浏览器访问 [http://localhost:3333](http://localhost:3333)。

### 端口占用处理

如果出现 `EADDRINUSE: address already in use :::3333`，先停止占用端口的进程：

```powershell
Get-NetTCPConnection -LocalPort 3333 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## 移动端 App（Capacitor）

`mobile/` 目录下是基于 [Capacitor](https://capacitorjs.com/) 的移动端应用。

### 开发

```bash
cd mobile
npm install
npm run dev        # 本地开发 → http://localhost:4444
```

### 构建与打包

```bash
cd mobile
npm run build      # 构建 dist/，复制 categories/ tags/ project/ 内容
npx cap sync       # 同步 Web 产物到原生项目
npx cap open android  # 在 Android Studio 中打开，打包 APK
```

### 同步题库

App 构建时会将当前 `categories/`、`tags/`、`project/` 的快照打入安装包。如需更新内容：

```bash
cd mobile
npm run sync       # git pull 拉取最新题库
npm run build      # 重新构建
npx cap sync       # 同步到原生项目
```

### 文件结构

```
mobile/
  src/              ← 纯 HTML/CSS/JS（ES modules + CDN marked.js）
  scripts/
    dev-server.mjs   ← 开发服务器（端口 4444）
    build.mjs        ← 构建脚本
    git-sync.mjs     ← git pull 更新
  dist/             ← 构建产物（Capacitor webDir 指向此处）
```
