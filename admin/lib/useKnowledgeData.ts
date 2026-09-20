'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryInfo, ExternalDocInfo, ProjectSubdir, TagInfo } from './types';
import type { FsrsStore } from './fsrsStore';

const EMPTY_FSRS: FsrsStore = { version: 1, cards: {} };

async function fetchJson(url: string) {
  try {
    const response = await fetch(url);
    return await response.json();
  } catch {
    return null;
  }
}

export function useKnowledgeData() {
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [projectSubdirs, setProjectSubdirs] = useState<ProjectSubdir[]>([]);
  const [externalDocs, setExternalDocs] = useState<ExternalDocInfo[]>([]);
  const [externalGroups, setExternalGroups] = useState<string[]>([]);
  const [inboxPending, setInboxPending] = useState(0);
  const [fsrsStore, setFsrsStore] = useState<FsrsStore>(EMPTY_FSRS);
  const fsrsStoreRef = useRef<FsrsStore>(EMPTY_FSRS);

  const applyFsrsStore = useCallback((store: FsrsStore) => {
    fsrsStoreRef.current = store;
    setFsrsStore(store);
  }, []);

  const applyProjectSubdirs = useCallback((data: ProjectSubdir[]) => {
    setProjectSubdirs(data);
  }, []);

  const loadCategories = useCallback(async () => {
    const json = await fetchJson('/api/categories');
    if (json?.success) setCategories(json.data || []);
  }, []);

  const loadTags = useCallback(async () => {
    const json = await fetchJson('/api/tags');
    if (json?.success) setTags(json.data || []);
  }, []);

  const loadProjectStats = useCallback(async () => {
    const json = await fetchJson('/api/project');
    if (json?.success) applyProjectSubdirs(json.data || []);
  }, [applyProjectSubdirs]);

  const loadExternalDocs = useCallback(async () => {
    const json = await fetchJson('/api/external');
    if (json?.success) {
      setExternalDocs(json.data || []);
      setExternalGroups(json.groups || []);
    }
  }, []);

  const loadFsrsStore = useCallback(async () => {
    const json = await fetchJson('/api/fsrs');
    if (json?.success) applyFsrsStore(json.data);
  }, [applyFsrsStore]);

  const loadInboxPending = useCallback(async () => {
    const json = await fetchJson('/api/inbox');
    if (json?.success) setInboxPending(json.data?.unchecked ?? 0);
  }, []);

  const loadBootstrap = useCallback(async () => {
    const json = await fetchJson('/api/bootstrap');
    if (!json?.success) throw new Error(json?.error || '初始化失败');
    const data = json.data;
    setCategories(data.categories || []);
    setTags(data.tags || []);
    applyProjectSubdirs(data.projectSubdirs || []);
    setExternalDocs(data.externalDocs || []);
    setExternalGroups(data.externalGroups || []);
    setInboxPending(data.inboxUnchecked ?? 0);
    applyFsrsStore(data.fsrsStore || EMPTY_FSRS);
  }, [applyFsrsStore, applyProjectSubdirs]);

  useEffect(() => {
    loadBootstrap().catch((error) => console.error('Failed to bootstrap knowledge data:', error));
  }, [loadBootstrap]);

  const projectStats = useMemo(() => {
    const normal = projectSubdirs.filter((subdir) => !subdir.isGroup);
    return {
      subdirs: normal.length,
      docs: normal.reduce((sum, subdir) => sum + subdir.docs.length, 0),
      groups: projectSubdirs.filter((subdir) => subdir.isGroup).length,
    };
  }, [projectSubdirs]);

  return {
    categories,
    setCategories,
    tags,
    setTags,
    projectSubdirs,
    setProjectSubdirs,
    projectStats,
    externalDocs,
    setExternalDocs,
    externalGroups,
    inboxPending,
    fsrsStore,
    fsrsStoreRef,
    applyFsrsStore,
    loadBootstrap,
    loadCategories,
    loadTags,
    loadProjectStats,
    loadExternalDocs,
    loadFsrsStore,
    loadInboxPending,
  };
}
