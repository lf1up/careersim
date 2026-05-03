import Link from 'next/link';

import { Button } from '@/components/ui/Button';

export function AuthBackLink() {
  return (
    <Link href="/simulations" className="inline-block pb-6 pt-4">
      <Button variant="ghost" size="sm">
        ← All simulations
      </Button>
    </Link>
  );
}
