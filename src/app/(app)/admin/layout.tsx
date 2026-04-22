import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }): JSX.Element {
  return <section className="space-y-6">{children}</section>;
}
