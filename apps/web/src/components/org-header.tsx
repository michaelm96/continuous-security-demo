import Link from 'next/link';
import { SignOutButton } from './sign-out-button';

export function OrgHeader({
  orgLabel,
  organizationId,
}: {
  orgLabel: string;
  organizationId: string;
}) {
  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label="Back to dashboard"
          >
            CS
          </Link>
          <div>
            <p className="text-sm font-semibold leading-tight">
              <Link
                href="/dashboard"
                className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Continuous Security Demo
              </Link>
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {orgLabel} ·{' '}
              <span className="font-mono">{organizationId.slice(0, 8)}</span>
            </p>
          </div>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
