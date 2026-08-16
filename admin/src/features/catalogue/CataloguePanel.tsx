import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import { ErrorState } from '../../components/common/ErrorState';
import { Money } from '../../components/common/Money';
import { Mono } from '../../components/common/Mono';
import { Num } from '../../components/common/Num';
import { SectionCard } from '../../components/common/SectionCard';
import { FormSkeleton } from '../../components/common/Skeletons';
import { StatusChip } from '../../components/common/StatusChip';
import { useCatalogue } from './api';
import { isPack, type CataloguePlan } from './types';

/**
 * The live price list.
 *
 * Every figure on this card is read from GET /api/payments/config, which is the
 * same response the mobile paywall renders. Nothing is transcribed: a panel
 * that hardcodes "١٠٠ ج.م" is a panel that keeps saying ١٠٠ after the price
 * changes, and the operator answering a pricing question would be reading a
 * number no customer was ever shown.
 */
export function CataloguePanel() {
  const query = useCatalogue();
  const plans = query.data?.plans ?? [];
  const packs = plans.filter(isPack);
  const subs = plans.filter((p) => !isPack(p));

  return (
    <SectionCard
      title="الباقات والأسعار"
      description="ما يستطيع العميل شراءه فعليًا الآن — مقروءًا من نفس المصدر الذي يقرأه التطبيق."
      disablePadding
    >
      <Box sx={{ p: { xs: 2, md: 2.5 } }}>
        {query.isError ? (
          <ErrorState
            error={query.error}
            variant="block"
            onRetry={() => void query.refetch()}
            description="تعذّر قراءة قائمة الأسعار. الأرقام لا تُعرض من الذاكرة حتى لا تُقرأ قيمة قديمة على أنها الحالية."
          />
        ) : query.isLoading ? (
          <FormSkeleton fields={3} />
        ) : (
          <Stack gap={2.5}>
            <GatewayNotice enabled={query.data?.enabled ?? false} mock={query.data?.mock ?? false} />

            <TrialNotice minutes={query.data?.trial?.minutes} />

            {packs.length > 0 && (
              <PlanTable
                heading="باقات الدقائق"
                note="تُشترى في أي وقت، وتتراكم، ولا تنتهي صلاحيتها."
                plans={packs}
              />
            )}

            {subs.length > 0 && (
              <PlanTable
                heading="الاشتراكات"
                note="رصيد شهري يتجدّد كل ٣٠ يومًا ولا يُرحَّل ما تبقّى منه، بالإضافة إلى الأقسام المميزة."
                plans={subs}
              />
            )}

            <Typography variant="caption" color="text.secondary">
              الخطة السنوية لم تعد معروضة للبيع. الاشتراكات السنوية القديمة ما زالت تعمل حتى تاريخ
              انتهائها وتظهر باسم «سنوي (متوقف)».
            </Typography>
          </Stack>
        )}
      </Box>
    </SectionCard>
  );
}

/**
 * The gateway's actual state, stated at the top of the price list.
 *
 * Without it the card reads as a shop. EasyKash has no credentials in this
 * deployment, so `enabled` is false and every price here is currently
 * unpurchasable — the operator has to know that before quoting one.
 */
function GatewayNotice({ enabled, mock }: { enabled: boolean; mock: boolean }) {
  if (mock) {
    return (
      <Alert severity="warning">
        <AlertTitle>بوابة الدفع في وضع المحاكاة</AlertTitle>
        العمليات تكتمل بدون تحصيل فعلي، والمدفوعات المسجّلة الآن ليست أموالًا حقيقية.
      </Alert>
    );
  }
  if (!enabled) {
    return (
      <Alert severity="info">
        <AlertTitle>الدفع الإلكتروني غير مفعّل</AlertTitle>
        لم تُضبط بيانات اعتماد EasyKash بعد، فلا يمكن شراء أي من هذه الباقات من التطبيق. حتى ذلك
        الحين تُباع الدقائق خارج المنصّة وتُضاف يدويًا من صفحة المستخدم.
      </Alert>
    );
  }
  return (
    <Alert severity="success">
      بوابة الدفع مفعّلة — هذه الباقات معروضة للشراء في التطبيق الآن.
    </Alert>
  );
}

/**
 * The free trial, beside the prices it is compared against.
 *
 * It is the one figure on this screen the operator can actually change —
 * `free_trial_seconds` is an app_settings row, editable without a deploy, and
 * zeroing it is the anti-farming kill switch. Read from the same response as
 * the prices, so the panel cannot quote a trial length that stopped being true
 * the last time someone touched the settings page.
 */
function TrialNotice({ minutes }: { minutes?: number }) {
  if (minutes === undefined) return null;
  if (minutes <= 0) {
    return (
      <Alert severity="warning">
        <AlertTitle>التجربة المجانية متوقفة</AlertTitle>
        الحساب الجديد يبدأ برصيد صفر ولا يستطيع بدء أي مقابلة قبل الشراء. تُضبط المدة من صفحة
        الإعدادات — «مدة التجربة المجانية».
      </Alert>
    );
  }
  return (
    <Typography variant="caption" color="text.secondary">
      التجربة المجانية الحالية: <Num value={minutes} variant="caption" /> دقيقة تُمنح مرة واحدة لكل
      حساب، ولا تنتهي صلاحيتها. تُضبط من صفحة الإعدادات.
    </Typography>
  );
}

function PlanTable({ heading, note, plans }: { heading: string; note: string; plans: CataloguePlan[] }) {
  return (
    <Box>
      <Typography variant="subtitle2">{heading}</Typography>
      <Typography variant="caption" color="text.secondary">
        {note}
      </Typography>
      <Box sx={{ overflowX: 'auto', mt: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>الباقة</TableCell>
              <TableCell>الكود</TableCell>
              <TableCell>السعر</TableCell>
              <TableCell>الدقائق</TableCell>
              <TableCell>سعر الدقيقة</TableCell>
              <TableCell>ملاحظات</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.code}>
                <TableCell>
                  <Stack direction="row" gap={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                    <Typography variant="body2">{plan.labelAr}</Typography>
                    {plan.popular && (
                      <StatusChip kind="custom" value="popular" label="الأكثر شيوعًا" tone="gold" />
                    )}
                  </Stack>
                </TableCell>
                <TableCell>
                  <Mono value={plan.code} variant="caption" />
                </TableCell>
                <TableCell>
                  <Money amount={plan.amountCents} unit="minor" currency="EGP" variant="body2" />
                </TableCell>
                <TableCell>
                  <Num value={plan.minutes} variant="body2" />
                </TableCell>
                <TableCell>
                  <Money
                    amount={plan.pricePerMinuteEgp}
                    unit="major"
                    currency="EGP"
                    variant="body2"
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {isPack(plan) ? (
                      'لا تنتهي صلاحيتها'
                    ) : (
                      <>
                        <Num value={plan.minutesPerMonth} variant="caption" /> دقيقة في الدورة
                        الشهرية ·{' '}
                        {plan.savingPct > 0 ? (
                          <>
                            توفير <Num value={plan.savingPct} variant="caption" />٪ عن الشهري
                          </>
                        ) : (
                          'السعر المرجعي'
                        )}
                      </>
                    )}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}
