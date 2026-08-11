'use client';

interface TocItem { id: string; label: string; level: 1 | 2 | 3; num?: string; }

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
                      if (el.textContent?.trim() === item.label) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
          const label = h.replace(/^###\s+/, '').trim();
          group.push({ id: '', label, level: 2 });
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
                    document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  } else {
                    const h3s = document.querySelectorAll('.tiptap-editor h3');
                    for (const el of h3s) {
                      if (el.textContent?.trim() === item.label) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
