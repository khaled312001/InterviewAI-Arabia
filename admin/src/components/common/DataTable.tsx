import { useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { DataGrid } from '@mui/x-data-grid';
import type {
  GridColDef,
  GridPaginationModel,
  GridRowId,
  GridRowSelectionModel,
  GridValidRowModel,
} from '@mui/x-data-grid';
import type { UseQueryResult } from '@tanstack/react-query';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { ErrorState } from './ErrorState';
import { TableSkeleton } from './Skeletons';

export interface DataTableProps<R extends GridValidRowModel> {
  rows: R[] | undefined;
  columns: GridColDef<R>[];
  getRowId?: (row: R) => GridRowId;

  /** The whole react-query result — every state is derived from it. */
  query: Pick<UseQueryResult, 'isLoading' | 'isFetching' | 'isError' | 'error' | 'refetch'>;

  /**
   * `'server'` (the default) requires the three props below — client paging
   * over a truncated page is banned.
   *
   * `'none'` is for endpoints that return one complete, bounded result set
   * (a top-N leaderboard). The footer is hidden rather than rendered as an
   * inert control, and sorting still works client-side because every row is
   * present.
   */
  paginationMode?: 'server' | 'none';
  paginationModel?: GridPaginationModel;
  onPaginationModelChange?: (model: GridPaginationModel) => void;
  /** The backend's `total`. Required for `paginationMode="server"`. */
  rowCount?: number | undefined;
  pageSizeOptions?: number[];

  /**
   * `variant`/`query` let a filtered-to-nothing table say so ("لا نتائج للبحث
   * «x»") instead of claiming the table is empty.
   */
  empty: Pick<
    EmptyStateProps,
    'title' | 'description' | 'icon' | 'action' | 'secondaryAction' | 'variant' | 'query'
  >;
  errorTitle?: string;

  toolbar?: React.ReactNode;
  onRowClick?: (row: R) => void;
  renderMobileCard?: (row: R) => React.ReactNode;
  density?: 'compact' | 'standard';
  height?: number | string;
  checkboxSelection?: boolean;
  /**
   * The bulk bar shown above the grid while rows are selected. `clear` empties
   * the selection — a bulk action that succeeded must not leave rows ticked, or
   * the next click repeats it on rows that were already handled.
   */
  selectionActions?: (ids: GridRowId[], clear: () => void) => React.ReactNode;
}

export function DataTable<R extends GridValidRowModel>({
  rows,
  columns,
  getRowId,
  query,
  paginationMode = 'server',
  paginationModel,
  onPaginationModelChange,
  rowCount,
  pageSizeOptions = [25, 50, 100],
  empty,
  errorTitle = 'تعذّر تحميل البيانات',
  toolbar,
  onRowClick,
  renderMobileCard,
  density = 'standard',
  height,
  checkboxSelection = false,
  selectionActions,
}: DataTableProps<R>) {
  const theme = useTheme();
  const isSm = useMediaQuery(theme.breakpoints.down('md'));
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const [selection, setSelection] = useState<GridRowId[]>([]);

  const isEmpty = !query.isError && !query.isLoading && (rows?.length ?? 0) === 0;

  const clearSelection = () => setSelection([]);

  /**
   * Turning the page drops the selection. With server pagination the rows
   * behind the ticked ids are no longer on screen, and a bulk action the
   * operator can no longer see the targets of is not a reviewable action.
   */
  const handlePaginationModelChange = (model: GridPaginationModel) => {
    clearSelection();
    onPaginationModelChange?.(model);
  };

  const paginated = paginationMode === 'server';
  // With `paginationMode="none"` every row is already on the client, so the
  // grid keeps one page big enough to hold them all and hides the footer.
  const effectiveModel: GridPaginationModel =
    paginated && paginationModel ? paginationModel : { page: 0, pageSize: 100 };

  const chrome = (body: React.ReactNode) => (
    <Card>
      {toolbar && (
        <>
          <Box sx={{ p: 2 }}>{toolbar}</Box>
          <Divider />
        </>
      )}
      {checkboxSelection && selectionActions && selection.length > 0 && (
        <>
          <Stack
            direction="row"
            alignItems="center"
            gap={1}
            sx={{ p: 1.5, bgcolor: 'action.hover', flexWrap: 'wrap' }}
          >
            {selectionActions(selection, clearSelection)}
          </Stack>
          <Divider />
        </>
      )}
      {body}
    </Card>
  );

  // A failed request replaces the grid. It is never an empty grid — that reads
  // identically to "no data" and hides the failure.
  if (query.isError) {
    return chrome(
      <ErrorState error={query.error} title={errorTitle} onRetry={() => query.refetch()} variant="block" />,
    );
  }

  if (query.isLoading) {
    return chrome(<TableSkeleton rows={effectiveModel.pageSize > 10 ? 8 : 5} cols={columns.length} />);
  }

  if (isEmpty) return chrome(<EmptyState {...empty} size="md" />);

  if (isXs && renderMobileCard) {
    return chrome(
      <Stack gap={1.5} sx={{ p: 2, opacity: query.isFetching ? 0.7 : 1 }}>
        {(rows ?? []).map((row) => (
          <Box key={String(getRowId ? getRowId(row) : row.id)}>{renderMobileCard(row)}</Box>
        ))}
      </Stack>,
    );
  }

  return chrome(
    <Box sx={{ width: '100%', overflowX: 'auto' }}>
      <DataGrid
        rows={rows ?? []}
        columns={columns}
        getRowId={getRowId}
        autoHeight={height === undefined}
        density={isSm ? 'compact' : density}
        paginationMode={paginated ? 'server' : 'client'}
        rowCount={paginated ? (rowCount ?? -1) : undefined}
        paginationModel={effectiveModel}
        onPaginationModelChange={paginated ? handlePaginationModelChange : undefined}
        pageSizeOptions={paginated ? pageSizeOptions : [effectiveModel.pageSize]}
        hideFooter={!paginated}
        keepNonExistentRowsSelected={false}
        checkboxSelection={checkboxSelection}
        // Controlled, so `clear` empties the tick boxes too and not just the
        // ids the bulk bar was holding.
        rowSelectionModel={checkboxSelection ? selection : undefined}
        onRowSelectionModelChange={(model: GridRowSelectionModel) => setSelection(model as GridRowId[])}
        onRowClick={onRowClick ? (params) => onRowClick(params.row as R) : undefined}
        // Rows stay mounted across page changes; the refetch shows as a top
        // progress bar plus a dimmed scroller, never as an unmount.
        loading={query.isFetching}
        slotProps={{ loadingOverlay: { variant: 'linear-progress', noRowsVariant: 'skeleton' } }}
        sx={{
          ...(height !== undefined ? { height } : { minHeight: 320 }),
          ...(onRowClick ? { '& .MuiDataGrid-row': { cursor: 'pointer' } } : null),
          '& .MuiDataGrid-virtualScroller': { opacity: query.isFetching ? 0.7 : 1 },
        }}
      />
    </Box>,
  );
}
