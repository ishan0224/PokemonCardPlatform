"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/ui/auth-shell";
import { Button } from "@/components/ui/button";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import { useAuth } from "@/hooks/use-auth";

const EMAIL_HELP_ID = "login-email-help";
const LOGIN_SOCIAL_HELP_ID = "login-social-help";

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const { refreshAuth } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errorId = error ? "login-form-error" : undefined;
  const emailDescribedBy = errorId ? `${EMAIL_HELP_ID} ${errorId}` : EMAIL_HELP_ID;
  const passwordDescribedBy = errorId;

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiClient.login({
        email: email.trim().toLowerCase(),
        password
      });
      await refreshAuth();
      router.push(routes.drops.index);
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
      footerLinkHref={routes.auth.register}
      auxiliaryContent={
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-pv-muted">Social sign-in</p>
          <p id={LOGIN_SOCIAL_HELP_ID} className="text-xs text-pv-muted">
            Coming soon.
          </p>
          <div className="grid grid-cols-2 gap-2" aria-describedby={LOGIN_SOCIAL_HELP_ID}>
            <Button type="button" variant="secondary" fullWidth disabled title="coming soon">
              Google
            </Button>
            <Button type="button" variant="secondary" fullWidth disabled title="coming soon">
              Apple
            </Button>
          </div>
        </div>
      }
    >
      <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
        <div>
          <label htmlFor="login-email" className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Email
          </label>
          <input
            id="login-email"
            required
            type="email"
            autoComplete="email"
            value={email}
            aria-describedby={emailDescribedBy}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-semibold text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25"
          />
          <p id={EMAIL_HELP_ID} className="mt-1 text-xs text-pv-muted">
            Use the email tied to your PullVault account.
          </p>
        </div>

        <div>
          <label htmlFor="login-password" className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Password
          </label>
          <input
            id="login-password"
            required
            type="password"
            autoComplete="current-password"
            value={password}
            aria-describedby={passwordDescribedBy}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-semibold text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25"
          />
        </div>

        {error ? (
          <p
            id={errorId}
            role="alert"
            className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-[13px] font-medium text-[#fca5a5]"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" loading={submitting} fullWidth>
          {submitting ? "Signing in..." : "Sign In"}
        </Button>
      </form>
    </AuthShell>
  );
}
