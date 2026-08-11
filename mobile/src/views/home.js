import { register } from '../router.js';

register('home', (container) => {
  const { categories } = window.__appData || {};

  container.innerHTML = `
    <div class="page">
      <header class="header">
        <h1>面试真题</h1>
        <span class="badge">${categories.length} 个分类</span>
      </header>

      <div class="search-bar" id="home-search">
        <input type="search" placeholder="搜索题目…" autocomplete="off" />
      </div>

      <div class="list">
        <a class="list-item" data-nav="tags" data-params='{}'>
          <span class="icon">🏷️</span>
          <span>标签浏览</span>
          <span class="arrow">›</span>
        </a>
        ${categories.map(c => `
          <a class="list-item" data-nav="category" data-params='${JSON.stringify({ slug: c.slug })}'>
            <span class="icon">📁</span>
            <div>
              <span>${c.name}</span>
              <span class="muted">${c.questions.length} 题</span>
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
      const nav = el.dataset.nav;
      const params = JSON.parse(el.dataset.params || '{}');
      import('../router.js').then(r => r.navigate(nav, params));
    });
  });

  container.querySelector('#home-search input').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (q) {
      import('../store.js').then(s => {
        window.__searchResults = s.search(q);
        import('../router.js').then(r => r.navigate('search'));
      });
    }
  });
});
