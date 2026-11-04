import type { Metadata } from "next";
import { StorageProvider } from "@/src/context/StorageContext";
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
          {children}
        </StorageProvider>
      </body>
    </html>
  );
}
