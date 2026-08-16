import { StubPage } from './StubPage';

export function AiIntegrationPage() {
  return (
    <StubPage
      title="تكامل الذكاء الاصطناعي"
      description="مزودو النماذج ومفاتيحهم"
      blockedBy="يحتاج جدول provider_credentials وتشفير AES-256-GCM ونقاط /admin/integrations."
    />
  );
}
