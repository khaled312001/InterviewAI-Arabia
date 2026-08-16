import { StubPage } from './StubPage';

export function PaymentsIntegrationPage() {
  return (
    <StubPage
      title="تكامل الدفع"
      description="بيانات اعتماد EasyKash"
      blockedBy="يحتاج جدول provider_credentials وتشفير AES-256-GCM ونقاط /admin/integrations."
    />
  );
}
