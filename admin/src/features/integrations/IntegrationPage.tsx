import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import LockOutlined from '@mui/icons-material/LockOutlined';

import { PageHeader } from '../../components/common/PageHeader';
import { SectionCard } from '../../components/common/SectionCard';
import { ErrorState } from '../../components/common/ErrorState';
import { EmptyState } from '../../components/common/EmptyState';
import { ListSkeleton } from '../../components/common/Skeletons';
import { can } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import { useIntegrationsQuery, type Credential } from './api';
import { CredentialRow } from './CredentialRow';
import { CredentialDrawer, type CredentialDrawerMode } from './CredentialDrawer';
import type { IntegrationPageSpec } from './registry';

export interface IntegrationPageProps {
  spec: IntegrationPageSpec;
}

/**
 * Both integration pages are this component with a different spec, so EasyKash
 * and the AI providers cannot drift into looking like two different products —
 * and a fix to the credential flow lands on both at once.
 */
export function IntegrationPage({ spec }: IntegrationPageProps) {
  const role = useAuth((s) => s.admin?.role);
  const writable = can(role, 'integrations.write');

  const query = useIntegrationsQuery();
  const [target, setTarget] = useState<{ credential: Credential; mode: CredentialDrawerMode } | null>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, Credential>();
    for (const c of query.data?.credentials ?? []) map.set(c.key, c);
    return map;
  }, [query.data?.credentials]);

  /**
   * Keys the backend returned for this group that no section lists. Rendering
   * them in their own card is the honest default — a credential that quietly
   * vanished from the UI is how a live key goes unaudited.
   */
  const unlisted = useMemo(() => {
    const listed = new Set(spec.sections.flatMap((s) => s.keys));
    return (query.data?.credentials ?? []).filter((c) => c.group === spec.group && !listed.has(c.key));
  }, [query.data?.credentials, spec]);

  const groupCredentials = (query.data?.credentials ?? []).filter((c) => c.group === spec.group);
  const missingCount = groupCredentials.filter((c) => !c.isSet).length;
  const brokenCount = groupCredentials.filter((c) => c.source === 'error').length;

  function openDrawer(credential: Credential, mode: CredentialDrawerMode) {
    setTarget({ credential, mode });
  }

  return (
    <>
      <PageHeader
        title={spec.titleAr}
        description={spec.descriptionAr}
        icon={<LockOutlined />}
        actions={
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<RefreshRounded />}
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            تحديث
          </Button>
        }
      />

      {spec.noteAr && <Alert severity="info">{spec.noteAr}</Alert>}

      {!writable && (
        <Alert severity="info">
          هذه الصفحة للعرض فقط بدورك الحالي. تعديل بيانات الاعتماد متاح لدور «مدير عام».
        </Alert>
      )}

      {query.isError ? (
        <ErrorState error={query.error} variant="block" onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <Stack gap={3}>
          {spec.sections.map((s) => (
            <SectionCard key={s.id} title={s.labelAr} description={s.description}>
              <ListSkeleton rows={s.keys.length} />
            </SectionCard>
          ))}
        </Stack>
      ) : (
        <Stack gap={3}>
          {query.data && !query.data.cryptoAvailable && (
            <Alert severity="error">
              <AlertTitle>التشفير غير مهيّأ على الخادم</AlertTitle>
              لا يمكن حفظ أي قيمة سرّية حتى يُضبط CREDENTIALS_SECRET (أو JWT_SECRET بطول ٣٢ حرفًا
              على الأقل) في ملف البيئة. الإعدادات غير السرّية تعمل بشكل طبيعي.
            </Alert>
          )}

          {brokenCount > 0 && (
            <Alert severity="error">
              <AlertTitle>قيم محفوظة غير قابلة للقراءة</AlertTitle>
              {brokenCount} من القيم المحفوظة لا يمكن فك تشفيرها — غالبًا لأن مفتاح التشفير تغيّر.
              الخادم لا يستخدمها ولا يعود إلى ملف البيئة بدلًا منها؛ أعد إدخالها.
            </Alert>
          )}

          {missingCount > 0 && (
            <Alert severity="warning">
              {missingCount} من الإعدادات غير مضبوطة. راجع الحقول الموسومة «غير مضبوط» أدناه.
            </Alert>
          )}

          {groupCredentials.length === 0 ? (
            <SectionCard>
              <EmptyState
                title="لا توجد إعدادات لهذا التكامل"
                description="لم يُرجع الخادم أي مفتاح ضمن هذه المجموعة. تأكد من تحديث نسخة الخادم."
              />
            </SectionCard>
          ) : (
            <>
              {spec.sections.map((section) => {
                const rows = section.keys.map((k) => byKey.get(k)).filter(Boolean) as Credential[];
                if (rows.length === 0) return null;
                return (
                  <SectionCard key={section.id} title={section.labelAr} description={section.description}>
                    {rows.map((credential) => (
                      <CredentialRow
                        key={credential.key}
                        credential={credential}
                        onEdit={openDrawer}
                        writable={writable}
                      />
                    ))}
                  </SectionCard>
                );
              })}

              {unlisted.length > 0 && (
                <SectionCard
                  title="مفاتيح إضافية"
                  description="يعرفها الخادم ولا تصفها هذه اللوحة بعد."
                >
                  {unlisted.map((credential) => (
                    <CredentialRow
                      key={credential.key}
                      credential={credential}
                      onEdit={openDrawer}
                      writable={writable}
                    />
                  ))}
                </SectionCard>
              )}
            </>
          )}
        </Stack>
      )}

      <CredentialDrawer
        credential={target?.credential ?? null}
        mode={target?.mode ?? 'set'}
        onClose={() => setTarget(null)}
      />
    </>
  );
}
