export interface RouteMeta {
  /** Path pattern; ':param' matches a single segment. */
  pattern: string;
  titleAr: string;
  parent?: string;
}

/** Ordered most-specific first — the first match wins. */
export const routeMeta: RouteMeta[] = [
  { pattern: '/users/:id', titleAr: 'تفاصيل المستخدم', parent: '/users' },
  { pattern: '/integrations/payments', titleAr: 'تكامل الدفع', parent: '/settings' },
  { pattern: '/integrations/ai', titleAr: 'تكامل الذكاء الاصطناعي', parent: '/settings' },
  { pattern: '/integrations/push', titleAr: 'تكامل الإشعارات', parent: '/settings' },
  { pattern: '/analytics', titleAr: 'التحليلات' },
  { pattern: '/users', titleAr: 'المستخدمون' },
  { pattern: '/questions', titleAr: 'الأسئلة' },
  { pattern: '/categories', titleAr: 'الأقسام' },
  { pattern: '/subscriptions', titleAr: 'الاشتراكات' },
  { pattern: '/payments', titleAr: 'المدفوعات' },
  { pattern: '/notifications', titleAr: 'الإشعارات' },
  { pattern: '/ai-usage', titleAr: 'استخدام الذكاء الاصطناعي' },
  { pattern: '/reports', titleAr: 'البلاغات' },
  { pattern: '/settings', titleAr: 'الإعدادات' },
  { pattern: '/admins', titleAr: 'المدراء' },
  { pattern: '/audit', titleAr: 'سجل التدقيق' },
  { pattern: '/403', titleAr: 'غير مصرّح' },
  { pattern: '/', titleAr: 'اللوحة الرئيسية' },
];

function matches(pattern: string, pathname: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const s = pathname.split('/').filter(Boolean);
  if (p.length !== s.length) return false;
  return p.every((seg, i) => seg.startsWith(':') || seg === s[i]);
}

export function findRouteMeta(pathname: string): RouteMeta | undefined {
  return routeMeta.find((m) => matches(m.pattern, pathname));
}

export interface Crumb {
  labelAr: string;
  to?: string;
}

/** Max 3 crumbs; the last one is the current page and is never a link. */
export function buildCrumbs(pathname: string): Crumb[] {
  const current = findRouteMeta(pathname);
  if (!current || current.pattern === '/') {
    return [{ labelAr: 'اللوحة الرئيسية' }];
  }

  const crumbs: Crumb[] = [{ labelAr: 'الرئيسية', to: '/' }];
  if (current.parent) {
    const parent = routeMeta.find((m) => m.pattern === current.parent);
    if (parent) crumbs.push({ labelAr: parent.titleAr, to: parent.pattern });
  }
  crumbs.push({ labelAr: current.titleAr });
  return crumbs.slice(-3);
}
