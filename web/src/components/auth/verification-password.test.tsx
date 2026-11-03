import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { RegisterForm } from './RegisterForm';
import { LoginForm } from './LoginForm';

const auth = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn(), verifyEmail: vi.fn(), resendVerification: vi.fn(), isLoading: false }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('./AltchaWidget', () => ({ AltchaWidget: ({ onVerified }: { onVerified: (value: string) => void }) => <button type="button" onClick={() => onVerified('test-challenge')}>Solve challenge</button> }));

beforeEach(() => {
  vi.resetAllMocks();
  auth.register.mockResolvedValue({ email: 'owner@example.com' });
  auth.resendVerification.mockResolvedValue(undefined);
  auth.verifyEmail.mockResolvedValue(undefined);
});

it.each(['register', 'login'] as const)('keeps the owner-chosen password through the %s email confirmation step', async (flow) => {
  const password = 'owner-chosen-password';
  auth.login.mockRejectedValue(new ApiError(403, 'Verify your email', { error: 'EMAIL_NOT_VERIFIED' }));
  render(flow === 'register' ? <RegisterForm /> : <LoginForm />);
  if (flow === 'register') fireEvent.click(screen.getByRole('tab', { name: 'With password' }));
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'owner@example.com' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: password } });
  if (flow === 'register') fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Solve challenge' }));
  fireEvent.click(screen.getByRole('button', { name: flow === 'register' ? 'Create account' : 'Sign in' }));
  const code = await screen.findByLabelText('Confirmation code');
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.submit(code.closest('form')!);
  await waitFor(() => expect(auth.verifyEmail).toHaveBeenCalledWith('owner@example.com', '123456', password));
});
