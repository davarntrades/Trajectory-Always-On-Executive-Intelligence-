import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { updatePasswordAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <main className="auth-shell"><section className="auth-card">
    <p className="auth-kicker">{language.auth.secureRecovery}</p><h1>{language.auth.choosePasswordTitle}</h1>
    {message ? <p className="auth-message" role="status">{message}</p> : null}
    <form action={updatePasswordAction} className="auth-form"><label>{language.auth.newPassword}<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label><button type="submit">{language.auth.updatePassword}</button></form>
  </section></main>;
}
