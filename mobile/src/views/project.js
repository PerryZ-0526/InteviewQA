import { register } from '../router.js';
import { marked } from '../store.js';

register('project', (container) => {
  const { projectDocs } = window.__appData || {};

  container.innerHTML = `
    <div class="page">
      <header class="header">
        <a class="back" data-nav="home" data-params='{}'>← 返回</a>
        <h1>项目文档</h1>
        <span class="badge">${projectDocs.length} 篇</span>
      </header>
      <div class="list">
        ${projectDocs.length === 0 ? '<div class="empty"><p>暂无项目文档</p></div>' : ''}
        ${projectDocs.map(d => `
          <a class="list-item" data-action="open-doc" data-base="${d.base || 'project'}" data-subdir="${d.subdir}" data-filename="${d.filename}">
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
  `;

  container.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const params = JSON.parse(el.dataset.params || '{}');
      import('../router.js').then(r => r.navigate(el.dataset.nav, params));
    });
  });

  container.querySelectorAll('[data-action="open-doc"]').forEach(el => {
    el.addEventListener('click', async () => {
      const base = el.dataset.base || 'project';
      const subdir = el.dataset.subdir;
      const fn = el.dataset.filename;
      try {
        const res = await fetch(`/${base}/${subdir}/${fn}`);
        const md = await res.text();
        let content = md;
        if (md.startsWith('---')) {
          const end = md.indexOf('---', 3);
          if (end > 0) content = md.slice(end + 3).trim();
        }
        const html = marked.parse(content).replace(/<img\b[^>]*?\bsrc=("|')([^"']+)\1/gi, (m, quote, src) => {
          if (/^(https?:|data:|blob:|\/)/i.test(src)) return m;
          return m.replace(`src=${quote}${src}${quote}`, `src=${quote}/${base}/${subdir}/${src.replace(/^\.\//, '')}${quote}`);
        });
        container.querySelector('.list').outerHTML = `
          <div class="card">
            <div class="card-body md">${html}</div>
          </div>
        `;
      } catch {
        alert('加载文档失败');
      }
    });
  });
});
