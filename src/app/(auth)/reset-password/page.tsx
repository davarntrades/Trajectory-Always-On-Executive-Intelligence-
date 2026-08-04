import { updatePasswordAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return (
    <main className="auth-shell"><section className="auth-card">
      <p className="auth-kicker">Secure recovery</p><h1>Choose a new password.</h1>
      {message ? <p className="auth-message" role="status">{message}</p> : null}
      <form action={updatePasswordAction} className="auth-form">
        <label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <button type="submit">Update password</button>
      </form>
    </section></main>
  );
}
