const LIBRARY_DEFINITIONS = {
  project: {
    title: '项目文档',
    icon: '📚',
    directoryUnit: '个项目',
  },
  groups: {
    title: '自定义分组',
    icon: '🗂️',
    directoryUnit: '个分组',
  },
};

export function libraryDefinition(base) {
  return LIBRARY_DEFINITIONS[base] || LIBRARY_DEFINITIONS.project;
}

export function groupLibraryDocuments(documents, base) {
  const grouped = new Map();
  for (const document of documents || []) {
    if (document.base !== base) continue;
    if (!grouped.has(document.subdir)) grouped.set(document.subdir, []);
    grouped.get(document.subdir).push(document);
  }

  return [...grouped.entries()]
    .map(([name, entries]) => ({
      name,
      documents: entries.slice().sort((a, b) => a.filename.localeCompare(b.filename)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
