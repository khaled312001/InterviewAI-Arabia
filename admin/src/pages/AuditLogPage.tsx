import { StubPage } from './StubPage';

export function AuditLogPage() {
  return (
    <StubPage
      title="سجل التدقيق"
      description="من فعل ماذا ومتى"
      blockedBy="جدول AdminAuditLog موجود لكن لا يكتب فيه أي كود بعد — يحتاج كاتبًا في الخادم ونقطة GET /admin/audit."
    />
  );
}
