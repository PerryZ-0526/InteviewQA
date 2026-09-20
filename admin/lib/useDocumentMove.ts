'use client';

import { useCallback, useState } from 'react';

export function useDocumentMove<TPayload extends object, TResult extends { success: boolean; error?: string }>(
  endpoint: string,
) {
  const [moving, setMoving] = useState(false);

  const move = useCallback(async (payload: TPayload): Promise<TResult> => {
    setMoving(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as TResult;
      if (!response.ok || !result.success) throw new Error(result.error || '移动失败');
      return result;
    } finally {
      setMoving(false);
    }
  }, [endpoint]);

  return { move, moving };
}
