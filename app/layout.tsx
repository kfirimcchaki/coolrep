import type { Metadata, Viewport } from 'next';
import './globals.css';
import SiteHeader from './components/SiteHeader';

export const metadata: Metadata = {
  title: 'NT Scripting',
  description:
    'Create and share scripts for friendly battles. An independent, from-scratch recreation of the NT Scripting platform.',
  applicationName: 'NT Scripting',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#08090d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <footer className="footer">
          <div className="container footer-inner">
            <span>
              NT Scripting · independent reimplementation for local/demo use · not affiliated with Null&apos;s
            </span>
            <span className="mono-id">API v1 · /api/health</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
