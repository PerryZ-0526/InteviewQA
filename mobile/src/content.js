export function parseQuestion(md, filename) {
  const lines = md.split('\n');
  let title = '';
  let question = '';
  let answer = '';
  let analysis = '';
  let notes = '';
  const tagNames = [];
  const knownSections = new Set(['题目', '标签', '题目导航', '面试直接答', '详细解析', '我的作答']);
  let section = '';
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
    }
    if (!inCodeBlock && line.startsWith('# ') && !line.startsWith('## ')) {
      title = line.slice(2).trim();
      continue;
    }
    if (!inCodeBlock && line.startsWith('## ')) {
      const name = line.slice(3).trim();
      section = knownSections.has(name) ? name : '';
      continue;
    }
    switch (section) {
      case '题目':
        if (line.trim() || question) question += `${line}\n`;
        break;
      case '标签': {
        const matches = line.match(/\[([^\]]+)\]\([^)]+\)/g);
        matches?.forEach((match) => {
          const name = match.match(/\[([^\]]+)\]/)?.[1];
          if (name) tagNames.push(name);
        });
        break;
      }
      case '面试直接答':
        if (line.trim() || answer) answer += `${line}\n`;
        break;
      case '详细解析':
        if (!/<!--\s*(?:created|updated):/.test(line) && (line.trim() || analysis)) analysis += `${line}\n`;
        break;
      case '我的作答':
        if (!/<!--\s*(?:created|updated):/.test(line) && (line.trim() || notes)) notes += `${line}\n`;
        break;
    }
  }

  return {
    title: title || filename.replace(/^\d{3}-/, '').replace(/\.md$/, ''),
    question: question.trim(),
    tags: [...new Set(tagNames)],
    answer: answer.trim(),
    analysis: analysis.trim(),
    notes: notes.trim(),
    filename,
  };
}

export function parseIndex(md) {
  const docs = [];
  for (const line of md.split('\n')) {
    const match = line.match(/- \[([^\]]+)\]\(([^)]+\.md)\)(?:\s*-\s*(.*))?/);
    if (match) {
      docs.push({ title: match[1], filename: match[2], brief: match[3] || '' });
    }
  }
  return docs;
}
