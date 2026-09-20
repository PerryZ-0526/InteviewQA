import path from 'path';

export function isSafePathSegment(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 180
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !/[\x00-\x1f<>:"|?*]/.test(value);
}

export function assertSafePathSegment(value: unknown, label = '路径'): asserts value is string {
  if (!isSafePathSegment(value)) {
    throw new Error(`${label}不合法`);
  }
}

export function isMarkdownFilename(value: unknown): value is string {
  return isSafePathSegment(value) && /^\d{3}-.+\.md$/u.test(value);
}

export function resolveInside(root: string, ...segments: string[]): string {
  segments.forEach((segment) => assertSafePathSegment(segment));
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('路径越界');
  }
  return resolved;
}
