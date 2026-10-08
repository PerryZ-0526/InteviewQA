const DB_NAME = 'interviewqa-content';
const DB_VERSION = 1;
const BLOB_STORE = 'blobs';
const META_STORE = 'meta';
const SYNC_SCHEMA_VERSION = 1;
const APP_VERSION = '1.0.0';
const PRODUCTION_SYNC_BASE = 'https://perryz-0526.github.io/InteviewQA/mobile-content';

let databasePromise;
let statePromise;
const objectUrls = new Map();

function openDatabase() {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('当前环境不支持本地内容存储'));
  }
  databasePromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BLOB_STORE)) database.createObjectStore(BLOB_STORE);
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地内容数据库打开失败'));
  });
  return databasePromise;
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地存储操作失败'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('本地存储事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('本地存储事务已取消'));
  });
}

async function getMeta(key) {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readonly');
  return requestValue(transaction.objectStore(META_STORE).get(key));
}

async function putBlob(hash, value) {
  const database = await openDatabase();
  const transaction = database.transaction(BLOB_STORE, 'readwrite');
  transaction.objectStore(BLOB_STORE).put(value, hash);
  await transactionDone(transaction);
}

async function getBlob(hash) {
  const database = await openDatabase();
  const transaction = database.transaction(BLOB_STORE, 'readonly');
  return requestValue(transaction.objectStore(BLOB_STORE).get(hash));
}

async function activateManifest(manifest, previousManifest) {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readwrite');
  const store = transaction.objectStore(META_STORE);
  store.put(manifest, 'activeManifest');
  store.put(previousManifest, 'previousManifest');
  store.put(new Date().toISOString(), 'lastSyncedAt');
  await transactionDone(transaction);
}

async function cleanupBlobs(manifests) {
  const keep = new Set(manifests.flatMap((manifest) => (
    (manifest?.files || []).map((entry) => entry.sha256)
  )));
  const database = await openDatabase();
  const transaction = database.transaction(BLOB_STORE, 'readwrite');
  const store = transaction.objectStore(BLOB_STORE);
  const done = transactionDone(transaction);
  await new Promise((resolve, reject) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        resolve();
        return;
      }
      if (!keep.has(current.key)) current.delete();
      current.continue();
    };
    cursor.onerror = () => reject(cursor.error || new Error('本地旧版本清理失败'));
  });
  await done;
}

function manifestFiles(manifest) {
  return new Map((manifest?.files || []).map((entry) => [entry.path, entry]));
}

function validateManifest(manifest) {
  if (
    !manifest
    || manifest.schemaVersion !== SYNC_SCHEMA_VERSION
    || typeof manifest.contentVersion !== 'string'
    || !Array.isArray(manifest.files)
  ) {
    throw new Error('远端内容清单格式不兼容');
  }
  for (const entry of manifest.files) {
    if (
      !entry
      || typeof entry.path !== 'string'
      || entry.path.startsWith('/')
      || entry.path.split('/').includes('..')
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isFinite(entry.size)
    ) {
      throw new Error(`远端内容文件描述不合法: ${entry?.path || '(unknown)'}`);
    }
  }
  return manifest;
}

function compareVersion(left, right) {
  const normalize = (value) => String(value || '0')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`内容服务请求失败 (${response.status})`);
  return response.json();
}

function isNativeApp() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

function syncBaseUrl() {
  const override = globalThis.localStorage?.getItem('interviewqa:sync-base-url')?.trim();
  if (override) return override.replace(/\/+$/, '');
  return isNativeApp() ? PRODUCTION_SYNC_BASE : '/mobile-content';
}

function encodedPath(relativePath) {
  return relativePath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function sha256(blob) {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持内容完整性校验');
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function initialState() {
  const baseline = validateManifest(await fetchJson('/baseline-sync-manifest.json'));
  let active = await getMeta('activeManifest').catch(() => null);
  if (active) {
    try {
      validateManifest(active);
      if (new Date(active.generatedAt).getTime() < new Date(baseline.generatedAt).getTime()) {
        active = null;
      }
    } catch {
      active = null;
    }
  }
  return {
    baseline,
    active,
    lastSyncedAt: await getMeta('lastSyncedAt').catch(() => null),
  };
}

export function initializeContentSync() {
  statePromise ||= initialState();
  return statePromise;
}

function effectiveManifest(state) {
  return state.active || state.baseline;
}

async function storedEntryBlob(entry, state) {
  const baselineEntry = manifestFiles(state.baseline).get(entry.path);
  if (baselineEntry?.sha256 === entry.sha256) return null;
  const stored = await getBlob(entry.sha256);
  if (!stored?.blob) throw new Error(`本地同步文件缺失: ${entry.path}`);
  return stored;
}

async function bundledFile(pathname) {
  const response = await fetch(`/${encodedPath(pathname)}`);
  if (!response.ok) throw new Error(`404 ${pathname}`);
  return response.blob();
}

export async function readContentFile(pathname) {
  const state = await initializeContentSync();
  const manifest = effectiveManifest(state);
  const entry = manifestFiles(manifest).get(pathname);
  if (!entry) throw new Error(`404 ${pathname}`);
  const stored = await storedEntryBlob(entry, state);
  const blob = stored?.blob || await bundledFile(pathname);
  return blob.text();
}

export async function resolveContentAssetUrl(pathname) {
  const state = await initializeContentSync();
  const manifest = effectiveManifest(state);
  const entry = manifestFiles(manifest).get(pathname);
  if (!entry) return `/${encodedPath(pathname)}`;
  const stored = await storedEntryBlob(entry, state);
  if (!stored?.blob) return `/${encodedPath(pathname)}`;
  if (!objectUrls.has(entry.sha256)) {
    objectUrls.set(entry.sha256, URL.createObjectURL(stored.blob));
  }
  return objectUrls.get(entry.sha256);
}

function normalizeContentPath(pathname) {
  const parts = [];
  for (const part of pathname.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

export async function resolveDocumentImages(root, documentPath) {
  const directory = documentPath.split('/').slice(0, -1).join('/');
  await Promise.all([...root.querySelectorAll('img[src]')].map(async (image) => {
    const source = image.getAttribute('src') || '';
    if (/^(https?:|data:|blob:)/i.test(source)) return;
    const contentPath = source.startsWith('/')
      ? normalizeContentPath(source.slice(1))
      : normalizeContentPath(`${directory}/${source}`);
    image.src = await resolveContentAssetUrl(contentPath);
  }));
}

async function downloadEntry(baseUrl, entry) {
  const response = await fetch(`${baseUrl}/${encodedPath(entry.path)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`下载失败: ${entry.path} (${response.status})`);
  const blob = await response.blob();
  if (blob.size !== entry.size) throw new Error(`文件大小校验失败: ${entry.path}`);
  if (await sha256(blob) !== entry.sha256) throw new Error(`文件哈希校验失败: ${entry.path}`);
  await putBlob(entry.sha256, {
    blob,
    contentType: entry.contentType,
    size: entry.size,
  });
}

async function validateDownloadedContentManifest(remoteManifest, state) {
  const entry = manifestFiles(remoteManifest).get('content-manifest.json');
  if (!entry) throw new Error('远端版本缺少 content-manifest.json');
  const baselineEntry = manifestFiles(state.baseline).get(entry.path);
  const blob = baselineEntry?.sha256 === entry.sha256
    ? await bundledFile(entry.path)
    : (await getBlob(entry.sha256))?.blob;
  if (!blob) throw new Error('内容索引下载不完整');
  const content = JSON.parse(await blob.text());
  if (content.version !== 1 || !Array.isArray(content.categories)) {
    throw new Error('内容索引格式不兼容');
  }
}

function clearObjectUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

export async function syncContent({ onProgress } = {}) {
  const state = await initializeContentSync();
  const baseUrl = syncBaseUrl();
  onProgress?.({ phase: 'checking', completed: 0, total: 0 });
  const remote = validateManifest(await fetchJson(`${baseUrl}/sync-manifest.json?t=${Date.now()}`));
  if (compareVersion(APP_VERSION, remote.minAppVersion) < 0) {
    throw new Error(`内容版本需要 App ${remote.minAppVersion} 或更高版本`);
  }

  const current = effectiveManifest(state);
  if (current.contentVersion === remote.contentVersion) {
    return { updated: false, manifest: current, downloaded: 0 };
  }

  const currentFiles = manifestFiles(current);
  const baselineFiles = manifestFiles(state.baseline);
  const downloads = remote.files.filter((entry) => (
    currentFiles.get(entry.path)?.sha256 !== entry.sha256
    && baselineFiles.get(entry.path)?.sha256 !== entry.sha256
  ));

  let completed = 0;
  onProgress?.({ phase: 'downloading', completed, total: downloads.length });
  for (let index = 0; index < downloads.length; index += 4) {
    await Promise.all(downloads.slice(index, index + 4).map(async (entry) => {
      await downloadEntry(baseUrl, entry);
      completed += 1;
      onProgress?.({ phase: 'downloading', completed, total: downloads.length });
    }));
  }

  onProgress?.({ phase: 'validating', completed, total: downloads.length });
  await validateDownloadedContentManifest(remote, state);
  await activateManifest(remote, current);
  state.active = remote;
  state.lastSyncedAt = new Date().toISOString();
  await cleanupBlobs([remote, current]).catch(() => {});
  clearObjectUrls();
  onProgress?.({ phase: 'complete', completed, total: downloads.length });
  return { updated: true, manifest: remote, downloaded: downloads.length };
}

export async function contentSyncState() {
  const state = await initializeContentSync();
  const manifest = effectiveManifest(state);
  return {
    contentVersion: manifest.contentVersion,
    generatedAt: manifest.generatedAt,
    lastSyncedAt: state.lastSyncedAt,
    usingDownloadedContent: Boolean(state.active),
  };
}

export function shortContentVersion(value) {
  return String(value || 'unknown').slice(0, 7);
}
