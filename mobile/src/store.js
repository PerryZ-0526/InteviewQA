import { marked } from '/vendor/marked.esm.js';
import { parseIndex, parseQuestion } from './content.js';

marked.setOptions({ breaks: true });

// ---- data ----
let categories = [];
let tags = [];
let projectDocs = [];
const questionCache = new Map();
const projectDocCache = new Map();

// ---- load ----
async function loadFile(filepath) {
  const res = await fetch(`/${filepath.replace(/^\/+/, '')}`);
  if (!res.ok) throw new Error(`404 ${filepath}`);
  return res.text();
}

async function loadAll() {
  const res = await fetch('/content-manifest.json');
  if (!res.ok) throw new Error(`内容清单加载失败 (${res.status})`);
  const manifest = await res.json();
  if (manifest.version !== 1 || !Array.isArray(manifest.categories)) {
    throw new Error('内容清单格式不兼容');
  }
  categories = manifest.categories;
  tags = Array.isArray(manifest.tags) ? manifest.tags : [];
  projectDocs = Array.isArray(manifest.projectDocs) ? manifest.projectDocs : [];
  return { categories, tags, projectDocs };
}

async function loadQuestion(category, filename) {
  const key = `${category}/${filename}`;
  if (questionCache.has(key)) return questionCache.get(key);
  const request = loadFile(`categories/${category}/${filename}`)
    .then(md => parseQuestion(md, filename))
    .catch((error) => {
      questionCache.delete(key);
      throw error;
    });
  questionCache.set(key, request);
  return request;
}

async function loadProjectDocument(base, subdir, filename) {
  const key = `${base}/${subdir}/${filename}`;
  if (projectDocCache.has(key)) return projectDocCache.get(key);
  const request = loadFile(key).catch((error) => {
    projectDocCache.delete(key);
    throw error;
  });
  projectDocCache.set(key, request);
  return request;
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

export {
  loadAll,
  loadQuestion,
  loadProjectDocument,
  search,
  parseQuestion,
  parseIndex,
  loadFile,
  categories,
  tags,
  projectDocs,
  marked,
};
