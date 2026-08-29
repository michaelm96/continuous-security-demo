import { LoginForm } from '@/components/login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/') ? next : '/dashboard';
  return (
    <main className="mx-auto mt-24 max-w-md">
      <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>
      <LoginForm next={safeNext} />
    </main>
  );
}
