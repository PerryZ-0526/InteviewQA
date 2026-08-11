import { register } from '../router.js';

register('search', (container) => {
  const results = window.__searchResults || [];

  container.innerHTML = `
    <div class="page">
      <header class="header">
        <a class="back" data-nav="home" data-params='{}'>← 返回</a>
        <h1>搜索结果</h1>
        <span class="badge">${results.length} 条</span>
      </header>
      <div class="list">
        ${results.length === 0 ? '<div class="empty"><p>无匹配结果</p></div>' : ''}
        ${results.map(q => `
          <a class="list-item" data-nav="question" data-params='${JSON.stringify({ category: q.category, filename: q.filename })}'>
            <span class="q-prefix">${q.filename.slice(0, 3)}</span>
            <div>
              <span>${q.title}</span>
              <span class="muted">${q.categoryName}</span>
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
});
