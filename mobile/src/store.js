import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12/lib/marked.esm.js';

marked.setOptions({ breaks: true });

const PROJECT_ROOT = '/';

// ---- data ----
let categories = [];
let tags = [];
let projectDocs = [];

// ---- parse helpers ----
function parseQuestion(md, filename) {
  const lines = md.split('\n');
  let title = '', question = '', answer = '', analysis = '', notes = '';
  const tagNames = [];
  const KNOWN = ['题目', '标签', '题目导航', '面试直接答', '详细解析', '我的作答'];
  let section = '';

  for (const line of lines) {
    if (line.startsWith('# ') && !line.startsWith('## ')) { title = line.replace('# ', '').trim(); continue; }
    if (line.startsWith('## ')) {
      const name = line.replace('## ', '').trim();
      section = KNOWN.includes(name) ? name : '';
      continue;
    }
    switch (section) {
      case '题目': if (line.trim()) question += line + '\n'; break;
      case '标签':
        const m = line.match(/\[([^\]]+)\]\([^)]+\)/g);
        if (m) m.forEach(t => { const n = t.match(/\[([^\]]+)\]/)?.[1]; if (n) tagNames.push(n); });
        break;
      case '面试直接答': if (line.trim() || answer) answer += line + '\n'; break;
      case '详细解析': if (line.trim() || analysis) analysis += line + '\n'; break;
      case '我的作答': if (line.trim() || notes) notes += line + '\n'; break;
    }
  }
  return { title, question: question.trim(), tags: tagNames, answer: answer.trim(), analysis: analysis.trim(), notes: notes.trim(), filename };
}

function parseIndex(md) {
  const docs = [];
  for (const line of md.split('\n')) {
    const m = line.match(/- \[([^\]]+)\]\(([^)]+)\)\s*-\s*(.+)/);
    if (m) docs.push({ title: m[1], filename: m[2], brief: m[3] });
  }
  return docs;
}

// ---- load ----
async function loadFile(filepath) {
  const res = await fetch(`${PROJECT_ROOT}${filepath}`);
  if (!res.ok) throw new Error(`404 ${filepath}`);
  return res.text();
}

async function loadAll() {
  const catDirs = [];
  try {
    const res = await fetch(`${PROJECT_ROOT}categories/`);
    const text = await res.text();
    // Simple directory listing: find subdirs from links
    const dirMatch = text.match(/<a href="([^"]+)\/">/g);
    if (dirMatch) {
      for (const m of dirMatch) {
        const name = m.match(/"([^"]+)"/)[1];
        if (name !== '../') catDirs.push(name.replace('/', ''));
      }
    }
  } catch (e) {
    console.warn('cannot list categories directory, trying hardcoded scan');
    return { categories: [], tags: [] };
  }

  const cats = [];
  const allTags = new Map();
  const progDocs = [];

  // Load project docs (scan subdirectories like categories)
  try {
    const res = await fetch(`${PROJECT_ROOT}project/`);
    const text = await res.text();
    const dirMatch = text.match(/<a href="([^"]+)\/">/g);
    if (dirMatch) {
      for (const m of dirMatch) {
        const subdir = m.match(/"([^"]+)"/)[1];
        if (subdir !== '../') {
          const s = subdir.replace('/', '');
          try {
            const idxMd = await loadFile(`project/${s}/00-index.md`);
            const docs = parseIndex(idxMd);
            for (const d of docs) progDocs.push({ ...d, subdir: s });
          } catch {}
        }
      }
    }
  } catch {}

  for (const slug of catDirs) {
    try {
      const idxMd = await loadFile(`categories/${slug}/00-index.md`);
      const titleMatch = idxMd.match(/^#\s+(.+?)\s*[-–—]/m);
      const name = titleMatch ? titleMatch[1].trim() : slug;

      const questions = [];
      const fileMatch = idxMd.match(/\[([^\]]+)\]\(([^)]+\.md)\)/g);
      if (fileMatch) {
        for (const fm of fileMatch) {
          const m = fm.match(/\[(.+?)\]\((.+?)\)/);
          if (!m) continue;
          try {
            const qMd = await loadFile(`categories/${slug}/${m[2]}`);
            const q = parseQuestion(qMd, m[2]);
            questions.push(q);
            for (const t of q.tags) {
              if (!allTags.has(t)) allTags.set(t, []);
              allTags.get(t).push({ filename: q.filename, title: q.title, category: slug });
            }
          } catch {}
        }
      }
      cats.push({ slug, name, questions });
    } catch {}
  }

  categories = cats.sort((a, b) => a.slug.localeCompare(b.slug));
  tags = Array.from(allTags.entries()).map(([name, qs]) => ({ name, questions: qs })).sort((a, b) => a.name.localeCompare(b.name));
  projectDocs = progDocs;
  return { categories, tags, projectDocs };
}

// ---- search ----
function search(query) {
  const q = query.toLowerCase();
  const results = [];
  for (const cat of categories) {
    for (const item of cat.questions) {
      if (item.title.toLowerCase().includes(q) || item.question.toLowerCase().includes(q) || item.tags.some(t => t.toLowerCase().includes(q))) {
        results.push({ ...item, category: cat.slug, categoryName: cat.name });
      }
    }
  }
  return results;
}

export { loadAll, search, parseQuestion, parseIndex, loadFile, categories, tags, projectDocs, marked };
