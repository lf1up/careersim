import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { Button } from '../ui/Button.tsx';
import { RetroCard } from '../ui/RetroCard.tsx';
import { RetroInput } from '../ui/RetroInput.tsx';
import { RetroAlert } from '../ui/RetroBadge.tsx';

export const RegisterForm: React.FC = () => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = useState('');
  const { register, isLoading, error } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear password error when user types
    if (name === 'password' || name === 'confirmPassword') {
      setPasswordError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    try {
      await register({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        password: formData.password,
      });
      navigate('/dashboard');
    } catch (error) {
      // Error is handled by the auth context
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
      <div className="w-full max-w-md">
        <RetroCard
          title={<span className="font-retro tracking-wider2">CREATE ACCOUNT</span>}
          subtitle={
            <span className="text-secondary-600 dark:text-secondary-400">
              Or <Link to="/login" className="underline text-primary-600 dark:text-primary-400">sign in to your account</Link>
            </span>
          }
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-4">
              <RetroInput
                label="First name"
                id="firstName"
                name="firstName"
                required
                value={formData.firstName}
                onChange={handleChange}
              />
              <RetroInput
                label="Last name"
                id="lastName"
                name="lastName"
                required
                value={formData.lastName}
                onChange={handleChange}
              />
            </div>

            <RetroInput
              label="Email address"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={formData.email}
              onChange={handleChange}
            />

            <RetroInput
              label="Password"
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={formData.password}
              onChange={handleChange}
            />

            <RetroInput
              label="Confirm password"
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={formData.confirmPassword}
              onChange={handleChange}
            />

            {(error || passwordError) && (
              <RetroAlert tone="error" title="Could not create account">
                {error || passwordError}
              </RetroAlert>
            )}

            <Button type="submit" className="w-full" isLoading={isLoading}>
              Create account
            </Button>
          </form>
        </RetroCard>
      </div>
    </div>
  );
}; 