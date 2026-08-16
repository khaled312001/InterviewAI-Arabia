import { useParams } from 'react-router-dom';
import { StubPage } from './StubPage';

export function UserDetailPage() {
  const { id } = useParams();
  return (
    <StubPage
      title="تفاصيل المستخدم"
      description={id ? `المستخدم رقم ${id}` : undefined}
      blockedBy="ستعرض الجلسات والخطة الفعلية ومنطقة الحذف — الاعتماد على GET /admin/users/:id/sessions الموجود بالفعل."
    />
  );
}
