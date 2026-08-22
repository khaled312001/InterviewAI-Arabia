import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { SessionBoot } from './components/layout/SessionBoot';
import { RequireRole } from './components/common/Guard';
import { isEnabled } from './lib/flags';
import type { AdminRole } from './store/auth';

import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { QuestionsPage } from './pages/QuestionsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { AIUsagePage } from './pages/AIUsagePage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PaymentsIntegrationPage } from './pages/PaymentsIntegrationPage';
import { AiIntegrationPage } from './pages/AiIntegrationPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PushIntegrationPage } from './pages/PushIntegrationPage';
import { AdminsPage } from './pages/AdminsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { NotFoundPage } from './pages/NotFoundPage';

const ALL: AdminRole[] = ['super_admin', 'moderator', 'content_editor'];

/** Same roles arrays as navConfig, so nav visibility and route access agree. */
function guard(roles: AdminRole[], element: React.ReactNode) {
  return <RequireRole roles={roles}>{element}</RequireRole>;
}

/** A flagged-off page is unreachable, not a stub full of invented numbers. */
function flagged(flag: string, element: React.ReactNode) {
  return isEnabled(flag) ? element : <Navigate to="/404" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <SessionBoot>
            <AppShell />
          </SessionBoot>
        }
      >
        <Route path="/" element={guard(ALL, <DashboardPage />)} />
        <Route path="/analytics" element={guard(ALL, <AnalyticsPage />)} />

        <Route path="/users" element={guard(ALL, <UsersPage />)} />
        <Route path="/users/:id" element={guard(ALL, <UserDetailPage />)} />

        <Route path="/questions" element={guard(['super_admin', 'content_editor'], <QuestionsPage />)} />
        <Route path="/categories" element={guard(ALL, <CategoriesPage />)} />

        <Route path="/subscriptions" element={guard(['super_admin'], <SubscriptionsPage />)} />
        <Route path="/payments" element={guard(['super_admin'], <PaymentsPage />)} />

        {/* Sending reaches every install at once, so it is super_admin only —
            the same role the backend requires on every /admin/push route. */}
        <Route path="/notifications" element={guard(['super_admin'], <NotificationsPage />)} />

        <Route path="/ai-usage" element={guard(ALL, <AIUsagePage />)} />
        <Route path="/reports" element={guard(['super_admin', 'moderator'], <ReportsPage />)} />

        <Route path="/settings" element={guard(ALL, <SettingsPage />)} />
        <Route
          path="/integrations/payments"
          element={guard(['super_admin'], <PaymentsIntegrationPage />)}
        />
        <Route
          path="/integrations/ai"
          element={guard(['super_admin'], <AiIntegrationPage />)}
        />
        <Route
          path="/integrations/push"
          element={guard(['super_admin'], <PushIntegrationPage />)}
        />
        <Route path="/admins" element={guard(['super_admin'], <AdminsPage />)} />
        {/* No longer flagged: GET /admin/audit exists and middleware/auditLog.js
            writes a row for every successful admin mutation. */}
        <Route path="/audit" element={guard(['super_admin'], <AuditLogPage />)} />

        <Route path="/403" element={<ForbiddenPage />} />
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
