import { register } from '../router.js';
import { loadProjectDocument, marked } from '../store.js';
import { setSafeHtml, setSafeOuterHtml } from '../html.js';

register('project', (container, _params, navigation) => {
  const { projectDocs } = window.__appData || {};

  setSafeHtml(container, `
    <div class="page">
      <header class="header">
        <a href="#" class="back" data-nav="home" data-params='{}'>← 返回</a>
        <h1>项目文档</h1>
        <span class="badge">${projectDocs.length} 篇</span>
      </header>
      <div class="list">
        ${projectDocs.length === 0 ? '<div class="empty"><p>暂无项目文档</p></div>' : ''}
        ${projectDocs.map(d => `
          <a href="#" class="list-item" data-action="open-doc" data-base="${d.base || 'project'}" data-subdir="${d.subdir}" data-filename="${d.filename}">
            <span class="q-prefix">${d.filename.slice(0, 3)}</span>
            <div>
              <span>${d.title}</span>
              <span class="muted">${d.brief}</span>
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
        const doc = projectDocs.find((item) => item.base === base && item.subdir === subdir && item.filename === fn);
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
      } catch {
        if (navigation.isCurrent()) {
          const list = container.querySelector('.list');
          if (list) setSafeOuterHtml(list, '<div class="empty"><p>加载文档失败</p></div>');
        }
      }
    });
  });
});
