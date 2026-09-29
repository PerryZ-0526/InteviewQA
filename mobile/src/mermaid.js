const MERMAID_SCRIPT_URL = '/vendor/mermaid.min.js';

let mermaidPromise;
let initialized = false;
let diagramSequence = 0;
let fullscreenHost = null;

function loadMermaid() {
  if (globalThis.mermaid) return Promise.resolve(globalThis.mermaid);
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MERMAID_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (globalThis.mermaid) resolve(globalThis.mermaid);
      else reject(new Error('Mermaid 加载完成但未提供渲染器'));
    };
    script.onerror = () => reject(new Error('Mermaid 组件加载失败'));
    document.head.append(script);
  });

  return mermaidPromise;
}

function createButton(symbol, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = symbol;
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  }
}

function setFullscreen(host, button, active) {
  if (fullscreenHost && fullscreenHost !== host) {
    fullscreenHost.classList.remove('is-fullscreen');
  }
  host.classList.toggle('is-fullscreen', active);
  button.textContent = active ? '×' : '⛶';
  button.title = active ? '退出全屏' : '全屏查看';
  button.setAttribute('aria-label', active ? '退出全屏' : '全屏查看 Mermaid 图表');
  document.body.classList.toggle('mermaid-fullscreen-open', active);
  fullscreenHost = active ? host : null;
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !fullscreenHost) return;
  const button = fullscreenHost.querySelector('[data-mermaid-fullscreen]');
  fullscreenHost.classList.remove('is-fullscreen');
  if (button) {
    button.textContent = '⛶';
    button.title = '全屏查看';
    button.setAttribute('aria-label', '全屏查看 Mermaid 图表');
  }
  document.body.classList.remove('mermaid-fullscreen-open');
  fullscreenHost = null;
});

function createDiagramShell(source) {
  const host = document.createElement('figure');
  host.className = 'mermaid-diagram';
  host.setAttribute('aria-label', 'Mermaid 图表');

  const toolbar = document.createElement('div');
  toolbar.className = 'mermaid-diagram-toolbar';
  const caption = document.createElement('figcaption');
  caption.textContent = 'Mermaid';
  const actions = document.createElement('div');
  actions.className = 'mermaid-diagram-actions';

  const sourceButton = createButton('</>', '查看 Mermaid 源码');
  sourceButton.setAttribute('aria-expanded', 'false');
  const copyButton = createButton('⧉', '复制 Mermaid 源码');
  const fullscreenButton = createButton('⛶', '全屏查看 Mermaid 图表');
  fullscreenButton.dataset.mermaidFullscreen = '';
  fullscreenButton.disabled = true;
  actions.append(sourceButton, copyButton, fullscreenButton);
  toolbar.append(caption, actions);

  const canvas = document.createElement('div');
  canvas.className = 'mermaid-canvas';
  canvas.setAttribute('aria-busy', 'true');
  const skeleton = document.createElement('div');
  skeleton.className = 'mermaid-skeleton';
  skeleton.setAttribute('aria-label', '正在渲染图表');
  skeleton.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  canvas.append(skeleton);

  const sourcePanel = document.createElement('div');
  sourcePanel.className = 'mermaid-source-panel';
  sourcePanel.hidden = true;
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = source;
  pre.append(code);
  sourcePanel.append(pre);

  sourceButton.addEventListener('click', () => {
    sourcePanel.hidden = !sourcePanel.hidden;
    sourceButton.classList.toggle('active', !sourcePanel.hidden);
    sourceButton.setAttribute('aria-expanded', String(!sourcePanel.hidden));
    sourceButton.title = sourcePanel.hidden ? '查看源码' : '收起源码';
  });
  copyButton.addEventListener('click', async () => {
    if (await writeClipboard(source)) {
      copyButton.textContent = '✓';
      copyButton.title = '已复制';
      copyButton.setAttribute('aria-label', '已复制 Mermaid 源码');
      window.setTimeout(() => {
        copyButton.textContent = '⧉';
        copyButton.title = '复制源码';
        copyButton.setAttribute('aria-label', '复制 Mermaid 源码');
      }, 1600);
    }
  });
  fullscreenButton.addEventListener('click', () => {
    setFullscreen(host, fullscreenButton, !host.classList.contains('is-fullscreen'));
  });

  host.append(toolbar, canvas, sourcePanel);
  return { host, canvas, sourcePanel, sourceButton, fullscreenButton };
}

function showRenderError(canvas, sourcePanel, sourceButton, error) {
  canvas.classList.add('mermaid-canvas-error');
  canvas.removeAttribute('aria-busy');

  const title = document.createElement('strong');
  title.textContent = 'Mermaid 图表无法渲染';
  const message = document.createElement('span');
  message.textContent = error instanceof Error
    ? (error.message.split('\n').find(line => line.trim()) || '请检查 Mermaid 语法')
    : '请检查 Mermaid 语法';
  canvas.replaceChildren(title, message);
  sourcePanel.hidden = false;
  sourceButton.classList.add('active');
  sourceButton.setAttribute('aria-expanded', 'true');
  sourceButton.title = '收起源码';
}

export async function renderMermaidDiagrams(root) {
  const blocks = Array.from(root.querySelectorAll('pre > code.language-mermaid'));
  if (blocks.length === 0) return;

  const diagrams = blocks.flatMap((code) => {
    const pre = code.parentElement;
    if (!pre) return [];
    const source = (code.textContent || '').trim();
    const shell = createDiagramShell(source);
    pre.replaceWith(shell.host);
    return [{ source, ...shell }];
  });

  let mermaid;
  try {
    mermaid = await loadMermaid();
    if (!initialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        themeVariables: {
          primaryColor: '#f2eef8',
          primaryTextColor: '#302a39',
          primaryBorderColor: '#8a79a8',
          secondaryColor: '#eef5f0',
          tertiaryColor: '#f8f7fa',
          lineColor: '#716a79',
          actorBkg: '#f2eef8',
          actorBorder: '#8a79a8',
          actorTextColor: '#302a39',
          signalColor: '#62586e',
          signalTextColor: '#302a39',
          noteBkgColor: '#fff7dc',
          noteBorderColor: '#d7b95f',
        },
        flowchart: { htmlLabels: false, useMaxWidth: true },
        sequence: { useMaxWidth: true },
      });
      initialized = true;
    }
  } catch (error) {
    for (const { canvas, sourcePanel, sourceButton } of diagrams) {
      showRenderError(canvas, sourcePanel, sourceButton, error);
    }
    return;
  }

  for (const { source, canvas, sourcePanel, sourceButton, fullscreenButton } of diagrams) {
    try {
      const id = `mermaid-mobile-${++diagramSequence}`;
      const { svg, bindFunctions } = await mermaid.render(id, source);
      canvas.innerHTML = svg;
      canvas.removeAttribute('aria-busy');
      fullscreenButton.disabled = false;
      bindFunctions?.(canvas);
    } catch (error) {
      showRenderError(canvas, sourcePanel, sourceButton, error);
    }
  }
}
