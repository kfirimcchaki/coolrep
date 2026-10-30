'use client';

import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { AppRouterProvider, type AppLinkProps, type AppNav } from '../../lib/app-router';

/**
 * Supplies navigation + link rendering to the shared component tree when it is
 * rendered by the Next.js server build.
 */
export default function NextProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const nav = useMemo<AppNav>(
    () => ({
      pathname,
      push: (path: string) => router.push(path),
      replace: (path: string) => router.replace(path),
      refresh: () => router.refresh(),
    }),
    [pathname, router],
  );

  const Link = useMemo(() => {
    const NextAppLink = ({ href, children: label, ...rest }: AppLinkProps) => (
      <NextLink href={href} {...rest}>
        {label}
      </NextLink>
    );
    return NextAppLink;
  }, []);

  return <AppRouterProvider value={{ nav, Link }}>{children}</AppRouterProvider>;
}
