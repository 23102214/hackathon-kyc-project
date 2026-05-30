/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Eye, EyeOff, KeyRound, LockKeyhole, Mail, Shield } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

interface LoginPageProps {
  onStartKyc: () => void;
  onLoginComplete: (role: "customer" | "admin") => void;
}

export default function LoginPage({ onStartKyc, onLoginComplete }: LoginPageProps) {
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = authMode === "signup"
    ? Boolean(email && password)
    : mode === "password"
      ? Boolean(email && password)
      : Boolean(email);

  const loadRoleAndContinue = async (token: string) => {
    const roleResponse = await fetch("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const rolePayload = await roleResponse.json();

    if (!roleResponse.ok || !rolePayload.success) {
      alert(rolePayload.error || "Could not load account role.");
      return;
    }

    onLoginComplete(rolePayload.role === "admin" ? "admin" : "customer");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);

    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName || email.split("@")[0],
              role: "customer",
            },
          },
        });

        if (error) {
          alert(error.message);
          return;
        }

        const token = data.session?.access_token;
        if (!token) {
          alert("Account created. Please confirm your email, then sign in.");
          setAuthMode("signin");
          return;
        }

        await loadRoleAndContinue(token);
        return;
      }

      if (mode === "otp") {
        if (otp.trim()) {
          const { data, error } = await supabase.auth.verifyOtp({
            email,
            token: otp.trim(),
            type: "email",
          });

          if (error) {
            alert(error.message);
            return;
          }

          const token = data.session?.access_token;
          if (!token) {
            alert("OTP verification failed. No Supabase session was returned.");
            return;
          }

          await loadRoleAndContinue(token);
          return;
        }

        const { error } = await supabase.auth.signInWithOtp({ email });

        if (error) {
          alert(error.message);
          return;
        }

        alert("OTP sent to your email. Enter the OTP code and press Sign In again.");
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (error.message.toLowerCase().includes("invalid login credentials")) {
          const { data: signupData, error: signupError } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                display_name: displayName || email.split("@")[0],
                role: "customer",
              },
            },
          });

          if (signupError) {
            alert(signupError.message);
            return;
          }

          const signupToken = signupData.session?.access_token;
          if (!signupToken) {
            alert("Customer account created. Please confirm your email, then sign in.");
            return;
          }

          await loadRoleAndContinue(signupToken);
          return;
        }

        alert(error.message);
        return;
      }

      const token = data.session?.access_token;
      if (!token) {
        alert("Login failed. No Supabase session was returned.");
        return;
      }

      await loadRoleAndContinue(token);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-4.25rem)] bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-xl flex-col items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-teal-700">
            <Shield className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950">Smart eKYC</h1>
            <p className="text-sm font-medium text-slate-500">Identity Intelligence Access</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-10 w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-xl font-black text-slate-950">
              {authMode === "signin" ? "Sign In" : "Create Customer Account"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {authMode === "signin"
                ? "Use password login or OTP verification."
                : "New accounts are created as customers only."}
            </p>
          </div>

          <div className="mt-6 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setAuthMode("signin")}
              className={`rounded-md px-3 py-2 text-sm font-bold transition ${
                authMode === "signin" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setMode("password");
              }}
              className={`rounded-md px-3 py-2 text-sm font-bold transition ${
                authMode === "signup" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
              }`}
            >
              Sign Up
            </button>
          </div>

          {authMode === "signin" && (
          <div className="mt-4 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode("password")}
              className={`rounded-md px-3 py-2 text-sm font-bold transition ${
                mode === "password" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => setMode("otp")}
              className={`rounded-md px-3 py-2 text-sm font-bold transition ${
                mode === "otp" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
              }`}
            >
              OTP
            </button>
          </div>
          )}

          <div className="mt-6 space-y-4">
            {authMode === "signup" && (
              <label className="block">
                <span className="text-sm font-bold text-slate-700">Name</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Enter your name"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>
            )}

            <label className="block">
              <span className="text-sm font-bold text-slate-700">Email</span>
              <span className="relative mt-2 block">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter account email"
                  className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </span>
            </label>

            {authMode === "signup" || mode === "password" ? (
              <label className="block">
                <span className="text-sm font-bold text-slate-700">Password</span>
                <span className="relative mt-2 block">
                  <LockKeyhole className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={authMode === "signup" ? "Create password" : "Enter password"}
                    className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-11 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-3 top-2.5 rounded p-1 text-slate-500 hover:bg-slate-100"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>
            ) : (
              <label className="block">
                <span className="text-sm font-bold text-slate-700">OTP Code</span>
                <span className="relative mt-2 block">
                  <KeyRound className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={otp}
                    onChange={(event) => setOtp(event.target.value)}
                    placeholder="Enter OTP"
                    className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </span>
              </label>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="mt-6 w-full rounded-lg bg-teal-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50"
          >
            {isSubmitting
              ? authMode === "signup" ? "Creating account..." : "Signing in..."
              : authMode === "signup" ? "Create Customer Account" : mode === "otp" && !otp.trim() ? "Send OTP" : "Sign In"}
          </button>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">or</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={onStartKyc}
            className="w-full rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-700 transition hover:bg-teal-100"
          >
            Start KYC without signing in
          </button>
        </form>
      </div>
    </main>
  );
}
