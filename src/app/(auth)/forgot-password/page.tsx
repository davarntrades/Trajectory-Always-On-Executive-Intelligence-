import Link from "next/link";
import { requestPasswordResetAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return (
    <main className="auth-shell"><section className="auth-card">
      <p className="auth-kicker">Secure recovery</p><h1>Reset your password.</h1>
      <p className="auth-copy">We’ll send a single-use recovery link to your verified email.</p>
      {message ? <p className="auth-message" role="status">{message}</p> : null}
      <form action={requestPasswordResetAction} className="auth-form">
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <button type="submit">Send recovery link</button>
      </form>
      <div className="auth-links"><Link href="/login">Return to sign in</Link></div>
    </section></main>
  );
}
