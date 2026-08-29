'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function handleSignOut() {
    const client = createBrowserClient();
    await client.auth.signOut();
    startTransition(() => {
      router.replace('/login');
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className="rounded border px-3 py-1 text-sm hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
