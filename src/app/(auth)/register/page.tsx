"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/ui/auth-shell";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";

export default function RegisterPage(): JSX.Element {
  const router = useRouter();
  const { refreshAuth } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const result = await apiClient.register({
        username: username.trim(),
        email: email.trim().toLowerCase(),
        password
      });

      if (result.requiresEmailConfirmation) {
        setNotice("Registration succeeded. Confirm your email, then sign in.");
      } else {
        await refreshAuth();
        router.push("/drops");
      }
    } catch (err) {
      setError(mapApiErrorToMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Create account"
      subtitle="Start with $100 balance and join the next drop."
      footerText="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkHref="/login"
    >
      <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Username</span>
          <input
            required
            minLength={3}
            maxLength={32}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>

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
            minLength={8}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>

        {error ? <p className="rounded-xl bg-rose-50 p-2 text-sm font-medium text-rose-700">{error}</p> : null}
        {notice ? <p className="rounded-xl bg-emerald-50 p-2 text-sm font-medium text-emerald-700">{notice}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className={`w-full rounded-xl px-4 py-2 text-sm font-bold transition ${
            submitting ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-rose-600 text-white hover:bg-rose-700"
          }`}
        >
          {submitting ? "Creating account..." : "Create Account"}
        </button>
      </form>
    </AuthShell>
  );
}
