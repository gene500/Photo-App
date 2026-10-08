import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/offline/ServiceWorkerRegister";
import { InitScript } from "@/components/settings/InitScript";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display face for headings and trip names: a grotesque with some road-sign weight; Geist stays for body text.
const display = Bricolage_Grotesque({
  variable: "--font-display-face",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Photo Op Planner",
  description: "Plan photo ops: scenic stops, the best light, and the route between them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
      // The inline script below sets data-theme / data-text-size / data-reduce-motion before hydration.
      suppressHydrationWarning
    >
      <head>
        <InitScript />
      </head>
      <body className="min-h-full flex flex-col">
        <SettingsProvider>
          {children}
          <ServiceWorkerRegister />
        </SettingsProvider>
      </body>
    </html>
  );
}
