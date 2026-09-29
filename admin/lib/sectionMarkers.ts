export const QUESTION_BODY_SCHEMA = 'interviewqa/sections-v1';

export type QuestionSectionType = 'question' | 'answer' | 'analysis' | 'notes' | 'custom';

export interface SectionDescriptor {
  type: QuestionSectionType;
  id?: string;
  title?: string;
}

export interface SectionBlock {
  descriptor: SectionDescriptor;
  content: string;
}

export interface ParsedSectionedBody {
  preamble: string;
  sections: SectionBlock[];
}

const STANDARD_SECTION_TYPES = new Set<QuestionSectionType>([
  'question',
  'answer',
  'analysis',
  'notes',
]);
const START_PREFIX = '<!-- interviewqa:section ';
export const SECTION_END_MARKER = '<!-- interviewqa:end -->';

export function sectionLabel(descriptor: SectionDescriptor): string {
  switch (descriptor.type) {
    case 'question': return '题目';
    case 'answer': return '面试直接答';
    case 'analysis': return '详细解析';
    case 'notes': return '我的作答';
    case 'custom': return descriptor.title?.trim() || '未命名章节';
  }
}

export function sectionStartMarker(descriptor: SectionDescriptor): string {
  if (STANDARD_SECTION_TYPES.has(descriptor.type)) {
    return `${START_PREFIX}${descriptor.type} -->`;
  }
  const id = descriptor.id?.trim();
  if (!id || !/^custom-[a-z0-9-]+$/i.test(id)) {
    throw new Error(`自定义章节 id 不合法: ${id || '(empty)'}`);
  }
  const payload = JSON.stringify({ id, title: descriptor.title?.trim() || '未命名章节' });
  if (payload.includes('-->')) throw new Error('自定义章节标题不能包含 -->');
  return `${START_PREFIX}custom ${payload} -->`;
}

export function parseSectionMarkerLine(
  line: string,
): { kind: 'start'; descriptor: SectionDescriptor } | { kind: 'end' } | null {
  const trimmed = line.trim();
  if (trimmed === SECTION_END_MARKER) return { kind: 'end' };
  if (!trimmed.startsWith(START_PREFIX) || !trimmed.endsWith(' -->')) return null;

  const payload = trimmed.slice(START_PREFIX.length, -4).trim();
  if (STANDARD_SECTION_TYPES.has(payload as QuestionSectionType)) {
    return { kind: 'start', descriptor: { type: payload as QuestionSectionType } };
  }
  if (!payload.startsWith('custom ')) {
    throw new Error(`未知章节标记: ${trimmed}`);
  }

  let custom: unknown;
  try {
    custom = JSON.parse(payload.slice('custom '.length));
  } catch {
    throw new Error(`自定义章节标记 JSON 不合法: ${trimmed}`);
  }
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
    throw new Error(`自定义章节标记结构不合法: ${trimmed}`);
  }
  const { id, title } = custom as Record<string, unknown>;
  if (typeof id !== 'string' || !/^custom-[a-z0-9-]+$/i.test(id)) {
    throw new Error(`自定义章节标记缺少合法 id: ${trimmed}`);
  }
  if (typeof title !== 'string') {
    throw new Error(`自定义章节标记缺少 title: ${trimmed}`);
  }
  return { kind: 'start', descriptor: { type: 'custom', id, title } };
}

function trimBoundaryBlankLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

export function parseSectionedBody(body: string): ParsedSectionedBody {
  const preambleLines: string[] = [];
  const outsideAfterSection: string[] = [];
  const sections: SectionBlock[] = [];
  let current: { descriptor: SectionDescriptor; lines: string[] } | null = null;
  let inCodeBlock = false;
  let hasSeenSection = false;

  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      (current?.lines || (hasSeenSection ? outsideAfterSection : preambleLines)).push(line);
      continue;
    }

    const marker = inCodeBlock ? null : parseSectionMarkerLine(line);
    if (marker?.kind === 'start') {
      if (current) throw new Error(`章节标记不能嵌套: ${sectionLabel(marker.descriptor)}`);
      if (outsideAfterSection.some((item) => item.trim())) {
        throw new Error('章节结束标记与下一章节之间存在未归属正文');
      }
      outsideAfterSection.length = 0;
      current = { descriptor: marker.descriptor, lines: [] };
      hasSeenSection = true;
      continue;
    }
    if (marker?.kind === 'end') {
      if (!current) throw new Error('发现没有起始标记的章节结束标记');
      sections.push({
        descriptor: current.descriptor,
        content: trimBoundaryBlankLines(current.lines),
      });
      current = null;
      continue;
    }

    if (current) current.lines.push(line);
    else if (hasSeenSection) outsideAfterSection.push(line);
    else preambleLines.push(line);
  }

  if (current) throw new Error(`章节缺少结束标记: ${sectionLabel(current.descriptor)}`);
  if (outsideAfterSection.some((item) => item.trim())) {
    throw new Error('最后一个章节结束后存在未归属正文');
  }

  const seenStandard = new Set<QuestionSectionType>();
  for (const section of sections) {
    if (section.descriptor.type === 'custom') continue;
    if (seenStandard.has(section.descriptor.type)) {
      throw new Error(`章节重复: ${sectionLabel(section.descriptor)}`);
    }
    seenStandard.add(section.descriptor.type);
  }

  return {
    preamble: trimBoundaryBlankLines(preambleLines),
    sections,
  };
}

function sectionBlock(descriptor: SectionDescriptor, content: string): string {
  const normalized = trimBoundaryBlankLines(content.split(/\r?\n/));
  return normalized
    ? `${sectionStartMarker(descriptor)}\n${normalized}\n${SECTION_END_MARKER}`
    : `${sectionStartMarker(descriptor)}\n${SECTION_END_MARKER}`;
}

export function serializeQuestionBody(input: {
  preamble?: string;
  question: string;
  answer: string;
  analysis: string;
  notes?: string;
  customSections?: { id?: string; title: string; content: string }[];
}): string {
  const parts: string[] = [];
  const preamble = input.preamble?.trim();
  if (preamble) parts.push(preamble);
  parts.push(sectionBlock({ type: 'question' }, input.question));
  parts.push(sectionBlock({ type: 'answer' }, input.answer));
  parts.push(sectionBlock({ type: 'analysis' }, input.analysis));
  if (input.notes?.trim()) parts.push(sectionBlock({ type: 'notes' }, input.notes));
  for (const [index, section] of (input.customSections || []).entries()) {
    parts.push(sectionBlock(
      {
        type: 'custom',
        id: section.id || `custom-${index + 1}`,
        title: section.title,
      },
      section.content,
    ));
  }
  return `${parts.join('\n\n')}\n`;
}

/** 把 marker 转成 Tiptap 可保留的原子块节点；代码围栏内的示例保持原文。 */
export function sectionMarkersToHtmlPlaceholders(markdown: string): string {
  const output: string[] = [];
  let inCodeBlock = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      output.push(line);
      continue;
    }
    const marker = inCodeBlock ? null : parseSectionMarkerLine(line);
    if (!marker) {
      output.push(line);
      continue;
    }
    if (marker.kind === 'end') {
      output.push('', '<div data-interviewqa-marker="end"></div>', '');
    } else {
      const descriptor = encodeURIComponent(JSON.stringify(marker.descriptor));
      output.push('', `<div data-interviewqa-marker="start" data-interviewqa-section="${descriptor}"></div>`, '');
    }
  }
  return output.join('\n');
}
