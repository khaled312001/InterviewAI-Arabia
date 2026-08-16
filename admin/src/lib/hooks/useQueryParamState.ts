import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A single filter value mirrored into the query string, so a filtered view is
 * linkable (Categories → `/questions?categoryId=3` depends on this) and
 * survives a reload.
 *
 * Setting a filter always rewinds `page` to 1 — the alternative is landing on
 * page 4 of a 2-page result and seeing an empty grid that looks like "no data".
 */
export function useQueryParamState(
  key: string,
  defaultValue = '',
): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? defaultValue;

  const set = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (!next) p.delete(key);
          else p.set(key, next);
          p.set('page', '1');
          return p;
        },
        { replace: true },
      );
    },
    [key, setParams],
  );

  return [value, set];
}
