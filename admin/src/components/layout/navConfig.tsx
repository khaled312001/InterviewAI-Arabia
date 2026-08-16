import AdminPanelSettingsRounded from '@mui/icons-material/AdminPanelSettingsRounded';
import CategoryRounded from '@mui/icons-material/CategoryRounded';
import CreditCardRounded from '@mui/icons-material/CreditCardRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import InsightsRounded from '@mui/icons-material/InsightsRounded';
import PaymentsRounded from '@mui/icons-material/PaymentsRounded';
import PeopleRounded from '@mui/icons-material/PeopleRounded';
import QuestionAnswerRounded from '@mui/icons-material/QuestionAnswerRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import SmartToyRounded from '@mui/icons-material/SmartToyRounded';
import SpaceDashboardRounded from '@mui/icons-material/SpaceDashboardRounded';
import CardMembershipRounded from '@mui/icons-material/CardMembershipRounded';
import QueryStatsRounded from '@mui/icons-material/QueryStatsRounded';
import type { AdminRole } from '../../store/auth';

export interface NavItem {
  path: string;
  labelAr: string;
  icon: React.ReactNode;
  roles?: AdminRole[];
  badge?: 'unresolvedReports';
  featureFlag?: string;
  /** Exact-match only — true for the dashboard root. */
  end?: boolean;
}

export interface NavSection {
  id: string;
  labelAr: string;
  items: NavItem[];
}

const ALL: AdminRole[] = ['super_admin', 'moderator', 'content_editor'];

/**
 * The `roles` array here is reused by RequireRole on the route, so nav
 * visibility and route access cannot drift apart.
 */
export const navSections: NavSection[] = [
  {
    id: 'overview',
    labelAr: 'نظرة عامة',
    items: [
      { path: '/', labelAr: 'اللوحة الرئيسية', icon: <SpaceDashboardRounded />, roles: ALL, end: true },
      { path: '/analytics', labelAr: 'التحليلات', icon: <QueryStatsRounded />, roles: ALL },
    ],
  },
  {
    id: 'people',
    labelAr: 'المستخدمون',
    items: [{ path: '/users', labelAr: 'المستخدمون', icon: <PeopleRounded />, roles: ALL }],
  },
  {
    id: 'content',
    labelAr: 'المحتوى',
    items: [
      {
        path: '/questions',
        labelAr: 'الأسئلة',
        icon: <QuestionAnswerRounded />,
        roles: ['super_admin', 'content_editor'],
      },
      {
        path: '/categories',
        labelAr: 'الأقسام',
        icon: <CategoryRounded />,
        roles: ALL,
      },
    ],
  },
  {
    id: 'revenue',
    labelAr: 'الإيرادات',
    items: [
      {
        path: '/subscriptions',
        labelAr: 'الاشتراكات',
        icon: <CardMembershipRounded />,
        roles: ['super_admin'],
      },
      {
        path: '/payments',
        labelAr: 'المدفوعات',
        icon: <CreditCardRounded />,
        roles: ['super_admin'],
      },
    ],
  },
  {
    id: 'ai',
    labelAr: 'الذكاء الاصطناعي والإشراف',
    items: [
      { path: '/ai-usage', labelAr: 'استخدام الذكاء الاصطناعي', icon: <SmartToyRounded />, roles: ALL },
      {
        path: '/reports',
        labelAr: 'البلاغات',
        icon: <FlagRounded />,
        roles: ['super_admin', 'moderator'],
        badge: 'unresolvedReports',
      },
    ],
  },
  {
    id: 'system',
    labelAr: 'النظام',
    items: [
      { path: '/settings', labelAr: 'الإعدادات', icon: <SettingsRounded />, roles: ALL },
      {
        path: '/integrations/payments',
        labelAr: 'تكامل الدفع',
        icon: <PaymentsRounded />,
        roles: ['super_admin'],
      },
      {
        path: '/integrations/ai',
        labelAr: 'تكامل الذكاء الاصطناعي',
        icon: <InsightsRounded />,
        roles: ['super_admin'],
      },
      {
        path: '/admins',
        labelAr: 'المدراء',
        icon: <AdminPanelSettingsRounded />,
        roles: ['super_admin'],
      },
      {
        path: '/audit',
        labelAr: 'سجل التدقيق',
        icon: <HistoryRounded />,
        roles: ['super_admin'],
      },
    ],
  },
];

export const allNavItems: NavItem[] = navSections.flatMap((s) => s.items);

/**
 * '/' matches exactly; everything else also matches its children, which is
 * what keeps المستخدمون lit on /users/42.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.path;
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}
