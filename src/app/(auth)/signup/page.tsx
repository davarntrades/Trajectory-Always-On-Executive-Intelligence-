import Link from "next/link";
import { oauthAction, signUpAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="auth-kicker">Your private trajectory</p>
        <h1>Create your workspace.</h1>
        <p className="auth-copy">Trajectory will build memory only from the world you choose to connect.</p>
        {message ? <p className="auth-message" role="status">{message}</p> : null}
        <form action={signUpAction} className="auth-form">
          <label>Display name<input name="displayName" type="text" autoComplete="name" maxLength={80} required /></label>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
          <button type="submit">Create account</button>
        </form>
        <div className="auth-divider"><span>or</span></div>
        <div className="auth-providers">
          <form action={oauthAction}><input type="hidden" name="provider" value="google" /><button type="submit">Continue with Google</button></form>
          <form action={oauthAction}><input type="hidden" name="provider" value="apple" /><button type="submit">Continue with Apple</button></form>
        </div>
        <div className="auth-links"><Link href="/login">Already have an account?</Link></div>
      </section>
    </main>
  );
}
