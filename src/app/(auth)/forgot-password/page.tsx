import Link from "next/link";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { requestPasswordResetAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <main className="auth-shell"><section className="auth-card">
    <p className="auth-kicker">{language.auth.secureRecovery}</p><h1>{language.auth.resetPasswordTitle}</h1>
    <p className="auth-copy">{language.auth.recoveryCopy}</p>{message ? <p className="auth-message" role="status">{message}</p> : null}
    <form action={requestPasswordResetAction} className="auth-form"><label>{language.auth.email}<input name="email" type="email" autoComplete="email" required /></label><button type="submit">{language.auth.sendRecoveryLink}</button></form>
    <div className="auth-links"><Link href="/login">{language.auth.returnToSignIn}</Link></div>
  </section></main>;
}
