import { register } from '../router.js';
import { setSafeHtml } from '../html.js';
import { groupLibraryDocuments, libraryDefinition } from '../library.js';
import {
  contentSyncState,
  shortContentVersion,
  syncContent,
} from '../content-sync.js';

function syncStateLabel(state) {
  const source = state.usingDownloadedContent ? '已同步' : '内置';
  const version = shortContentVersion(state.contentVersion);
  if (!state.lastSyncedAt) return `内容 ${version} · ${source}版本`;
  const time = new Date(state.lastSyncedAt).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `内容 ${version} · ${time} 同步`;
}

register('home', (container, _params, navigation) => {
  const { categories, projectDocs } = window.__appData || {};
  const libraries = ['project', 'groups']
    .map((base) => ({
      base,
      definition: libraryDefinition(base),
      directories: groupLibraryDocuments(projectDocs, base),
    }))
    .filter((library) => library.directories.length > 0);

  setSafeHtml(container, `
    <div class="page">
      <header class="header home-header">
        <div>
          <h1>面试真题</h1>
          <span class="badge">${categories.length} 个分类 · ${projectDocs.length} 篇资料</span>
        </div>
        <button class="sync-button" type="button" aria-label="同步最新内容" title="同步最新内容">↻</button>
      </header>
      <div class="sync-status" aria-live="polite">正在读取内容版本…</div>

      <div class="search-bar" id="home-search">
        <input type="search" placeholder="搜索题目…" autocomplete="off" />
      </div>

      <div class="home-section-title">资料库</div>
      <div class="list library-list">
        <a href="#" class="list-item" data-nav="tags" data-params='{}'>
          <span class="icon">🏷️</span>
          <div class="list-item-main">
            <span>标签浏览</span>
            <span class="muted">按知识主题查找</span>
          </div>
          <span class="arrow">›</span>
        </a>
        ${libraries.map(({ base, definition, directories }) => {
          const documentCount = directories.reduce((sum, directory) => sum + directory.documents.length, 0);
          return `
        <a href="#" class="list-item" data-nav="project" data-params='${JSON.stringify({ base })}'>
          <span class="icon">${definition.icon}</span>
          <div class="list-item-main">
            <span>${definition.title}</span>
            <span class="muted">${directories.length} ${definition.directoryUnit}</span>
          </div>
          <span class="list-item-count">${documentCount} 篇</span>
          <span class="arrow">›</span>
        </a>`;
        }).join('')}
      </div>

      <div class="home-section-title">题目分类</div>
      <div class="list">
        ${categories.map(c => `
          <a href="#" class="list-item" data-nav="category" data-params='${JSON.stringify({ slug: c.slug })}'>
            <span class="icon">📁</span>
            <div class="list-item-main">
              <span>${c.name}</span>
              <span class="muted">${c.questions.length} 篇</span>
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

  const syncButton = container.querySelector('.sync-button');
  const syncStatus = container.querySelector('.sync-status');
  contentSyncState()
    .then((state) => {
      if (navigation.isCurrent()) syncStatus.textContent = syncStateLabel(state);
    })
    .catch(() => {
      if (navigation.isCurrent()) syncStatus.textContent = '当前使用内置内容';
    });

  syncButton.addEventListener('click', async () => {
    syncButton.disabled = true;
    syncButton.classList.add('syncing');
    try {
      const result = await syncContent({
        onProgress(progress) {
          if (!navigation.isCurrent()) return;
          if (progress.phase === 'checking') syncStatus.textContent = '正在检查内容版本…';
          else if (progress.phase === 'downloading') {
            syncStatus.textContent = progress.total > 0
              ? `正在同步 ${progress.completed}/${progress.total}`
              : '正在准备新版本…';
          } else if (progress.phase === 'validating') syncStatus.textContent = '正在校验新版本…';
        },
      });
      if (!navigation.isCurrent()) return;
      if (!result.updated) {
        syncStatus.textContent = `内容 ${shortContentVersion(result.manifest.contentVersion)} · 已是最新`;
        return;
      }
      syncStatus.textContent = `已同步 ${result.downloaded} 个文件，正在刷新…`;
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      if (navigation.isCurrent()) {
        syncStatus.textContent = error instanceof Error ? error.message : '同步失败，请稍后重试';
      }
    } finally {
      syncButton.disabled = false;
      syncButton.classList.remove('syncing');
    }
  });
});
