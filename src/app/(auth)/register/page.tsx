"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/ui/auth-shell";
import { Button } from "@/components/ui/button";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import { useAuth } from "@/hooks/use-auth";

const USERNAME_HELP_ID = "register-username-help";
const REGISTER_SOCIAL_HELP_ID = "register-social-help";

export default function RegisterPage(): JSX.Element {
  const router = useRouter();
  const { refreshAuth } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const errorId = error ? "register-form-error" : undefined;
  const usernameDescribedBy = errorId ? `${USERNAME_HELP_ID} ${errorId}` : USERNAME_HELP_ID;

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (submitting) {
      return;
    }

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
        router.push(routes.home);
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
      footerLinkHref={routes.auth.login}
      auxiliaryContent={
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-pv-muted">Social sign-in</p>
          <p id={REGISTER_SOCIAL_HELP_ID} className="text-xs text-pv-muted">
            Coming soon.
          </p>
          <div className="grid grid-cols-2 gap-2" aria-describedby={REGISTER_SOCIAL_HELP_ID}>
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
          <label htmlFor="register-username" className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Username
          </label>
          <input
            id="register-username"
            required
            minLength={3}
            maxLength={32}
            autoComplete="username"
            value={username}
            aria-describedby={usernameDescribedBy}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-1 w-full rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-semibold text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25"
          />
          <p id={USERNAME_HELP_ID} className="mt-1 text-xs text-pv-muted">
            3-32 characters. Letters, numbers, and underscores work best.
          </p>
        </div>

        <div>
          <label htmlFor="register-email" className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Email
          </label>
          <input
            id="register-email"
            required
            type="email"
            autoComplete="email"
            aria-describedby={errorId}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-semibold text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25"
          />
        </div>

        <div>
          <label htmlFor="register-password" className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Password
          </label>
          <input
            id="register-password"
            required
            minLength={8}
            type="password"
            autoComplete="new-password"
            aria-describedby={errorId}
            value={password}
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
        {notice ? (
          <p className="rounded-pv-sm border border-pv-good/30 bg-[rgba(16,185,129,0.06)] p-3 text-[13px] font-medium text-pv-good">
            {notice}
          </p>
        ) : null}

        <Button type="submit" loading={submitting} fullWidth>
          {submitting ? "Creating account..." : "Create Account"}
        </Button>
      </form>
    </AuthShell>
  );
}
