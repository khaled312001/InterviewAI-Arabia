import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GridPaginationModel } from '@mui/x-data-grid';

const DEFAULT_SIZE = 25;

/**
 * Server pagination state mirrored into the query string, so a paginated view
 * is linkable and survives a reload.
 */
export function useServerPagination(defaultPageSize = DEFAULT_SIZE) {
  const [params, setParams] = useSearchParams();

  const page = Math.max(0, (Number(params.get('page')) || 1) - 1);
  const pageSize = Math.max(1, Number(params.get('size')) || defaultPageSize);

  const paginationModel = useMemo<GridPaginationModel>(() => ({ page, pageSize }), [page, pageSize]);

  const onPaginationModelChange = useCallback(
    (model: GridPaginationModel) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('page', String(model.page + 1));
          next.set('size', String(model.pageSize));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const reset = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('page', '1');
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return {
    paginationModel,
    onPaginationModelChange,
    /** 1-based, for the backend's `page` query param. */
    page: page + 1,
    pageSize,
    reset,
  };
}
