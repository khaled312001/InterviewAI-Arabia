import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { FormDrawer } from '../../components/common/FormDrawer';
import { Num } from '../../components/common/Num';
import { StatusChip } from '../../components/common/StatusChip';
import { useSaveQuestion } from './api';
import { DIFFICULTIES, DIFFICULTY_LABEL_AR } from './types';
import type { AdminCategory, AdminQuestion, Difficulty, QuestionInput } from './types';

interface Props {
  open: boolean;
  /** null ⇒ create. */
  question: AdminQuestion | null;
  categories: AdminCategory[];
  /** Preselected in create mode when the grid is filtered to one category. */
  defaultCategoryId?: number;
  onClose: () => void;
}

type Values = QuestionInput;
type FieldErrors = Partial<Record<keyof Values, string>>;

function blank(defaultCategoryId?: number): Values {
  return {
    categoryId: defaultCategoryId ?? 0,
    questionAr: '',
    questionEn: '',
    difficulty: 'medium',
    isActive: true,
  };
}

function fromQuestion(q: AdminQuestion): Values {
  return {
    categoryId: q.categoryId,
    questionAr: q.questionAr,
    questionEn: q.questionEn,
    difficulty: q.difficulty,
    isActive: q.isActive,
  };
}

/** Mirrors backend questionSchema — nothing stricter, so a valid form never 400s. */
function validate(values: Values): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.categoryId) errors.categoryId = 'اختر القسم الذي ينتمي إليه السؤال.';
  if (!values.questionAr.trim()) errors.questionAr = 'نص السؤال بالعربية مطلوب.';
  if (!values.questionEn.trim()) errors.questionEn = 'نص السؤال بالإنجليزية مطلوب.';
  return errors;
}

export function QuestionFormDrawer({ open, question, categories, defaultCategoryId, onClose }: Props) {
  const [values, setValues] = useState<Values>(blank(defaultCategoryId));
  const [initial, setInitial] = useState<Values>(blank(defaultCategoryId));
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const save = useSaveQuestion(onClose);

  // Re-seed on every open so a cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!open) return;
    const next = question ? fromQuestion(question) : blank(defaultCategoryId);
    setValues(next);
    setInitial(next);
    setTouched({});
    setSubmitted(false);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, question, defaultCategoryId]);

  const errors = useMemo(() => validate(values), [values]);
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);

  const show = (field: keyof Values) => (submitted || touched[field] ? errors[field] : undefined);
  const set = <K extends keyof Values>(field: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [field]: value }));
  const blur = (field: keyof Values) => () => setTouched((t) => ({ ...t, [field]: true }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    save.mutate({ ...values, id: question?.id });
  }

  const isEdit = Boolean(question);
  const selectedCategory = categories.find((c) => c.id === values.categoryId);

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'تعديل سؤال' : 'سؤال جديد'}
      subtitle={isEdit ? `رقم ${question?.id}` : 'يُضاف السؤال إلى بنك الأسئلة فورًا'}
      mode={isEdit ? 'edit' : 'create'}
      onSubmit={handleSubmit}
      submitting={save.isPending}
      error={save.error}
      dirty={dirty}
      // Validation is inline and Arabic; native bubbles would arrive in the
      // browser's own language.
      noValidate
    >
      <TextField
        select
        required
        label="القسم"
        value={values.categoryId || ''}
        onChange={(e) => set('categoryId', Number(e.target.value))}
        onBlur={blur('categoryId')}
        error={Boolean(show('categoryId'))}
        helperText={show('categoryId') ?? 'يحدّد أين يظهر السؤال للمستخدمين.'}
      >
        {categories.length === 0 && (
          <MenuItem value="" disabled>
            لا توجد أقسام — أنشئ قسمًا أولًا
          </MenuItem>
        )}
        {categories.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ width: '100%' }}>
              <span>{c.nameAr}</span>
              {!c.isActive && <StatusChip kind="active" value={false} />}
              {c.isPremium && <StatusChip kind="custom" value="premium" label="مميز" tone="gold" />}
            </Stack>
          </MenuItem>
        ))}
      </TextField>

      {selectedCategory && !selectedCategory.isActive && (
        <Alert severity="warning">
          القسم «{selectedCategory.nameAr}» موقوف، فلن يصل المستخدمون إلى هذا السؤال حتى تُعيد تفعيل القسم.
        </Alert>
      )}

      <TextField
        required
        label="السؤال (عربي)"
        value={values.questionAr}
        onChange={(e) => set('questionAr', e.target.value)}
        onBlur={blur('questionAr')}
        error={Boolean(show('questionAr'))}
        helperText={show('questionAr') ?? `${values.questionAr.trim().length} حرفًا`}
        multiline
        minRows={2}
      />

      <TextField
        required
        label="Question (English)"
        value={values.questionEn}
        onChange={(e) => set('questionEn', e.target.value)}
        onBlur={blur('questionEn')}
        error={Boolean(show('questionEn'))}
        helperText={show('questionEn') ?? 'يُعرض للمستخدمين الذين اختاروا الإنجليزية.'}
        multiline
        minRows={2}
        slotProps={{ htmlInput: { dir: 'ltr' } }}
      />

      <TextField
        select
        label="الصعوبة"
        value={values.difficulty}
        onChange={(e) => set('difficulty', e.target.value as Difficulty)}
        helperText="تُستخدم لتصفية الأسئلة عند بدء جلسة تدريب."
      >
        {DIFFICULTIES.map((d) => (
          <MenuItem key={d} value={d}>
            {DIFFICULTY_LABEL_AR[d]}
          </MenuItem>
        ))}
      </TextField>

      <div>
        <FormControlLabel
          control={
            <Switch checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          }
          label="سؤال مفعّل"
        />
        <FormHelperText>
          السؤال الموقوف يبقى في البنك ولا يُطرح على أي مستخدم — وهو البديل عن الحذف عندما تريد
          الاحتفاظ بالإجابات المرتبطة به.
        </FormHelperText>
      </div>

      {isEdit && (
        <Typography variant="caption" color="text.secondary">
          طُرح على المستخدمين <Num value={question?.usageCount} /> مرة.
        </Typography>
      )}
    </FormDrawer>
  );
}
