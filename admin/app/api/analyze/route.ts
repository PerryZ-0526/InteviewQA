import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from '@/lib/fileUtils';
import { callClaudeCode } from '@/lib/claudeCode';

/**
 * 从 questions 目录获取所有分类名
 */
async function getExistingCategories(): Promise<string[]> {
  const dir = path.join(PROJECT_ROOT, 'categories');
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * 从 tags 目录获取所有已有标签名
 */
async function getExistingTags(): Promise<string[]> {
  const dir = path.join(PROJECT_ROOT, 'tags');
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''));
}

/**
 * POST /api/analyze
 * 分析题目内容，建议分类和标签
 */
export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();

    if (!question || !question.trim()) {
      return NextResponse.json(
        { success: false, error: '题目内容不能为空' },
        { status: 400 }
      );
    }

    // 获取已有的分类和标签
    const [existingCategories, existingTags] = await Promise.all([
      getExistingCategories(),
      getExistingTags(),
    ]);

    // 构建分析 prompt
    const prompt = buildAnalyzePrompt(
      question.trim(),
      existingCategories,
      existingTags
    );

    console.log('=== 分析题目 ===');
    console.log('题目:', question);

    const result = await callClaudeCode(prompt);

    if (!result.success) {
      console.error('分析失败:', result.error);
      return NextResponse.json(
        {
          success: false,
          error: '分析失败: ' + (result.error || '未知错误'),
          rawOutput: result.output.slice(-500),
        },
        { status: 500 }
      );
    }

    // 从 stdout 解析 Claude Code 的 JSON 输出
    const analysis = parseAnalysisOutput(
      result.output,
      existingCategories,
      existingTags
    );

    return NextResponse.json({
      success: true,
      data: analysis,
    });
  } catch (e: any) {
    console.error('分析接口异常:', e);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}

function buildAnalyzePrompt(
  question: string,
  existingCategories: string[],
  existingTags: string[]
): string {
  const catList = existingCategories
    .map((c) => `  - ${c}`)
    .join('\n');
  const tagList = existingTags
    .map((t) => `  - ${t}`)
    .join('\n');

  return `你是一个面试题库的分类助手。请分析以下面试题目，给出最合适的分类和标签建议。

## 题目内容
${question}

## 已有分类（目录名即分类名）
${catList}

## 已有标签
${tagList}

## 要求
请分析题目内容，判断它最适合放在哪个分类下，以及应该打上哪些标签。

注意：
1. 优先从已有分类中选择最匹配的
2. 如果已有分类都不合适，可以建议新增分类（用简短英文+连字符命名，如 "distributed-system"）
3. 优先从已有标签中选择合适的
4. 如果需要的标签不存在，可以建议新增标签

请严格按以下 JSON 格式输出你的建议（只输出 JSON，不要输出其他内容）：

\`\`\`json
{
  "suggestedCategory": "最推荐的分类名（来自已有分类）",
  "newCategory": null,
  "suggestedTags": ["标签1", "标签2"],
  "newTags": ["需要新建的标签A"],
  "reasoning": "简短说明分类和标签选择的理由（一句话）"
}
\`\`\`

如果建议新分类，将 newCategory 设置为推荐的新分类英文名（如 "distributed-system"），suggestedCategory 设为空字符串 ""。
不需要新增分类时，newCategory 为 null。
不需要新增标签时，newTags 为空数组 []。

只输出 JSON，不要输出解释文字。`;
}

function parseAnalysisOutput(
  output: string,
  existingCategories: string[],
  existingTags: string[]
) {
  // 尝试从输出中提取 JSON（可能被 markdown 代码块包裹）
  let jsonStr = output;

  const codeBlockMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // 尝试找到第一个 { 到最后一个 }
  const braceStart = jsonStr.indexOf('{');
  const braceEnd = jsonStr.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
    jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // 校验分类是否真的存在
    const suggestedCategory = parsed.suggestedCategory || '';
    const newCategory = parsed.newCategory || null;

    // 分类标签：existing 的分类用已有名，new 用建议名
    const categoryExists = existingCategories.includes(suggestedCategory);

    // 分离已有标签和新标签
    const suggestedTags: string[] = (parsed.suggestedTags || []).filter(
      (t: string) => t && typeof t === 'string'
    );
    const newTags: string[] = (parsed.newTags || []).filter(
      (t: string) => t && typeof t === 'string'
    );

    // 将 suggestedTags 中实际上不存在的移到 newTags
    const existingTagSet = new Set(existingTags);
    const finalExistingTags = suggestedTags.filter((t: string) => existingTagSet.has(t));
    const finalNewTags = [
      ...suggestedTags.filter((t: string) => !existingTagSet.has(t)),
      ...newTags,
    ];

    // 去重
    const uniqueNewTags = [...new Set(finalNewTags)];

    return {
      suggestedCategory: categoryExists ? suggestedCategory : '',
      newCategory: categoryExists ? null : (newCategory || suggestedCategory || ''),
      suggestedTags: finalExistingTags,
      newTags: uniqueNewTags,
      reasoning: parsed.reasoning || '',
    };
  } catch (e) {
    // 解析失败，返回空
    console.error('Failed to parse analysis JSON:', e);
    return {
      suggestedCategory: '',
      newCategory: null,
      suggestedTags: [],
      newTags: [],
      reasoning: '自动分析失败，请手动选择分类和标签',
    };
  }
}
