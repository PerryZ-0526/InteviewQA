'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'saved' | 'saving' | 'waiting' | 'error';

interface AutosaveOptions<T> {
  delay: number;
  buildValue: () => T | null;
  save: (value: T) => Promise<boolean>;
}

export function useAutosave<T>({ delay, buildValue, save }: AutosaveOptions<T>) {
  const [status, setStatus] = useState<AutosaveStatus>('saved');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const editVersionRef = useRef(0);
  const buildValueRef = useRef(buildValue);
  const saveRef = useRef(save);
  const flushRef = useRef<(silent?: boolean) => void>(() => {});
  buildValueRef.current = buildValue;
  saveRef.current = save;

  const flush = useCallback((silent = false) => {
    const value = buildValueRef.current();
    if (value === null) return;
    const version = editVersionRef.current;
    const saveValue = saveRef.current;
    if (!silent) setStatus('saving');

    queueRef.current = queueRef.current.then(async () => {
      const success = await saveValue(value);
      if (mountedRef.current && version === editVersionRef.current) {
        setStatus(success ? 'saved' : 'error');
      }
    });
  }, []);
  flushRef.current = flush;

  const schedule = useCallback(() => {
    editVersionRef.current += 1;
    setStatus('waiting');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushRef.current();
    }, delay);
  }, [delay]);

  const reset = useCallback(() => {
    editVersionRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus('saved');
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        flushRef.current(true);
      }
      mountedRef.current = false;
    };
  }, []);

  return { status, schedule, flush, reset };
}
