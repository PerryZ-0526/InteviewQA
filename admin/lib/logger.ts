import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './fileUtils';

const LOG_FILE = path.join(PROJECT_ROOT, 'admin', 'logs.jsonl');

export interface LogEntry {
  timestamp: string;
  action: string;
  status: 'success' | 'fail' | 'running';
  category?: string;
  filename?: string;
  question?: string;
  error?: string;
  detail?: string;
}

function format(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function appendLog(entry: Omit<LogEntry, 'timestamp'>) {
  const line = JSON.stringify({ timestamp: format(), ...entry });
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, line + '\n', 'utf-8');
  } catch (e) {
    console.error('Failed to write log:', e);
  }
}

export async function readLogs(limit = 50, offset = 0): Promise<LogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries = lines.map((l) => {
      try { return JSON.parse(l) as LogEntry; } catch { return null; }
    }).filter(Boolean) as LogEntry[];
    // Return newest first
    entries.reverse();
    return entries.slice(offset, offset + limit);
  } catch {
    return [];
  }
}

// Convenience functions
export async function logCreateStart(category: string, question: string) {
  await appendLog({
    action: 'create_question',
    status: 'running',
    category: category || '(auto)',
    question: question.slice(0, 200),
  });
}

export async function logCreate(success: boolean, category: string, filename: string, question: string, error?: string) {
  await appendLog({
    action: 'create_question',
    status: success ? 'success' : 'fail',
    category,
    filename,
    question: question.slice(0, 200),
    error,
  });
}

export async function logUpdate(category: string, filename: string) {
  await appendLog({
    action: 'update_question',
    status: 'success',
    category,
    filename,
  });
}

export async function logDelete(category: string, filename: string) {
  await appendLog({
    action: 'delete_question',
    status: 'success',
    category,
    filename,
  });
}

export async function logAnswer(category: string, filename: string, detail?: string) {
  await appendLog({
    action: 'answer_random',
    status: 'success',
    category,
    filename,
    detail: detail?.slice(0, 200),
  });
}

export async function logAnnotation(category: string, filename: string, action: string, detail?: string) {
  await appendLog({
    action: `annotation_${action}`,
    status: 'success',
    category,
    filename,
    detail: detail?.slice(0, 200),
  });
}
