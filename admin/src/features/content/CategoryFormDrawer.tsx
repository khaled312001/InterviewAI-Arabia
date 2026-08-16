import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { FormDrawer } from '../../components/common/FormDrawer';
import { Num } from '../../components/common/Num';
import { useSaveCategory } from './api';
import type { AdminCategory, CategoryInput } from './types';

interface Props {
  open: boolean;
  /** null ⇒ create. */
  category: AdminCategory | null;
  /** Used only to suggest the next sort order on create. */
  categories: AdminCategory[];
  onClose: () => void;
}

type Values = CategoryInput;
type FieldErrors = Partial<Record<keyof Values, string>>;

function blank(categories: AdminCategory[]): Values {
  const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0);
  return {
    nameAr: '',
    nameEn: '',
    descriptionAr: '',
    descriptionEn: '',
    icon: '',
    isPremium: false,
    isActive: true,
    sortOrder: maxOrder + 10,
  };
}

function fromCategory(c: AdminCategory): Values {
  return {
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    descriptionAr: c.descriptionAr ?? '',
    descriptionEn: c.descriptionEn ?? '',
    icon: c.icon ?? '',
    isPremium: c.isPremium,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
  };
}

/** Mirrors backend categorySchema, including the VarChar limits. */
function validate(values: Values): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.nameAr.trim()) errors.nameAr = 'اسم القسم بالعربية مطلوب.';
  else if (values.nameAr.trim().length > 120) errors.nameAr = 'الحد الأقصى ١٢٠ حرفًا.';

  if (!values.nameEn.trim()) errors.nameEn = 'اسم القسم بالإنجليزية مطلوب.';
  else if (values.nameEn.trim().length > 120) errors.nameEn = 'الحد الأقصى ١٢٠ حرفًا.';

  if ((values.descriptionAr ?? '').length > 500) errors.descriptionAr = 'الحد الأقصى ٥٠٠ حرف.';
  if ((values.descriptionEn ?? '').length > 500) errors.descriptionEn = 'الحد الأقصى ٥٠٠ حرف.';
  if ((values.icon ?? '').length > 64) errors.icon = 'الحد الأقصى ٦٤ حرفًا.';
  if (!Number.isInteger(values.sortOrder)) errors.sortOrder = 'أدخل رقمًا صحيحًا.';

  return errors;
}

/** Empty optional strings become null so the column is cleared, not set to ''. */
function toPayload(values: Values): Values {
  const trim = (v: string | null) => {
    const t = (v ?? '').trim();
    return t.length > 0 ? t : null;
  };
  return {
    ...values,
    nameAr: values.nameAr.trim(),
    nameEn: values.nameEn.trim(),
    descriptionAr: trim(values.descriptionAr),
    descriptionEn: trim(values.descriptionEn),
    icon: trim(values.icon),
  };
}

export function CategoryFormDrawer({ open, category, categories, onClose }: Props) {
  const [values, setValues] = useState<Values>(() => blank(categories));
  const [initial, setInitial] = useState<Values>(() => blank(categories));
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const save = useSaveCategory(onClose);

  useEffect(() => {
    if (!open) return;
    const next = category ? fromCategory(category) : blank(categories);
    setValues(next);
    setInitial(next);
    setTouched({});
    setSubmitted(false);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category]);

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
    save.mutate({ ...toPayload(values), id: category?.id });
  }

  const isEdit = Boolean(category);
  const willDeactivate = isEdit && category?.isActive && !values.isActive;

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'تعديل قسم' : 'قسم جديد'}
      subtitle={isEdit ? `رقم ${category?.id}` : undefined}
      mode={isEdit ? 'edit' : 'create'}
      onSubmit={handleSubmit}
      submitting={save.isPending}
      error={save.error}
      dirty={dirty}
      noValidate
    >
      <TextField
        required
        label="الاسم (عربي)"
        value={values.nameAr}
        onChange={(e) => set('nameAr', e.target.value)}
        onBlur={blur('nameAr')}
        error={Boolean(show('nameAr'))}
        helperText={show('nameAr')}
      />

      <TextField
        required
        label="Name (English)"
        value={values.nameEn}
        onChange={(e) => set('nameEn', e.target.value)}
        onBlur={blur('nameEn')}
        error={Boolean(show('nameEn'))}
        helperText={show('nameEn')}
        slotProps={{ htmlInput: { dir: 'ltr' } }}
      />

      <TextField
        label="الوصف (عربي)"
        value={values.descriptionAr ?? ''}
        onChange={(e) => set('descriptionAr', e.target.value)}
        onBlur={blur('descriptionAr')}
        error={Boolean(show('descriptionAr'))}
        helperText={show('descriptionAr') ?? 'اختياري — يظهر تحت اسم القسم في التطبيق.'}
        multiline
        minRows={2}
      />

      <TextField
        label="Description (English)"
        value={values.descriptionEn ?? ''}
        onChange={(e) => set('descriptionEn', e.target.value)}
        onBlur={blur('descriptionEn')}
        error={Boolean(show('descriptionEn'))}
        helperText={show('descriptionEn') ?? 'اختياري.'}
        multiline
        minRows={2}
        slotProps={{ htmlInput: { dir: 'ltr' } }}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <TextField
          label="الأيقونة"
          value={values.icon ?? ''}
          onChange={(e) => set('icon', e.target.value)}
          onBlur={blur('icon')}
          error={Boolean(show('icon'))}
          helperText={show('icon') ?? 'اسم أيقونة Lucide، مثل briefcase.'}
          slotProps={{ htmlInput: { dir: 'ltr' } }}
        />
        <TextField
          label="ترتيب الظهور"
          type="number"
          value={values.sortOrder}
          onChange={(e) => set('sortOrder', Number(e.target.value))}
          onBlur={blur('sortOrder')}
          error={Boolean(show('sortOrder'))}
          helperText={show('sortOrder') ?? 'الأصغر يظهر أولًا.'}
        />
      </Stack>

      <div>
        <FormControlLabel
          control={
            <Switch checked={values.isPremium} onChange={(e) => set('isPremium', e.target.checked)} />
          }
          label="قسم مميز (للمشتركين فقط)"
        />
        <FormHelperText>
          يرفض الخادم بدء جلسة في هذا القسم لأي مستخدم على الخطة المجانية.
        </FormHelperText>
      </div>

      <div>
        <FormControlLabel
          control={
            <Switch checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          }
          label="قسم مفعّل"
        />
        <FormHelperText>
          إيقاف القسم يمنع بدء أي جلسة تدريب أو مقابلة فيه، ويخفي أسئلته عن التطبيق.
        </FormHelperText>
      </div>

      {willDeactivate && (category?.sessionCount ?? 0) > 0 && (
        <Alert severity="info">
          هذا القسم له <Num value={category?.sessionCount} /> جلسة مسجّلة. الإيقاف يحافظ عليها، بعكس
          الحذف.
        </Alert>
      )}
    </FormDrawer>
  );
}
