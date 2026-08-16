import { StubPage } from './StubPage';

export function PaymentsPage() {
  return (
    <StubPage
      title="المدفوعات"
      description="عمليات الدفع عبر EasyKash"
      blockedBy="يحتاج نقطة نهاية GET /api/admin/payments — لا توجد في الخادم بعد."
    />
  );
}
