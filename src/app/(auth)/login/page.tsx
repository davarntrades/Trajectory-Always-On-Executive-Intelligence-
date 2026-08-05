import Link from "next/link";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { oauthAction, signInAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ message?: string; next?: string }> }) {
  const { message, next = "/" } = await searchParams;
  return <main className="auth-shell"><section className="auth-card">
    <p className="auth-kicker">{language.auth.persistentIntelligence}</p><h1>{language.auth.reconnectTitle}</h1>
    <p className="auth-copy">{language.auth.reconnectCopy}</p>{message ? <p className="auth-message" role="status">{message}</p> : null}
    <form action={signInAction} className="auth-form"><input type="hidden" name="next" value={next} />
      <label>{language.auth.email}<input name="email" type="email" autoComplete="email" required /></label>
      <label>{language.auth.password}<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
      <button type="submit">{language.auth.signIn}</button></form>
    <div className="auth-divider"><span>{language.auth.alternative}</span></div>
    <div className="auth-providers"><form action={oauthAction}><input type="hidden" name="provider" value="google" /><button type="submit">{language.auth.continueGoogle}</button></form><form action={oauthAction}><input type="hidden" name="provider" value="apple" /><button type="submit">{language.auth.continueApple}</button></form></div>
    <div className="auth-links"><Link href="/forgot-password">{language.auth.forgotPassword}</Link><Link href="/signup">{language.auth.createAccountLink}</Link></div>
  </section></main>;
}
