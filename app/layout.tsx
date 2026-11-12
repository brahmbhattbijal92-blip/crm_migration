import type { Metadata } from "next";
import { StorageProvider } from "@/src/context/StorageContext";
import { AuthSessionProvider } from "@/src/context/AuthSessionContext";
import AppNavigation from "@/src/components/AppNavigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM Migration Platform",
  description: "Secure Production-Grade Multi-Tenant Migration Practice Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* Wrap your system shell container inside the state provider */}
        <StorageProvider>
          <AuthSessionProvider>
            <AppNavigation />
            {children}
          </AuthSessionProvider>
        </StorageProvider>
      </body>
    </html>
  );
}
