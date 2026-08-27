import { findChildren } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { common, createLowlight } from 'lowlight';

// 代码块语法高亮：lowlight（highlight.js 内核）+ 常用语言集。
// token 配色由 globals.css 的 CSS 变量驱动（浅灰/深灰/纯黑三主题可切换）
export const lowlight = createLowlight(common);
// mermaid 是图表源码不是代码语法，按纯文本处理，避免自动猜测染色误导
// （registerAlias 参数顺序：语言在前、别名在后）
lowlight.registerAlias('plaintext', 'mermaid');

// highlightAuto 置信度阈值：低于该值视为「识别不出来」，按纯文本渲染。
// 实测校准（lowlight common 语言集）：典型正确识别在 13-17（长段 Python=14、JSON=14），
// 典型误判在 2-8（两数之和 Python 被识别成 kotlin=7、docker 命令识别成 css=2），
// 取 10 让「有把握才染色」，短片段宁可不染色也不显示误导性配色
const AUTO_DETECT_RELEVANCE_THRESHOLD = 10;

// --- 代码块染色装饰器（替换 @tiptap/extension-code-block-lowlight 内置版本）---
// 与内置版本的差异：
// 1. 未标注（language 为 null，即 ``` 围栏）按纯文本渲染，不再自动猜测染色
//    （旧版对未标注块跑 highlightAuto，导致散文被染成 python/csharp 等错误配色）
// 2. language='code' 时走 highlightAuto 自动识别，置信度低于阈值则按纯文本渲染
// 3. 历史明确标注的已注册语言（如 python）保持确定性染色，不受本次简化影响

// 从 highlight.js 的 hast 结果中提取文本片段与 class 列表（取自 tiptap 内置实现）
function parseHighlightNodes(nodes: any[], className: string[] = []): { text: string; classes: string[] }[] {
  return nodes.flatMap(node => {
    const classes = [...className, ...(node.properties ? node.properties.className : [])];
    if (node.children) return parseHighlightNodes(node.children, classes);
    return [{ text: node.value, classes }];
  });
}

function getHighlightNodes(result: any) {
  return result.value || result.children || [];
}

export function getCodeBlockDecorations(doc: any, name: string): DecorationSet {
  const decorations: Decoration[] = [];
  findChildren(doc, (node: any) => node.type.name === name).forEach(block => {
    let from = block.pos + 1;
    const language = (block.node.attrs.language as string | null) || '';
    let nodes: { text: string; classes: string[] }[] = [];
    if (language === 'code') {
      // 自动识别：低置信度不染色，避免误导性配色
      const result = lowlight.highlightAuto(block.node.textContent);
      if ((result.data?.relevance ?? 0) >= AUTO_DETECT_RELEVANCE_THRESHOLD) {
        nodes = parseHighlightNodes(getHighlightNodes(result));
      }
    } else if (language && (lowlight.listLanguages().includes(language) || lowlight.registered(language))) {
      // 明确标注的已注册语言（含 text/plaintext/mermaid 别名）：确定性染色
      nodes = parseHighlightNodes(getHighlightNodes(lowlight.highlight(language, block.node.textContent)));
    }
    // 其余情况（未标注 / 未注册语言）：无装饰，纯文本渲染
    nodes.forEach(node => {
      const to = from + node.text.length;
      if (node.classes.length) {
        decorations.push(Decoration.inline(from, to, { class: node.classes.join(' ') }));
      }
      from = to;
    });
  });
  return DecorationSet.create(doc, decorations);
}

export function AutoDetectLowlightPlugin({ name }: { name: string }): Plugin {
  // 增量更新判断与 tiptap 内置 lowlight 插件一致：仅当选区进出代码块、
  // 代码块数量变化、或事务完整覆盖某个代码块时才重算染色，避免每次按键全量重算
  const plugin: Plugin = new Plugin({
    key: new PluginKey('autoDetectLowlight'),
    state: {
      init: (_: any, { doc }: any) => getCodeBlockDecorations(doc, name),
      apply: (transaction: any, decorationSet: DecorationSet, oldState: any, newState: any) => {
        const oldNodeName = oldState.selection.$head.parent.type.name;
        const newNodeName = newState.selection.$head.parent.type.name;
        const oldNodes = findChildren(oldState.doc, (node: any) => node.type.name === name);
        const newNodes = findChildren(newState.doc, (node: any) => node.type.name === name);
        if (
          transaction.docChanged &&
          ([oldNodeName, newNodeName].includes(name) ||
            newNodes.length !== oldNodes.length ||
            transaction.steps.some((step: any) => {
              return (
                step.from !== undefined &&
                step.to !== undefined &&
                oldNodes.some(node => node.pos >= step.from && node.pos + node.node.nodeSize <= step.to)
              );
            }))
        ) {
          return getCodeBlockDecorations(transaction.doc, name);
        }
        return decorationSet.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations(state: any): DecorationSet | undefined {
        return plugin.getState(state);
      },
    },
  });
  return plugin;
}
