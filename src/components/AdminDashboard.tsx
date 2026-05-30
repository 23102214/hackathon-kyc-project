/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileSearch,
  Fingerprint,
  Mail,
  MapPin,
  Phone,
  Search,
  ShieldAlert,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { OnboardingRequest } from "../types";

interface AdminDashboardProps {
  requests: OnboardingRequest[];
  onUpdateRequestStatus: (id: string, newStatus: "APPROVED" | "REJECTED" | "HELD_FOR_REVIEW") => void;
}

type QueueFilter = "ALL" | "REVIEW" | "APPROVED" | "REJECTED";

function statusLabel(request: OnboardingRequest) {
  if (request.status === "HELD_FOR_REVIEW" || request.result.riskRating.verdict === "MANUAL_REVIEW") {
    return "Manual Review";
  }
  if (request.status === "APPROVED") return "Approved";
  if (request.status === "REJECTED") return "Rejected";
  return "Pending";
}

function riskTone(score: number) {
  if (score >= 70) return "text-rose-700 bg-rose-50 border-rose-100";
  if (score >= 40) return "text-amber-700 bg-amber-50 border-amber-100";
  return "text-emerald-700 bg-emerald-50 border-emerald-100";
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export default function AdminDashboard({ requests, onUpdateRequestStatus }: AdminDashboardProps) {
  const [selectedRequest, setSelectedRequest] = useState<OnboardingRequest | null>(requests[0] || null);
  const [filter, setFilter] = useState<QueueFilter>("ALL");
  const [search, setSearch] = useState("");
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    setSelectedRequest((current) => {
      if (current && requests.some((request) => request.id === current.id)) return current;
      return requests[0] || null;
    });
  }, [requests]);

  const summary = useMemo(() => {
    const total = requests.length;
    const approved = requests.filter((request) => request.status === "APPROVED").length;
    const review = requests.filter(
      (request) => request.status === "HELD_FOR_REVIEW" || request.result.riskRating.verdict === "MANUAL_REVIEW",
    ).length;
    const rejected = requests.filter((request) => request.status === "REJECTED").length;
    const avgScore = total
      ? Math.round(requests.reduce((sum, request) => sum + request.result.riskRating.overallScore, 0) / total)
      : 0;

    return { total, approved, review, rejected, avgScore };
  }, [requests]);

  const filteredRequests = requests.filter((request) => {
    const label = statusLabel(request);
    const matchesFilter =
      filter === "ALL" ||
      (filter === "REVIEW" && label === "Manual Review") ||
      (filter === "APPROVED" && request.status === "APPROVED") ||
      (filter === "REJECTED" && request.status === "REJECTED");
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      request.id.toLowerCase().includes(query) ||
      request.data.fullName.toLowerCase().includes(query) ||
      request.data.email.toLowerCase().includes(query);

    return matchesFilter && matchesSearch;
  });

  const currentSelection = selectedRequest
    ? requests.find((request) => request.id === selectedRequest.id) || selectedRequest
    : null;

  const metrics = [
    { label: "Total Applications", value: summary.total, icon: BarChart3, tone: "bg-teal-50 text-teal-700" },
    { label: "Approved", value: summary.approved, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
    { label: "Manual Review", value: summary.review, icon: Clock3, tone: "bg-amber-50 text-amber-700" },
    { label: "Rejected", value: summary.rejected, icon: ShieldAlert, tone: "bg-rose-50 text-rose-700" },
    { label: "Average Risk", value: `${summary.avgScore}%`, icon: AlertTriangle, tone: "bg-slate-100 text-slate-700" },
  ];

  if (showDetail && currentSelection) {
    const risk = currentSelection.result.riskRating.overallScore;
    const componentScores = [
      { label: "Document OCR", value: currentSelection.result.ocrData.ocrConfidence },
      { label: "Face Match", value: currentSelection.result.faceVerification.similarityPercentage },
      { label: "Liveness Detection", value: currentSelection.result.livenessResult.livenessScore },
      {
        label: "Behavioral Signals",
        value: 100 - currentSelection.result.behavioralRisk.botDetectionIndex,
      },
      {
        label: "Device Risk",
        value: 100 - currentSelection.result.deviceFingerprint.fraudRingRisk,
      },
      {
        label: "Network Graph",
        value: 100 - currentSelection.result.syntheticIdentityRisk.graphRiskScore,
      },
    ];

    return (
      <div className="animate-fadeIn space-y-6">
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <button
              onClick={() => setShowDetail(false)}
              className="mt-1 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Queue
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black text-slate-950">{currentSelection.id}</h1>
                <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                  {statusLabel(currentSelection)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">Submitted {currentSelection.dateCreated}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onUpdateRequestStatus(currentSelection.id, "REJECTED")}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50"
            >
              <X className="h-4 w-4" /> Reject
            </button>
            <button
              onClick={() => onUpdateRequestStatus(currentSelection.id, "APPROVED")}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
            >
              <Check className="h-4 w-4" /> Approve
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
                <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full border-8 border-amber-300 text-4xl font-black text-amber-600">
                  {risk}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-black text-slate-950">Risk Assessment</h2>
                  <div className="mt-5 space-y-3">
                    {componentScores.map((score) => (
                      <div key={score.label} className="grid grid-cols-[140px_1fr_48px] items-center gap-3 text-sm">
                        <span className="text-slate-500">{score.label}</span>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-teal-600" style={{ width: formatPercent(score.value) }} />
                        </div>
                        <span className="text-right font-bold text-slate-700">{formatPercent(score.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-7 space-y-3">
                <h3 className="text-sm font-black text-slate-950">Risk Flags</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    {
                      active: !currentSelection.result.faceVerification.faceMatch,
                      title: "Face mismatch",
                      text: "Similarity score is below the accepted threshold.",
                    },
                    {
                      active: currentSelection.result.behavioralRisk.botDetectionIndex > 35,
                      title: "Behavioral anomaly",
                      text: "Session behavior contains automation-like indicators.",
                    },
                    {
                      active: currentSelection.result.forgeryDetection.detailsEditedScore > 45,
                      title: "Document tamper signal",
                      text: "Document forensics produced elevated edit indicators.",
                    },
                    {
                      active: currentSelection.result.syntheticIdentityRisk.syntheticDetected,
                      title: "Synthetic identity graph",
                      text: "Identity graph contains linked risk nodes.",
                    },
                  ].map((flag) => (
                    <div
                      key={flag.title}
                      className={`rounded-lg border p-4 ${
                        flag.active ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-slate-900">
                        <AlertTriangle className={`h-4 w-4 ${flag.active ? "text-amber-600" : "text-slate-400"}`} />
                        {flag.title}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{flag.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                  <FileSearch className="h-5 w-5 text-teal-700" /> Document Verification
                </h2>
                <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
                  {formatPercent(currentSelection.result.ocrData.ocrConfidence)} confidence
                </span>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                  <h3 className="font-black text-slate-950">{currentSelection.data.documentType.replace("_", " ")}</h3>
                  <dl className="mt-5 space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500">Name</dt>
                      <dd className="font-bold text-slate-900">{currentSelection.result.ocrData.fullNameExtracted || "Not extracted"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500">Document</dt>
                      <dd className="font-bold text-slate-900">{currentSelection.result.ocrData.docNumberExtracted || "Not extracted"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500">DOB</dt>
                      <dd className="font-bold text-slate-900">{currentSelection.result.ocrData.dobExtracted || "Not extracted"}</dd>
                    </div>
                  </dl>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                  <h3 className="font-black text-slate-950">Face Verification</h3>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-white p-4 text-center">
                      <div className="text-2xl font-black text-amber-600">
                        {formatPercent(currentSelection.result.faceVerification.similarityPercentage)}
                      </div>
                      <div className="text-xs font-medium text-slate-500">Face Match</div>
                    </div>
                    <div className="rounded-lg bg-white p-4 text-center">
                      <div className="text-2xl font-black text-emerald-600">
                        {formatPercent(currentSelection.result.livenessResult.livenessScore)}
                      </div>
                      <div className="text-xs font-medium text-slate-500">Liveness</div>
                    </div>
                    <div className="rounded-lg bg-white p-4 text-center">
                      <div className="text-2xl font-black text-rose-600">
                        {formatPercent(currentSelection.result.faceVerification.deepfakeConfidence)}
                      </div>
                      <div className="text-xs font-medium text-slate-500">Deepfake Risk</div>
                    </div>
                    <div className="rounded-lg bg-white p-4 text-center">
                      <div className="text-2xl font-black text-slate-900">
                        {currentSelection.result.livenessResult.eyeBlinksDetected}
                      </div>
                      <div className="text-xs font-medium text-slate-500">Blink Events</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <Fingerprint className="h-5 w-5 text-teal-700" /> Behavioral Analysis
              </h2>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-4">
                  <div className="text-2xl font-black text-slate-950">
                    {currentSelection.result.behavioralRisk.typingSpeed}
                  </div>
                  <div className="text-xs font-medium text-slate-500">Typing speed</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <div className="text-2xl font-black text-slate-950">
                    {currentSelection.result.behavioralRisk.mouseSpeed}
                  </div>
                  <div className="text-xs font-medium text-slate-500">Mouse velocity</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <div className="text-2xl font-black text-slate-950">
                    {formatPercent(currentSelection.result.behavioralRisk.botDetectionIndex)}
                  </div>
                  <div className="text-xs font-medium text-slate-500">Bot index</div>
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <User className="h-5 w-5 text-slate-500" /> Applicant Information
              </h2>
              <dl className="mt-5 space-y-4 text-sm">
                <div>
                  <dt className="text-slate-500">Full Name</dt>
                  <dd className="mt-1 font-bold text-slate-950">{currentSelection.data.fullName || "Not provided"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Email</dt>
                  <dd className="mt-1 flex items-center gap-2 font-bold text-slate-950">
                    <Mail className="h-4 w-4 text-slate-400" /> {currentSelection.data.email || "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Phone</dt>
                  <dd className="mt-1 flex items-center gap-2 font-bold text-slate-950">
                    <Phone className="h-4 w-4 text-slate-400" /> {currentSelection.data.phone || "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Address</dt>
                  <dd className="mt-1 flex items-start gap-2 font-bold text-slate-950">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {currentSelection.data.address || "Not provided"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-lg border border-teal-100 bg-teal-50 p-6">
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <ShieldCheck className="h-5 w-5 text-teal-700" /> AI Explanation
              </h2>
              <p className="mt-4 text-sm leading-6 text-slate-700">
                {currentSelection.result.riskRating.aiExplanation || "No explanation returned by the backend yet."}
              </p>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">Make Decision</h2>
              <p className="mt-1 text-sm text-slate-500">Apply a final status to this backend-backed verification case.</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  onClick={() => onUpdateRequestStatus(currentSelection.id, "APPROVED")}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100"
                >
                  Approve
                </button>
                <button
                  onClick={() => onUpdateRequestStatus(currentSelection.id, "REJECTED")}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100"
                >
                  Reject
                </button>
              </div>
              <button
                onClick={() => onUpdateRequestStatus(currentSelection.id, "HELD_FOR_REVIEW")}
                className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Keep in Review
              </button>
            </section>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Manual Review Queue</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review submitted onboarding records in priority order. No sample rows are created here.
          </p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search real requests"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-100"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => {
          const Icon = metric.icon;

          return (
            <div key={metric.label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className={`mb-5 flex h-11 w-11 items-center justify-center rounded-lg ${metric.tone}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="text-3xl font-black text-slate-950">{metric.value}</div>
              <div className="mt-1 text-sm font-medium text-slate-500">{metric.label}</div>
            </div>
          );
        })}
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
              <FileCheck2 className="h-5 w-5 text-teal-700" /> Applications Pending Review
            </h2>
            <p className="mt-1 text-sm text-slate-500">Filter and inspect records produced by the onboarding flow.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "ALL", label: "All" },
              { id: "REVIEW", label: "Review" },
              { id: "APPROVED", label: "Approved" },
              { id: "REJECTED", label: "Rejected" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id as QueueFilter)}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                  filter === item.id
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
          {filteredRequests.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center bg-slate-50 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm">
                <FileSearch className="h-7 w-7" />
              </div>
              <h3 className="mt-5 text-lg font-black text-slate-950">No submitted requests found</h3>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Start an onboarding flow to create API-backed records, then return here to review them.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredRequests.map((request) => {
                const score = request.result.riskRating.overallScore;
                const selected = currentSelection?.id === request.id;

                return (
                  <button
                    key={request.id}
                    onClick={() => {
                      setSelectedRequest(request);
                      setShowDetail(true);
                    }}
                    className={`grid w-full gap-4 p-5 text-left transition hover:bg-slate-50 lg:grid-cols-[1fr_140px_220px_120px] lg:items-center ${
                      selected ? "bg-teal-50/60" : "bg-white"
                    }`}
                  >
                    <div className="flex min-w-0 gap-4">
                      <div
                        className={`mt-1 h-16 w-1 shrink-0 rounded-full ${
                          score >= 70 ? "bg-rose-500" : score >= 40 ? "bg-amber-400" : "bg-teal-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{request.id}</div>
                        <div className="mt-1 truncate text-lg font-black text-slate-950">
                          {request.data.fullName || "Unnamed applicant"}
                        </div>
                        <div className="truncate text-sm text-slate-500">{request.data.email || "No email provided"}</div>
                      </div>
                    </div>
                    <div className={`w-fit rounded-lg border px-3 py-2 text-center ${riskTone(score)}`}>
                      <div className="text-2xl font-black">{score}%</div>
                      <div className="text-xs font-semibold">Risk Score</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600">
                        {statusLabel(request)}
                      </span>
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600">
                        {request.data.documentType.replace("_", " ")}
                      </span>
                    </div>
                    <span className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white">
                      Review
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: Fingerprint,
            title: "Behavioral Analysis",
            text: "Check typing cadence, pointer movement, and automation indicators.",
          },
          {
            icon: ShieldCheck,
            title: "Face Verification",
            text: "Compare biometric capture with document evidence and liveness signals.",
          },
          {
            icon: FileSearch,
            title: "Document Review",
            text: "Verify extracted OCR details, tamper indicators, and document confidence.",
          },
        ].map((card) => {
          const Icon = card.icon;

          return (
            <article key={card.title} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-8 flex items-center gap-2 text-lg font-black text-slate-950">
                <Icon className="h-5 w-5 text-teal-700" />
                {card.title}
              </div>
              <p className="text-sm leading-6 text-slate-600">{card.text}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
