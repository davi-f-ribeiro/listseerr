import { createContext } from 'react';
import type { SerializedUser } from 'shared/application/dtos';

export interface AuthContextValue {
  user: SerializedUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True when in-app auth is disabled server-side (external/reverse-proxy auth) */
  authDisabled: boolean;
  login: (token: string, user: SerializedUser, rememberMe: boolean) => void;
  logout: () => Promise<void>;
  sessionToken: string | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
