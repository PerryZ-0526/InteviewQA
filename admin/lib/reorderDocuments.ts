import type { CategoryInfo, ExternalDocInfo, ProjectSubdir } from './types';

export function reorderCategories(
  previous: CategoryInfo[],
  fromCategory: string,
  filename: string,
  toCategory: string,
  toIndex: number,
): CategoryInfo[] {
  const moved = previous
    .find((category) => category.slug === fromCategory)
    ?.questions.find((question) => question.filename === filename);
  if (!moved) return previous;

  return previous.map((category) => {
    if (category.slug === fromCategory && category.slug === toCategory) {
      const questions = [...category.questions];
      const currentIndex = questions.findIndex((question) => question.filename === filename);
      if (currentIndex < 0) return category;
      const [question] = questions.splice(currentIndex, 1);
      questions.splice(Math.max(0, Math.min(toIndex, questions.length)), 0, question);
      return { ...category, questions };
    }
    if (category.slug === fromCategory) {
      const questions = category.questions.filter((question) => question.filename !== filename);
      return { ...category, questions, questionCount: questions.length };
    }
    if (category.slug === toCategory) {
      const questions = [...category.questions];
      questions.splice(Math.max(0, Math.min(toIndex, questions.length)), 0, moved);
      return { ...category, questions, questionCount: questions.length };
    }
    return category;
  });
}

export function reorderProjectSubdirs(
  previous: ProjectSubdir[],
  fromSubdir: string,
  filename: string,
  toSubdir: string,
  toIndex: number,
): ProjectSubdir[] {
  const moved = previous
    .find((subdir) => subdir.slug === fromSubdir)
    ?.docs.find((document) => document.filename === filename);
  if (!moved) return previous;

  return previous.map((subdir) => {
    if (subdir.slug === fromSubdir && subdir.slug === toSubdir) {
      const documents = [...subdir.docs];
      const currentIndex = documents.findIndex((document) => document.filename === filename);
      if (currentIndex < 0) return subdir;
      const [document] = documents.splice(currentIndex, 1);
      documents.splice(Math.max(0, Math.min(toIndex, documents.length)), 0, document);
      return { ...subdir, docs: documents };
    }
    if (subdir.slug === fromSubdir) {
      return { ...subdir, docs: subdir.docs.filter((document) => document.filename !== filename) };
    }
    if (subdir.slug === toSubdir) {
      const documents = [...subdir.docs];
      documents.splice(Math.max(0, Math.min(toIndex, documents.length)), 0, moved);
      return { ...subdir, docs: documents };
    }
    return subdir;
  });
}

export function reorderExternalDocs(
  previous: ExternalDocInfo[],
  documentId: string,
  toGroup: string,
  toIndex: number,
): ExternalDocInfo[] {
  const currentIndex = previous.findIndex((document) => document.id === documentId);
  if (currentIndex < 0) return previous;
  const moved = { ...previous[currentIndex], group: toGroup };
  const remainingDocuments = previous.filter((document) => document.id !== documentId);
  const targetDocuments = remainingDocuments.filter((document) => (document.group || '') === toGroup);
  const targetIndex = Math.max(0, Math.min(toIndex, targetDocuments.length));

  let insertAt: number;
  if (targetDocuments.length === 0) {
    insertAt = remainingDocuments.length;
  } else if (targetIndex < targetDocuments.length) {
    insertAt = remainingDocuments.indexOf(targetDocuments[targetIndex]);
  } else {
    insertAt = remainingDocuments.indexOf(targetDocuments[targetDocuments.length - 1]) + 1;
  }

  const next = [...remainingDocuments];
  next.splice(insertAt, 0, moved);
  return next;
}
