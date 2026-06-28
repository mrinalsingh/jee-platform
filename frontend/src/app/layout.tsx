import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// Design-lock #2: Inter variable, weights 400/500/600/700, `display: 'swap'`
// for instant render to hit TTFP p95 ≤ 1500 ms (PRD §5.1).
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'jee_platform — test runtime',
  description:
    'JEE-Advanced-style CBT runtime with diagnostic axis review.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-surface-0 text-text-primary">
        {children}
      </body>
    </html>
  );
}
