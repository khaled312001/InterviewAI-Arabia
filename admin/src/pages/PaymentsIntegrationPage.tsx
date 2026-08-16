import { IntegrationPage } from '../features/integrations/IntegrationPage';
import { PAYMENTS_PAGE } from '../features/integrations/registry';

export function PaymentsIntegrationPage() {
  return <IntegrationPage spec={PAYMENTS_PAGE} />;
}
