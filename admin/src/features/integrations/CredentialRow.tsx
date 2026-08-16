import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import BoltRounded from '@mui/icons-material/BoltRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';

import { Mono } from '../../components/common/Mono';
import { RelativeTime } from '../../components/common/RelativeTime';
import { StatusChip } from '../../components/common/StatusChip';
import { useToast } from '../../components/common/ToastProvider';
import { parseApiError } from '../../lib/errors';
import { probeMessage, useTestCredential, type Credential, type ProbeResult } from './api';
import { copyFor } from './registry';
import type { CredentialDrawerMode } from './CredentialDrawer';

export interface CredentialRowProps {
  credential: Credential;
  onEdit: (credential: Credential, mode: CredentialDrawerMode) => void;
  /** False for a read-only viewer; every write control is hidden, not disabled. */
  writable: boolean;
}

export function CredentialRow({ credential, onEdit, writable }: CredentialRowProps) {
  const toast = useToast();
  const test = useTestCredential();
  const [probe, setProbe] = useState<ProbeResult | null>(null);

  const copy = copyFor(credential.key);
  const isStored = credential.source === 'db';

  function runTest() {
    // No value in the body: this tests whatever the server is actually using,
    // which is the question an operator has on this screen.
    test.mutate(
      { key: credential.key },
      {
        onSuccess: setProbe,
        onError: (err) => {
          setProbe(null);
          toast.error(parseApiError(err).messageAr);
        },
      },
    );
  }

  const probeInfo = probe ? probeMessage(probe) : null;

  return (
    <Box
      sx={{
        paddingBlock: 2,
        borderBlockEnd: '1px solid',
        borderColor: 'divider',
        '&:last-of-type': { borderBlockEnd: 0, paddingBlockEnd: 0 },
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ md: 'flex-start' }}
        gap={2}
      >
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ flexWrap: 'wrap' }}>
            <Typography variant="subtitle2">{copy.labelAr}</Typography>
            <StatusChip kind="source" value={credential.source} />
            {credential.secret && (
              <StatusChip
                kind="custom"
                value="secret"
                label="سرّي"
                tone="neutral"
                tooltip="لا يُعاد من الخادم أبدًا"
              />
            )}
          </Stack>

          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.25 }}>
            <Mono value={credential.key} variant="caption" />
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {copy.help}
          </Typography>

          <Stack direction="row" gap={2} sx={{ mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <CurrentValue credential={credential} />

            {credential.updatedAt && (
              <Typography variant="caption" color="text.disabled">
                عُدّلت <RelativeTime value={credential.updatedAt} variant="caption" />
                {credential.updatedByName ? ` بواسطة ${credential.updatedByName}` : ''}
              </Typography>
            )}
          </Stack>
        </Box>

        {writable && (
          <Stack
            direction="row"
            gap={1}
            sx={{ flexShrink: 0, flexWrap: 'wrap', width: { xs: '100%', md: 'auto' } }}
          >
            {credential.testable && credential.isSet && (
              <Button
                size="small"
                variant="text"
                color="inherit"
                startIcon={test.isPending ? <CircularProgress size={14} /> : <BoltRounded />}
                onClick={runTest}
                disabled={test.isPending}
              >
                اختبار
              </Button>
            )}
            <Button size="small" variant="outlined" onClick={() => onEdit(credential, 'set')}>
              {credential.isSet ? 'تغيير' : 'تعيين'}
            </Button>
            {/* Only a DB row can be cleared — an env value is not ours to delete. */}
            {isStored && (
              <Button
                size="small"
                variant="text"
                color="error"
                startIcon={<DeleteOutlineRounded />}
                onClick={() => onEdit(credential, 'clear')}
              >
                مسح
              </Button>
            )}
          </Stack>
        )}
      </Stack>

      {probeInfo && (
        <Alert severity={probeInfo.severity} sx={{ mt: 1.5 }} onClose={() => setProbe(null)}>
          {probeInfo.text}
        </Alert>
      )}
    </Box>
  );
}

/**
 * What is installed right now. A secret shows only its tail; non-secret config
 * shows in the clear because the owner needs to be able to read it back.
 */
function CurrentValue({ credential }: { credential: Credential }) {
  if (credential.source === 'error') {
    return (
      <Typography variant="caption" color="error.main">
        القيمة المحفوظة غير قابلة لفك التشفير — أعد إدخالها.
      </Typography>
    );
  }

  if (!credential.isSet) {
    return (
      <Typography variant="caption" color="warning.main">
        غير مضبوط
      </Typography>
    );
  }

  if (credential.secret) {
    return (
      <Typography variant="caption" color="text.secondary" component="span">
        ينتهي بـ <Mono value={credential.last4 ? `••••${credential.last4}` : '••••'} variant="caption" />
      </Typography>
    );
  }

  if (credential.type === 'boolean') {
    return <StatusChip kind="active" value={credential.value === 'true'} />;
  }

  return <Mono value={credential.value} maxChars={44} variant="caption" />;
}
