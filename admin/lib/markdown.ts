import { Question } from './types';
import { marked } from 'marked';

const PROJECT_ROOT = process.cwd() + '/..';

/**
 * Markdown → HTML，给 TipTap 编辑器加载内容用。
 * 处理高亮语法 ==text==，修复表格/代码块与后续标题间的空行，
 * 修正 marked.js 在代码块末尾保留的换行。
 */

// 仅对代码块之外的内容执行替换，避免代码示例里的 ++/== 被误转
function replaceOutsideCodeFences(md: string, regexp: RegExp, replace: (match: string, inner: string) => string): string {
  const parts = md.split('```');
  return parts
    .map((part, index) => (index % 2 === 1 ? part : part.replace(regexp, replace)))
    .join('```');
}

export function mdToHtml(md: string): string {
  let preprocessed = md
    .replace(/<\/(table|pre)>[ \t]*(?:\r?\n[ \t]*)?(?=#{1,6}[ \t]+)/gi, '</$1>\n\n')
    .replace(/\[\[([^\]]+)\]\]/g, (_m, wiki: string) => {
      const safe = wiki.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return `<a class="wiki-link" data-wiki="${safe}">[[${safe}]]</a>`;
    });
  // 高亮 ==text== 与历史下划线 ++text++（新版序列化为 <u>，见 WysiwygEditor 的 ColoredUnderline）
  // 都只在代码块之外替换，避免代码示例里的比较表达式（a == b）或自增运算被误转
  preprocessed = replaceOutsideCodeFences(preprocessed, /==(.+?)==/g, (_m, inner: string) => `<mark>${inner}</mark>`);
  preprocessed = replaceOutsideCodeFences(preprocessed, /\+{2}([^+\n][^+\n]*?)\+{2}/g, (_m, inner: string) => `<u>${inner}</u>`);
  let html = marked.parse(preprocessed, { breaks: true }) as string;
  html = html.replace(/\n(<\/code><\/pre>)/g, '$1');
  return html;
}

/**
 * 解析题目 Markdown 文件为结构化 Question 对象
 */
export function parseQuestion(markdown: string, filename: string): Question {
  const lines = markdown.split('\n');

  let title = '';
  let question = '';
  const tags: string[] = [];
  let answer = '';
  let analysis = '';
  let prevLink: string | null = null;
  let nextLink: string | null = null;

  const KNOWN_SECTIONS = ['题目', '标签', '题目导航', '面试直接答', '详细解析', '我的作答'];
  let currentSection = '';
  let inCodeBlock = false;
  let createdAt = '';
  let updatedAt = '';
  let notes = '';
  let inNotes = false;
  const customSections: { title: string; content: string }[] = [];
  // null = 不在自定义章节内；'' = 未命名的自定义章节（真值判断无法区分，必须用 null 判断）
  let currentCustom: string | null = null;

  for (const line of lines) {
    // Track code fences: ``` or ```lang opens/closes
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      // Still accumulate the line in the current section
      if (currentSection === '题目') {
        question += line + '\n';
      } else if (currentSection === '面试直接答') {
        answer += line + '\n';
      } else if (currentSection === '详细解析') {
        analysis += line + '\n';
      } else if (currentSection === '我的作答') {
        notes += line + '\n';
      }
      // Also accumulate in custom sections（未命名章节标题为 ''，须判 null 而非真值）
      if (currentCustom !== null && customSections.length > 0) {
        const last = customSections[customSections.length - 1];
        if (last.title === currentCustom) {
          last.content += line + '\n';
        }
      }
      continue;
    }

    // 一级标题
    if (!inCodeBlock && line.startsWith('# ') && !line.startsWith('## ')) {
      title = line.replace('# ', '').trim();
      continue;
    }

    // 二级标题 — only outside code blocks
    if (!inCodeBlock && line.startsWith('## ')) {
      const name = line.replace('## ', '').trim();
      if (!KNOWN_SECTIONS.includes(name)) {
        // Custom section: push immediately so content can accumulate
        customSections.push({ title: name, content: '' });
        currentCustom = name;
        currentSection = '';
        continue;
      }
      // Known section: stop accumulating custom content
      currentCustom = null;
      currentSection = name;
      continue;
    }

    switch (currentSection) {
      case '题目':
        if (line.trim()) question += line + '\n';
        break;
      case '标签':
        // 解析 [标签名](链接) | ... 格式的行
        const tagMatches = line.match(/\[([^\]]+)\]\([^)]+\)/g);
        if (tagMatches) {
          for (const m of tagMatches) {
            const name = m.match(/\[([^\]]+)\]/)?.[1];
            if (name) tags.push(name);
          }
        }
        break;
      case '题目导航':
        const prevMatch = line.match(/←\s*\[([^\]]+)\]\(([^)]+)\)/);
        const nextMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)\s*→/);
        if (prevMatch) prevLink = prevMatch[1];
        else if (line.includes('← 无')) prevLink = null;
        if (nextMatch) nextLink = nextMatch[1];
        else if (line.includes('无 →')) nextLink = null;
        break;
      case '面试直接答':
        if (line.trim() || answer) answer += line + '\n';
        break;
      case '详细解析':
        // Skip time metadata comments from content (don't use continue — it would skip metadata parsing below)
        if (!line.match(/<!--\s*(?:created|updated):/)) {
          if (line.trim() || analysis) analysis += line + '\n';
        }
        break;
      case '我的作答':
        if (!line.match(/<!--\s*(?:created|updated):/)) {
          if (line.trim() || notes) notes += line + '\n';
        }
        break;
    }

    // Accumulate custom section content (skip time metadata)
    // 未命名章节标题为 ''，须判 null 而非真值；纯元数据注释行整行跳过（同旧行为），
    // 历史格式中粘连在正文末行上的注释则剥离注释、保留正文部分
    if (currentCustom !== null && customSections.length > 0) {
      const last = customSections[customSections.length - 1];
      if (last.title === currentCustom) {
        if (/<!--\s*(?:created|updated):/.test(line)) {
          const cleaned = line.replace(/<!--\s*(?:created|updated):[^>]*-->/g, '').replace(/[ \t]+$/, '');
          if (cleaned.trim()) last.content += cleaned + '\n';
        } else {
          last.content += line + '\n';
        }
      }
    }

    // Parse time metadata comments
    const createdMatch = line.match(/<!--\s*created:\s*(.+?)\s*-->/);
    if (createdMatch) createdAt = createdMatch[1].trim();
    const updatedMatch = line.match(/<!--\s*updated:\s*(.+?)\s*-->/);
    if (updatedMatch) updatedAt = updatedMatch[1].trim();

    // Fallback: parse notes from old comment format (only if no section found)
    if (!notes) {
      if (/<!--\s*notes:\s*-->/.test(line)) { inNotes = true; continue; }
      if (/<!--\s*\/notes\s*-->/.test(line)) { inNotes = false; continue; }
      if (inNotes) notes += line + '\n';
    }
  }

  // If no times found, use current time as default
  if (!createdAt) createdAt = formatDateTime(new Date());
  if (!updatedAt) updatedAt = createdAt;

  // 去掉末尾恰好一个 \n（结构性分隔符），保留用户有意多打的换行
  const trimOne = (s: string) => s.replace(/\r?\n$/, '');

  return {
    title: title || question.trim().slice(0, 50),
    question: trimOne(question),
    tags,
    answer: trimOne(answer),
    analysis: trimOne(analysis),
    filename,
    prevLink,
    nextLink,
    createdAt,
    updatedAt,
    notes: trimOne(notes),
    customSections: customSections.map(s => ({ ...s, content: trimOne(s.content) })),
  };
}

export function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 将结构化 Question 对象生成 Markdown，符合 CLAUDE.md 规范
 */
export function generateMarkdown(q: Question): string {
  const tagLinks = q.tags
    .map((t) => `[${t}](../../tags/${t}.md)`)
    .join(' | ');

  const prevPart = q.prevLink
    ? `← [${q.prevLink}](${q.prevLink})`
    : '← 无';
  const nextPart = q.nextLink
    ? `[${q.nextLink}](${q.nextLink}) →`
    : '无 →';

  const now = formatDateTime(new Date());
  const created = (q.createdAt && q.createdAt.trim()) || now;
  const updated = now;
  const rtrim1 = (s: string) => s.replace(/\r?\n$/, '');

  const answerBlock = q.answer?.trim() ? `## 面试直接答\n\n${rtrim1(q.answer)}\n\n` : '';
  const analysisBlock = q.analysis?.trim() ? `## 详细解析\n\n${rtrim1(q.analysis)}\n\n` : '';
  const notesBlock = q.notes?.trim() ? `## 我的作答\n\n${rtrim1(q.notes)}\n\n` : '';
  // 自定义章节块结尾补 \n\n，避免时间元数据注释粘连在最后一个章节的正文末行上
  //（粘连后重新解析时该行会被当元数据跳过，导致最后一行内容丢失）
  const customsBlock = (q.customSections || []).length > 0
    ? (q.customSections || []).map(s => `## ${s.title}\n\n${rtrim1(s.content)}`).join('\n\n') + '\n\n'
    : '';

  return `# ${q.title}

## 题目

${rtrim1(q.question)}

## 标签

${tagLinks}

## 题目导航

${prevPart} | ${nextPart}

${answerBlock}${analysisBlock}${notesBlock}${customsBlock}<!-- created: ${created} -->
<!-- updated: ${updated} -->
`;
}
