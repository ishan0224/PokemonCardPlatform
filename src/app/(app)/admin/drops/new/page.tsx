import Link from "next/link";
import dynamic from "next/dynamic";
import { buttonClassName } from "@/components/ui/button-styles";
import { routes } from "@/lib/routes";
import { useSession } from "@/server/auth/session";
import { buildDefaultAdminDropInput, previewAdminDropComposition } from "@/server/services/admin-drop.service";

const AdminDropEditor = dynamic(
  () => import("@/components/admin/admin-drop-editor").then((module) => module.AdminDropEditor),
  { ssr: false }
);

export default async function AdminDropCreatePage(): Promise<JSX.Element> {
  const session = await useSession();

  if (!session.isAuthenticated || !session.user) {
    return (
      <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-pv-ink">Admin Drops</h1>
        <p className="mt-2 text-sm text-pv-muted">Sign in with an admin account to schedule drops.</p>
        <Link href={routes.auth.login} className={`${buttonClassName({ variant: "primary" })} mt-4`}>
          Go to Login
        </Link>
      </section>
    );
  }

  if (session.user.role !== "admin") {
    return (
      <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-pv-ink">Forbidden</h1>
        <p className="mt-2 text-sm text-pv-muted">Your account is not authorized to access admin drops.</p>
      </section>
    );
  }

  const initialInput = buildDefaultAdminDropInput();
  const initialPreview = await previewAdminDropComposition(initialInput);

  return <AdminDropEditor mode="create" initialInput={initialInput} initialPreview={initialPreview} />;
}
