'use client';

import { useState } from 'react';
import type { CategoryInfo, ExternalDocInfo, ProjectSubdir } from '@/lib/types';
import ScopeSearchPanel from './ScopeSearchPanel';

export function HomeView({
  categories,
  projectSubdirs,
  externalDocs,
  onSelectQuestion,
  onSelectProjectDoc,
  onSelectExternalDoc,
  onExternalMissing,
}: {
  categories: CategoryInfo[];
  projectSubdirs: ProjectSubdir[];
  externalDocs: ExternalDocInfo[];
  onSelectQuestion: (category: string, filename: string) => void;
  onSelectProjectDoc: (subdir: string, filename: string) => void;
  onSelectExternalDoc: (id: string) => void;
  onExternalMissing: (path: string) => void;
}) {
  const projects = projectSubdirs.filter((subdir) => !subdir.isGroup);
  const groups = projectSubdirs.filter((subdir) => subdir.isGroup);
  const questionCount = categories.reduce((sum, category) => sum + category.questions.length, 0);
  const projectCount = projects.reduce((sum, subdir) => sum + subdir.docs.length, 0);
  const groupCount = groups.reduce((sum, subdir) => sum + subdir.docs.length, 0);

  if (questionCount + projectCount + groupCount + externalDocs.length === 0) {
    return (
      <div className="empty-state">
        <h3>知识库为空</h3>
        <p>从左侧边栏创建分类、添加外部文档，或点击「新建题目」开始</p>
      </div>
    );
  }

  let documentIndex = 0;
  const documentRow = (filename: string, title: string, onClick: () => void, wordCount?: number) => {
    documentIndex += 1;
    return (
      <div key={filename} className="question-list-item" onClick={onClick} title={title}>
        <span className="doc-index">{documentIndex}.</span>
        <span className="title">{title}</span>
        <span className="document-word-count">
          {wordCount != null ? `${wordCount.toLocaleString()} 字` : ''}
        </span>
      </div>
    );
  };

  return (
    <div className="home-view">
      <div className="home-stats">
        <span>{categories.length} 个分类 · {questionCount} 道题目</span>
        <span>{projects.length} 个 project · {projectCount} 篇文档</span>
        <span>{groups.length} 个分组 · {groupCount} 篇文档</span>
        <span>{externalDocs.length} 个外部文档</span>
      </div>

      {categories.length > 0 && (
        <div className="home-section">
          <div className="home-section-title">分类</div>
          {categories.map((category) => (
            <div key={category.slug} className="home-block">
              <div className="home-block-title">
                <span className="sidebar-cat-dot" />
                <span className="home-block-name" title={category.name}>{category.name}</span>
                <span className="home-block-count">{category.questions.length}</span>
              </div>
              <div className="card home-document-list">
                {category.questions.map((question) => documentRow(
                  question.filename,
                  question.title,
                  () => onSelectQuestion(category.slug, question.filename),
                  question.wordCount,
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {projects.length > 0 && (
        <div className="home-section">
          <div className="home-section-title">project</div>
          {projects.map((subdir) => (
            <div key={subdir.slug} className="home-block">
              <div className="home-block-title">
                <span className="sidebar-cat-dot" />
                <span className="home-block-name" title={subdir.slug}>{subdir.name}</span>
                <span className="home-block-count">{subdir.docs.length}</span>
              </div>
              <div className="card home-document-list">
                {subdir.docs.map((document) => documentRow(
                  document.filename,
                  document.title,
                  () => onSelectProjectDoc(subdir.slug, document.filename),
                  document.wordCount,
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <div className="home-section">
          <div className="home-section-title">其他分组</div>
          {groups.map((subdir) => (
            <div key={subdir.slug} className="home-block">
              <div className="home-block-title">
                <span className="sidebar-cat-dot" />
                <span className="home-block-name" title={subdir.slug}>{subdir.name}</span>
                <span className="home-block-count">{subdir.docs.length}</span>
              </div>
              <div className="card home-document-list">
                {subdir.docs.map((document) => documentRow(
                  document.filename,
                  document.title,
                  () => onSelectProjectDoc(subdir.slug, document.filename),
                  document.wordCount,
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {externalDocs.length > 0 && (
        <div className="home-section">
          <div className="home-section-title">外部文档</div>
          <div className="card home-document-list">
            {externalDocs.map((document) => {
              documentIndex += 1;
              return (
                <div
                  key={document.id}
                  className="question-list-item"
                  onClick={() => (document.missing ? onExternalMissing(document.path) : onSelectExternalDoc(document.id))}
                  title={document.path}
                >
                  <span className="doc-index">{documentIndex}.</span>
                  <span className="title" style={document.missing ? { color: '#c92a2a' } : undefined}>
                    {document.missing ? '⚠ ' : ''}{document.title}
                  </span>
                  <span className="external-path">{document.path}</span>
                  {document.missing ? (
                    <span className="document-error-label">索引失效</span>
                  ) : (
                    <span className="document-word-count">{document.wordCount.toLocaleString()} 字</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function BrowseView({
  categories,
  selectedCategory,
  onSelectQuestion,
  loading,
}: {
  categories: CategoryInfo[];
  selectedCategory: string | null;
  onSelectQuestion: (category: string, filename: string) => void;
  loading: boolean;
}) {
  const category = categories.find((item) => item.slug === selectedCategory);
  const [searchActive, setSearchActive] = useState(false);

  if (!selectedCategory) {
    return (
      <div className="empty-state">
        <h3>选择一个分类</h3>
        <p>从左侧边栏选择分类查看题目列表，或点击「新建题目」创建新题目</p>
      </div>
    );
  }
  if (!category) {
    return (
      <div className="empty-state">
        <h3>分类不存在</h3>
        <p>请选择其他分类</p>
      </div>
    );
  }
  if (category.questions.length === 0) {
    return (
      <div className="empty-state">
        <h3>{category.name} — 暂无题目</h3>
        <p>该分类下还没有题目，点击「新建题目」开始创建</p>
      </div>
    );
  }

  return (
    <div className="card document-list-card">
      <div className="document-list-heading">{category.name} — {category.questions.length} 道题目</div>
      {loading && <div className="loading-overlay document-list-loading"><div className="loading-spinner" /></div>}
      <ScopeSearchPanel
        key={selectedCategory}
        scope="category"
        slug={selectedCategory}
        onOpen={(hit) => hit.filename && onSelectQuestion(selectedCategory, hit.filename)}
        onActiveChange={setSearchActive}
      />
      {!searchActive && category.questions.map((question) => (
        <div
          key={question.filename}
          className="question-list-item"
          onClick={() => onSelectQuestion(selectedCategory, question.filename)}
        >
          <span className="filename">{question.filename}</span>
          <span className="title">{question.title}</span>
          <span className="document-word-count">{question.wordCount?.toLocaleString() ?? ''} 字</span>
        </div>
      ))}
    </div>
  );
}

export function ProjectBrowseView({
  subdirs,
  selectedSubdir,
  onSelectDoc,
}: {
  subdirs: ProjectSubdir[];
  selectedSubdir: string | null;
  onSelectDoc: (subdir: string, filename: string) => void;
}) {
  const subdir = subdirs.find((item) => item.slug === selectedSubdir);
  const [searchActive, setSearchActive] = useState(false);
  if (!subdir) return null;

  return (
    <div className="card document-list-card">
      <div className="document-list-heading">{subdir.name} — {subdir.docs.length} 篇文档</div>
      <ScopeSearchPanel
        key={subdir.slug}
        scope="project"
        slug={subdir.slug}
        onOpen={(hit) => hit.filename && onSelectDoc(subdir.slug, hit.filename)}
        onActiveChange={setSearchActive}
      />
      {subdir.docs.length === 0 && !searchActive && (
        <div className="empty-state compact-empty-state"><p>暂无文档</p></div>
      )}
      {!searchActive && subdir.docs.map((document) => (
        <div
          key={document.filename}
          className="question-list-item"
          onClick={() => onSelectDoc(subdir.slug, document.filename)}
        >
          <span className="filename">{document.filename}</span>
          <span className="title">{document.title}</span>
          <span className="document-word-count">{document.wordCount?.toLocaleString() ?? ''} 字</span>
        </div>
      ))}
    </div>
  );
}

function formatModifiedTime(milliseconds: number): string {
  const date = new Date(milliseconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ExternalBrowseView({
  docs,
  group,
  onOpenDoc,
  onMissing,
}: {
  docs: ExternalDocInfo[];
  group?: string | null;
  onOpenDoc: (id: string) => void;
  onMissing: (path: string) => void;
}) {
  const [searchActive, setSearchActive] = useState(false);
  const inGroup = group != null;

  return (
    <div className="card document-list-card">
      <div className="document-list-heading">
        {inGroup ? `${group || '未分组'} — ${docs.length} 篇` : `外部文档 — ${docs.length} 篇（按修改时间倒序）`}
      </div>
      {inGroup && (
        <ScopeSearchPanel
          key={group}
          scope="external"
          slug={group}
          onOpen={(hit) => hit.extId && onOpenDoc(hit.extId)}
          onActiveChange={setSearchActive}
        />
      )}
      {docs.length === 0 && !searchActive && (
        <div className="empty-state compact-empty-state">
          <p>{inGroup ? '该分组下暂无文档' : '暂无外部文档，点击侧边栏「外部文档」旁的 + 从资源管理器选择'}</p>
        </div>
      )}
      {!searchActive && docs.map((document) => (
        <div
          key={document.id}
          className="question-list-item"
          onClick={() => (document.missing ? onMissing(document.path) : onOpenDoc(document.id))}
          title={document.path}
        >
          <span className="title" style={document.missing ? { color: '#c92a2a' } : undefined}>
            {document.missing ? '⚠ ' : ''}{document.title}
            {document.customTitle && !document.missing && (
              <span className="document-original-title">原名：{document.originalTitle}</span>
            )}
          </span>
          <span className="external-path">{document.path}</span>
          {document.missing ? (
            <span className="document-error-label">索引失效</span>
          ) : (
            <>
              <span className="document-word-count document-word-count-spaced">
                {document.wordCount.toLocaleString()} 字
              </span>
              <span className="document-word-count">
                {document.mtimeMs != null ? formatModifiedTime(document.mtimeMs) : ''}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
