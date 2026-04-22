import { redirect } from 'next/navigation';

// `/simulations` is the shared home for both guests (public catalogue)
// and authenticated users (the signed-in Navbar still exposes the
// Dashboard link). Redirecting everyone here avoids bouncing guests
// through `/dashboard` → `/login`.
export default function RootPage(): never {
  redirect('/simulations');
}
