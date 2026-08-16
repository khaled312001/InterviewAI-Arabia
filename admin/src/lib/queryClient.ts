import { QueryClient, MutationCache } from '@tanstack/react-query';
import { parseApiError } from './errors';
import { emitToast } from './toastBus';

export const queryClient = new QueryClient({
  // A mutation that fails must never fail silently. Pages can still add their
  // own onError; this is the floor, not the ceiling.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.onError) return; // page handles it explicitly
      emitToast({ message: parseApiError(error).messageAr, severity: 'error' });
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
