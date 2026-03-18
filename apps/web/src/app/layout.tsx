import type { Metadata } from "next";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import { NotificationHost } from "@/components/common/notification-host";
import { TopNav } from "@/components/layout/top-nav";
import { AuthProvider } from "@/providers/auth-provider";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
});

export const metadata: Metadata = {
  title: "Ecommerce Platform",
  description: "Frontend ecommerce multiempresa conectado al backend NestJS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${spaceGrotesk.variable} ${ibmPlexSans.variable}`} suppressHydrationWarning>
        <AuthProvider>
          <TopNav />
          <NotificationHost />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
