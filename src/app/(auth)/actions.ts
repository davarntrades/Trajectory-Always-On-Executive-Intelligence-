"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { config } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

const Credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(128) });
const messageUrl = (path: string, message: string) => `${path}?message=${encodeURIComponent(message)}`;
const safeNext = (value: FormDataEntryValue | null) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";

export async function signInAction(formData: FormData) {
  const parsed = Credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(messageUrl("/login", language.authMessages.invalidCredentialsInput));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect(messageUrl("/login", language.authMessages.credentialsNotRecognised));
  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(formData: FormData) {
  const parsed = Credentials.extend({ displayName: z.string().trim().min(1).max(80) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(messageUrl("/signup", language.authMessages.incompleteSignup));
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.displayName }, emailRedirectTo: `${config.appUrl}/auth/callback?next=/` },
  });
  if (error) redirect(messageUrl("/signup", language.authMessages.accountCreationFailed));
  redirect(messageUrl("/login", language.authMessages.verifyAccount));
}

export async function oauthAction(formData: FormData) {
  const provider = z.enum(["google", "apple"]).safeParse(formData.get("provider"));
  if (!provider.success) redirect(messageUrl("/login", language.authMessages.providerUnavailable));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider.data,
    options: {
      redirectTo: `${config.appUrl}/auth/callback?next=/`,
      queryParams: provider.data === "google" ? { access_type: "offline", prompt: "consent" } : undefined,
    },
  });
  if (error || !data.url) redirect(messageUrl("/login", language.authMessages.providerNotConfigured));
  redirect(data.url);
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = z.string().email().safeParse(formData.get("email"));
  if (!email.success) redirect(messageUrl("/forgot-password", language.authMessages.invalidEmail));
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${config.appUrl}/auth/callback?next=/reset-password` });
  redirect(messageUrl("/forgot-password", language.authMessages.recoverySent));
}

export async function updatePasswordAction(formData: FormData) {
  const password = z.string().min(8).max(128).safeParse(formData.get("password"));
  if (!password.success) redirect(messageUrl("/reset-password", language.authMessages.weakPassword));
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) redirect(messageUrl("/reset-password", language.authMessages.invalidRecovery));
  redirect(messageUrl("/login", language.authMessages.passwordUpdated));
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
