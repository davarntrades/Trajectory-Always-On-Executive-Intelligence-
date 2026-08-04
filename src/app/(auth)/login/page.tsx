import Link from "next/link";
import { oauthAction, signInAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; next?: string }>;
}) {
  const { message, next = "/" } = await searchParams;
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="auth-kicker">Persistent executive intelligence</p>
        <h1>Reconnect with Trajectory.</h1>
        <p className="auth-copy">Your workspace, memory and trajectory remain private to you.</p>
        {message ? <p className="auth-message" role="status">{message}</p> : null}
        <form action={signInAction} className="auth-form">
          <input type="hidden" name="next" value={next} />
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
          <button type="submit">Sign in</button>
        </form>
        <div className="auth-divider"><span>or</span></div>
        <div className="auth-providers">
          <form action={oauthAction}><input type="hidden" name="provider" value="google" /><button type="submit">Continue with Google</button></form>
          <form action={oauthAction}><input type="hidden" name="provider" value="apple" /><button type="submit">Continue with Apple</button></form>
        </div>
        <div className="auth-links">
          <Link href="/forgot-password">Forgot password?</Link>
          <Link href="/signup">Create an account</Link>
        </div>
      </section>
    </main>
  );
}
