import { register } from '../router.js';
import { setSafeHtml } from '../html.js';

register('category', (container, { slug }) => {
  const { categories } = window.__appData || {};
  const cat = categories.find(c => c.slug === slug);

  if (!cat) {
    setSafeHtml(container, '<div class="empty"><p>分类不存在</p></div>');
    return;
  }

  setSafeHtml(container, `
    <div class="page">
      <header class="header">
        <a href="#" class="back" data-nav="home" data-params='{}'>← 返回</a>
        <h1>${cat.name}</h1>
        <span class="badge">${cat.questions.length} 题</span>
      </header>
      <div class="list">
        ${cat.questions.map(q => `
          <a href="#" class="list-item" data-nav="question" data-params='${JSON.stringify({ category: cat.slug, filename: q.filename })}'>
            <span class="q-prefix">${q.filename.slice(0, 3)}</span>
            <span>${q.title}</span>
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
});
