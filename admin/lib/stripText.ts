// 标题/锚点文本的纯文本化：唯一实现，前后端共用。
// 目录（TOC）显示与跳转匹配、文档标题提取、wiki 锚点解析都必须经过它，
// 否则 markdown 标记或内联 HTML（如颜色 <span style>）会泄漏到界面文本中。

/** 剥离标题/锚点文本中的内联 HTML 与 markdown 格式，得到与 DOM textContent 一致的纯文本 */
export function stripMdText(s: string): string {
  return s
    .replace(/<[^>]+>/g, '') // 内联 HTML 标签（标题颜色等 <span style> 标签）
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/[*_~]/g, '')
    .trim();
}
