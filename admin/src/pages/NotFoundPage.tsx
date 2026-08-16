import Button from '@mui/material/Button';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { EmptyState } from '../components/common/EmptyState';
import { Mono } from '../components/common/Mono';

/** Replaces the old silent <Navigate to="/">, which hid every typo. */
export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <EmptyState
      title="الصفحة غير موجودة"
      description="تحقق من الرابط، أو ارجع إلى اللوحة الرئيسية."
      secondaryAction={<Mono value={pathname} />}
      action={
        <Button component={RouterLink} to="/">
          اللوحة الرئيسية
        </Button>
      }
    />
  );
}
