"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { config } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

const Credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

function messageUrl(path: string, message: string) {
  return `${path}?message=${encodeURIComponent(message)}`;
}

function safeNext(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

export async function signInAction(formData: FormData) {
  const parsed = Credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(messageUrl("/login", "Enter a valid email and password."));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect(messageUrl("/login", "The email or password was not recognised."));
  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(formData: FormData) {
  const parsed = Credentials.extend({ displayName: z.string().trim().min(1).max(80) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(messageUrl("/signup", "Complete every field using a password of at least eight characters."));

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.displayName },
      emailRedirectTo: `${config.appUrl}/auth/callback?next=/`,
    },
  });
  if (error) redirect(messageUrl("/signup", "Trajectory could not create that account."));
  redirect(messageUrl("/login", "Check your email to verify your account, then sign in."));
}

export async function oauthAction(formData: FormData) {
  const provider = z.enum(["google", "apple"]).safeParse(formData.get("provider"));
  if (!provider.success) redirect(messageUrl("/login", "That sign-in provider is unavailable."));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider.data,
    options: {
      redirectTo: `${config.appUrl}/auth/callback?next=/`,
      queryParams: provider.data === "google" ? { access_type: "offline", prompt: "consent" } : undefined,
    },
  });
  if (error || !data.url) redirect(messageUrl("/login", "That sign-in provider is not configured yet."));
  redirect(data.url);
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = z.string().email().safeParse(formData.get("email"));
  if (!email.success) redirect(messageUrl("/forgot-password", "Enter a valid email address."));

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${config.appUrl}/auth/callback?next=/reset-password`,
  });
  // Do not reveal whether an account exists.
  redirect(messageUrl("/forgot-password", "If an account exists, a reset link is on its way."));
}

export async function updatePasswordAction(formData: FormData) {
  const password = z.string().min(8).max(128).safeParse(formData.get("password"));
  if (!password.success) redirect(messageUrl("/reset-password", "Use a password of at least eight characters."));

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) redirect(messageUrl("/reset-password", "The reset link is invalid or has expired."));
  redirect(messageUrl("/login", "Password updated. You can now sign in."));
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
