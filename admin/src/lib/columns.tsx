import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { GridColDef, GridValidRowModel } from '@mui/x-data-grid';
import { Money, type MoneyProps } from '../components/common/Money';
import { Mono } from '../components/common/Mono';
import { Num } from '../components/common/Num';
import { RelativeTime } from '../components/common/RelativeTime';
import { StatusChip, type StatusKind, type Tone } from '../components/common/StatusChip';
import type { NumFormat } from './format';

/**
 * `align` / `headerAlign` map to justify-content on a direction-aware flex row,
 * so 'left' means inline-start (visually right here). That is a trap, so pages
 * never write them — alignment is set once, in these factories.
 */

interface BaseOptions {
  field: string;
  headerName: string;
  width?: number;
  flex?: number;
  minWidth?: number;
  sortable?: boolean;
}

export function textCol<R extends GridValidRowModel>(o: BaseOptions & { mono?: boolean }): GridColDef<R> {
  return {
    field: o.field,
    headerName: o.headerName,
    width: o.width,
    flex: o.flex,
    minWidth: o.minWidth,
    sortable: o.sortable ?? true,
    align: 'left',
    headerAlign: 'left',
    renderCell: o.mono
      ? ({ value }) => <Mono value={value as string} />
      : ({ value }) => (
          <Typography variant="body2" noWrap>
            {(value as string) || '—'}
          </Typography>
        ),
  };
}

export function numCol<R extends GridValidRowModel>(
  o: BaseOptions & { format?: NumFormat },
): GridColDef<R> {
  return {
    field: o.field,
    headerName: o.headerName,
    width: o.width ?? 120,
    flex: o.flex,
    minWidth: o.minWidth,
    sortable: o.sortable ?? true,
    type: 'number',
    align: 'left',
    headerAlign: 'left',
    renderCell: ({ value }) => <Num value={value as number} format={o.format ?? 'int'} variant="body2" />,
  };
}

export function moneyCol<R extends GridValidRowModel>(
  o: BaseOptions & Pick<MoneyProps, 'currency' | 'unit' | 'precision' | 'approximate'>,
): GridColDef<R> {
  return {
    field: o.field,
    headerName: o.headerName,
    width: o.width ?? 140,
    flex: o.flex,
    minWidth: o.minWidth,
    sortable: o.sortable ?? true,
    type: 'number',
    align: 'left',
    headerAlign: 'left',
    renderCell: ({ value }) => (
      <Money
        amount={value as number}
        currency={o.currency}
        unit={o.unit}
        precision={o.precision}
        approximate={o.approximate}
        variant="body2"
      />
    ),
  };
}

export function dateCol<R extends GridValidRowModel>(
  o: BaseOptions & { mode?: 'relative' | 'absolute' | 'both' },
): GridColDef<R> {
  return {
    field: o.field,
    headerName: o.headerName,
    width: o.width ?? 170,
    flex: o.flex,
    minWidth: o.minWidth,
    sortable: o.sortable ?? true,
    align: 'left',
    headerAlign: 'left',
    renderCell: ({ value }) => (
      <RelativeTime value={value as string} mode={o.mode ?? 'relative'} variant="body2" />
    ),
  };
}

export function chipCol<R extends GridValidRowModel>(
  o: BaseOptions & { kind: StatusKind; tone?: Tone; tooltip?: (row: R) => string | undefined },
): GridColDef<R> {
  return {
    field: o.field,
    headerName: o.headerName,
    width: o.width ?? 130,
    flex: o.flex,
    minWidth: o.minWidth,
    sortable: o.sortable ?? false,
    align: 'left',
    headerAlign: 'left',
    renderCell: ({ value, row }) => (
      <StatusChip kind={o.kind} value={value as string} tone={o.tone} tooltip={o.tooltip?.(row as R)} />
    ),
  };
}

export function actionsCol<R extends GridValidRowModel>(o: {
  headerName?: string;
  width?: number;
  render: (row: R) => React.ReactNode;
}): GridColDef<R> {
  return {
    field: '__actions',
    headerName: o.headerName ?? '',
    width: o.width ?? 140,
    sortable: false,
    filterable: false,
    disableColumnMenu: true,
    align: 'right',
    headerAlign: 'right',
    renderCell: ({ row }) => (
      <Stack direction="row" gap={0.5} alignItems="center">
        {o.render(row as R)}
      </Stack>
    ),
  };
}
