# 管理端后续事项

## 已完成：生成与写入职责分离

Claude Code 只输出带 `META` 和 `CONTENT` 标记的结构化结果，不再直接修改仓库。
`questionRepository.ts` 串行执行文件创建、分类索引、导航、标签和 README 更新。

## 后续

- 为多标签编辑增加基于 mtime/ETag 的冲突检测。
- 将文件级原子写扩展为带恢复日志的多文件事务。
- 按文档 mtime 增量维护全文检索索引。
- 将 `page.tsx` 和 `Sidebar.tsx` 中的工作区状态拆分为独立 hooks。
