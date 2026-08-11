import { register, navigate, container } from './router.js';
import { loadAll, search, marked } from './store.js';
import './style.css';

// ---- Views ----
import './views/home.js';
import './views/category.js';
import './views/question.js';
import './views/search.js';
import './views/tags.js';
import './views/project.js';

// ---- Init ----
async function init() {
  container.innerHTML = `<div class="loading"><div class="spinner"></div><p>加载题库…</p></div>`;

  try {
    const data = await loadAll();
    window.__appData = data;
    navigate('home');
  } catch (e) {
    container.innerHTML = `<div class="empty"><p>加载失败</p><p class="muted">${e.message}</p></div>`;
  }
}

init();
