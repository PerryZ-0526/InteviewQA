import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '面试真题知识库 - 管理后台',
  description: '面试真题知识库管理后台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
