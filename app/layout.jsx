import { Manrope, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata = {
  title: 'Football Predictor by DTech — V2.0',
  description:
    "Pronostics de football pilotés par l'IA : probabilités 1X2, BTTS, scores exacts, combiné du jour et coupon personnalisé, pondérés par niveau de championnat.",
  icons: {
    icon: '/logo-icon.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr" className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-base-950 text-ink-100 font-sans antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
