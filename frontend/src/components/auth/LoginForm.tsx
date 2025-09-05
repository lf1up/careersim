import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { Button } from '../ui/Button.tsx';
import { RetroCard } from '../ui/RetroCard.tsx';
import { RetroInput } from '../ui/RetroInput.tsx';
import { RetroAlert } from '../ui/RetroBadge.tsx';

export const LoginForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login({ email, password });
      navigate('/dashboard');
    } catch (error) {
      // Error is handled by the auth context
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-retro-paper p-4">
      <div className="w-full max-w-md">
        <RetroCard
          title={<span className="font-retro tracking-wider2">SIGN IN</span>}
          subtitle={
            <span>
              Or <Link to="/register" className="underline">start your 14-day free trial</Link>
            </span>
          }
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <RetroInput
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <RetroInput
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="flex items-center justify-between">
              <Link to="/forgot-password" className="text-sm underline">
                Forgot your password?
              </Link>
            </div>

            {error && (
              <RetroAlert tone="error" title="Sign in failed">
                {error}
              </RetroAlert>
            )}

            <Button type="submit" className="w-full" isLoading={isLoading}>
              Sign in
            </Button>
          </form>
        </RetroCard>
      </div>
    </div>
  );
}; 