import { register } from '../router.js';

register('tags', (container) => {
  const { tags } = window.__appData || {};

  container.innerHTML = `
    <div class="page">
      <header class="header">
        <a class="back" data-nav="home" data-params='{}'>← 返回</a>
        <h1>标签浏览</h1>
        <span class="badge">${tags.length} 个标签</span>
      </header>
      <div class="tags-cloud">
        ${tags.map(t => `
          <span class="tag" data-tag="${t.name}">
            ${t.name} <span class="muted">(${t.questions.length})</span>
          </span>
        `).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.tag').forEach(el => {
    el.addEventListener('click', () => {
      const tagName = el.dataset.tag;
      const tag = tags.find(t => t.name === tagName);
      window.__searchResults = (tag?.questions || []).map(q => ({ ...q, categoryName: q.category }));
      import('../router.js').then(r => r.navigate('search'));
    });
  });

  container.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const params = JSON.parse(el.dataset.params || '{}');
      import('../router.js').then(r => r.navigate(el.dataset.nav, params));
    });
  });
});
