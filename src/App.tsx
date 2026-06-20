/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Eye,
  FileSearch,
  Fingerprint,
  Layers,
  LockKeyhole,
  Menu,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  X,
  Zap,
} from "lucide-react";
import { OnboardingData, OnboardingRequest, VerificationResult } from "./types";
import OnboardingFlow from "./components/OnboardingFlow";
import AdminDashboard from "./components/AdminDashboard";
import ContinuousFeed from "./components/ContinuousFeed";
import DeveloperCenter from "./components/DeveloperCenter";
import LoginPage from "./components/LoginPage";
import { supabase } from "./lib/supabaseClient";

type TabId = "home" | "login" | "onboard" | "admin" | "streams" | "blueprints";

const navItems: Array<{ id: TabId; label: string }> = [
  { id: "home", label: "Features" },
  { id: "admin", label: "Review" },
  { id: "streams", label: "Monitoring" },
  { id: "blueprints", label: "Blueprints" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [requests, setRequests] = useState<OnboardingRequest[]>([]);
  const [requestLoadError, setRequestLoadError] = useState("");
  const [accountRole, setAccountRole] = useState<"guest" | "customer" | "admin">("guest");
  const isAdmin = accountRole === "admin";

  useEffect(() => {
    async function restoreSessionRole() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      try {
        const response = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json();
        if (response.ok && payload.success) {
          setAccountRole(payload.role === "admin" ? "admin" : "customer");
        }
      } catch (error) {
        console.warn("Could not restore Supabase session role.", error);
      }
    }

    restoreSessionRole();
  }, []);

  useEffect(() => {
    async function loadSavedRequests() {
      if (!isAdmin) {
        setRequests([]);
        return;
      }

      try {
        setRequestLoadError("");
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const response = await fetch("/api/onboard/requests", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          setRequestLoadError(payload.error || "Could not load saved verification reports.");
          return;
        }
        setRequests(payload.requests || []);
      } catch (error) {
        console.warn("Could not load API-backed requests.", error);
        setRequestLoadError("Could not reach the backend API to load saved verification reports.");
      }
    }

    loadSavedRequests();
  }, [isAdmin]);

  const requestSummary = useMemo(() => {
    const total = requests.length;
    const approved = requests.filter((request) => request.status === "APPROVED").length;
    const review = requests.filter(
      (request) => request.status === "HELD_FOR_REVIEW" || request.result.riskRating.verdict === "MANUAL_REVIEW",
    ).length;
    const rejected = requests.filter((request) => request.status === "REJECTED").length;
    const completionRate = total ? Math.round((approved / total) * 100) : 0;

    return { total, approved, review, rejected, completionRate };
  }, [requests]);

  const handleOnboardingComplete = (
    data: OnboardingData,
    result: VerificationResult,
    savedRequest?: OnboardingRequest | null,
  ) => {
    if (savedRequest) {
      setRequests((prev) => [savedRequest, ...prev]);
    } else {
      console.warn("Verification completed, but no API-backed request was saved.", data, result);
    }
  };

  const handleUpdateRequestStatus = async (
    id: string,
    newStatus: "APPROVED" | "REJECTED" | "HELD_FOR_REVIEW",
  ) => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch(`/api/onboard/requests/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        alert(payload.error || "Could not save status update through the backend API.");
        return;
      }
    } catch (error) {
      console.warn("Could not persist status update.", error);
      alert("Could not reach backend API to save status update.");
      return;
    }

    setRequests((prev) =>
      prev.map((request) => {
        if (request.id !== id) return request;

        return {
          ...request,
          status: newStatus,
          result: {
            ...request.result,
            riskRating: {
              ...request.result.riskRating,
              verdict: newStatus === "HELD_FOR_REVIEW" ? "MANUAL_REVIEW" : newStatus,
            },
          },
        };
      }),
    );
  };

  const handleUpdateRequestData = async (id: string, dataPatch: Partial<OnboardingData>) => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch(`/api/onboard/requests/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ data: dataPatch }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        alert(payload.error || "Could not update request data.");
        return false;
      }

      setRequests((prev) =>
        prev.map((request) =>
          request.id === id
            ? {
                ...request,
                data: {
                  ...request.data,
                  ...dataPatch,
                },
              }
            : request,
        ),
      );
      return true;
    } catch (error) {
      console.warn("Could not update request data.", error);
      alert("Could not reach backend API to update request data.");
      return false;
    }
  };

  const handleDeleteRequest = async (id: string) => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch(`/api/onboard/requests/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        alert(payload.error || "Could not delete request.");
        return false;
      }

      setRequests((prev) => prev.filter((request) => request.id !== id));
      return true;
    } catch (error) {
      console.warn("Could not delete request.", error);
      alert("Could not reach backend API to delete request.");
      return false;
    }
  };

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-teal-100 selection:text-teal-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-24 max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-start gap-3">
            <button
              onClick={() => selectTab("home")}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              aria-label="Go to home"
            >
              <Shield className="h-5 w-5" />
            </button>
            <div>
              <button
                onClick={() => selectTab("home")}
                className="block rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                <span className="block text-lg font-extrabold tracking-tight">Smart eKYC</span>
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Identity intelligence
                </span>
              </button>
            </div>
          </div>

          <nav className="hidden items-center gap-2 md:flex">
            {navItems
              .filter((item) => isAdmin || !["admin", "streams"].includes(item.id))
              .map((item) => (
                <button
                  key={item.id}
                  onClick={() => selectTab(item.id)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    activeTab === item.id
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  {item.label}
                </button>
              ))}
          </nav>

          <button
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            className="rounded-lg border border-slate-200 p-2 text-slate-700 md:hidden"
            aria-label="Toggle navigation"
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {isMobileMenuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 py-3 md:hidden">
            <div className="grid gap-2">
              {navItems
                .filter((item) => isAdmin || !["admin", "streams"].includes(item.id))
                .map((item) => (
                  <button
                    key={item.id}
                    onClick={() => selectTab(item.id)}
                    className={`rounded-lg px-3 py-2 text-left text-sm font-semibold ${
                      activeTab === item.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
            </div>
          </div>
        )}
      </header>

      <main>
        {activeTab === "home" && (
          <div className="animate-fadeIn">
            <section className="mx-auto flex min-h-[calc(100vh-4.25rem)] max-w-6xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-100 bg-teal-50 px-4 py-2 text-sm font-bold text-teal-700">
                <Zap className="h-4 w-4" />
                AI-powered identity verification
              </div>
              <h1 className="max-w-5xl text-4xl font-black tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
                Smart eKYC & Behavioral Identity Intelligence Platform
              </h1>
              <button
                onClick={() => selectTab("login")}
                className="mt-7 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                Sign In
              </button>
              <p className="mt-6 max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
                Enterprise-grade identity verification with document checks, biometric risk analysis, behavioral
                signals, and a human review console for financial onboarding teams.
              </p>
            </section>

            <section className="mx-auto max-w-7xl px-4 py-18 sm:px-6 lg:px-8">
              <div className="mx-auto max-w-3xl text-center">
                <h2 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                  Comprehensive Identity Verification
                </h2>
                <p className="mt-4 text-slate-600">
                  A layered workflow for document verification, biometrics, behavioral telemetry, and analyst review.
                </p>
              </div>

              <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {[
                  {
                    icon: Eye,
                    title: "Document OCR",
                    text: "Extract and compare user-submitted identity details against the registration form.",
                    points: ["Multi-document intake", "Tamper indicators", "Cross-reference checks"],
                    tone: "teal",
                  },
                  {
                    icon: Fingerprint,
                    title: "Face Match & Liveness",
                    text: "Compare submitted biometrics against the document portrait and liveness indicators.",
                    points: ["Similarity scoring", "Liveness indicators", "Deepfake risk checks"],
                    tone: "blue",
                  },
                  {
                    icon: BrainCircuit,
                    title: "Behavioral Biometrics",
                    text: "Assess typing cadence, mouse movement, and session-level behavior during onboarding.",
                    points: ["Bot indicators", "Anomaly scoring", "Session context"],
                    tone: "emerald",
                  },
                  {
                    icon: ShieldAlert,
                    title: "Risk Scoring",
                    text: "Combine verification signals into a clear status for approval, rejection, or review.",
                    points: ["Configurable thresholds", "Audit trail", "Explainable status"],
                    tone: "amber",
                  },
                  {
                    icon: LockKeyhole,
                    title: "Secure Intake",
                    text: "Keep personally identifiable inputs inside the existing backend-backed verification flow.",
                    points: ["Consent capture", "Transport checks", "Status persistence"],
                    tone: "rose",
                  },
                  {
                    icon: BarChart3,
                    title: "Analyst Console",
                    text: "Review actual submitted requests, inspect evidence, and record decisions.",
                    points: ["Live queue", "Evidence panels", "Manual decisions"],
                    tone: "teal",
                  },
                ].map((feature) => {
                  const Icon = feature.icon;
                  const toneClass =
                    feature.tone === "amber"
                      ? "bg-amber-50 text-amber-700"
                      : feature.tone === "rose"
                        ? "bg-rose-50 text-rose-700"
                        : feature.tone === "blue"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-teal-50 text-teal-700";

                  return (
                    <article
                      key={feature.title}
                      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className={`mb-6 flex h-12 w-12 items-center justify-center rounded-lg ${toneClass}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <h3 className="text-lg font-extrabold text-slate-950">{feature.title}</h3>
                      <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">{feature.text}</p>
                      <ul className="mt-6 space-y-3 text-sm font-medium text-slate-600">
                        {feature.points.map((point) => (
                          <li key={point} className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-teal-600" />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="bg-white">
              <div className="mx-auto max-w-5xl px-4 py-18 text-center sm:px-6 lg:px-8">
                <h2 className="text-3xl font-black tracking-tight text-slate-950">Ready to Secure Your Onboarding?</h2>
                <p className="mx-auto mt-4 max-w-2xl text-slate-600">
                  Start a new verification or inspect the analyst console to continue working with submitted cases.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <button
                    onClick={() => selectTab("onboard")}
                    className="rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-teal-700"
                  >
                    Get Started
                  </button>
                  <button
                  onClick={() => selectTab(isAdmin ? "admin" : "login")}
                    className="rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50"
                  >
                    Open Analyst Console
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === "login" && (
          <LoginPage
            onStartKyc={() => selectTab("onboard")}
            onLoginComplete={(role) => {
              setAccountRole(role);
              selectTab(role === "admin" ? "admin" : "onboard");
            }}
          />
        )}

        {activeTab === "onboard" && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {accountRole !== "guest" && (
              <div className="mb-4 rounded-lg border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-800">
                Signed in as {accountRole === "admin" ? "admin" : "customer"}.
              </div>
            )}
            <OnboardingFlow onOnboardingComplete={handleOnboardingComplete} />
          </section>
        )}

        {activeTab === "admin" && isAdmin && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {requestLoadError && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                {requestLoadError}
              </div>
            )}
            <AdminDashboard
              requests={requests}
              onUpdateRequestStatus={handleUpdateRequestStatus}
              onUpdateRequestData={handleUpdateRequestData}
              onDeleteRequest={handleDeleteRequest}
            />
          </section>
        )}

        {activeTab === "admin" && !isAdmin && (
          <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
            <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
              <h1 className="text-2xl font-black text-slate-950">Access denied</h1>
              <p className="mt-2 text-slate-600">Only the admin account can view the dashboard and audit details.</p>
              <button
                onClick={() => selectTab("login")}
                className="mt-6 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700"
              >
                Sign in as admin
              </button>
            </div>
          </section>
        )}

        {activeTab === "streams" && isAdmin && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <ContinuousFeed />
          </section>
        )}

        {activeTab === "streams" && !isAdmin && (
          <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
            <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
              <h1 className="text-2xl font-black text-slate-950">Access denied</h1>
              <p className="mt-2 text-slate-600">Only the admin account can view monitoring and audit streams.</p>
            </div>
          </section>
        )}

        {activeTab === "blueprints" && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <DeveloperCenter />
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-7 text-center text-xs text-slate-500">
        Hackathon project - Smart eKYC & Behavioral Identity Intelligence Platform
      </footer>
    </div>
  );
}
