import { api } from '../../api/client';

/** The desktop app's plan, as its server reports it. */
export interface DesktopSubscription {
  plan: string;
  planLabel: string;
  state: 'active' | 'exhausted' | 'expired' | 'cancelled';
  answersTotal: number;
  answersUsed: number;
  answersLeft: number;
  startsAt: string;
  endsAt: string;
}

export interface DesktopStatus {
  /** False when the server is not set up to reach the desktop service. */
  available: boolean;
  linked?: boolean;
  /** How the link was proved: the desktop password, or a Google-verified email. */
  via?: 'password' | 'google' | null;
  email?: string | null;
  exists?: boolean;
  approved?: boolean;
  banned?: boolean;
  subscription?: DesktopSubscription | null;
  /** The desktop service did not answer this time. */
  unreachable?: boolean;
  downloadPath: string;
  pricingPath: string;
}

export const accountApi = {
  desktop: () => api.get<DesktopStatus>('/account/desktop').then((r) => r.data),
  linkDesktop: (email: string, password: string) =>
    api.post<DesktopStatus>('/account/desktop/link', { email, password }).then((r) => r.data),
  unlinkDesktop: () => api.delete('/account/desktop/link').then((r) => r.data),
};

export const WEBSITE_URL = 'https://interprova.com';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.interprova.app';
