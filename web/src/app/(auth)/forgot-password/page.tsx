import { Suspense } from 'react';

import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export const metadata = {
  title: 'Forgot password · CareerSIM',
};

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
