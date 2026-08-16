import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';

import { PageHeader } from '../components/common/PageHeader';
import { SectionCard } from '../components/common/SectionCard';
import { ErrorState } from '../components/common/ErrorState';
import { StatusChip } from '../components/common/StatusChip';
import { RelativeTime } from '../components/common/RelativeTime';
import { FormSkeleton } from '../components/common/Skeletons';
import { useToast } from '../components/common/ToastProvider';
import { parseApiError } from '../lib/errors';
import { can } from '../lib/permissions';
import { useAuth } from '../store/auth';
import { useSaveSettings, useSettingsQuery } from '../features/settings/api';
import {
  ALL_SETTINGS,
  SETTING_GROUPS,
  isKnownSetting,
  validateSetting,
  type SettingDef,
} from '../features/settings/registry';

/** A row that exists in `app_settings` but not in the registry. */
interface UnknownSetting {
  key: string;
  value: string;
}

export function SettingsPage() {
  const toast = useToast();
  const role = useAuth((s) => s.admin?.role);
  const writable = can(role, 'settings.write');

  const query = useSettingsQuery();
  const save = useSaveSettings();

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const stored = query.data?.settings;
  const updatedAt = query.data?.updatedAt;

  // The server's list wins over the registry's `effect` flag: if a key is
  // wired up in the backend and this file has not caught up, the page must not
  // keep warning that it does nothing.
  const wired = useMemo(() => new Set(query.data?.wired ?? []), [query.data?.wired]);

  /**
   * Keys the backend used to read and has stopped reading (RETIRED_KEYS). The
   * server owns this list for the same reason it owns `wired`: a registry that
   * has not caught up would keep offering a live-looking field for a setting
   * that was switched off. A retired key is rendered read-only — editable and
   * inert is precisely the failure this page exists to prevent.
   */
  const retired = useMemo(() => query.data?.retired ?? {}, [query.data?.retired]);

  /**
   * Rows already in the table that the registry does not describe — the seed
   * flag, or a key from an older build. Rendering them read-only is the honest
   * option: hiding them would make the page look like the whole truth while
   * quietly concealing live configuration.
   */
  const unknown = useMemo<UnknownSetting[]>(() => {
    if (!stored) return [];
    return Object.entries(stored)
      .filter(([key]) => !isKnownSetting(key))
      .map(([key, value]) => ({ key, value }));
  }, [stored]);

  // There is deliberately no effect copying `stored` into state. `valueOf`
  // falls through to the server value whenever the operator has not typed in a
  // field, so a background refetch updates untouched fields and cannot stamp on
  // an edit in progress — which is what a seeding effect would do.
  function valueOf(def: SettingDef): string {
    if (edits[def.key] !== undefined) return edits[def.key];
    return stored?.[def.key] ?? '';
  }

  function errorOf(def: SettingDef): string | null {
    if (!touched[def.key]) return null;
    return validateSetting(def, valueOf(def));
  }

  const changed = useMemo(() => {
    const out: Record<string, string> = {};
    for (const def of ALL_SETTINGS) {
      const next = edits[def.key];
      if (next === undefined) continue;
      const current = stored?.[def.key] ?? '';
      if (next.trim() !== current.trim()) out[def.key] = next.trim();
    }
    return out;
  }, [edits, stored]);

  const changedKeys = Object.keys(changed);
  const invalid = ALL_SETTINGS.filter((d) => edits[d.key] !== undefined && validateSetting(d, valueOf(d)));

  function submit() {
    if (changedKeys.length === 0) return;
    if (invalid.length > 0) {
      setTouched(Object.fromEntries(ALL_SETTINGS.map((d) => [d.key, true])));
      toast.error('راجع الحقول المميزة بالأحمر');
      return;
    }
    save.mutate(changed, {
      onSuccess: () => {
        toast.success(`تم حفظ ${changedKeys.length} إعداد`);
        setEdits({});
        setTouched({});
      },
      onError: (err) => toast.error(parseApiError(err).messageAr),
    });
  }

  const actions = writable ? (
    <>
      <Button
        variant="outlined"
        color="inherit"
        startIcon={<RestartAltRounded />}
        onClick={() => { setEdits({}); setTouched({}); }}
        disabled={changedKeys.length === 0 || save.isPending}
      >
        تراجع
      </Button>
      <Button
        onClick={submit}
        disabled={changedKeys.length === 0 || save.isPending}
        sx={{ minWidth: 150 }}
      >
        {save.isPending
          ? <CircularProgress size={18} color="inherit" />
          : `حفظ التغييرات${changedKeys.length ? ` (${changedKeys.length})` : ''}`}
      </Button>
    </>
  ) : null;

  return (
    <>
      <PageHeader
        title="إعدادات التطبيق"
        description="قيم تشغيلية مخزّنة في قاعدة البيانات. مفاتيح المزوّدين ليست هنا — انظر صفحات التكامل."
        icon={<SettingsRounded />}
        actions={actions}
      />

      {!writable && (
        <Alert severity="info">
          يمكنك عرض الإعدادات فقط. التعديل متاح لدور «مدير عام».
        </Alert>
      )}

      {query.isError ? (
        <ErrorState error={query.error} variant="block" onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <Stack gap={3}>
          {SETTING_GROUPS.map((g) => (
            <SectionCard key={g.id} title={g.labelAr} description={g.description}>
              <FormSkeleton fields={g.settings.length} />
            </SectionCard>
          ))}
        </Stack>
      ) : (
        <Stack gap={3}>
          {SETTING_GROUPS.map((group) => (
            <SectionCard key={group.id} title={group.labelAr} description={group.description}>
              <Stack gap={3}>
                {group.settings.map((def) => {
                  const isRetired = def.key in retired;
                  // Retired wins over wired. `free_daily_question_limit` is
                  // still parsed by appSettings.js (the shim that keeps a
                  // rolled-back backend booting reads it), so it is in BOTH
                  // lists — badging it "مفعّل" would be exactly the lie the
                  // retired list exists to prevent.
                  const isLive = !isRetired && wired.has(def.key);
                  const err = errorOf(def);
                  const isDirty = changed[def.key] !== undefined;

                  return (
                    <Box key={def.key}>
                      <Stack
                        direction="row"
                        alignItems="center"
                        gap={1}
                        sx={{ mb: 1, flexWrap: 'wrap' }}
                      >
                        <Typography variant="subtitle2">{def.labelAr}</Typography>
                        {isRetired ? (
                          <StatusChip
                            kind="custom"
                            value="retired"
                            label="متوقف"
                            tone="neutral"
                            tooltip={retired[def.key]}
                          />
                        ) : isLive ? (
                          <StatusChip kind="custom" value="live" label="مفعّل" tone="success" />
                        ) : (
                          <StatusChip
                            kind="custom"
                            value="not-wired"
                            label="لا يقرأها التطبيق بعد"
                            tone="warning"
                            tooltip={def.effectNote}
                          />
                        )}
                        {isDirty && (
                          <StatusChip kind="custom" value="dirty" label="غير محفوظ" tone="info" />
                        )}
                      </Stack>

                      <TextField
                        value={valueOf(def)}
                        placeholder={def.defaultValue}
                        onChange={(e) => setEdits((p) => ({ ...p, [def.key]: e.target.value }))}
                        onBlur={() => setTouched((p) => ({ ...p, [def.key]: true }))}
                        disabled={!writable || save.isPending || isRetired}
                        error={Boolean(err)}
                        multiline={def.type === 'multiline'}
                        minRows={def.type === 'multiline' ? 2 : undefined}
                        inputProps={
                          def.type === 'int'
                            ? { inputMode: 'numeric', dir: 'ltr', style: { textAlign: 'start' } }
                            : undefined
                        }
                        helperText={err ?? def.help}
                      />

                      <Stack direction="row" gap={1.5} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                        {isRetired ? (
                          <Typography variant="caption" color="text.secondary">
                            {def.effectNote ?? retired[def.key]}
                          </Typography>
                        ) : (
                          !isLive && def.effectNote && (
                            <Typography variant="caption" color="warning.main">
                              {def.effectNote}
                            </Typography>
                          )
                        )}
                        {updatedAt?.[def.key] && (
                          <Typography variant="caption" color="text.disabled" component="span">
                            آخر تحديث: <RelativeTime value={updatedAt[def.key]} variant="caption" />
                          </Typography>
                        )}
                        {stored?.[def.key] === undefined && (
                          <Typography variant="caption" color="text.disabled">
                            لم تُحفظ بعد — التطبيق يستخدم القيمة الافتراضية {def.defaultValue}
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </SectionCard>
          ))}

          {unknown.length > 0 && (
            <SectionCard
              title="مفاتيح غير معروفة"
              description="موجودة في قاعدة البيانات ولا تصفها هذه اللوحة. تُعرض للاطّلاع فقط."
            >
              <Alert severity="warning" sx={{ mb: 2 }}>
                <AlertTitle>لماذا تظهر هنا؟</AlertTitle>
                هذه صفوف في جدول app_settings كتبها إصدار أقدم أو سكربت تهيئة. إخفاؤها كان
                سيجعل هذه الصفحة تبدو كأنها كل الإعدادات.
              </Alert>
              <Stack gap={2}>
                {unknown.map((row) => (
                  <TextField
                    key={row.key}
                    label={row.key}
                    value={row.value}
                    disabled
                    multiline={row.value.length > 60}
                    InputProps={{ readOnly: true }}
                    inputProps={{ dir: 'ltr', style: { textAlign: 'start' } }}
                  />
                ))}
              </Stack>
            </SectionCard>
          )}
        </Stack>
      )}
    </>
  );
}
