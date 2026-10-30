'use client';

/**
 * Router abstraction shared by the Next.js server build and the static
 * GitHub Pages build. Components never import `next/navigation` or `next/link`
 * directly, so the exact same component tree runs in both targets.
 */
import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from 'react';

export interface AppNav {
  pathname: string;
  /** Client-side navigation. */
  push(path: string): void;
  replace(path: string): void;
  /** Re-fetch data for the current screen. */
  refresh(): void;
}

export type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children?: ReactNode;
};

export type AppLinkComponent = ComponentType<AppLinkProps>;

interface AppRouterValue {
  nav: AppNav;
  Link: AppLinkComponent;
}

const AppRouterContext = createContext<AppRouterValue | null>(null);

export function AppRouterProvider({
  value,
  children,
}: {
  value: AppRouterValue;
  children: ReactNode;
}) {
  return <AppRouterContext.Provider value={value}>{children}</AppRouterContext.Provider>;
}

function useValue(): AppRouterValue {
  const value = useContext(AppRouterContext);
  if (!value) throw new Error('AppRouterProvider is missing');
  return value;
}

export function useNav(): AppNav {
  return useValue().nav;
}

export function useAppLink(): AppLinkComponent {
  return useValue().Link;
}

/** `<Link>` that works in both targets. */
export function Link(props: AppLinkProps) {
  const Component = useAppLink();
  return <Component {...props} />;
}
