'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api';
import type { PendingRegistration, User } from '@/lib/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string, altcha?: string) => Promise<void>;
  register: (
    email: string,
    password?: string,
    altcha?: string,
  ) => Promise<PendingRegistration>;
  resendVerification: (email: string, altcha?: string) => Promise<void>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  requestEmailLink: (email: string, altcha?: string) => Promise<void>;
  consumeMagicLink: (token: string) => Promise<void>;
  forgotPassword: (email: string, altcha?: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  changePassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  requestEmailChange: (newEmail: string, currentPassword?: string) => Promise<void>;
  confirmEmailChange: (code: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
};

type AuthAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_USER'; payload: User }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'CLEAR_USER' }
  | { type: 'CLEAR_ERROR' };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_USER':
      return {
        ...state,
        user: action.payload,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    case 'CLEAR_USER':
      return { ...state, user: null, isAuthenticated: false, isLoading: false };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const token =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('careersim.authToken')
          : null;
      if (!token) {
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }
      try {
        const user = await apiClient.me();
        if (!cancelled) dispatch({ type: 'SET_USER', payload: user });
      } catch {
        apiClient.logout();
        if (!cancelled) dispatch({ type: 'CLEAR_USER' });
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, altcha?: string) => {
      dispatch({ type: 'SET_LOADING', payload: true });
      try {
        const res = await apiClient.login(email, password, altcha);
        dispatch({ type: 'SET_USER', payload: res.user });
        toast.success('Welcome back!');
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Invalid email or password';
        dispatch({ type: 'SET_ERROR', payload: message });
        throw err;
      }
    },
    [],
  );

  const register = useCallback(
    async (
      email: string,
      password?: string,
      altcha?: string,
    ): Promise<PendingRegistration> => {
      dispatch({ type: 'SET_LOADING', payload: true });
      try {
        const pending = await apiClient.register(email, password, altcha);
        // Registration no longer returns a JWT — the user must still
        // confirm their email. Surface it in state, but don't flip to
        // authenticated.
        dispatch({ type: 'SET_LOADING', payload: false });
        return pending;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Registration failed';
        dispatch({ type: 'SET_ERROR', payload: message });
        throw err;
      }
    },
    [],
  );

  const resendVerification = useCallback(
    async (email: string, altcha?: string) => {
      await apiClient.resendVerification(email, altcha);
    },
    [],
  );

  const verifyEmail = useCallback(async (email: string, code: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const res = await apiClient.verifyEmail(email, code);
      dispatch({ type: 'SET_USER', payload: res.user });
      toast.success('Welcome to CareerSIM!');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Verification failed';
      dispatch({ type: 'SET_ERROR', payload: message });
      throw err;
    }
  }, []);

  const requestEmailLink = useCallback(async (email: string, altcha?: string) => {
    await apiClient.requestEmailLink(email, altcha);
  }, []);

  const consumeMagicLink = useCallback(async (token: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const res = await apiClient.consumeMagicLink(token);
      dispatch({ type: 'SET_USER', payload: res.user });
      toast.success('Signed in');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not sign you in';
      dispatch({ type: 'SET_ERROR', payload: message });
      throw err;
    }
  }, []);

  const forgotPassword = useCallback(async (email: string, altcha?: string) => {
    await apiClient.forgotPassword(email, altcha);
  }, []);

  const resetPassword = useCallback(async (token: string, password: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const res = await apiClient.resetPassword(token, password);
      dispatch({ type: 'SET_USER', payload: res.user });
      toast.success('Password updated');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not reset password';
      dispatch({ type: 'SET_ERROR', payload: message });
      throw err;
    }
  }, []);

  const changePassword = useCallback(
    async (newPassword: string, currentPassword?: string) => {
      const user = await apiClient.changePassword(newPassword, currentPassword);
      dispatch({ type: 'SET_USER', payload: user });
      toast.success('Password updated');
    },
    [],
  );

  const requestEmailChange = useCallback(
    async (newEmail: string, currentPassword?: string) => {
      await apiClient.requestEmailChange(newEmail, currentPassword);
      toast.success('Check your new inbox for a 6-digit code');
    },
    [],
  );

  const confirmEmailChange = useCallback(async (code: string) => {
    const res = await apiClient.confirmEmailChange(code);
    dispatch({ type: 'SET_USER', payload: res.user });
    toast.success('Email updated');
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const user = await apiClient.me();
      dispatch({ type: 'SET_USER', payload: user });
    } catch {
      apiClient.logout();
      dispatch({ type: 'CLEAR_USER' });
    }
  }, []);

  const logout = useCallback(() => {
    apiClient.logout();
    dispatch({ type: 'CLEAR_USER' });
    toast.success('Logged out');
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        register,
        resendVerification,
        verifyEmail,
        requestEmailLink,
        consumeMagicLink,
        forgotPassword,
        resetPassword,
        changePassword,
        requestEmailChange,
        confirmEmailChange,
        refreshUser,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
