import ConstructionRounded from '@mui/icons-material/ConstructionRounded';
import { EmptyState } from '../components/common/EmptyState';
import { PageHeader } from '../components/common/PageHeader';
import { SectionCard } from '../components/common/SectionCard';

export interface StubPageProps {
  title: string;
  description?: string;
  /** What has to land before this page can show anything real. */
  blockedBy?: string;
}

/**
 * A route that exists so links do not 404 while the page is being built. It
 * shows nothing that looks like data — an unbuilt page must not be mistaken
 * for an empty one.
 */
export function StubPage({ title, description, blockedBy }: StubPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <SectionCard>
        <EmptyState
          icon={<ConstructionRounded />}
          title="هذه الصفحة قيد الإنشاء"
          description={blockedBy ?? 'سيتم تفعيلها في التحديث القادم.'}
        />
      </SectionCard>
    </>
  );
}
