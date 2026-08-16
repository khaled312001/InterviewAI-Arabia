import { useMemo, useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';
import FlagRounded from '@mui/icons-material/FlagRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import ToggleOffRounded from '@mui/icons-material/ToggleOffRounded';
import type { GridColDef } from '@mui/x-data-grid';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '../components/common/PageHeader';
import { DataTable } from '../components/common/DataTable';
import { StatusChip } from '../components/common/StatusChip';
import { Mono } from '../components/common/Mono';
import { useConfirm } from '../components/common/ConfirmDialog';
import { useToast } from '../components/common/ToastProvider';
import { dateCol, chipCol, actionsCol } from '../lib/columns';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import { useDebouncedValue } from '../lib/hooks/useDebouncedValue';
import { parseApiError } from '../lib/errors';
import { can } from '../lib/permissions';
import { useAuth } from '../store/auth';
import { useToggleQuestion } from '../features/content/api';
import {
  useReportsQuery,
  useResolveReport,
  type AdminReport,
  type ReportStatusFilter,
} from '../features/reports/api';
import { ReportDetailDrawer, ResolveButton } from '../features/reports/ReportDetailDrawer';

const STATUS_VALUES: ReportStatusFilter[] = ['open', 'all', 'resolved'];

function isStatus(v: string | null): v is ReportStatusFilter {
  return v === 'all' || v === 'open' || v === 'resolved';
}

export function ReportsPage() {
  const role = useAuth((s) => s.admin?.role);
  const canResolve = can(role, 'reports.resolve');
  /**
   * Acting on the reported content, not just on the report. PATCH /questions/:id
   * is super_admin|content_editor while this page is super_admin|moderator, so
   * in practice only a super admin sees it — a moderator would have to go to
   * the Questions page, which their role cannot open at all.
   */
  const canEditQuestions = can(role, 'questions.write');
  const toast = useToast();
  const confirm = useConfirm();

  const [params, setParams] = useSearchParams();
  const { paginationModel, onPaginationModelChange, page, pageSize, reset } = useServerPagination();

  // Defaults to the queue that needs work, not to everything ever filed.
  const statusParam = params.get('status');
  const status: ReportStatusFilter = isStatus(statusParam) ? statusParam : 'open';

  const [search, setSearch] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebouncedValue(search, 300);

  const query = useReportsQuery({ page, limit: pageSize, status, q: debouncedSearch });
  const resolve = useResolveReport();
  const deactivateQuestion = useToggleQuestion({ errorsHandledByCaller: true });

  const [selected, setSelected] = useState<AdminReport | null>(null);

  function setStatus(next: ReportStatusFilter) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('status', next);
        p.set('page', '1');
        return p;
      },
      { replace: true },
    );
  }

  function onSearchChange(value: string) {
    setSearch(value);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set('q', value);
        else p.delete('q');
        p.set('page', '1');
        return p;
      },
      { replace: true },
    );
  }

  function toggleResolved(report: AdminReport) {
    const next = !report.resolved;
    resolve.mutate(
      { id: report.id, resolved: next },
      {
        onSuccess: () => {
          toast.success(next ? 'تمت معالجة البلاغ' : 'أُعيد فتح البلاغ');
          setSelected(null);
        },
        onError: (err) => toast.error(parseApiError(err).messageAr),
      },
    );
  }

  /**
   * Takes the offending question out of circulation. Only 'catalogue' reports
   * have one: a 'meeting' prompt was generated inside a live session and has no
   * row in `questions`, so there is nothing to switch off.
   */
  function askDeactivateQuestion(report: AdminReport) {
    const questionId = report.answer.question.id;
    if (!questionId) return Promise.resolve(false);

    return confirm({
      title: 'إيقاف السؤال المُبلَّغ عنه؟',
      description: report.answer.question.text ?? undefined,
      tone: 'danger',
      confirmLabel: 'إيقاف السؤال',
      consequences: [
        'لن يُطرح هذا السؤال في أي جلسة جديدة.',
        'الإجابات السابقة وسجلّ الجلسات تبقى كما هي — لا يُحذف شيء.',
        'البلاغ نفسه يبقى قيد المراجعة حتى تضعه كمعالج.',
        'يمكن إعادة تفعيله لاحقًا من صفحة الأسئلة.',
      ],
      onConfirm: () => deactivateQuestion.mutateAsync({ id: questionId, isActive: false }),
    });
  }

  const columns = useMemo<GridColDef<AdminReport>[]>(
    () => [
      {
        field: 'questionText',
        headerName: 'السؤال',
        flex: 1.4,
        minWidth: 220,
        sortable: false,
        align: 'left',
        headerAlign: 'left',
        valueGetter: (_v, row) => row.answer.question.text ?? '',
        renderCell: ({ row }) => (
          <Typography variant="body2" noWrap color={row.answer.question.text ? undefined : 'text.disabled'}>
            {row.answer.question.text || 'سؤال مقابلة غير مسجّل'}
          </Typography>
        ),
      },
      {
        field: 'userAnswer',
        headerName: 'الإجابة المُبلَّغ عنها',
        flex: 1.4,
        minWidth: 220,
        sortable: false,
        align: 'left',
        headerAlign: 'left',
        valueGetter: (_v, row) => row.answer.userAnswer ?? '',
        renderCell: ({ row }) => (
          <Typography variant="body2" noWrap color={row.answer.userAnswer ? undefined : 'text.disabled'}>
            {row.answer.userAnswer || '—'}
          </Typography>
        ),
      },
      {
        field: 'reason',
        headerName: 'السبب',
        flex: 1,
        minWidth: 150,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ value }) => (
          <Typography variant="body2" noWrap>
            {(value as string) || '—'}
          </Typography>
        ),
      },
      {
        field: 'reporter',
        headerName: 'المُبلِّغ',
        width: 210,
        sortable: false,
        align: 'left',
        headerAlign: 'left',
        valueGetter: (_v, row) => row.reporter.email ?? '',
        renderCell: ({ row }) => <Mono value={row.reporter.email} maxChars={24} />,
      },
      dateCol<AdminReport>({ field: 'createdAt', headerName: 'تاريخ البلاغ', width: 150 }),
      chipCol<AdminReport>({ field: 'resolved', headerName: 'الحالة', kind: 'reportStatus', width: 140 }),
      ...(canResolve || canEditQuestions
        ? [
            actionsCol<AdminReport>({
              width: canEditQuestions ? 170 : 120,
              render: (row) => (
                <>
                  {canEditQuestions && (
                    <Tooltip
                      title={
                        row.answer.question.source === 'meeting'
                          ? 'سؤال حر من مقابلة مباشرة — لا يوجد في بنك الأسئلة ليُوقف'
                          : 'إيقاف السؤال في بنك الأسئلة'
                      }
                    >
                      <span>
                        <IconButton
                          size="small"
                          aria-label="إيقاف السؤال"
                          disabled={
                            deactivateQuestion.isPending || row.answer.question.source === 'meeting'
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            void askDeactivateQuestion(row);
                          }}
                        >
                          <ToggleOffRounded fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  {canResolve && (
                    <ResolveButton
                      report={row}
                      disabled={resolve.isPending}
                      onToggle={toggleResolved}
                    />
                  )}
                </>
              ),
            }),
          ]
        : []),
    ],
    // toggleResolved is stable enough for this list; the two isPending flags
    // drive disabled states and must re-render the actions column.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canResolve, canEditQuestions, resolve.isPending, deactivateQuestion.isPending],
  );

  const openCount = query.data?.openCount;

  return (
    <>
      <PageHeader
        title="البلاغات"
        description="إجابات أبلغ عنها المستخدمون — راجع المحتوى قبل معالجته."
        icon={<FlagRounded />}
        meta={
          openCount !== undefined ? (
            <StatusChip
              kind="custom"
              value="open"
              label={openCount > 0 ? `${openCount} قيد المراجعة` : 'لا بلاغات معلّقة'}
              tone={openCount > 0 ? 'warning' : 'success'}
            />
          ) : undefined
        }
      />

      <DataTable<AdminReport>
        rows={query.data?.reports}
        columns={columns}
        query={query}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        rowCount={query.data?.total}
        getRowId={(r) => r.id}
        onRowClick={(row) => setSelected(row)}
        toolbar={
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            gap={1.5}
            alignItems={{ sm: 'center' }}
            justifyContent="space-between"
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={status}
              onChange={(_e, v) => {
                if (v && isStatus(v)) {
                  setStatus(v);
                  reset();
                }
              }}
            >
              {STATUS_VALUES.map((v) => (
                <ToggleButton key={v} value={v} sx={{ paddingInline: 2 }}>
                  {v === 'open' ? 'قيد المراجعة' : v === 'resolved' ? 'تمت المعالجة' : 'الكل'}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <TextField
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="ابحث في السبب أو البريد أو نص الإجابة…"
              sx={{ maxWidth: { sm: 340 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Stack>
        }
        empty={{
          title:
            status === 'open'
              ? 'لا بلاغات قيد المراجعة'
              : status === 'resolved'
                ? 'لا بلاغات تمت معالجتها'
                : 'لا توجد بلاغات',
          description: debouncedSearch
            ? `لا نتائج للبحث «${debouncedSearch}».`
            : status === 'open'
              ? 'كل ما أبلغ عنه المستخدمون تمت معالجته.'
              : 'ستظهر هنا الإجابات التي يبلّغ عنها المستخدمون.',
          icon: <FlagRounded />,
        }}
      />

      <ReportDetailDrawer
        report={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        canResolve={canResolve}
        submitting={resolve.isPending}
        onToggleResolved={toggleResolved}
        canEditQuestions={canEditQuestions}
        deactivatingQuestion={deactivateQuestion.isPending}
        onDeactivateQuestion={(report) => void askDeactivateQuestion(report)}
      />
    </>
  );
}
