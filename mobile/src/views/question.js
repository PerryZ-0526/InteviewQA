import { register } from '../router.js';
import { marked } from '../store.js';

register('question', (container, { category, filename }) => {
  const { categories } = window.__appData || {};
  const cat = categories.find(c => c.slug === category);
  const q = cat?.questions.find(q => q.filename === filename);

  if (!q) {
    container.innerHTML = '<div class="empty"><p>题目不存在</p></div>';
    return;
  }

  // 渲染 markdown 并将文档内相对图片路径 images/xxx.png 解析为 /categories/<category>/images/xxx.png
  const renderMd = (md) => {
    const html = marked.parse(md || '');
    return html.replace(/<img\b[^>]*?\bsrc=("|')([^"']+)\1/gi, (m, quote, src) => {
      if (/^(https?:|data:|blob:|\/)/i.test(src)) return m;
      return m.replace(`src=${quote}${src}${quote}`, `src=${quote}/categories/${category}/${src.replace(/^\.\//, '')}${quote}`);
    });
  };

  container.innerHTML = `
    <div class="page">
      <header class="header">
        <a class="back" data-nav="category" data-params='${JSON.stringify({ slug: category })}'>← ${cat.name}</a>
        <h1>${q.title}</h1>
        <div class="tags-row">${q.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
      </header>

      <div class="card">
        <div class="card-title">题目</div>
        <div class="card-body">${q.question}</div>
      </div>

      ${q.answer ? `
      <div class="card">
        <div class="card-title">面试直接答</div>
        <div class="card-body md">${renderMd(q.answer)}</div>
      </div>` : ''}

      ${q.analysis ? `
      <div class="card">
        <div class="card-title">详细解析</div>
        <div class="card-body md">${renderMd(q.analysis)}</div>
      </div>` : ''}

      ${q.notes && q.notes !== '(暂无作答记录)' ? `
      <div class="card">
        <div class="card-title">我的作答</div>
        <div class="card-body md">${renderMd(q.notes)}</div>
      </div>` : ''}
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
