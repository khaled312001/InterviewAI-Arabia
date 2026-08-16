import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';

export interface SettingsResponse {
  settings: Record<string, string>;
  updatedAt: Record<string, string | null>;
  /**
   * Keys the backend actually reads at runtime, from
   * services/appSettings.js WIRED_KEYS. The page badges everything else
   * "لا يقرأها التطبيق بعد" — sourcing the list from the server is what stops
   * the badge from lying after someone wires a key up and forgets the UI.
   */
  wired: string[];
  /**
   * Keys the backend USED to read and no longer does, mapped to why
   * (services/appSettings.js RETIRED_KEYS). They are listed rather than deleted
   * so the row can be badged "متوقف" instead of silently disappearing — an
   * operator who set `free_daily_question_limit` last month needs to be told it
   * stopped mattering, not to find the field gone.
   */
  retired?: Record<string, string>;
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: qk.settings.all(),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<SettingsResponse>('/admin/settings', { signal });
      return data;
    },
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    // Only the changed keys are sent: PUT upserts, so posting the whole form
    // would stamp an `updated_at` on every row and make the audit trail useless
    // for working out what an operator actually touched.
    mutationFn: async (changed: Record<string, string>) => {
      const { data } = await api.put('/admin/settings', changed);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.settings.all() });
    },
  });
}
