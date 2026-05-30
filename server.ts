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

function calculateHumanConfidence(telemetry: any) {
  const typingSpeed = telemetry?.typingSpeed || 0;
  const mouseSpeed = telemetry?.mouseSpeed || 0;
  const typingPenalty = typingSpeed > 0 && typingSpeed < 360 ? 0 : typingSpeed ? 12 : 4;
  const mousePenalty = mouseSpeed > 0 && mouseSpeed < 700 ? 0 : mouseSpeed ? 10 : 4;

  return Math.max(55, Math.min(100, 100 - typingPenalty - mousePenalty));
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
  const candidates = [
    dob,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${year}/${month}/${day}`,
  ].filter(Boolean);
  const haystack = `${extractedDob} ${extractedText}`;
  return candidates.some((candidate) => haystack.includes(candidate));
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
      address: onboardingData.address,
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
      "kyc_verifications?select=id,created_at,status,result,kyc_profiles(full_name,dob,email,phone,address,document_type,document_image,selfie_image,consent_accepted,compliance_checked)&order=created_at.desc"
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
        documentImage: row.kyc_profiles.document_image,
        selfieImage: row.kyc_profiles.selfie_image,
        consentAccepted: row.kyc_profiles.consent_accepted,
        complianceChecked: row.kyc_profiles.compliance_checked,
      },
      result: row.result,
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

    res.json({ success: true, request: updated });
  } catch (error: any) {
    console.error("Supabase status update failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Monitoring feed derived from saved verification records.
app.get("/api/monitoring/logs", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (!isSupabaseConfigured()) {
    return res.json({ success: true, logs: [], message: "Supabase is not configured; no monitoring records loaded." });
  }

  try {
    const rows = await supabaseRequest<any[]>(
      "kyc_verifications?select=id,created_at,status,result,kyc_profiles(full_name,email)&order=created_at.desc&limit=15"
    );

    const logs = rows.map((row) => {
      const riskScore = row.result?.riskRating?.overallScore || 0;
      const eventType = riskScore > 70 ? "BEHAVIOR_DRIFT" : riskScore > 30 ? "DEVICE_SWAP" : "LOGIN";
      const riskRating = riskScore > 80 ? "CRITICAL" : riskScore > 60 ? "HIGH" : riskScore > 30 ? "MEDIUM" : "LOW";
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
        cosineDistance: aiData.biometric_analysis.cosine_distance
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
    console.error("Liveness check failed:", error?.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: "Could not complete backend liveness verification. Make sure python ai_service\\flask_main.py is running.",
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
    const realOcrScore = Number(realAiData?.ocr_analysis?.ocr_consistency_score);
    const realBiometricConfidence = Number(realAiData?.biometric_analysis?.biometric_confidence);
    const realRiskScore = Number(realAiData?.fraud_risk_assessment?.risk_score);
    const realNameSimilarity = scoreNameMatch(onboardingData.fullName, extractedName, extractedText);
    const realDobMatch = dobAppearsInText(onboardingData.dob, extractedDob, extractedText);

    const nameSimilarity = realAiData ? realNameSimilarity : isSyntheticRisk ? 42 : isEditingRisk ? 72 : 98;
    const dobMatch = realAiData ? realDobMatch : !isSyntheticRisk && !isEditingRisk;
    const ocrConfidence = realAiData && Number.isFinite(realOcrScore)
      ? Math.round(realOcrScore * 100)
      : isEditingRisk ? 58 : isSyntheticRisk ? 65 : 97;
    
    const ocrMissingCritical = realAiData && (!extractedText || extractedName === "UNKNOWN" || ocrConfidence < 45);
    const detailsEditedScore = realAiData
      ? Math.max(isEditingRisk ? 92 : 12, ocrMissingCritical ? 72 : 100 - ocrConfidence)
      : isEditingRisk ? 92 : 12;
    const tamperedPhotoScore = realAiData
      ? Math.max(isEditingRisk ? 88 : 15, ocrMissingCritical ? 70 : 100 - ocrConfidence)
      : isEditingRisk ? 88 : isDeepfakeRisk ? 40 : 15;
    const metadataTraceLevel = isEditingRisk ? 95 : 10;
    const textInconsistencyDetected = realAiData ? nameSimilarity < 70 || !dobMatch || ocrMissingCritical : isEditingRisk || isSyntheticRisk;
    const forgeryConfidence = isEditingRisk ? 94 : 88;

    const similarityPercentage = realAiData && Number.isFinite(realBiometricConfidence)
      ? Math.round(realBiometricConfidence * 100)
      : isDeepfakeRisk ? 30 : isEditingRisk ? 82 : 95;
    const faceMatch = similarityPercentage >= 80;
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
      if (!faceMatch) overallScore = Math.max(overallScore, 88);
      if (!livenessComplete) overallScore = Math.max(overallScore, 82);
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
        fullNameExtracted: realAiData ? extractedName || "UNKNOWN" : isSyntheticRisk ? "JOHNATHAN DOE" : onboardingData.fullName.toUpperCase(),
        dobExtracted: realAiData ? extractedDob || "UNKNOWN" : isSyntheticRisk ? "1994-01-01" : onboardingData.dob,
        docNumberExtracted: onboardingData.documentType === "aadhaar" ? "8273 9182 3019" : "P" + Math.floor(1000000 + Math.random() * 9000000),
        expirationDate: realAiData ? realAiData.ocr_analysis?.extracted_data?.expiry || "UNKNOWN" : "2034-11-20",
        matchScores: { nameSimilarity, dobMatch, addressMatch: isSyntheticRisk ? 35 : 100 },
        ocrConfidence,
      },
      forgeryDetection: {
        detailsEditedScore,
        holagramMatch: !isEditingRisk,
        tamperedPhotoScore,
        metadataTraceLevel,
        textInconsistencyDetected,
        confidenceScore: forgeryConfidence,
      },
      faceVerification: {
        similarityPercentage,
        faceMatch,
        deepfakeConfidence,
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
      if (realAiData && !faceMatch) {
        verificationResponse.riskRating.aiExplanation = `BIOMETRIC MISMATCH DETECTED: The uploaded document portrait and live face capture did not meet the face-match threshold. Similarity was ${similarityPercentage}%, so the onboarding request was rejected for possible impersonation or forged live capture.`;
      } else if (realAiData && textInconsistencyDetected) {
        verificationResponse.riskRating.aiExplanation = `DOCUMENT DATA MISMATCH: OCR extracted "${verificationResponse.ocrData.fullNameExtracted}" and DOB "${verificationResponse.ocrData.dobExtracted}", which did not reliably match the submitted profile. The request was blocked from auto-approval and routed to risk handling.`;
      } else if (realAiData && !livenessComplete) {
        verificationResponse.riskRating.aiExplanation = `LIVENESS FAILED: ${livenessResult?.reason || "The backend liveness challenge was not verified."} The capture cannot be trusted for automatic approval, so the request was rejected pending a fresh live capture.`;
      } else if (realAiData) {
        verificationResponse.riskRating.aiExplanation = `REAL AI VERIFICATION COMPLETE: OCR, biometric comparison, behavioral telemetry, and risk scoring were evaluated from the uploaded images. OCR confidence is ${ocrConfidence}%, face similarity is ${similarityPercentage}%, and the final risk score is ${overallScore}%.`;
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
