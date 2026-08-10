import "./globals.css";
import type { Metadata } from "next";
import { QueryProvider } from "../components/query-provider";

export const metadata: Metadata = { title: "TubeGen Production OS", description: "Faceless YouTube production cockpit" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><QueryProvider>{children}</QueryProvider></body></html>;
}
