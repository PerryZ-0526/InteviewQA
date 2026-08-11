# TODO：将索引维护从 Claude Code 迁移到应用代码

## 目标

Claude Code 只生成题目 Markdown 内容，不操作文件系统。
所有文件写入和索引维护由 Next.js API 代码完成。

## 改造范围

### 1. 修改 Claude Code Prompt（`lib/claudeCode.ts`）

原 prompt 要求 Claude Code 写文件 + 更新索引，改为只要求输出 Markdown 内容到 stdout：

```diff
- 创建题目文件、更新索引、更新标签...
+ 只输出完整 Markdown 原文，不要写任何文件。
+ 输出格式：先输出一行 ===CONTENT_START===，
+ 然后输出完整 Markdown，最后输出一行 ===CONTENT_END===
```

### 2. 重写 `POST /api/generate`（`app/api/generate/route.ts`）

```
接收请求 { question, category?, tags? }
  │
  ├─ 1. 如果 category 为空
  │     ├─ 调 Claude Code analyze（轻量，只输出 JSON：{category, tags, newTags}）
  │     └─ 解析 JSON，得到 category 和 tags
  │
  ├─ 2. 调 Claude Code generate（只输出 Markdown 内容）
  │     └─ 从 stdout 提取 ===CONTENT_START=== 到 ===CONTENT_END=== 之间的内容
  │
  ├─ 3. 代码确定序号
  │     └─ 扫描 categories/<category>/ 目录，找最大序号 N，新序号 = N + 1
  │
  ├─ 4. 生成文件名并写入
  │     ├─ 从 Markdown 标题提取文件名（或让 Claude 在输出中指定）
  │     ├─ 文件名格式: NNN-xxx.md
  │     └─ fs.writeFile(categories/<category>/<NNN-xxx>.md, content)
  │
  ├─ 5. 更新分类索引
  │     └─ 编辑 categories/<category>/00-index.md，追加条目
  │
  ├─ 6. 更新标签文件
  │     ├─ 遍历 tags，检查 tags/<tag>.md 是否存在
  │     ├─ 不存在 → 新建并写入基本结构
  │     └─ 存在 → 在 ## 相关题目 下追加条目
  │
  ├─ 7. 更新前题导航
  │     └─ 如果 N > 1，读 categories/<category>/<NNN-1>-xxx.md，
  │        把「下一题」从「无」改为指向新文件
  │
  ├─ 8. 检查新增内容
  │     ├─ 如果是新分类 → 更新 README.md 的分类列表
  │     └─ 如有新标签 → 更新 README.md 的标签列表
  │
  └─ 9. 返回 { filePath, content }
```

### 3. 需要新建的工具函数（`lib/fileUtils.ts`）

| 函数 | 功能 |
|------|------|
| `getMaxSequence(category)` | ✅ 已有 |
| `writeQuestion(category, filename, content)` | ✅ 已有 |
| `readIndex(category)` | 读 00-index.md 内容 |
| `appendToIndex(category, entry)` | 在 00-index.md 中追加一行题目条目 |
| `upsertTagFile(tagName, entry)` | 创建或更新标签文件，追加题目链接 |
| `updatePrevNavigation(category, prevFilename, newFilename)` | 更新前一题的下一题链接 |
| `updateReadmeForNewCategory(categoryName, slug)` | 追加新分类到 README |
| `updateReadmeForNewTags(tagNames)` | 追加新标签到 README |

### 4. 改动涉及的文件

```
admin/
├── lib/
│   ├── claudeCode.ts        ← 修改 prompt，只输出内容
│   ├── fileUtils.ts          ← 新增上述工具函数
│   └── types.ts              ← 可能需要新增类型
├── app/api/generate/
│   └── route.ts              ← 重写：串联所有步骤
└── components/
    └── GenerateForm.tsx      ← 不变（接口兼容）
```

### 5. 不改动的内容

- `/api/analyze`：可复用做轻量分类判断（第一步）
- 前端组件：接口保持 `POST /api/generate`，返回格式不变
- Claude Code 调用方式：仍然 `spawn('claude', ['-p', '--dangerously-skip-permissions', prompt])`
- 已有题目的编辑和预览：不受影响

### 6. 风险点

- **Claude Code 输出解析**：需要可靠的标记（`===CONTENT_START===`/`===CONTENT_END===`），防止 Markdown 正文中的巧合匹配
- **00-index.md 格式一致性**：追加条目时需保证和已有格式一致（包括缩进和换行）
- **并发问题**：当前是单用户本地工具，暂不考虑，但未来若多人使用需加文件锁
- **标签文件名**：标题中包含特殊字符时需要 sanitize

### 7. 预估工作量

约 2-3 小时：
- 改 prompt + 解析输出：30 分钟
- 写文件工具函数：60 分钟
- 串联 route 逻辑：45 分钟
- 测试 + 修 bug：30 分钟
