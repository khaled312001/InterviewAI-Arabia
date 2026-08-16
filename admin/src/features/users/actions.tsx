import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useConfirm, type ConfirmOptions } from '../../components/common/ConfirmDialog';
import { Mono } from '../../components/common/Mono';
import { useDeleteUser, useSetUserDisabled } from './api';
import type { AdminUser } from './types';

/** Name over email, so a confirmation always names the account it is about. */
export function userIdentity(user: AdminUser) {
  return (
    <Stack gap={0.5}>
      <Typography variant="body2" color="text.secondary">
        {user.name}
      </Typography>
      <Mono value={user.email} />
    </Stack>
  );
}

type ConfirmCopy = Omit<ConfirmOptions, 'onConfirm'>;

/**
 * The disable/enable wording, exported so the row action and the edit drawer's
 * status switch cannot drift into telling the operator two different stories
 * about the same mutation.
 */
export function disableConfirmCopy(user: AdminUser, nextDisabled: boolean): ConfirmCopy {
  return {
    title: nextDisabled ? 'تعطيل الحساب؟' : 'إعادة تفعيل الحساب؟',
    description: userIdentity(user),
    confirmLabel: nextDisabled ? 'تعطيل' : 'تفعيل',
    tone: nextDisabled ? 'danger' : 'default',
    consequences: nextDisabled
      ? [
          'لن يتمكن المستخدم من تسجيل الدخول أو بدء جلسات جديدة',
          'تبقى جلساته وإجاباته واشتراكاته كما هي، ويمكن التراجع في أي وقت',
        ]
      : ['سيتمكن المستخدم من تسجيل الدخول واستخدام التطبيق مرة أخرى'],
  };
}

/**
 * Every line here is a real rule in the backend: the cascades are in
 * prisma/schema.prisma, and the two refusals are DELETE /admin/users/:id.
 * The financial refusal is why "تُحذف اشتراكاته وسجل مدفوعاته" is gone — the
 * server will not delete an account that has any, precisely so revenue cannot
 * disappear from the payments page with no reversing entry.
 */
export function deleteConfirmCopy(user: AdminUser): ConfirmCopy {
  return {
    title: 'حذف الحساب نهائيًا؟',
    description: userIdentity(user),
    confirmLabel: 'حذف نهائي',
    tone: 'danger',
    consequences: [
      `سيُحذف حساب ${user.email} حذفًا نهائيًا لا يمكن التراجع عنه`,
      'تُحذف معه كل الجلسات والإجابات المرتبطة بها',
      'إذا كان للحساب أي مدفوعات أو اشتراكات أو حركات رصيد فلن يُسمح بالحذف — أوقف الحساب بدلًا من ذلك',
      'إذا سبق للمستخدم إرسال بلاغ فلن يُسمح بالحذف — عطّل الحساب بدلًا من ذلك',
    ],
    requireTypedConfirmation: user.email,
  };
}

/**
 * The disable and delete flows, shared by the list and the detail page so a
 * destructive action reads identically wherever it is triggered.
 */
export function useUserActions() {
  const confirm = useConfirm();
  const setDisabled = useSetUserDisabled();
  const deleteUser = useDeleteUser();

  function toggleDisabled(user: AdminUser) {
    return confirm({
      ...disableConfirmCopy(user, !user.isDisabled),
      onConfirm: () => setDisabled.mutateAsync({ id: user.id, isDisabled: !user.isDisabled }),
    });
  }

  function remove(user: AdminUser, onDeleted?: () => void) {
    return confirm({
      ...deleteConfirmCopy(user),
      onConfirm: async () => {
        await deleteUser.mutateAsync(user.id);
        onDeleted?.();
      },
    });
  }

  return { toggleDisabled, remove };
}
