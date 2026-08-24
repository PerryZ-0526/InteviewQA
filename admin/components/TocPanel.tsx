'use client';

import { isVisibleInLayout, headingMatch } from '@/lib/domScroll';
import { stripMdText } from '@/lib/stripText';

interface TocItem { id: string; label: string; level: 1 | 2 | 3; num?: string; sectionId?: string; }

interface Props {
  sections: { id: string; label: string; markdown?: string }[];
  headings?: { label: string; level: number }[];
}

export default function TocPanel({ sections, headings }: Props) {
  let groups: TocItem[][] = [];
  let summary: string;

  if (headings) {
    // Flat headings mode: each heading is its own "group" of 1
    // h1/h2 → level 1, h3 → level 2, h4+ → level 3
    // 编号仅对 level 1 递增，level 2/3 用 —
    let lv1Counter = 0;
    groups = headings.map(h => {
      const level = (h.level <= 2 ? 1 : h.level === 3 ? 2 : 3) as 1 | 2 | 3;
      const num = level === 1 ? String(++lv1Counter).padStart(2, '0') : '—';
      return [{ id: '', label: h.label, level, num }];
    });
    summary = `${headings.length} 个标题`;

    if (groups.length === 0) return null;

    return (
      <nav className="toc-panel" aria-label="文档目录">
        <div className="toc-heading">
          <div>
            <span className="toc-eyebrow">CONTENTS</span>
            <div className="toc-title">内容导航</div>
          </div>
          <span className="toc-summary">{summary}</span>
        </div>
        <div className="toc-list">
          {groups.map((group, groupIndex) => (
            <div className="toc-group" key={groupIndex}>
              {group.map((item, itemIndex) => (
                <a
                  key={`${item.label}-${itemIndex}`}
                  href="#"
                  className={`toc-item toc-l${item.level}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const allH = document.querySelectorAll<HTMLElement>('.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3, .tiptap-editor h4');
                    for (const el of Array.from(allH)) {
                      if (!isVisibleInLayout(el)) continue;
                      if (headingMatch(el, item.label)) {
                        el.scrollIntoView({ behavior: 'auto', block: 'start' });
                        break;
                      }
                    }
                  }}
                >
                  <span className="toc-num">{item.num}</span>
                  <span className="toc-label" title={item.label}>{item.label}</span>
                </a>
              ))}
            </div>
          ))}
        </div>
      </nav>
    );
  }

  // Sections mode
  for (const sec of sections) {
    const group: TocItem[] = [{ id: sec.id, label: sec.label, level: 1 }];
    if (sec.markdown) {
      const h3s = sec.markdown.match(/^###\s+(.+)/gm);
      if (h3s) {
        for (const h of h3s) {
          const raw = h.replace(/^###\s+/, '').trim();
          const label = stripMdText(raw);
          group.push({ id: '', label, level: 2, sectionId: sec.id });
        }
      }
    }
    groups.push(group);
  }

  if (groups.length === 0) return null;
  summary = `${sections.length} 个章节`;

  return (
    <nav className="toc-panel" aria-label="文档目录">
      <div className="toc-heading">
        <div>
          <span className="toc-eyebrow">CONTENTS</span>
          <div className="toc-title">内容导航</div>
        </div>
        <span className="toc-summary">{summary}</span>
      </div>
      <div className="toc-list">
        {groups.map((group, groupIndex) => (
          <div className="toc-group" key={group[0].id}>
            {group.map((item, itemIndex) => (
              <a
                key={`${item.label}-${itemIndex}`}
                href={item.id ? `#${item.id}` : '#'}
                className={`toc-item toc-l${item.level}`}
                onClick={(e) => {
                  e.preventDefault();
                  if (item.id) {
                    const target = document.getElementById(item.id);
                    if (isVisibleInLayout(target)) {
                      target.scrollIntoView({ behavior: 'auto', block: 'start' });
                    }
                  } else {
                    // 限定在该章节的编辑器内搜索，避免跨章节同名标题误跳
                    const sectionEl = item.sectionId
                      ? document.getElementById(item.sectionId)?.closest('.doc-section')
                      : null;
                    const scope: Document | Element = sectionEl || document;
                    const h3s = scope.querySelectorAll('.tiptap-editor h3');
                    for (const el of h3s) {
                      if (!isVisibleInLayout(el)) continue;
                      if (headingMatch(el, item.label)) {
                        el.scrollIntoView({ behavior: 'auto', block: 'start' });
                        break;
                      }
                    }
                  }
                }}
              >
                <span className="toc-num">{item.num || (item.level === 1 ? String(groupIndex + 1).padStart(2, '0') : '—')}</span>
                <span className="toc-label" title={item.label}>{item.label}</span>
                {item.level === 1 && <span className="toc-arrow" aria-hidden="true">↘</span>}
              </a>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
