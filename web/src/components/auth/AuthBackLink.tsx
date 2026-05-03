import Link from 'next/link';

import { Button } from '@/components/ui/Button';

export function AuthBackLink() {
  return (
    <Link href="/simulations" className="inline-block py-4">
      <Button variant="ghost" size="sm">
        ← All simulations
      </Button>
    </Link>
  );
}
