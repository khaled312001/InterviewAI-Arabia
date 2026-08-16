import { IntegrationPage } from '../features/integrations/IntegrationPage';
import { AI_PAGE } from '../features/integrations/registry';

export function AiIntegrationPage() {
  return <IntegrationPage spec={AI_PAGE} />;
}
