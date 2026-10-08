import { register } from '../router.js';
import { loadProjectDocument, marked } from '../store.js';
import { setSafeHtml, setSafeOuterHtml } from '../html.js';
import { enhanceCodeBlocks } from '../mermaid.js';
import { groupLibraryDocuments, libraryDefinition } from '../library.js';
import { resolveDocumentImages } from '../content-sync.js';

register('project', (container, params, navigation) => {
  const { projectDocs } = window.__appData || {};
  const base = params.base === 'groups' ? 'groups' : 'project';
  const subdir = typeof params.subdir === 'string' ? params.subdir : '';
  const definition = libraryDefinition(base);
  const directories = groupLibraryDocuments(projectDocs, base);
  const selectedDirectory = directories.find((directory) => directory.name === subdir);
  const documents = selectedDirectory?.documents || [];
  const showingDirectory = Boolean(subdir);
  const backTarget = showingDirectory
    ? { nav: 'project', params: { base } }
    : { nav: 'home', params: {} };
  const title = showingDirectory ? subdir : definition.title;
  const countLabel = showingDirectory
    ? `${documents.length} 篇`
    : `${directories.length} ${definition.directoryUnit}`;

  setSafeHtml(container, `
    <div class="page">
      <header class="header">
        <a href="#" class="back" data-nav="${backTarget.nav}" data-params='${JSON.stringify(backTarget.params)}'>← 返回</a>
        <h1>${title}</h1>
        <span class="badge">${countLabel}</span>
      </header>
      <div class="list">
        ${!showingDirectory && directories.length === 0 ? `<div class="empty"><p>暂无${definition.title}</p></div>` : ''}
        ${showingDirectory && documents.length === 0 ? '<div class="empty"><p>该目录暂无文档</p></div>' : ''}
        ${showingDirectory ? documents.map(d => `
          <a href="#" class="list-item" data-action="open-doc" data-base="${d.base || 'project'}" data-subdir="${d.subdir}" data-filename="${d.filename}">
            <span class="q-prefix">${d.filename.slice(0, 3)}</span>
            <div class="list-item-main">
              <span>${d.title}</span>
              ${d.brief ? `<span class="muted">${d.brief}</span>` : ''}
            </div>
            <span class="arrow">›</span>
          </a>
        `).join('') : directories.map(directory => `
          <a href="#" class="list-item" data-nav="project" data-params='${JSON.stringify({ base, subdir: directory.name })}'>
            <span class="icon">📁</span>
            <div class="list-item-main">
              <span>${directory.name}</span>
              <span class="muted">${directory.documents.length} 篇文档</span>
            </div>
            <span class="arrow">›</span>
          </a>
        `).join('')}
      </div>
    </div>
  `);

  container.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const params = JSON.parse(el.dataset.params || '{}');
      import('../router.js').then(r => r.navigate(el.dataset.nav, params));
    });
  });

  container.querySelectorAll('[data-action="open-doc"]').forEach(el => {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      const base = el.dataset.base || 'project';
      const subdir = el.dataset.subdir;
      const fn = el.dataset.filename;
      try {
        const doc = documents.find((item) => item.base === base && item.subdir === subdir && item.filename === fn);
        if (!doc) throw new Error('文档不存在');
        setSafeOuterHtml(container.querySelector('.list'), '<div class="list loading"><div class="spinner"></div><p>加载文档…</p></div>');
        const md = await loadProjectDocument(base, subdir, fn);
        if (!navigation.isCurrent()) return;
        let content = md;
        if (md.startsWith('---')) {
          const end = md.indexOf('---', 3);
          if (end > 0) content = md.slice(end + 3).trim();
        }
        // 旧版编辑器将下划线存为 ++text++，marked 不认识，转回 <u> 显示
        const html = marked.parse(content.replace(/\+{2}([^+\n][^+\n]*?)\+{2}/g, '<u>$1</u>')).replace(/<img\b[^>]*?\bsrc=("|')([^"']+)\1/gi, (m, quote, src) => {
          if (/^(https?:|data:|blob:|\/)/i.test(src)) return m;
          return m.replace(`src=${quote}${src}${quote}`, `src=${quote}/${base}/${subdir}/${src.replace(/^\.\//, '')}${quote}`);
        });
        setSafeOuterHtml(container.querySelector('.list'), `
          <div class="card">
            <div class="card-body md">${html}</div>
          </div>
        `);
        await resolveDocumentImages(container, `${base}/${subdir}/${fn}`);
        await enhanceCodeBlocks(container);
      } catch {
        if (navigation.isCurrent()) {
          const list = container.querySelector('.list');
          if (list) setSafeOuterHtml(list, '<div class="empty"><p>加载文档失败</p></div>');
        }
      }
    });
  });
});
