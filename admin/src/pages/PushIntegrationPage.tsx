import { IntegrationPage } from '../features/integrations/IntegrationPage';
import { PUSH_PAGE } from '../features/integrations/registry';

export function PushIntegrationPage() {
  return <IntegrationPage spec={PUSH_PAGE} />;
}
