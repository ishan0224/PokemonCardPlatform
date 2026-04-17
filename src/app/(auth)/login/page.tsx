"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/ui/auth-shell";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const { refreshAuth } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await apiClient.login({
        email: email.trim().toLowerCase(),
        password
      });
      await refreshAuth();
      router.push("/drops");
    } catch (err) {
      setError(mapApiErrorToMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to join live drops and reveal your packs."
      footerText="No account yet?"
      footerLinkLabel="Create one"
      footerLinkHref="/register"
    >
      <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>

        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Password</span>
          <input
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>

        {error ? <p className="rounded-xl bg-rose-50 p-2 text-sm font-medium text-rose-700">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className={`w-full rounded-xl px-4 py-2 text-sm font-bold transition ${
            submitting ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-slate-900 text-white hover:bg-slate-700"
          }`}
        >
          {submitting ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </AuthShell>
  );
}
