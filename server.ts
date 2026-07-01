/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import "dotenv/config";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dns from "dns";

// Add these to the top of your server.ts (Keep your existing imports too!)
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { createClient } from '@supabase/supabase-js';

// Support node local resolution of DNS in development environments if needed
dns.setDefaultResultOrder?.("ipv4first");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Add this below your imports or above your "const app = express();" line
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Supabase with your Service Role Key (if you don't already have a client defined)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Enable large limits for base64 image uploads (selfie & document scans)
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ limit: "30mb", extended: true }));

// Lazy initializer for Gemini client to handle environment gracefully
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
      try {
        aiClient = new GoogleGenAI({
          apiKey: apiKey,
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build",
            },
          },
        });
        console.log("Successfully initialized server-side Gemini AI client.");
      } catch (e) {
        console.error("Configuring GoogleGenAI failed:", e);
      }
    }
  }
  return aiClient;
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRequest<T>(pathName: string, options: RequestInit = {}): Promise<T> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathName}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${message}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

async function getAuthenticatedUser(req: express.Request) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.");
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return null;
  }

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!userResponse.ok) {
    return null;
  }

  const user = await userResponse.json();
  const email = user.email;
  if (!email) {
    return null;
  }

  const rows = await supabaseRequest<any[]>(
    `app_accounts?email=eq.${encodeURIComponent(email)}&select=id,email,role,display_name,is_active`
  );
  let account = rows[0] || null;

  if (!account) {
    const [createdAccount] = await supabaseRequest<any[]>("app_accounts?on_conflict=email", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        email,
        role: "customer",
        display_name: user.user_metadata?.display_name || user.user_metadata?.full_name || email.split("@")[0],
        last_login_at: new Date().toISOString(),
      }),
    });
    account = createdAccount;
  } else {
    await supabaseRequest<any[]>(`app_accounts?id=eq.${account.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        last_login_at: new Date().toISOString(),
      }),
    });
  }

  return {
    email,
    role: account?.role || "customer",
    account,
  };
}

async function requireAdmin(req: express.Request, res: express.Response) {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user || user.role !== "admin" || user.account?.is_active === false) {
      res.status(403).json({
        success: false,
        error: "Admin access required.",
      });
      return null;
    }

    return user;
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
    return null;
  }
}

function toRequestStatus(verdict: "APPROVED" | "REJECTED" | "MANUAL_REVIEW") {
  return verdict === "APPROVED" ? "APPROVED" : verdict === "REJECTED" ? "REJECTED" : "HELD_FOR_REVIEW";
}

function toAccountStatus(status: "PENDING" | "APPROVED" | "REJECTED" | "HELD_FOR_REVIEW") {
  if (status === "APPROVED") return "ACTIVE";
  if (status === "REJECTED") return "REJECTED";
  if (status === "HELD_FOR_REVIEW") return "REVIEW_LOCKED";
  return "PENDING_KYC";
}

function calculateHumanConfidence(telemetry: any) {
  const typingSpeed = telemetry?.typingSpeed || 0;
  const mouseSpeed = telemetry?.mouseSpeed || 0;
  const typingPenalty = typingSpeed > 0 && typingSpeed < 360 ? 0 : typingSpeed ? 12 : 4;
  const mousePenalty = mouseSpeed > 0 && mouseSpeed < 700 ? 0 : mouseSpeed ? 10 : 4;

  return Math.max(55, Math.min(100, 100 - typingPenalty - mousePenalty));
}

function toRiskRating(score: number) {
  if (score >= 85) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function clampRiskScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
}

function compactVerificationResult(result: any) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    faceVerification: result.faceVerification
      ? {
          ...result.faceVerification,
          documentFaceCropDataUrl: null,
        }
      : result.faceVerification,
  };
}

function alertSeverity(score: number) {
  return toRiskRating(score);
}

async function safeSupabaseSideEffect(label: string, task: () => Promise<any>) {
  try {
    return await task();
  } catch (error: any) {
    console.error(`${label} failed:`, error?.message || error);
    return null;
  }
}

function buildMonitoringAssessment(eventType: string, payload: any) {
  let riskScore = Number(payload.riskScore || 0);
  const amount = Number(payload.amount || 0);
  const country = String(payload.country || "India");
  const deviceChanged = Boolean(payload.deviceChanged);
  const vpnDetected = Boolean(payload.vpnDetected);
  const repeatedActivity = Boolean(payload.repeatedActivity);
  const riskyReceiver = Boolean(payload.riskyReceiver);

  if (eventType === "TRANSACTION") {
    if (amount > 100000) riskScore += 35;
    if (amount > 500000) riskScore += 25;
    if (country.toLowerCase() !== "india") riskScore += 20;
    if (repeatedActivity) riskScore += 15;
  }

  if (eventType === "LOGIN") {
    if (deviceChanged) riskScore += 25;
    if (vpnDetected) riskScore += 30;
    if (country.toLowerCase() !== "india") riskScore += 20;
  }

  if (eventType === "AML_ALERT") {
    riskScore += 55;
    if (amount > 100000) riskScore += 20;
    if (riskyReceiver) riskScore += 20;
    if (country.toLowerCase() !== "india") riskScore += 15;
  }

  if (eventType === "FRAUD_ALERT" || eventType === "DEVICE_SWAP" || eventType === "GEOLOCATION_SWAP") {
    riskScore += 45;
    if (deviceChanged) riskScore += 20;
    if (vpnDetected) riskScore += 20;
    if (repeatedActivity) riskScore += 15;
  }

  if (eventType === "BEHAVIOR_DRIFT") {
    riskScore += 50;
    if (repeatedActivity) riskScore += 20;
  }

  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));
  const riskRating = toRiskRating(riskScore);
  const mitigationApplied = riskScore >= 85
    ? "Blocked, account suspended, and escalated to fraud operations"
    : riskScore >= 65
      ? "Held for analyst review with account restrictions"
      : riskScore >= 35
        ? "Step-up verification required"
        : "Allowed and logged";

  return { riskScore, riskRating, mitigationApplied };
}

function buildAlertForEvent(eventType: string, riskScore: number, email: string) {
  if (eventType === "AML_ALERT") {
    return {
      alertType: "AML_ALERT",
      title: "AML monitoring alert",
      message: `AML controls flagged ${email} with risk score ${riskScore}/100.`,
      actionRequired: "Freeze high-risk transfer, collect beneficiary evidence, and route to compliance review.",
    };
  }

  if (eventType === "FRAUD_ALERT" || riskScore >= 85) {
    return {
      alertType: "FRAUD_ALERT",
      title: "Fraud detection alert",
      message: `Fraud rules escalated ${email} with risk score ${riskScore}/100.`,
      actionRequired: "Block the session, suspend account access, and request fresh verification.",
    };
  }

  if (riskScore >= 65) {
    return {
      alertType: "RISK_ESCALATION",
      title: "Risk escalation",
      message: `Continuous monitoring raised ${email} to high risk.`,
      actionRequired: "Apply step-up verification and analyst review before allowing sensitive actions.",
    };
  }

  return null;
}

function dataUrlToBuffer(dataUrl?: string | null) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) return null;

  const extension = match[1].includes("png") ? "png" : "jpg";
  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeType: match[1],
    extension,
  };
}

function normalizeIdentityText(value = "") {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreNameMatch(inputName = "", extractedName = "", extractedText = "") {
  const inputTokens = normalizeIdentityText(inputName).split(" ").filter((token) => token.length > 1);
  const ocrText = normalizeIdentityText(`${extractedName} ${extractedText}`);
  if (!inputTokens.length || !ocrText) return 0;

  const matched = inputTokens.filter((token) => ocrText.includes(token)).length;
  return Math.round((matched / inputTokens.length) * 100);
}

function dobAppearsInText(dob = "", extractedDob = "", extractedText = "") {
  if (!dob) return false;
  const [year, month, day] = dob.split("-");
  const normalizedDob = [year, month, day].filter(Boolean).join("");
  const normalizedTextDates = `${extractedDob} ${extractedText}`.replace(/[^0-9]/g, "");
  const candidates = [
    dob,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${year}/${month}/${day}`,
  ].filter(Boolean);
  const haystack = `${extractedDob} ${extractedText}`;
  return candidates.some((candidate) => haystack.includes(candidate)) || normalizedTextDates.includes(normalizedDob);
}

function normalizeDocumentNumber(value = "") {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeDocumentNumberForOcr(value = "") {
  return normalizeDocumentNumber(value)
    .replace(/[OQD]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2");
}

function normalizePanByPosition(value = "") {
  const normalized = normalizeDocumentNumber(value);
  if (normalized.length !== 10) return normalized;

  const toLetter = (char: string) => char
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/5/g, "S")
    .replace(/8/g, "B")
    .replace(/2/g, "Z");
  const toDigit = (char: string) => char
    .replace(/[OQD]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2");

  return [
    ...normalized.slice(0, 5).split("").map(toLetter),
    ...normalized.slice(5, 9).split("").map(toDigit),
    ...normalized.slice(9).split("").map(toLetter),
  ].join("");
}

function extractDocumentNumberFromText(extractedText = "", documentType = "") {
  const text = normalizeIdentityText(extractedText);
  const patterns =
    documentType === "aadhaar"
      ? [/\b[0-9]{12}\b/]
      : documentType === "pan"
        ? [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/]
        : documentType === "passport"
          ? [/\b[A-Z][0-9]{7}\b/]
          : documentType === "driver_license"
            ? [/\b[A-Z]{2}[0-9]{2}[0-9]{4,11}\b/]
            : [];

  const genericPatterns = [
    /\b[A-Z]{5}[0-9]{4}[A-Z]\b/,
    /\b[0-9]{12}\b/,
    /\b[A-Z][0-9]{7}\b/,
    /\b[A-Z]{2}[0-9]{2}[0-9]{4,11}\b/,
    /\b(?:ID|NO|NUMBER|DOCUMENT|DL|LICENSE|PASSPORT|AADHAAR|PAN)\s+([A-Z0-9]{5,24})\b/,
  ];

  for (const pattern of [...patterns, ...genericPatterns]) {
    const match = text.match(pattern);
    if (match) return match[1] || match[0];
  }

  return "";
}

function documentNumberMatches(inputDocumentNumber = "", extractedDocumentNumber = "", extractedText = "") {
  const input = normalizeDocumentNumber(inputDocumentNumber);
  if (!input) return false;

  const extracted = normalizeDocumentNumber(extractedDocumentNumber);
  const text = normalizeDocumentNumber(extractedText);
  const inputOcrSafe = normalizeDocumentNumberForOcr(input);
  const extractedOcrSafe = normalizeDocumentNumberForOcr(extracted);
  const textOcrSafe = normalizeDocumentNumberForOcr(text);
  const inputPan = normalizePanByPosition(input);
  const extractedPan = normalizePanByPosition(extracted);

  return (
    extracted === input ||
    text.includes(input) ||
    extractedOcrSafe === inputOcrSafe ||
    textOcrSafe.includes(inputOcrSafe) ||
    extractedPan === inputPan ||
    text.includes(inputPan)
  );
}

async function runPythonImageVerification(onboardingData: any, telemetry: any) {
  const documentImage = dataUrlToBuffer(onboardingData?.documentImage);
  const selfieImage = dataUrlToBuffer(onboardingData?.selfieImage);
  if (!documentImage || !selfieImage) return null;

  const form = new FormData();
  form.append("document_image", documentImage.buffer, {
    filename: `document.${documentImage.extension}`,
    contentType: documentImage.mimeType,
  });
  form.append("selfie_image", selfieImage.buffer, {
    filename: `selfie.${selfieImage.extension}`,
    contentType: selfieImage.mimeType,
  });
  form.append("ip_change_detected", telemetry?.ipChangeDetected ? "true" : "false");
  form.append("request_frequency", String(telemetry?.requestFrequency || 1));

  const response = await axios.post(`${AI_SERVICE_URL}/api/verify`, form, {
    headers: { ...form.getHeaders() },
    timeout: 120000,
  });

  return response.data;
}

async function createRiskAlert(input: {
  accountId?: string | null;
  monitoringEventId?: string | null;
  alertType: string;
  severity: string;
  title: string;
  message: string;
  actionRequired: string;
}) {
  if (!isSupabaseConfigured() || !input.accountId) return null;

  const [alert] = await supabaseRequest<any[]>("risk_alerts", {
    method: "POST",
    body: JSON.stringify({
      account_id: input.accountId,
      monitoring_event_id: input.monitoringEventId || null,
      alert_type: input.alertType,
      severity: input.severity,
      title: input.title,
      message: input.message,
      action_required: input.actionRequired,
    }),
  });

  return alert;
}

async function updateAccountActivation(account: any, status: "PENDING" | "APPROVED" | "REJECTED" | "HELD_FOR_REVIEW", riskScore: number, reason: string) {
  if (!isSupabaseConfigured() || !account?.id) return null;

  const accountStatus = toAccountStatus(status);
  const active = accountStatus === "ACTIVE";
  const payload: any = {
    account_status: accountStatus,
    is_active: active,
    latest_risk_score: clampRiskScore(riskScore),
    latest_risk_rating: toRiskRating(riskScore),
  };

  if (active) {
    payload.activated_at = new Date().toISOString();
    payload.deactivated_at = null;
  } else if (accountStatus === "REJECTED") {
    payload.deactivated_at = new Date().toISOString();
  }

  const [updated] = await supabaseRequest<any[]>(`app_accounts?id=eq.${account.id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  const actionTaken = active
    ? "Account activated"
    : accountStatus === "REVIEW_LOCKED"
      ? "Account locked pending manual review"
      : "Account rejected and access disabled";

  await safeSupabaseSideEffect("Risk recalculation insert", () => supabaseRequest<any[]>("risk_recalculations", {
    method: "POST",
    body: JSON.stringify({
      account_id: account.id,
      previous_score: clampRiskScore(account.latest_risk_score || 0),
      new_score: clampRiskScore(riskScore),
      new_rating: toRiskRating(riskScore),
      reason,
      action_taken: actionTaken,
    }),
  }));

  if (status !== "APPROVED") {
    await safeSupabaseSideEffect("KYC alert insert", () => createRiskAlert({
      accountId: account.id,
      alertType: status === "REJECTED" ? "KYC_REJECTION" : "MANUAL_REVIEW",
      severity: alertSeverity(riskScore),
      title: status === "REJECTED" ? "KYC rejected" : "Manual review required",
      message: `${account.email} completed KYC with ${riskScore}/100 risk. ${reason}`,
      actionRequired: status === "REJECTED"
        ? "Keep account disabled and request a new verified submission."
        : "Review document, biometric, liveness, behavior, and device evidence before activation.",
    }));
  }

  return updated;
}

async function recalculateRiskAfterMonitoring(account: any, event: any, payload: any) {
  if (!isSupabaseConfigured() || !account?.id || !event?.id) return null;

  const previousScore = clampRiskScore(account.latest_risk_score || 0);
  const eventScore = clampRiskScore(event.risk_score);
  const riskDrift = payload.repeatedActivity ? 8 : 0;
  const newScore = clampRiskScore(Math.max(eventScore, Math.round(previousScore * 0.65 + eventScore * 0.35) + riskDrift));
  const newRating = toRiskRating(newScore);
  const shouldSuspend = newScore >= 85 || event.event_type === "FRAUD_ALERT";
  const shouldRestrict = !shouldSuspend && (newScore >= 65 || event.event_type === "AML_ALERT");

  const accountPatch: any = {
    latest_risk_score: newScore,
    latest_risk_rating: newRating,
  };

  let actionTaken = "Risk recalculated and account remains active";
  if (shouldSuspend) {
    accountPatch.account_status = "SUSPENDED";
    accountPatch.is_active = false;
    accountPatch.deactivated_at = new Date().toISOString();
    actionTaken = "Account suspended and fraud action opened";
  } else if (shouldRestrict) {
    accountPatch.account_status = "REVIEW_LOCKED";
    accountPatch.is_active = false;
    actionTaken = "Account restricted pending analyst review";
  }

  await supabaseRequest<any[]>(`app_accounts?id=eq.${account.id}`, {
    method: "PATCH",
    body: JSON.stringify(accountPatch),
  });

  const [riskRecord] = await supabaseRequest<any[]>("risk_recalculations", {
    method: "POST",
    body: JSON.stringify({
      account_id: account.id,
      monitoring_event_id: event.id,
      previous_score: previousScore,
      new_score: newScore,
      new_rating: newRating,
      reason: `${event.event_type} monitoring event changed account risk from ${previousScore} to ${newScore}.`,
      action_taken: actionTaken,
    }),
  });

  const alert = buildAlertForEvent(event.event_type, newScore, account.email);
  if (alert) {
    await createRiskAlert({
      accountId: account.id,
      monitoringEventId: event.id,
      alertType: alert.alertType,
      severity: alertSeverity(newScore),
      title: alert.title,
      message: alert.message,
      actionRequired: alert.actionRequired,
    });
  }

  return riskRecord;
}

async function saveOnboardingToSupabase(onboardingData: any, result: any, preset: string, telemetry: any) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const [account] = await supabaseRequest<any[]>("app_accounts?on_conflict=email", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      email: onboardingData.email,
      role: "customer",
      display_name: onboardingData.fullName,
      last_login_at: new Date().toISOString(),
    }),
  });

  const [profile] = await supabaseRequest<any[]>("kyc_profiles", {
    method: "POST",
    body: JSON.stringify({
      account_id: account?.id || null,
      full_name: onboardingData.fullName,
      dob: onboardingData.dob,
      email: onboardingData.email,
      phone: onboardingData.phone,
      address: onboardingData.address || "",
      document_type: onboardingData.documentType,
      document_image: onboardingData.documentImage,
      selfie_image: onboardingData.selfieImage,
      consent_accepted: onboardingData.consentAccepted,
      compliance_checked: onboardingData.complianceChecked,
    }),
  });

  const status = toRequestStatus(result.riskRating.verdict);
  const [verification] = await supabaseRequest<any[]>("kyc_verifications", {
    method: "POST",
    body: JSON.stringify({
      profile_id: profile.id,
      preset,
      status,
      result,
    }),
  });

  await supabaseRequest<any[]>("kyc_session_telemetry", {
    method: "POST",
    body: JSON.stringify({
      verification_id: verification.id,
      typing_speed: telemetry?.typingSpeed || 0,
      mouse_speed: telemetry?.mouseSpeed || 0,
      event_count: telemetry?.eventCount || 0,
      human_confidence: calculateHumanConfidence(telemetry),
      current_step: 8,
    }),
  });

  await supabaseRequest<any[]>("kyc_audit_events", {
    method: "POST",
    body: JSON.stringify({
      verification_id: verification.id,
      actor_email: onboardingData.email,
      event_type: "APPLICATION_SUBMITTED",
      old_status: null,
      new_status: status,
      notes: `Verification submitted with ${preset} risk model.`,
    }),
  });

  await safeSupabaseSideEffect("Account activation update", () => updateAccountActivation(
    account,
    status,
    result.riskRating.overallScore,
    `KYC decision ${status} from onboarding risk engine.`
  ));

  return {
    id: verification.id,
    dateCreated: verification.created_at,
    status,
    data: onboardingData,
    result,
  };
}

// API: Resolve the logged-in Supabase Auth user and app role.
app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated.",
      });
    }

    res.json({
      success: true,
      email: user.email,
      role: user.role,
      displayName: user.account?.display_name || null,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API: Read persisted Supabase onboarding requests for the admin dashboard.
app.get("/api/onboard/requests", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (!isSupabaseConfigured()) {
    return res.json({ success: true, requests: [], message: "Supabase is not configured; no database records loaded." });
  }

  try {
    const rows = await supabaseRequest<any[]>(
      "kyc_verifications?select=id,created_at,status,result,kyc_profiles(full_name,dob,email,phone,address,document_type,consent_accepted,compliance_checked)&order=created_at.desc"
    );

    const requests = rows.map((row) => ({
      id: row.id,
      dateCreated: row.created_at,
      status: row.status,
      data: {
        fullName: row.kyc_profiles.full_name,
        dob: row.kyc_profiles.dob,
        email: row.kyc_profiles.email,
        phone: row.kyc_profiles.phone,
        address: row.kyc_profiles.address,
        documentType: row.kyc_profiles.document_type,
        documentImage: null,
        selfieImage: null,
        consentAccepted: row.kyc_profiles.consent_accepted,
        complianceChecked: row.kyc_profiles.compliance_checked,
      },
      result: compactVerificationResult(row.result),
    }));

    res.json({ success: true, requests });
  } catch (error: any) {
    console.error("Supabase request list failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Persist manual compliance status updates from the admin dashboard.
app.patch("/api/onboard/requests/:id/status", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ success: false, error: "Supabase is not configured; status was not saved." });
  }

  try {
    const { status } = req.body;
    const [updated] = await supabaseRequest<any[]>(`kyc_verifications?id=eq.${req.params.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, reviewed_by: admin.email }),
    });

    await safeSupabaseSideEffect("Manual account activation update", async () => {
      const rows = await supabaseRequest<any[]>(
        `kyc_verifications?id=eq.${req.params.id}&select=id,status,result,kyc_profiles(account_id,email)`
      );
      const row = rows[0];
      const profile = row?.kyc_profiles;
      if (!profile?.account_id) return null;
      const accounts = await supabaseRequest<any[]>(
        `app_accounts?id=eq.${profile.account_id}&select=id,email,latest_risk_score`
      );
      return updateAccountActivation(
        accounts[0],
        status,
        row?.result?.riskRating?.overallScore || accounts[0]?.latest_risk_score || 0,
        `Manual reviewer ${admin.email} changed verification status to ${status}.`
      );
    });

    res.json({ success: true, request: updated });
  } catch (error: any) {
    console.error("Supabase status update failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Admin update of applicant profile fields and optional verification status.
app.patch("/api/onboard/requests/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ success: false, error: "Supabase is not configured; request was not updated." });
  }

  try {
    const rows = await supabaseRequest<any[]>(
      `kyc_verifications?id=eq.${req.params.id}&select=id,status,result,profile_id,kyc_profiles(account_id,email)`
    );
    const verification = rows[0];
    if (!verification) {
      return res.status(404).json({ success: false, error: "KYC request not found." });
    }

    const { data = {}, status } = req.body || {};
    const profilePatch: any = {};
    if (typeof data.fullName === "string") profilePatch.full_name = data.fullName;
    if (typeof data.dob === "string") profilePatch.dob = data.dob;
    if (typeof data.email === "string") profilePatch.email = data.email;
    if (typeof data.phone === "string") profilePatch.phone = data.phone;
    if (typeof data.address === "string") profilePatch.address = data.address;
    if (typeof data.documentType === "string") profilePatch.document_type = data.documentType;
    if (typeof data.consentAccepted === "boolean") profilePatch.consent_accepted = data.consentAccepted;
    if (typeof data.complianceChecked === "boolean") profilePatch.compliance_checked = data.complianceChecked;

    if (Object.keys(profilePatch).length > 0) {
      await supabaseRequest<any[]>(`kyc_profiles?id=eq.${verification.profile_id}`, {
        method: "PATCH",
        body: JSON.stringify(profilePatch),
      });
    }

    let updatedVerification = verification;
    if (status) {
      const [updated] = await supabaseRequest<any[]>(`kyc_verifications?id=eq.${req.params.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, reviewed_by: admin.email }),
      });
      updatedVerification = updated;

      await safeSupabaseSideEffect("Admin edit activation update", async () => {
        const profile = verification.kyc_profiles;
        if (!profile?.account_id) return null;
        const accounts = await supabaseRequest<any[]>(
          `app_accounts?id=eq.${profile.account_id}&select=id,email,latest_risk_score`
        );
        return updateAccountActivation(
          accounts[0],
          status,
          verification?.result?.riskRating?.overallScore || accounts[0]?.latest_risk_score || 0,
          `Admin ${admin.email} edited request and set status to ${status}.`
        );
      });
    }

    await supabaseRequest<any[]>("kyc_audit_events", {
      method: "POST",
      body: JSON.stringify({
        verification_id: req.params.id,
        actor_email: admin.email,
        event_type: "ADMIN_UPDATED_REQUEST",
        old_status: verification.status,
        new_status: status || verification.status,
        notes: "Admin modified applicant verification data.",
      }),
    });

    res.json({ success: true, request: updatedVerification });
  } catch (error: any) {
    console.error("Admin request update failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Admin delete of a KYC request and its profile data.
app.delete("/api/onboard/requests/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ success: false, error: "Supabase is not configured; request was not deleted." });
  }

  try {
    const rows = await supabaseRequest<any[]>(
      `kyc_verifications?id=eq.${req.params.id}&select=id,profile_id,kyc_profiles(account_id,email)`
    );
    const verification = rows[0];
    if (!verification) {
      return res.status(404).json({ success: false, error: "KYC request not found." });
    }

    await safeSupabaseSideEffect("KYC delete audit", () => supabaseRequest<any[]>("risk_alerts", {
      method: "POST",
      body: JSON.stringify({
        account_id: verification.kyc_profiles?.account_id || null,
        alert_type: "MANUAL_REVIEW",
        severity: "MEDIUM",
        title: "KYC request deleted",
        message: `Admin ${admin.email} deleted KYC request ${req.params.id}.`,
        action_required: "Confirm deletion was intentional and request a new submission if needed.",
        status: "RESOLVED",
      }),
    }));

    await supabaseRequest<null>(`kyc_verifications?id=eq.${req.params.id}`, { method: "DELETE" });
    if (verification.profile_id) {
      await safeSupabaseSideEffect("KYC profile delete", () =>
        supabaseRequest<null>(`kyc_profiles?id=eq.${verification.profile_id}`, { method: "DELETE" })
      );
    }

    res.json({ success: true, deletedId: req.params.id });
  } catch (error: any) {
    console.error("Admin request delete failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Admin account CRUD operations.
app.get("/api/admin/accounts", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const accounts = await supabaseRequest<any[]>(
      "app_accounts?select=id,email,role,display_name,is_active,account_status,latest_risk_score,latest_risk_rating,last_login_at,created_at&order=created_at.desc"
    );
    res.json({ success: true, accounts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch("/api/admin/accounts/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const allowed = ["role", "display_name", "is_active", "account_status", "latest_risk_score", "latest_risk_rating"];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    const [account] = await supabaseRequest<any[]>(`app_accounts?id=eq.${req.params.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    res.json({ success: true, account });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/admin/accounts/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (admin.account?.id === req.params.id) {
      return res.status(400).json({ success: false, error: "Admins cannot delete their own active account." });
    }
    await supabaseRequest<null>(`app_accounts?id=eq.${req.params.id}`, { method: "DELETE" });
    res.json({ success: true, deletedId: req.params.id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Create real post-onboarding monitoring events.
app.post("/api/monitoring/events", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ success: false, error: "Supabase is not configured; monitoring event was not saved." });
  }

  try {
    const {
      eventType = "LOGIN",
      userName = admin.account?.display_name || "Demo User",
      email = admin.email,
      ip = req.socket.remoteAddress || "127.0.0.1",
      location = "Mumbai, India",
      device = req.headers["user-agent"] || "Browser session",
      details,
      metadata = {},
    } = req.body || {};

    const { riskScore, riskRating, mitigationApplied } = buildMonitoringAssessment(eventType, req.body || {});
    const defaultDetails = `${eventType.replace("_", " ")} monitored for ${email}. Risk score ${riskScore}/100.`;
    const accountRows = await supabaseRequest<any[]>(
      `app_accounts?email=eq.${encodeURIComponent(email)}&select=id,email,latest_risk_score,account_status,is_active`
    );
    const targetAccount = accountRows[0] || admin.account;

    const [event] = await supabaseRequest<any[]>("monitoring_events", {
      method: "POST",
      body: JSON.stringify({
        account_id: targetAccount?.id || null,
        event_type: eventType,
        user_name: userName,
        email,
        ip,
        location,
        device: String(device).slice(0, 180),
        details: details || defaultDetails,
        risk_score: riskScore,
        risk_rating: riskRating,
        mitigation_applied: mitigationApplied,
        metadata,
      }),
    });

    const riskRecord = await safeSupabaseSideEffect("Continuous risk recalculation", () =>
      recalculateRiskAfterMonitoring(targetAccount, event, req.body || {})
    );

    res.json({ success: true, event, riskRecalculation: riskRecord });
  } catch (error: any) {
    console.error("Monitoring event save failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Admin update/delete monitoring records.
app.patch("/api/monitoring/events/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const allowed = ["details", "risk_score", "risk_rating", "mitigation_applied", "metadata"];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    const [event] = await supabaseRequest<any[]>(`monitoring_events?id=eq.${req.params.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    res.json({ success: true, event });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/monitoring/events/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    await supabaseRequest<null>(`monitoring_events?id=eq.${req.params.id}`, { method: "DELETE" });
    res.json({ success: true, deletedId: req.params.id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Monitoring feed from real monitoring_events, with verification records as fallback.
app.get("/api/monitoring/logs", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (!isSupabaseConfigured()) {
    return res.json({ success: true, logs: [], message: "Supabase is not configured; no monitoring records loaded." });
  }

  try {
    const monitoringRows = await supabaseRequest<any[]>(
      "monitoring_events?select=id,created_at,event_type,user_name,email,ip,location,device,details,risk_rating,risk_score,mitigation_applied&order=created_at.desc&limit=30"
    );

    if (monitoringRows.length > 0) {
      const logs = monitoringRows.map((row) => ({
        id: row.id,
        timestamp: new Date(row.created_at).toLocaleTimeString(),
        eventType: row.event_type,
        userName: row.user_name,
        email: row.email,
        ip: row.ip,
        location: row.location,
        device: row.device,
        details: row.details,
        riskRating: row.risk_rating,
        riskScore: row.risk_score,
        mitigationApplied: row.mitigation_applied,
      }));

      return res.json({ success: true, logs });
    }

    const rows = await supabaseRequest<any[]>(
      "kyc_verifications?select=id,created_at,status,result,kyc_profiles(full_name,email)&order=created_at.desc&limit=15"
    );

    const logs = rows.map((row) => {
      const riskScore = row.result?.riskRating?.overallScore || 0;
      const eventType = riskScore > 70 ? "BEHAVIOR_DRIFT" : riskScore > 30 ? "DEVICE_SWAP" : "LOGIN";
      const riskRating = toRiskRating(riskScore);
      const fingerprint = row.result?.deviceFingerprint || {};

      return {
        id: `LOG-${row.id}`,
        timestamp: new Date(row.created_at).toLocaleTimeString(),
        eventType,
        userName: row.kyc_profiles?.full_name || "Unknown User",
        email: row.kyc_profiles?.email || "unknown@example.com",
        ip: fingerprint.ip || "unknown",
        location: fingerprint.location || "unknown",
        device: `${fingerprint.browser || "unknown browser"} / ${fingerprint.os || "unknown OS"}`,
        details: row.result?.riskRating?.aiExplanation || `Verification status updated to ${row.status}.`,
        riskRating,
        riskScore,
        mitigationApplied: row.status === "REJECTED"
          ? "Rejected by verification workflow"
          : row.status === "HELD_FOR_REVIEW"
            ? "Held for manual compliance review"
            : "Approved by verification workflow",
      };
    });

    res.json({ success: true, logs });
  } catch (error: any) {
    console.error("Monitoring log load failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Paste this endpoint directly alongside your other route definitions
app.post('/api/verify-identity', upload.fields([
  { name: 'document_image', maxCount: 1 },
  { name: 'selfie_image', maxCount: 1 }
]), async (req: any, res: any) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const profile_id = req.body.profile_id; 

    if (!profile_id) {
      return res.status(400).json({ error: "Missing 'profile_id'." });
    }
    if (!files || !files['document_image'] || !files['selfie_image']) {
      return res.status(400).json({ error: "Both 'document_image' and 'selfie_image' are required." });
    }

    const docFile = files['document_image'][0];
    const selfieFile = files['selfie_image'][0];

    const form = new FormData();
    form.append('document_image', docFile.buffer, docFile.originalname);
    form.append('selfie_image', selfieFile.buffer, selfieFile.originalname);
    form.append('ip_change_detected', req.body.ip_change_detected || 'false');
    form.append('request_frequency', req.body.request_frequency || '1');

    console.log(`Forwarding files to Python AI Service for profile_id: ${profile_id}...`);
    
    const aiResponse = await axios.post(`${AI_SERVICE_URL}/api/verify`, form, {
      headers: { ...form.getHeaders() }
    });

    const aiData = aiResponse.data;

    const isHighRisk = aiData.fraud_risk_assessment.risk_level === "High";
    const status = isHighRisk ? "REJECTED" : "APPROVED";

    const resultJsonb = {
      ocrData: {
        matchScore: aiData.ocr_analysis.ocr_consistency_score,
        extractedName: aiData.ocr_analysis.extracted_data.name,
        extractedDob: aiData.ocr_analysis.extracted_data.dob,
        expiryDate: aiData.ocr_analysis.extracted_data.expiry
      },
      biometricData: {
        isVerified: aiData.biometric_analysis.is_verified,
        confidence: aiData.biometric_analysis.biometric_confidence,
        cosineDistance: aiData.biometric_analysis.cosine_distance,
        comparisonSource: aiData.biometric_analysis.comparison_source
      },
      documentFaceData: {
        faceDetected: Boolean(aiData.document_face_analysis?.face_detected),
        croppedFacePath: aiData.document_face_analysis?.cropped_face_path || null,
        faceBox: aiData.document_face_analysis?.face_box || null,
        confidence: aiData.document_face_analysis?.confidence || 0
      },
      behavioralData: {
        score: aiData.behavioral_analysis.behavioral_score,
        ipAnomaly: aiData.behavioral_analysis.ip_anomaly,
        highFrequency: aiData.behavioral_analysis.high_frequency_flag
      },
      riskAssessment: {
        score: aiData.fraud_risk_assessment.risk_score,
        level: aiData.fraud_risk_assessment.risk_level
      }
    };

    console.log("Saving records to Supabase...");
    const { data: dbData, error: dbError } = await supabase
      .from('kyc_verifications')
      .insert([
        {
          profile_id: profile_id,
          preset: "clean", 
          status: status,  
          result: resultJsonb
        }
      ])
      .select();

    if (dbError) {
      console.error("Supabase Database Save Error:", dbError);
      return res.status(500).json({ error: "Failed to write database record.", details: dbError.message });
    }

    return res.status(200).json({
      message: "KYC verification successfully processed and logged.",
      status: status,
      record: dbData[0]
    });

  } catch (error: any) {
    console.error("KYC Verification Pipeline Failed:", error.message);
    return res.status(500).json({ error: "Internal verification pipeline error." });
  }
});




// 1. API: Device Fingerprinting Gateway
app.post("/api/liveness/check", async (req, res) => {
  try {
    const response = await axios.post(`${AI_SERVICE_URL}/api/liveness/check`, req.body, {
      timeout: 120000,
    });
    res.json({ success: true, liveness: response.data });
  } catch (error: any) {
    const upstreamStatus = error?.response?.status;
    const upstreamError = error?.response?.data?.error || error?.response?.data || error.message;
    console.error("Liveness check failed:", {
      aiServiceUrl: AI_SERVICE_URL,
      upstreamStatus,
      upstreamError,
    });
    res.status(500).json({
      success: false,
      error: upstreamStatus
        ? `AI service liveness failed with HTTP ${upstreamStatus}: ${typeof upstreamError === "string" ? upstreamError : JSON.stringify(upstreamError)}`
        : `AI service liveness request failed: ${upstreamError}`,
      aiServiceUrl: AI_SERVICE_URL,
    });
  }
});

// 1. API: Device Fingerprinting Gateway
app.post("/api/security/fingerprint", (req, res) => {
  const browserHeader = req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "182.72.196.22";
  const userLanguage = req.headers["accept-language"] || "en-US";
  
  // Realistic IP Geo Parsing
  let location = "United States (US)";
  if (ip.toString().includes("182.72") || ip.toString().startsWith("103") || ip.toString().startsWith("14")) {
    location = "Mumbai, Maharashtra (IN)";
  } else if (ip.toString().startsWith("192") || ip.toString().startsWith("127") || ip.toString().startsWith("::")) {
    location = "San Jose, California (US) - Developer Host";
  }

  // Determine platform and screen factors
  let os = "Windows 11";
  if (browserHeader.includes("Macintosh")) os = "macOS Sequoia";
  else if (browserHeader.includes("iPhone")) os = "iOS 18.2";
  else if (browserHeader.includes("Android")) os = "Android 15";
  else if (browserHeader.includes("Linux")) os = "Ubuntu Linux 24.04";

  let browser = "Chrome Enterprise (V134)";
  if (browserHeader.includes("Safari") && !browserHeader.includes("Chrome")) browser = "Safari desktop 18";
  else if (browserHeader.includes("Firefox")) browser = "Firefox Developer Edition";
  else if (browserHeader.includes("Edg")) browser = "Microsoft Edge Stable";

  // Simulate device constraints and VPN checks
  const screenRes = req.body.screenRes || "1920x1080";
  const useCasePreset = req.body.preset || "clean";

  const vpnDetected = useCasePreset === "synthetic" || useCasePreset === "deepfake";
  const proxyDetected = useCasePreset === "synthetic";
  const fraudRingRisk = useCasePreset === "synthetic" ? 85 : useCasePreset === "manually_edited" ? 45 : 12;

  const deviceFingerprint = {
    browser,
    os,
    resolution: screenRes,
    deviceId: "DEV_IDX_" + Math.random().toString(36).substring(2, 10).toUpperCase(),
    ip: Array.isArray(ip) ? ip[0] : ip,
    location,
    vpnDetected,
    proxyDetected,
    fraudRingRisk,
  };

  res.json({ success: true, fingerprint: deviceFingerprint });
});

// 2. API: Main AI KYC Verification Processor
// Supporting both client-side simulation scenarios and actual server-side Gemini analyses
app.post("/api/onboard/process", async (req, res) => {
  try {
    const { onboardingData, fingerprint, telemetry, preset, livenessActions, livenessResult } = req.body;
    const client = getGeminiClient();
    let realAiData: any = null;
    let realAiError = "";

    const hasSubmittedImages = Boolean(onboardingData?.documentImage && onboardingData?.selfieImage);

    try {
      realAiData = await runPythonImageVerification(onboardingData, telemetry);
    } catch (error: any) {
      realAiError = error?.response?.data?.error || error?.message || "Python AI verification service was unavailable.";
      console.error("Python image verification failed; falling back to guarded scoring:", realAiError);
    }

    // Default heuristics based on current credentials and preset types
    const isEditingRisk = preset === "manually_edited";
    const isDeepfakeRisk = preset === "deepfake";
    const isSyntheticRisk = preset === "synthetic";

    const extractedName = realAiData?.ocr_analysis?.extracted_data?.name || "";
    const extractedDob = realAiData?.ocr_analysis?.extracted_data?.dob || "";
    const extractedText = realAiData?.ocr_analysis?.extracted_text || "";
    const backendDocumentNumber = realAiData?.ocr_analysis?.extracted_data?.document_number || "";
    const extractedDocumentNumber =
      backendDocumentNumber && backendDocumentNumber !== "UNKNOWN"
        ? backendDocumentNumber
        : extractDocumentNumberFromText(extractedText, onboardingData.documentType);
    const realOcrScore = Number(realAiData?.ocr_analysis?.ocr_consistency_score);
    const realBiometricConfidence = Number(realAiData?.biometric_analysis?.biometric_confidence);
    const realBiometricVerified = Boolean(realAiData?.biometric_analysis?.is_verified);
    const realRiskScore = Number(realAiData?.fraud_risk_assessment?.risk_score);
    const realForgery = realAiData?.document_forgery_analysis || null;
    const realDocumentFace = realAiData?.document_face_analysis || null;
    const documentFaceDetected = Boolean(realDocumentFace?.face_detected);
    const documentFaceConfidence = Number(realDocumentFace?.confidence);
    const documentFaceCropPath = realDocumentFace?.cropped_face_path || null;
    const documentFaceCropDataUrl = realDocumentFace?.cropped_face_data_url || null;
    const biometricComparisonSource = realAiData?.biometric_analysis?.comparison_source || "document_image";
    const realForgeryScore = Number(realForgery?.forgery_score);
    const realNameSimilarity = scoreNameMatch(onboardingData.fullName, extractedName, extractedText);
    const realDobMatch = dobAppearsInText(onboardingData.dob, extractedDob, extractedText);
    const realDocNumberMatch = documentNumberMatches(onboardingData.documentNumber, extractedDocumentNumber, extractedText);

    const nameSimilarity = realAiData ? realNameSimilarity : 0;
    const dobMatch = realAiData ? realDobMatch : false;
    const docNumberMatch = realAiData ? realDocNumberMatch : false;
    const rawOcrConfidence = realAiData && Number.isFinite(realOcrScore)
      ? Math.round(realOcrScore * 100)
      : 0;
    const matchedOcrFieldCount = [
      nameSimilarity >= 70,
      dobMatch,
      docNumberMatch,
    ].filter(Boolean).length;
    const evidenceBasedOcrConfidence = matchedOcrFieldCount === 3
      ? 92
      : matchedOcrFieldCount === 2
        ? 72
        : matchedOcrFieldCount === 1
          ? 45
          : 0;
    const ocrConfidence = Math.max(rawOcrConfidence, evidenceBasedOcrConfidence);
    
    const ocrMissingCritical = realAiData && (!extractedText || matchedOcrFieldCount === 0 || ocrConfidence < 45);
    const detailsEditedScore = realAiData
      ? Math.max(
          Number(realForgery?.details_edited_score) || 0,
          isEditingRisk ? 92 : 12,
          ocrMissingCritical ? 72 : 100 - ocrConfidence,
        )
      : isEditingRisk ? 92 : 12;
    const tamperedPhotoScore = realAiData
      ? Math.max(
          Number(realForgery?.tampered_photo_score) || 0,
          isEditingRisk ? 88 : 15,
          ocrMissingCritical ? 70 : 100 - ocrConfidence,
        )
      : isEditingRisk ? 88 : isDeepfakeRisk ? 40 : 15;
    const metadataTraceLevel = realAiData
      ? Math.max(Number(realForgery?.metadata_trace_level) || 0, isEditingRisk ? 95 : 10)
      : isEditingRisk ? 95 : 10;
    const textInconsistencyDetected = realAiData
      ? nameSimilarity < 70 || !dobMatch || !docNumberMatch || ocrMissingCritical
      : isEditingRisk || isSyntheticRisk;
    const forgeryConfidence = realAiData
      ? Math.max(Number(realForgery?.confidence_score) || 0, isEditingRisk ? 94 : 70)
      : isEditingRisk ? 94 : 88;
    const realForgeryDetected = Boolean(realForgery?.forgery_detected) || (Number.isFinite(realForgeryScore) && realForgeryScore >= 0.45);

    const similarityPercentage = realAiData && Number.isFinite(realBiometricConfidence)
      ? Math.round(realBiometricConfidence * 100)
      : isDeepfakeRisk ? 30 : isEditingRisk ? 82 : 95;
    const faceMatch = realAiData ? realBiometricVerified && similarityPercentage >= 80 : similarityPercentage >= 80;
    const deepfakeConfidence = isDeepfakeRisk ? 96 : 14;

    const backendLivenessPassed = Boolean(livenessResult?.passed);
    const backendLivenessScore = Number(livenessResult?.liveness_score);
    const livenessComplete = backendLivenessPassed || (livenessActions ? Object.values(livenessActions).every(Boolean) : false);
    const eyeBlinksDetected = livenessResult?.blink_or_eye_motion_detected ? 2 : livenessComplete ? 1 : 0;
    const livenessScore = Number.isFinite(backendLivenessScore)
      ? Math.round(backendLivenessScore)
      : livenessComplete && faceMatch ? 86 : livenessComplete ? 45 : 15;

    const typingSpeed = telemetry?.typingSpeed || 135;
    const mouseSpeed = telemetry?.mouseSpeed || 420;
    const clickAnomalyIndex = isDeepfakeRisk || isSyntheticRisk ? 68 : 12;

    const sharedIpLinks = isSyntheticRisk ? 8 : 1;
    const sharedPhoneCount = isSyntheticRisk ? 5 : 1;
    const graphRiskScore = isSyntheticRisk ? 89 : 8;

    // Calculate final Risk Score based on logical aggregation
    let overallScore = realAiData && Number.isFinite(realRiskScore)
      ? Math.round(realRiskScore * 100)
      : 15; // default approved background range

    if (realAiData) {
      if (ocrMissingCritical) overallScore = Math.max(overallScore, 72);
      if (nameSimilarity < 70) overallScore = Math.max(overallScore, 76);
      if (!dobMatch) overallScore = Math.max(overallScore, 68);
      if (!docNumberMatch) overallScore = Math.max(overallScore, 74);
      if (realForgeryDetected) overallScore = Math.max(overallScore, 78);
      if (!documentFaceDetected) overallScore = Math.max(overallScore, 84);
      if (!faceMatch) overallScore = Math.max(overallScore, 88);
      if (!livenessComplete) overallScore = Math.max(overallScore, 82);
      if (
        matchedOcrFieldCount === 3 &&
        documentFaceDetected &&
        faceMatch &&
        livenessComplete &&
        !realForgeryDetected
      ) {
        overallScore = Math.min(overallScore, 28);
      }
    } else if (hasSubmittedImages && realAiError) {
      overallScore = Math.max(overallScore, 55);
    } else if (isEditingRisk) {
      overallScore = 65; // goes to Manual Review
    } else if (isDeepfakeRisk) {
      overallScore = 88; // Rejection boundary
    } else if (isSyntheticRisk) {
      overallScore = 94; // Rejection boundary
    }

    let verdict: "APPROVED" | "REJECTED" | "MANUAL_REVIEW" = "APPROVED";
    if (overallScore > 70) verdict = "REJECTED";
    else if (overallScore > 30) verdict = "MANUAL_REVIEW";

    // Standard baseline response payload
    let verificationResponse = {
      ocrData: {
        fullNameExtracted: realAiData ? extractedName || "UNKNOWN" : "AI_SERVICE_UNAVAILABLE",
        dobExtracted: realAiData
          ? extractedDob && extractedDob !== "UNKNOWN"
            ? extractedDob
            : dobMatch
              ? onboardingData.dob
              : "UNKNOWN"
          : "AI_SERVICE_UNAVAILABLE",
        docNumberExtracted: realAiData ? extractedDocumentNumber || "UNKNOWN" : "AI_SERVICE_UNAVAILABLE",
        expirationDate: realAiData ? realAiData.ocr_analysis?.extracted_data?.expiry || "UNKNOWN" : "AI_SERVICE_UNAVAILABLE",
        matchScores: { nameSimilarity, dobMatch, docNumberMatch },
        ocrConfidence,
      },
      forgeryDetection: {
        detailsEditedScore,
        holagramMatch: realAiData ? Boolean(realForgery?.hologram_match) : !isEditingRisk,
        tamperedPhotoScore,
        metadataTraceLevel,
        textInconsistencyDetected: textInconsistencyDetected || realForgeryDetected,
        confidenceScore: forgeryConfidence,
      },
      faceVerification: {
        similarityPercentage,
        faceMatch,
        deepfakeConfidence,
        comparisonSource: biometricComparisonSource,
        documentFaceDetected,
        documentFaceConfidence: Number.isFinite(documentFaceConfidence) ? Math.round(documentFaceConfidence * 100) : 0,
        documentFaceCropPath,
        documentFaceCropDataUrl,
      },
      livenessResult: {
        passed: livenessComplete && faceMatch,
        eyeBlinksDetected,
        headMovementSync: livenessComplete ? 72 : 18,
        depthConsistency: livenessComplete && faceMatch ? 75 : 30,
        textureAnalysisScore: livenessComplete && faceMatch ? 78 : 35,
        livenessScore,
      },
      deviceFingerprint: fingerprint || {
        browser: "Chrome 134",
        os: "Windows 11",
        resolution: "1920x1080",
        deviceId: "IDX_DEFAULT_3910A",
        ip: "182.72.196.22",
        location: "Mumbai, India",
        vpnDetected: false,
        proxyDetected: false,
        fraudRingRisk: 10,
      },
      behavioralRisk: {
        typingSpeed,
        mouseSpeed,
        clickAnomalyIndex,
        pastingRateScore: isSyntheticRisk ? 80 : 5,
        botDetectionIndex: isDeepfakeRisk ? 45 : 5,
      },
      syntheticIdentityRisk: {
        sharedPhoneCount,
        sharedIpLinks,
        sharedDeviceLinks: isSyntheticRisk ? 3 : 0,
        graphRiskScore,
        syntheticDetected: isSyntheticRisk,
      },
      riskRating: {
        overallScore,
        verdict,
        complianceVerdicts: {
          rbiValid: !isEditingRisk && !isSyntheticRisk,
          amlScreeningClean: !isSyntheticRisk,
          gdprCompliant: onboardingData.consentAccepted,
        },
        aiExplanation: "",
      },
      accountActivation: {
        status: toAccountStatus(toRequestStatus(verdict)),
        action: verdict === "APPROVED"
          ? "Account will be activated after the KYC record is saved."
          : verdict === "MANUAL_REVIEW"
            ? "Account remains locked until an analyst approves the case."
            : "Account is rejected and access remains disabled.",
      },
    };

    // If Gemini client is running, invoke it for a high-value real explanation or validation!
    if (client) {
      try {
        console.log("Analyzing data with real Gemini AI models...");
        const response = await client.models.generateContent({
          model: "gemini-3.5-flash",
          contents: `Create a professional risk mitigation explanation and detailed AML assessment explanation based on candidate indicators:
          - Candidate Name: ${onboardingData.fullName}
          - Document Type: ${onboardingData.documentType}
          - Target Preset Simulation: ${preset}
          - Computed System Overall Risk Score: ${overallScore}/100
          - Verdict decision: ${verdict}
          - OCR confidence: ${ocrConfidence}%
          - Name match score: ${nameSimilarity}%
          - DOB match: ${dobMatch ? "matched" : "not matched"}
          - Document number match: ${docNumberMatch ? "matched" : "not matched"}
          - Forgery indicator of photoshop editing: ${detailsEditedScore}%
          - Deepfake face probability: ${deepfakeConfidence}%
          - Behavior click anomaly: ${clickAnomalyIndex}%
          - GNN Graph risk index for Synthetic networks: ${graphRiskScore}%
          
          Guidelines: Compose 3-4 professional, precise compliance-ready sentences detailing which modules flagged threats, what risk is identified (e.g. Photoshop visual edits, lack of natural ocular blinks in liveness tests, or linked synthetic parameters like clustered IPs in Graph Analytics), and final resolution steps.`,
        });

        if (response.text) {
          verificationResponse.riskRating.aiExplanation = response.text.trim();
        }
      } catch (gemError) {
        console.error("Gemini context translation error:", gemError);
      }
    }

    // Default backup AI explanation if Gemini wasn't setup or hit an error
    if (!verificationResponse.riskRating.aiExplanation) {
      if (realAiData && realForgeryDetected) {
        verificationResponse.riskRating.aiExplanation = `DOCUMENT FORGERY DETECTED: The backend OpenCV forensics module found elevated tamper indicators (${detailsEditedScore}% edit risk, ${tamperedPhotoScore}% photo-region risk). The account is not activated automatically and the case is escalated for document review.`;
      } else if (realAiData && !documentFaceDetected) {
        verificationResponse.riskRating.aiExplanation = `DOCUMENT FACE EXTRACTION FAILED: OCR completed, but the backend could not isolate a portrait/photo region from the uploaded ${onboardingData.documentType} image. DeepFace comparison requires a stored document face crop, so the request was blocked for manual identity review.`;
      } else if (realAiData && !faceMatch) {
        verificationResponse.riskRating.aiExplanation = `BIOMETRIC MISMATCH DETECTED: The uploaded document portrait and live face capture did not meet the face-match threshold. Similarity was ${similarityPercentage}%, so the onboarding request was rejected for possible impersonation or forged live capture.`;
      } else if (realAiData && textInconsistencyDetected) {
        verificationResponse.riskRating.aiExplanation = `DOCUMENT DATA MISMATCH: OCR extracted name "${verificationResponse.ocrData.fullNameExtracted}", DOB "${verificationResponse.ocrData.dobExtracted}", and document number "${verificationResponse.ocrData.docNumberExtracted}". The submitted profile did not reliably match these document fields, so the request was blocked from auto-approval and routed to risk handling.`;
      } else if (realAiData && !livenessComplete) {
        verificationResponse.riskRating.aiExplanation = `LIVENESS FAILED: ${livenessResult?.reason || "The backend liveness challenge was not verified."} The capture cannot be trusted for automatic approval, so the request was rejected pending a fresh live capture.`;
      } else if (realAiData) {
        verificationResponse.riskRating.aiExplanation = `REAL AI VERIFICATION COMPLETE: OCR extracted document fields, the document portrait was cropped and stored, DeepFace compared that crop with the live selfie, and behavioral risk scoring was evaluated. OCR confidence is ${ocrConfidence}%, face similarity is ${similarityPercentage}%, and the final risk score is ${overallScore}%.`;
      } else if (isEditingRisk) {
        verificationResponse.riskRating.aiExplanation = `DOCUMENT FORGERY DETECTED: Convolutional neural network text OCR extracted inconsistency in date boundaries and detected font mismatch. Photo editing traces identified on photo boundaries with confidence level of ${detailsEditedScore}%. System holds onboarding session for advanced compliance forensic review.`;
      } else if (isDeepfakeRisk) {
        verificationResponse.riskRating.aiExplanation = `DEEPFAKE INTRUSION BLOCK: Biometric liveness validation failed. Eye blink count of ${eyeBlinksDetected} is severely below threshold. Facial landmarks frequency analysis identified visual edge distortions indicating static photo insertion or deepfake synthesis. Risk score exceeds acceptable limits; onboarding rejected.`;
      } else if (isSyntheticRisk) {
        verificationResponse.riskRating.aiExplanation = `SYNTHETIC IDENTITY DETECTED: Relational graph queries matching shared IPs (${sharedIpLinks}) and shared device links mapped to known fraudulent ring structures. The phone number is linked to ${sharedPhoneCount} concurrent files. Automated sanction checks and behavioral paste rates marked highly anomalous; onboarding rejected.`;
      } else {
        verificationResponse.riskRating.aiExplanation = `SIMULATION FALLBACK USED: Python AI verification did not return a live image result (${realAiError || "no uploaded image result"}). This response is not treated as a real ML decision.`;
      }
    }

    let savedRequest = null;
    try {
      savedRequest = await saveOnboardingToSupabase(onboardingData, verificationResponse, preset, telemetry);
    } catch (dbError) {
      console.error("Supabase save failed; returning computed result only:", dbError);
    }

    res.json({ success: true, result: verificationResponse, request: savedRequest });
  } catch (error: any) {
    console.error("Process handler crashed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve static frontend assets and entry points
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // SPA Fallback
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express Dev Server active on Host 0.0.0.0 (Port ${PORT})`);
  });
}

startServer();
