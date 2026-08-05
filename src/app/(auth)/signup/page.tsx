import Link from "next/link";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { oauthAction, signUpAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <main className="auth-shell"><section className="auth-card">
    <p className="auth-kicker">{language.auth.privateTrajectory}</p><h1>{language.auth.createWorkspaceTitle}</h1>
    <p className="auth-copy">{language.auth.createWorkspaceCopy}</p>{message ? <p className="auth-message" role="status">{message}</p> : null}
    <form action={signUpAction} className="auth-form">
      <label>{language.auth.displayName}<input name="displayName" type="text" autoComplete="name" maxLength={80} required /></label>
      <label>{language.auth.email}<input name="email" type="email" autoComplete="email" required /></label>
      <label>{language.auth.password}<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
      <button type="submit">{language.auth.createAccount}</button></form>
    <div className="auth-divider"><span>{language.auth.alternative}</span></div>
    <div className="auth-providers"><form action={oauthAction}><input type="hidden" name="provider" value="google" /><button type="submit">{language.auth.continueGoogle}</button></form><form action={oauthAction}><input type="hidden" name="provider" value="apple" /><button type="submit">{language.auth.continueApple}</button></form></div>
    <div className="auth-links"><Link href="/login">{language.auth.alreadyRegistered}</Link></div>
  </section></main>;
}
