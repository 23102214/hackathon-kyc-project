/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface OnboardingData {
  fullName: string;
  dob: string;
  email: string;
  phone: string;
  address?: string;
  documentNumber?: string;
  documentType: "passport" | "aadhaar" | "pan" | "driver_license";
  documentImage: string | null; // DataURL
  selfieImage: string | null;     // DataURL
  consentAccepted: boolean;
  complianceChecked: boolean;
}

export interface VerificationResult {
  ocrData: {
    fullNameExtracted: string;
    dobExtracted: string;
    docNumberExtracted: string;
    expirationDate: string | null;
    matchScores: {
      nameSimilarity: number;
      dobMatch: boolean;
      docNumberMatch?: boolean;
    };
    ocrConfidence: number;
  };
  forgeryDetection: {
    detailsEditedScore: number; // 0-100 indicating Photoshop risk
    holagramMatch: boolean;
    tamperedPhotoScore: number;
    metadataTraceLevel: number;
    textInconsistencyDetected: boolean;
    confidenceScore: number; // overall forgery assessment confidence
  };
  faceVerification: {
    similarityPercentage: number;
    faceMatch: boolean;
    deepfakeConfidence: number; // 0-100 indicating raw deepfake risk
    comparisonSource?: string;
    documentFaceDetected?: boolean;
    documentFaceConfidence?: number;
    documentFaceCropPath?: string | null;
    documentFaceCropDataUrl?: string | null;
  };
  livenessResult: {
    passed: boolean;
    eyeBlinksDetected: number;
    headMovementSync: number;
    depthConsistency: number;
    textureAnalysisScore: number;
    livenessScore: number;
  };
  deviceFingerprint: {
    browser: string;
    os: string;
    resolution: string;
    deviceId: string;
    ip: string;
    location: string;
    vpnDetected: boolean;
    proxyDetected: boolean;
    fraudRingRisk: number;
  };
  behavioralRisk: {
    typingSpeed: number; // keys per minute
    mouseSpeed: number;  // pixels per sec
    clickAnomalyIndex: number; // 0-100
    pastingRateScore: number;
    botDetectionIndex: number;
  };
  syntheticIdentityRisk: {
    sharedPhoneCount: number;
    sharedIpLinks: number;
    sharedDeviceLinks: number;
    graphRiskScore: number;
    syntheticDetected: boolean;
  };
  riskRating: {
    overallScore: number; // 0-100
    verdict: "APPROVED" | "REJECTED" | "MANUAL_REVIEW";
    complianceVerdicts: {
      rbiValid: boolean;
      amlScreeningClean: boolean;
      gdprCompliant: boolean;
    };
    aiExplanation: string;
  };
  accountActivation?: {
    status: "PENDING_KYC" | "ACTIVE" | "REVIEW_LOCKED" | "REJECTED" | "SUSPENDED";
    action: string;
  };
}

export interface ContinuousMonitoringLog {
  id: string;
  timestamp: string;
  eventType: "LOGIN" | "TRANSACTION" | "DEVICE_SWAP" | "GEOLOCATION_SWAP" | "BEHAVIOR_DRIFT" | "AML_ALERT" | "FRAUD_ALERT";
  userName: string;
  email: string;
  ip: string;
  location: string;
  device: string;
  details: string;
  riskRating: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskScore: number;
  mitigationApplied: string;
}

export interface OnboardingRequest {
  id: string;
  dateCreated: string;
  data: OnboardingData;
  result: VerificationResult;
  status: "PENDING" | "APPROVED" | "REJECTED" | "HELD_FOR_REVIEW";
  reviewedBy?: string;
}
