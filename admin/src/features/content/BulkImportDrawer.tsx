import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import { FormDrawer } from '../../components/common/FormDrawer';
import { Mono } from '../../components/common/Mono';
import { Num } from '../../components/common/Num';
import { useToast } from '../../components/common/ToastProvider';
import { apiErrorPayload } from '../../lib/errors';
import { monoFamily } from '../../theme/typography';
import { useBulkImportQuestions } from './api';
import {
  BULK_MAX_ROWS,
  BULK_TEMPLATE,
  parseBulkText,
  validateBulkRows,
  type BulkServerDetails,
  type RowError,
} from './bulkImport';
import type { AdminCategory } from './types';

interface Props {
  open: boolean;
  categories: AdminCategory[];
  onClose: () => void;
}

function RowErrorList({ errors, total }: { errors: RowError[]; total?: number }) {
  const shown = errors.slice(0, 20);
  return (
    <Alert severity="error">
      <AlertTitle>
        {total && total > errors.length
          ? `${total} صف به خطأ (أول ${shown.length})`
          : `${errors.length} صف به خطأ`}
      </AlertTitle>
      <Typography variant="body2" sx={{ mb: 1 }}>
        لم يُحفظ أي سؤال. صحّح الصفوف التالية ثم أعد المحاولة.
      </Typography>
      <Stack component="ul" gap={0.75} sx={{ m: 0, paddingInlineStart: 2.5 }}>
        {shown.map((e) => (
          <Typography key={e.row} component="li" variant="body2">
            الصف <Num value={e.row + 1} />:{' '}
            {e.issues.map((i) => (i.path ? `${i.path} — ${i.message}` : i.message)).join(' · ')}
          </Typography>
        ))}
      </Stack>
      {errors.length > shown.length && (
        <Typography variant="caption" color="text.secondary">
          و{errors.length - shown.length} صفًا آخر…
        </Typography>
      )}
    </Alert>
  );
}

export function BulkImportDrawer({ open, categories, onClose }: Props) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [checked, setChecked] = useState(false);

  const importer = useBulkImportQuestions((count) => {
    toast.success(`تم استيراد ${count} سؤالًا`);
    onClose();
  });

  useEffect(() => {
    if (!open) return;
    setText('');
    setChecked(false);
    importer.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const knownIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);

  // Recomputed on every keystroke but only *shown* after the operator asks —
  // a red wall while typing JSON is noise, not feedback.
  const result = useMemo(() => {
    const parsed = parseBulkText(text);
    if (parsed.fatal || !parsed.rows) return { fatal: parsed.fatal, questions: [], errors: [] as RowError[] };
    const { questions, errors } = validateBulkRows(parsed.rows, knownIds);
    return { fatal: undefined, questions, errors };
  }, [text, knownIds]);

  const serverDetails = apiErrorPayload<BulkServerDetails>(importer.error);
  const serverRows = serverDetails?.rows;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChecked(true);
    if (result.fatal || result.errors.length > 0 || result.questions.length === 0) return;
    importer.mutate(result.questions);
  }

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(BULK_TEMPLATE);
      toast.success('تم نسخ النموذج');
    } catch {
      toast.error('تعذّر النسخ');
    }
  }

  const readyCount = result.questions.length;
  const showLocalErrors = checked && (result.fatal || result.errors.length > 0);

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="استيراد أسئلة مجمّعة"
      subtitle={`حتى ${BULK_MAX_ROWS} سؤال في الدفعة الواحدة`}
      onSubmit={handleSubmit}
      submitting={importer.isPending}
      // Surfaces anything that is not a row-level failure (403, network, 500).
      error={importer.error}
      submitLabel="استيراد"
      width={640}
      dirty={text.trim().length > 0}
      noValidate
      footerStart={
        readyCount > 0 && !showLocalErrors ? (
          <Chip size="small" label={`${readyCount} سؤال جاهز`} color="success" variant="outlined" />
        ) : undefined
      }
    >
      <Box>
        <Typography variant="body2" color="text.secondary">
          الصق مصفوفة JSON، أو كائنًا يحتوي على المفتاح <Mono value="questions" />. الحقول المطلوبة
          لكل صف: <Mono value="categoryId" />، <Mono value="questionAr" />، <Mono value="questionEn" />.
          الحقلان <Mono value="difficulty" /> و<Mono value="isActive" /> اختياريان.
        </Typography>
        <Button
          size="small"
          variant="text"
          startIcon={<ContentCopyRounded />}
          onClick={copyTemplate}
          sx={{ mt: 1 }}
        >
          نسخ نموذج جاهز
        </Button>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          أرقام الأقسام المتاحة
        </Typography>
        {categories.length === 0 ? (
          <Alert severity="warning">لا توجد أقسام بعد — أنشئ قسمًا قبل استيراد الأسئلة.</Alert>
        ) : (
          <Stack direction="row" gap={0.75} sx={{ flexWrap: 'wrap' }}>
            {categories.map((c) => (
              <Chip key={c.id} size="small" variant="outlined" label={`${c.id} · ${c.nameAr}`} />
            ))}
          </Stack>
        )}
      </Box>

      <TextField
        label="محتوى JSON"
        value={text}
        onChange={(e) => setText(e.target.value)}
        multiline
        minRows={12}
        placeholder={BULK_TEMPLATE}
        slotProps={{
          htmlInput: {
            dir: 'ltr',
            spellCheck: false,
            style: { fontFamily: monoFamily, fontSize: '0.8125rem', lineHeight: 1.6 },
          },
        }}
      />

      <Stack direction="row" alignItems="center" gap={1}>
        <Button size="small" variant="outlined" onClick={() => setChecked(true)} disabled={!text.trim()}>
          تحقّق من الصفوف
        </Button>
        {checked && !result.fatal && result.errors.length === 0 && readyCount > 0 && (
          <Typography variant="body2" color="success.main">
            كل الصفوف صالحة (<Num value={readyCount} />).
          </Typography>
        )}
      </Stack>

      {checked && result.fatal && <Alert severity="error">{result.fatal}</Alert>}

      {checked && !result.fatal && result.errors.length > 0 && <RowErrorList errors={result.errors} />}

      {/* The server re-validates; if it disagrees, its rows are shown too. */}
      {serverRows && serverRows.length > 0 && (
        <RowErrorList errors={serverRows} total={serverDetails?.totalInvalid} />
      )}
    </FormDrawer>
  );
}
