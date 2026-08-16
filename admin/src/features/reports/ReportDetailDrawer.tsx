import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { FormDrawer } from '../../components/common/FormDrawer';
import { Mono } from '../../components/common/Mono';
import { Num } from '../../components/common/Num';
import { RelativeTime } from '../../components/common/RelativeTime';
import { StatusChip } from '../../components/common/StatusChip';
import type { AdminReport } from './api';

interface Field {
  label: string;
  value: React.ReactNode;
}

function FieldRow({ label, value }: Field) {
  return (
    <Stack direction="row" gap={2} alignItems="baseline">
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 96, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{value}</Box>
    </Stack>
  );
}

/** Verbatim user content — never interpreted, only displayed. */
function Quote({ text, empty }: { text: string | null; empty: string }) {
  if (!text) {
    return (
      <Typography variant="body2" color="text.disabled">
        {empty}
      </Typography>
    );
  }
  return (
    <Box
      sx={{
        backgroundColor: 'surface.sunken',
        borderRadius: 2,
        padding: 2,
        maxHeight: 280,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text}
      </Typography>
    </Box>
  );
}

export interface ReportDetailDrawerProps {
  report: AdminReport | null;
  open: boolean;
  onClose: () => void;
  /** Hidden entirely when the role cannot resolve. */
  canResolve: boolean;
  submitting: boolean;
  onToggleResolved: (report: AdminReport) => void;
  /**
   * Acting on the question itself. Hidden when the role cannot write questions
   * (PATCH /admin/questions/:id is super_admin|content_editor) — a moderator
   * would otherwise be shown a button that 403s.
   */
  canEditQuestions?: boolean;
  deactivatingQuestion?: boolean;
  onDeactivateQuestion?: (report: AdminReport) => void;
}

/**
 * The backend has always returned the answer text, the AI score and the
 * question; the old grid threw all three away, so a moderator marked items
 * resolved having never seen what was reported. This is that content.
 */
export function ReportDetailDrawer({
  report,
  open,
  onClose,
  canResolve,
  submitting,
  onToggleResolved,
  canEditQuestions = false,
  deactivatingQuestion = false,
  onDeactivateQuestion,
}: ReportDetailDrawerProps) {
  if (!report) return null;

  const { answer, reporter } = report;
  const isMeeting = answer.question.source === 'meeting';

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="تفاصيل البلاغ"
      subtitle={`بلاغ رقم ${report.id}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (canResolve) onToggleResolved(report);
      }}
      submitting={submitting}
      // The drawer is a reading surface first; without permission it has no
      // action, so the footer offers only "close".
      disabled={!canResolve}
      submitLabel={report.resolved ? 'إعادة الفتح' : 'وضع كمعالج'}
      footerStart={
        <Stack direction="row" gap={1} alignItems="center">
          <StatusChip kind="reportStatus" value={report.resolved} />
        </Stack>
      }
    >
      <Stack gap={1}>
        <FieldRow label="سبب البلاغ" value={<Typography variant="body2">{report.reason}</Typography>} />
        <FieldRow
          label="المُبلِّغ"
          value={
            <Stack gap={0.25}>
              <Mono value={reporter.email} />
              {reporter.name && (
                <Typography variant="caption" color="text.secondary">
                  {reporter.name}
                </Typography>
              )}
            </Stack>
          }
        />
        <FieldRow label="تاريخ البلاغ" value={<RelativeTime value={report.createdAt} mode="both" variant="body2" />} />
      </Stack>

      <Divider />

      <Stack gap={1.5}>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <Typography variant="h6">السؤال</Typography>
          <StatusChip
            kind="custom"
            value={answer.question.source}
            label={isMeeting ? 'مقابلة مباشرة' : 'من بنك الأسئلة'}
            tone={isMeeting ? 'info' : 'neutral'}
            tooltip={
              isMeeting
                ? 'سؤال حر من جلسة مقابلة — غير مسجّل في بنك الأسئلة'
                : 'سؤال من بنك الأسئلة'
            }
          />
        </Stack>
        <Quote text={answer.question.text} empty="لم يُسجَّل نص السؤال" />
        {canEditQuestions && onDeactivateQuestion && (
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={isMeeting || deactivatingQuestion}
              onClick={() => onDeactivateQuestion(report)}
            >
              إيقاف هذا السؤال
            </Button>
            <Typography variant="caption" color="text.secondary">
              {isMeeting
                ? 'سؤال حر من مقابلة مباشرة — لا يوجد في بنك الأسئلة ليُوقف.'
                : 'يوقف طرحه في الجلسات الجديدة دون حذف أي إجابة، ودون معالجة البلاغ.'}
            </Typography>
          </Stack>
        )}
      </Stack>

      <Stack gap={1.5}>
        <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
          <Typography variant="h6">إجابة المستخدم</Typography>
          <Stack direction="row" gap={0.5} alignItems="baseline">
            <Typography variant="caption" color="text.secondary">
              تقييم الذكاء الاصطناعي
            </Typography>
            {/* null means "never scored" — a 0 would read as a failing grade. */}
            <Num value={answer.aiScore} variant="subtitle2" />
          </Stack>
        </Stack>
        <Quote text={answer.userAnswer} empty="لا يوجد نص للإجابة" />
        <Stack direction="row" gap={2} flexWrap="wrap">
          <FieldRow
            label="تاريخ الإجابة"
            value={<RelativeTime value={answer.answeredAt} mode="both" variant="body2" />}
          />
        </Stack>
      </Stack>

      {!canResolve && (
        <Typography variant="caption" color="text.secondary">
          ليس لديك صلاحية معالجة البلاغات.
        </Typography>
      )}
    </FormDrawer>
  );
}

/** Row action used by the grid, kept next to the drawer it opens. */
export function ResolveButton({
  report,
  disabled,
  onToggle,
}: {
  report: AdminReport;
  disabled: boolean;
  onToggle: (report: AdminReport) => void;
}) {
  return (
    <Button
      size="small"
      variant={report.resolved ? 'text' : 'outlined'}
      color={report.resolved ? 'inherit' : 'primary'}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(report);
      }}
    >
      {report.resolved ? 'إعادة الفتح' : 'معالجة'}
    </Button>
  );
}
