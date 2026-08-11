// 分类信息
export interface CategoryInfo {
  slug: string;        // 目录名，如 "agent"
  name: string;        // 显示名，如 "Agent"
  questionCount: number;
  questions: QuestionBrief[];
}

// 题目简要信息（来自 00-index.md）
export interface QuestionBrief {
  filename: string;    // 如 "001-xxx.md"
  title: string;       // 题目标题
  brief: string;       // 简短说明
}

// 完整题目（从 MD 解析）
export interface Question {
  title: string;
  question: string;
  tags: string[];       // 标签名列表
  answer: string;       // 面试直接答
  analysis: string;     // 详细解析
  filename: string;
  prevLink: string | null;
  nextLink: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string;
  customSections: { title: string; content: string }[];
}

// 生成请求
export interface GenerateRequest {
  question: string;
  category: string;
  tags: string[];
}

// 生成响应
export interface GenerateResponse {
  success: boolean;
  filePath?: string;
  content?: string;
  error?: string;
}

// 标签信息
export interface TagInfo {
  name: string;
  questions: { category: string; filename: string; title: string }[];
}

// API 响应包装
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// 项目文档
export interface ProjectDocBrief {
  filename: string;
  title: string;
  brief: string;
}

export interface ProjectSubdir {
  slug: string;
  name: string;
  docs: ProjectDocBrief[];
}
