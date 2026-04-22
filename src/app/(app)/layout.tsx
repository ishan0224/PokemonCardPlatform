import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/app-shell";

export default function AppGroupLayout({ children }: { children: ReactNode }): JSX.Element {
  return <AppShell>{children}</AppShell>;
}
