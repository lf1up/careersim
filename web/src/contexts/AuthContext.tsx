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
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
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

  const login = useCallback(async (email: string, password: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const res = await apiClient.login(email, password);
      dispatch({ type: 'SET_USER', payload: res.user });
      toast.success('Welcome back!');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Invalid email or password';
      dispatch({ type: 'SET_ERROR', payload: message });
      throw err;
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const res = await apiClient.register(email, password);
      dispatch({ type: 'SET_USER', payload: res.user });
      toast.success('Welcome to CareerSim!');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      dispatch({ type: 'SET_ERROR', payload: message });
      throw err;
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
      value={{ ...state, login, register, logout, clearError }}
    >
      {children}
    </AuthContext.Provider>
  );
};
