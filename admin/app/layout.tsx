import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '面试真题知识库 - 管理后台',
  description: '面试真题知识库管理后台',
};

// 首屏渲染前应用持久化的代码块配色主题，避免暗色主题用户看到一闪的浅色代码块
const CODE_THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('qa-editor-code-theme');if(t){document.documentElement.setAttribute('data-code-theme',t)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <script dangerouslySetInnerHTML={{ __html: CODE_THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
