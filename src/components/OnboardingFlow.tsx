/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Camera,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileSearch,
  FileText,
  Fingerprint,
  Gauge,
  Lock,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  Video,
} from "lucide-react";
import { OnboardingData, OnboardingRequest, VerificationResult } from "../types";

interface OnboardingFlowProps {
  onOnboardingComplete: (data: OnboardingData, result: VerificationResult, savedRequest?: OnboardingRequest | null) => void;
}

type ScenarioId = "clean" | "manually_edited" | "deepfake" | "synthetic";
type LivenessAction = "blink" | "left" | "right" | "smile";
type LivenessCheckResult = {
  passed: boolean;
  liveness_score: number;
  face_detected: boolean;
  motion_detected: boolean;
  blink_or_eye_motion_detected: boolean;
  head_motion_detected: boolean;
  reason: string;
};

const scenarios: Array<{ id: ScenarioId; label: string; description: string; outcome: string }> = [
  {
    id: "clean",
    label: "Standard verification",
    description: "Normal document and biometric risk model.",
    outcome: "Low risk",
  },
  {
    id: "manually_edited",
    label: "Document tamper risk",
    description: "Raises document editing and OCR mismatch sensitivity.",
    outcome: "Review/reject model",
  },
  {
    id: "deepfake",
    label: "Biometric spoof risk",
    description: "Raises liveness and deepfake detection sensitivity.",
    outcome: "High risk model",
  },
  {
    id: "synthetic",
    label: "Linked identity risk",
    description: "Raises device, network, and graph-link sensitivity.",
    outcome: "Manual review model",
  },
];

const stepTitles = [
  "Welcome",
  "Personal information",
  "Document upload",
  "OCR verification",
  "Selfie capture",
  "Liveness detection",
  "Review application",
  "Verification result",
];

export default function OnboardingFlow({ onOnboardingComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<number>(1);
  const [preset, setPreset] = useState<ScenarioId>("clean");
  const [formData, setFormData] = useState<OnboardingData>({
    fullName: "",
    dob: "",
    email: "",
    phone: "",
    address: "",
    documentNumber: "",
    documentType: "passport",
    documentImage: null,
    selfieImage: null,
    consentAccepted: false,
    complianceChecked: false,
  });
  const [typingKeys, setTypingKeys] = useState<number>(0);
  const typingStartTime = useRef<number>(0);
  const [typingSpeed, setTypingSpeed] = useState<number>(0);
  const mouseMoves = useRef<number>(0);
  const [mouseSpeed, setMouseSpeed] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState("");
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [applicationId, setApplicationId] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [livenessStarted, setLivenessStarted] = useState(false);
  const [livenessActions, setLivenessActions] = useState<Record<LivenessAction, boolean>>({
    blink: false,
    left: false,
    right: false,
    smile: false,
  });
  const [isLivenessChecking, setIsLivenessChecking] = useState(false);
  const [livenessResult, setLivenessResult] = useState<LivenessCheckResult | null>(null);

  const progress = Math.round((step / 8) * 100);
  const activeScenario = scenarios.find((scenario) => scenario.id === preset) || scenarios[0];

  const humanConfidence = useMemo(() => {
    const typingPenalty = typingSpeed > 0 && typingSpeed < 360 ? 0 : typingSpeed ? 12 : 4;
    const mousePenalty = mouseSpeed > 0 && mouseSpeed < 700 ? 0 : mouseSpeed ? 10 : 4;
    return Math.max(55, Math.min(100, 100 - typingPenalty - mousePenalty));
  }, [typingSpeed, mouseSpeed]);
  const livenessComplete = Boolean(livenessResult?.passed);

  useEffect(() => {
    setApplicationId(`APP-${Date.now().toString(36).toUpperCase()}`);
  }, []);

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => undefined);
    }
  }, [step, isCameraActive]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (typingKeys > 3 && typingStartTime.current > 0) {
      const durationMin = (Date.now() - typingStartTime.current) / 60000;
      if (durationMin > 0) setTypingSpeed(Math.round(typingKeys / durationMin));
    }
  }, [typingKeys]);

  const handleKeyDown = () => {
    if (typingStartTime.current === 0) typingStartTime.current = Date.now();
    setTypingKeys((prev) => prev + 1);
  };

  const handleMouseMove = () => {
    mouseMoves.current += 1;
    if (mouseMoves.current % 12 === 0) {
      setMouseSpeed(Math.round(50 + Math.random() * 220));
    }
  };

  const handleFieldChange = (field: keyof OnboardingData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleImageUpload = (field: "documentImage" | "selfieImage", file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleFieldChange(field, reader.result as string);
    reader.readAsDataURL(file);
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const startCamera = async () => {
    setCameraError("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not available in this browser.");
      return;
    }

    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      console.error(error);
      setCameraError("Camera permission was blocked or no camera was found. Allow camera access and try again.");
      setIsCameraActive(false);
    }
  };

  const captureLiveSelfie = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError("Camera is not ready yet. Wait a moment and try again.");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    handleFieldChange("selfieImage", canvas.toDataURL("image/jpeg", 0.92));
    setLivenessStarted(false);
    setLivenessActions({ blink: false, left: false, right: false, smile: false });
    setLivenessResult(null);
    stopCamera();
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  };

  const runLivenessCheck = async () => {
    setCameraError("");
    setLivenessResult(null);
    setIsLivenessChecking(true);

    try {
      if (!isCameraActive) {
        await startCamera();
        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      setLivenessStarted(true);
      const frames: string[] = [];
      for (let index = 0; index < 18; index += 1) {
        const frame = captureFrame();
        if (frame) frames.push(frame);
        await new Promise((resolve) => setTimeout(resolve, 220));
      }

      const response = await fetch("/api/liveness/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Liveness check failed.");
      }

      setLivenessResult(payload.liveness);
      setLivenessActions({
        blink: Boolean(payload.liveness.blink_or_eye_motion_detected),
        left: Boolean(payload.liveness.head_motion_detected),
        right: Boolean(payload.liveness.head_motion_detected),
        smile: Boolean(payload.liveness.motion_detected),
      });
    } catch (error: any) {
      console.error(error);
      setCameraError(error.message || "Could not complete liveness check.");
    } finally {
      setIsLivenessChecking(false);
      stopCamera();
    }
  };

  const processOnboarding = async () => {
    setIsProcessing(true);
    setVerificationResult(null);

    const stages = [
      "Validating consent and encrypted session context...",
      "Extracting document fields and OCR confidence...",
      "Checking document tamper and metadata risk...",
      "Comparing biometric capture against document evidence...",
      "Assessing liveness, behavior, and device signals...",
      "Compiling explainable risk decision...",
    ];

    for (const stage of stages) {
      setProcessingStage(stage);
      await new Promise((resolve) => setTimeout(resolve, 650));
    }

    try {
      const fingerprintRes = await fetch("/api/security/fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset, screenRes: `${window.innerWidth}x${window.innerHeight}` }),
      });
      const fingerData = await fingerprintRes.json();

      const onboardRes = await fetch("/api/onboard/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingData: formData,
          fingerprint: fingerData.fingerprint,
          telemetry: { typingSpeed, mouseSpeed },
          preset,
          livenessActions,
          livenessResult,
        }),
      });

      const finalKycResult = await onboardRes.json();
      if (finalKycResult.success) {
        setVerificationResult(finalKycResult.result);
        onOnboardingComplete(formData, finalKycResult.result, finalKycResult.request);
        setStep(8);
        if (!finalKycResult.request) {
          alert("Verification completed, but it was not saved. Check backend environment keys and server logs.");
        }
      } else {
        alert("Server failed to compute AI risk scoring: " + finalKycResult.error);
      }
    } catch (err) {
      console.error(err);
      alert("Error reaching full-stack verification endpoints.");
    } finally {
      setIsProcessing(false);
    }
  };

  const resetFlow = () => {
    setStep(1);
    setVerificationResult(null);
    setProcessingStage("");
    setApplicationId(`APP-${Date.now().toString(36).toUpperCase()}`);
    stopCamera();
    setCameraError("");
    setLivenessStarted(false);
    setLivenessActions({ blink: false, left: false, right: false, smile: false });
    setLivenessResult(null);
    setFormData({
      fullName: "",
      dob: "",
      email: "",
      phone: "",
      address: "",
      documentNumber: "",
      documentType: "passport",
      documentImage: null,
      selfieImage: null,
      consentAccepted: false,
      complianceChecked: false,
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" onMouseMove={handleMouseMove}>
      <div className="border-b border-slate-200 bg-white">
        <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-teal-700">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-black text-slate-950">Smart eKYC Verification</h2>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                  {stepTitles[step - 1]}
                </span>
              </div>
              <p className="text-xs text-slate-500">{applicationId}</p>
            </div>
          </div>
          <div className="text-sm font-bold text-slate-600">Step {step} of 8</div>
        </div>
        <div className="h-1.5 bg-slate-100">
          <div className="h-full bg-teal-600 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid min-h-[620px] lg:grid-cols-[1fr_340px]">
        <div className="px-5 py-8 md:px-8 lg:px-12">
          {step === 1 && (
            <div className="mx-auto flex max-w-3xl flex-col items-center justify-center py-8 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                <ShieldCheck className="h-9 w-9" />
              </div>
              <h1 className="mt-6 text-3xl font-black tracking-tight text-slate-950">Welcome to KYC Verification</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                Complete identity verification through a guided workflow. You will provide profile details, upload your
                own identity document, capture a live face image, complete liveness checks, and review everything before submission.
              </p>

              <div className="mt-10 grid w-full gap-4 md:grid-cols-2">
                {[
                  { icon: FileText, title: "Upload documents", text: "Provide your own readable identity document image." },
                  { icon: Camera, title: "Live face capture", text: "Use your camera to capture a real-time face image." },
                  { icon: BrainCircuit, title: "AI analysis", text: "Risk scoring runs through backend verification APIs." },
                  { icon: CheckCircle2, title: "Get verified", text: "Receive an approve, reject, or manual review result." },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-left">
                      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="font-black text-slate-950">{item.title}</h3>
                      <p className="mt-1 text-sm leading-5 text-slate-600">{item.text}</p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 w-full rounded-lg border border-teal-100 bg-teal-50 p-5 text-left">
                <h3 className="font-black text-slate-950">What you will need</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  <li className="flex gap-2"><span className="text-teal-700">•</span> A readable identity document image</li>
                  <li className="flex gap-2"><span className="text-teal-700">•</span> A clear selfie or portrait image</li>
                  <li className="flex gap-2"><span className="text-teal-700">•</span> Consent to process the verification request</li>
                </ul>
              </div>

              <button
                onClick={() => setStep(2)}
                className="mt-8 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-teal-700"
              >
                Start Verification <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="mx-auto max-w-2xl">
              <h1 className="text-2xl font-black text-slate-950">Personal Information</h1>
              <p className="mt-1 text-sm text-slate-600">Enter details exactly as they appear on your document.</p>
              <div className="mt-7 space-y-4">
                {[
                  { field: "fullName", label: "Full Name", type: "text", placeholder: "Enter full legal name" },
                  { field: "email", label: "Email Address", type: "email", placeholder: "Enter email address" },
                  { field: "phone", label: "Phone Number", type: "tel", placeholder: "Enter phone number" },
                  { field: "dob", label: "Date of Birth", type: "date", placeholder: "" },
                ].map((input) => (
                  <label key={input.field} className="block">
                    <span className="text-sm font-bold text-slate-700">{input.label}</span>
                    <input
                      type={input.type}
                      value={formData[input.field as keyof OnboardingData] as string}
                      onKeyDown={handleKeyDown}
                      onChange={(event) => handleFieldChange(input.field as keyof OnboardingData, event.target.value)}
                      placeholder={input.placeholder}
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep(1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!formData.fullName || !formData.email || !formData.phone || !formData.dob}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="mx-auto max-w-3xl">
              <h1 className="text-2xl font-black text-slate-950">Upload Identity Document</h1>
              <p className="mt-1 text-sm text-slate-600">
                Choose the document type and upload a clear image. Nothing is prefilled from the sample references.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { id: "passport", label: "Passport" },
                  { id: "aadhaar", label: "Aadhaar" },
                  { id: "pan", label: "PAN" },
                  { id: "driver_license", label: "Driving License" },
                ].map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleFieldChange("documentType", doc.id)}
                    className={`rounded-lg border px-3 py-3 text-sm font-bold ${
                      formData.documentType === doc.id
                        ? "border-teal-700 bg-teal-600 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {doc.label}
                  </button>
                ))}
              </div>
              <label className="mt-6 block">
                <span className="text-sm font-bold text-slate-700">Document Number</span>
                <input
                  type="text"
                  value={formData.documentNumber || ""}
                  onKeyDown={handleKeyDown}
                  onChange={(event) => handleFieldChange("documentNumber", event.target.value)}
                  placeholder="Enter the ID number printed on the document"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm uppercase outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>
              <div className="mt-6 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                {formData.documentImage ? (
                  <div className="mx-auto max-w-sm">
                    <img src={formData.documentImage} alt="Uploaded identity document" className="aspect-[3/2] w-full rounded-lg object-cover" />
                    <button onClick={() => handleFieldChange("documentImage", null)} className="mt-3 text-sm font-bold text-rose-600">
                      Remove document
                    </button>
                  </div>
                ) : (
                  <label className="mx-auto flex max-w-sm cursor-pointer flex-col items-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
                      <Upload className="h-6 w-6" />
                    </span>
                    <span className="mt-4 font-black text-slate-950">Click to upload document</span>
                    <span className="mt-1 text-sm text-slate-500">PNG or JPG image</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => handleImageUpload("documentImage", event.target.files?.[0])} />
                  </label>
                )}
              </div>
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep(2)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  disabled={!formData.documentImage || !formData.documentNumber}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  Continue to OCR <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="mx-auto flex max-w-2xl flex-col items-center py-12 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                <RefreshCw className="h-9 w-9 animate-spin" />
              </div>
              <h1 className="mt-6 text-2xl font-black text-slate-950">OCR Verification</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
                The document image is ready for backend OCR and tamper analysis. Continue when you are ready to move to
                biometric capture.
              </p>
              <div className="mt-8 w-full rounded-lg border border-slate-200 bg-slate-50 p-5 text-left">
                <div className="flex items-center gap-3">
                  <FileCheck2 className="h-5 w-5 text-teal-700" />
                  <div>
                    <h3 className="font-black text-slate-950">Document queued for verification</h3>
                    <p className="text-sm text-slate-600">Tamper detection, field extraction, and identity matching will run on submission.</p>
                  </div>
                </div>
              </div>
              <div className="mt-8 flex w-full justify-between">
                <button onClick={() => setStep(3)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button onClick={() => setStep(5)} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700">
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="mx-auto max-w-3xl">
              <h1 className="text-2xl font-black text-slate-950">Live Face Capture</h1>
              <p className="mt-1 text-sm text-slate-600">
                Start your camera and capture a live face image. The app does not use sample face data.
              </p>

              <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                {formData.selfieImage ? (
                  <div className="p-5">
                    <div className="relative mx-auto max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <img src={formData.selfieImage} alt="Captured live face" className="aspect-video w-full object-cover" />
                      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm">
                        Live face captured
                      </span>
                    </div>
                    <div className="mt-4 flex justify-center gap-3">
                      <button
                        onClick={() => {
                          handleFieldChange("selfieImage", null);
                          setLivenessStarted(false);
                          setLivenessActions({ blink: false, left: false, right: false, smile: false });
                        }}
                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Retake capture
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-5">
                    <div className="relative mx-auto max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
                      {isCameraActive ? (
                        <video
                          ref={videoRef}
                          autoPlay
                          muted
                          playsInline
                          className="aspect-video w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-video flex-col items-center justify-center bg-white text-center">
                          <Video className="h-10 w-10 text-slate-400" />
                          <p className="mt-3 text-sm font-bold text-slate-700">Camera is not active</p>
                          <p className="mt-1 max-w-sm text-xs text-slate-500">
                            Click start camera and allow browser camera permission.
                          </p>
                        </div>
                      )}

                      {isCameraActive && (
                        <>
                          <div className="pointer-events-none absolute inset-6 rounded-full border-4 border-emerald-500/80" />
                          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm">
                            Align face inside the guide
                          </span>
                        </>
                      )}
                    </div>

                    {cameraError && (
                      <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
                        {cameraError}
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap justify-center gap-3">
                      <button
                        onClick={startCamera}
                        className="inline-flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-700 hover:bg-teal-100"
                      >
                        <Video className="h-4 w-4" /> Start camera
                      </button>
                      <button
                        onClick={captureLiveSelfie}
                        disabled={!isCameraActive}
                        className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
                      >
                        <Camera className="h-4 w-4" /> Capture photo
                      </button>
                      {isCameraActive && (
                        <button
                          onClick={stopCamera}
                          className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                        >
                          Stop camera
                        </button>
                      )}
                    </div>
                    <canvas ref={canvasRef} className="hidden" />
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {["Good lighting", "Face visible", "No document glare"].map((tip) => (
                  <div key={tip} className="rounded-lg border border-slate-200 bg-white p-4 text-center text-sm font-bold text-slate-600">
                    {tip}
                  </div>
                ))}
              </div>
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep(4)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={() => {
                    stopCamera();
                    setStep(6);
                  }}
                  disabled={!formData.selfieImage}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  Continue to Liveness <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="mx-auto max-w-3xl">
              <h1 className="text-2xl font-black text-slate-950">Liveness Detection</h1>
              <p className="mt-1 text-sm text-slate-600">
                Keep your full face inside the frame, blink once, and make a small left-right head movement while the check runs.
              </p>

              <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-5">
                <div className="relative mx-auto max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {isCameraActive ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="aspect-video w-full object-cover"
                    />
                  ) : formData.selfieImage ? (
                    <img src={formData.selfieImage} alt="Captured face preview" className="aspect-video w-full object-cover" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center text-slate-400">No face capture available</div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/70 to-transparent p-4">
                    <p className="text-sm font-bold text-white">
                      {isLivenessChecking
                        ? "Keep your full face visible, blink once, and make a small left-right head movement."
                        : livenessResult
                          ? livenessResult.reason
                          : "Run the live challenge to continue."}
                    </p>
                  </div>
                </div>

                {cameraError && (
                  <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
                    {cameraError}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button
                    onClick={runLivenessCheck}
                    disabled={isLivenessChecking}
                    className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    {isLivenessChecking ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                    {isLivenessChecking ? "Checking liveness..." : "Run liveness challenge"}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  { key: "blink", label: "Blink or eye-state change detected" },
                  { key: "left", label: "Head movement detected" },
                  { key: "right", label: "Face consistently detected" },
                  { key: "smile", label: "Natural frame motion detected" },
                ].map((action) => {
                  const passed =
                    action.key === "right"
                      ? Boolean(livenessResult?.face_detected)
                      : Boolean(livenessActions[action.key as LivenessAction]);

                  return (
                    <div
                      key={action.key}
                      className={`flex items-center gap-3 rounded-lg border p-4 text-left font-bold transition ${
                        passed
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <CheckCircle2 className={`h-5 w-5 ${passed ? "text-emerald-600" : "text-slate-400"}`} />
                      {action.label}
                    </div>
                  );
                })}
              </div>

              <div className={`mt-5 rounded-lg border p-4 text-sm text-slate-700 ${
                livenessResult?.passed
                  ? "border-emerald-100 bg-emerald-50"
                  : livenessResult
                    ? "border-rose-100 bg-rose-50"
                    : "border-teal-100 bg-teal-50"
              }`}>
                <span className="font-black text-slate-950">Liveness status:</span>{" "}
                {livenessComplete
                  ? `Verified with score ${livenessResult?.liveness_score || 0}%. You can continue to review.`
                  : livenessResult
                    ? livenessResult.reason
                    : "Run the backend liveness challenge to unlock review."}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {["Live camera used", "Captured image present", "Actions completed", "Anti-spoofing ready"].map((check, index) => (
                  <div key={check} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 font-bold text-slate-700">
                    <CheckCircle2 className={`h-5 w-5 ${
                      index === 0 && isCameraActive ? "text-teal-600" :
                      index === 1 && formData.selfieImage ? "text-teal-600" :
                      index === 2 && livenessComplete ? "text-teal-600" :
                      index === 3 && livenessComplete ? "text-teal-600" : "text-slate-300"
                    }`} />
                    {check}
                  </div>
                ))}
              </div>
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep(5)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={() => {
                    stopCamera();
                    setStep(7);
                  }}
                  disabled={!livenessComplete}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  Continue to Review <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 7 && (
            <div className="mx-auto max-w-3xl">
              <h1 className="text-2xl font-black text-slate-950">Review Your Application</h1>
              <p className="mt-1 text-sm text-slate-600">Confirm the details below before submitting for verification.</p>
              <div className="mt-6 space-y-5">
                <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                  <h2 className="mb-4 flex items-center gap-2 font-black text-slate-950"><User className="h-4 w-4" /> Personal Information</h2>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    {[
                      ["Full Name", formData.fullName],
                      ["Email", formData.email],
                      ["Phone", formData.phone],
                      ["Date of Birth", formData.dob],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="mt-1 font-bold text-slate-950">{value || "Not provided"}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                  <h2 className="mb-4 flex items-center gap-2 font-black text-slate-950"><Lock className="h-4 w-4" /> Consent</h2>
                  <div className="space-y-3">
                    <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                      <input type="checkbox" checked={formData.consentAccepted} onChange={(event) => handleFieldChange("consentAccepted", event.target.checked)} className="mt-1" />
                      I authorize secure processing of my document, profile, and biometric verification data.
                    </label>
                    <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                      <input type="checkbox" checked={formData.complianceChecked} onChange={(event) => handleFieldChange("complianceChecked", event.target.checked)} className="mt-1" />
                      I confirm the submitted information is accurate and belongs to me.
                    </label>
                  </div>
                </section>
              </div>
              {isProcessing && (
                <div className="mt-6 rounded-lg border border-teal-100 bg-teal-50 p-5 text-sm font-bold text-teal-800">
                  <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />
                  {processingStage}
                </div>
              )}
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep(6)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={processOnboarding}
                  disabled={!formData.consentAccepted || !formData.complianceChecked || isProcessing}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" /> Submit Application
                </button>
              </div>
            </div>
          )}

          {step === 8 && verificationResult && (
            <div className="mx-auto max-w-3xl">
              <section className={`rounded-lg border p-8 text-center ${
                verificationResult.riskRating.verdict === "APPROVED"
                  ? "border-emerald-200 bg-emerald-50"
                  : verificationResult.riskRating.verdict === "REJECTED"
                    ? "border-rose-200 bg-rose-50"
                    : "border-amber-200 bg-amber-50"
              }`}>
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white text-teal-700 shadow-sm">
                  <CheckCircle2 className="h-10 w-10" />
                </div>
                <h1 className="mt-6 text-3xl font-black text-slate-950">
                  {verificationResult.riskRating.verdict === "APPROVED"
                    ? "Application Approved"
                    : verificationResult.riskRating.verdict === "REJECTED"
                      ? "Application Rejected"
                      : "Manual Review Required"}
                </h1>
                <p className="mt-3 text-slate-600">Application ID: <span className="font-bold">{applicationId}</span></p>
              </section>
              <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-5 flex items-center gap-2 text-xl font-black text-slate-950">
                  <Gauge className="h-5 w-5 text-teal-700" /> Risk Assessment Breakdown
                </h2>
                <div className="rounded-lg bg-slate-50 p-5">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-slate-950">Fraud Risk Score</span>
                    <span className="text-3xl font-black text-teal-700">{verificationResult.riskRating.overallScore}%</span>
                  </div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-teal-600" style={{ width: `${verificationResult.riskRating.overallScore}%` }} />
                  </div>
                </div>
                <div className="mt-6 space-y-4">
                  {[
                    ["Document OCR", verificationResult.ocrData.ocrConfidence],
                    ["Face Match", verificationResult.faceVerification.similarityPercentage],
                    ["Liveness Detection", verificationResult.livenessResult.livenessScore],
                    ["Behavioral Biometrics", 100 - verificationResult.behavioralRisk.botDetectionIndex],
                    ["Device Risk", 100 - verificationResult.deviceFingerprint.fraudRingRisk],
                    ["IP/Geo Analysis", 100 - verificationResult.syntheticIdentityRisk.graphRiskScore],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <div className="mb-2 flex justify-between text-sm font-bold">
                        <span>{label}</span>
                        <span>{Math.round(value as number)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.round(value as number)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  {verificationResult.riskRating.aiExplanation}
                </p>
              </section>
              <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-5 flex items-center gap-2 text-xl font-black text-slate-950">
                  <FileSearch className="h-5 w-5 text-teal-700" /> Extracted OCR Details
                </h2>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Name extracted from document</dt>
                    <dd className="mt-1 font-bold text-slate-950">{verificationResult.ocrData.fullNameExtracted || "Not extracted"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">DOB extracted from document</dt>
                    <dd className="mt-1 font-bold text-slate-950">{verificationResult.ocrData.dobExtracted || "Not extracted"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Document number extracted</dt>
                    <dd className="mt-1 font-bold text-slate-950">{verificationResult.ocrData.docNumberExtracted || "Not extracted"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Document number matched</dt>
                    <dd className="mt-1 font-bold text-slate-950">{verificationResult.ocrData.matchScores.docNumberMatch ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Name match score</dt>
                    <dd className="mt-1 font-bold text-slate-950">{verificationResult.ocrData.matchScores.nameSimilarity}%</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">DOB matched</dt>
                    <dd className="mt-1 font-bold text-slate-950">{verificationResult.ocrData.matchScores.dobMatch ? "Yes" : "No"}</dd>
                  </div>
                </dl>
              </section>
              <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-5 flex items-center gap-2 text-xl font-black text-slate-950">
                  <Fingerprint className="h-5 w-5 text-teal-700" /> Document Face Extraction
                </h2>
                <div className="grid gap-5 md:grid-cols-[220px_1fr]">
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    {verificationResult.faceVerification.documentFaceCropDataUrl ? (
                      <img
                        src={verificationResult.faceVerification.documentFaceCropDataUrl}
                        alt="Cropped document face"
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center px-4 text-center text-sm font-bold text-slate-400">
                        No document face crop available
                      </div>
                    )}
                  </div>
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-slate-500">Face crop extracted</dt>
                      <dd className="mt-1 font-bold text-slate-950">
                        {verificationResult.faceVerification.documentFaceDetected ? "Yes" : "No"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Crop confidence</dt>
                      <dd className="mt-1 font-bold text-slate-950">
                        {verificationResult.faceVerification.documentFaceConfidence || 0}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">DeepFace comparison source</dt>
                      <dd className="mt-1 font-bold text-slate-950">
                        {verificationResult.faceVerification.comparisonSource === "document_face_crop"
                          ? "Stored document face crop"
                          : verificationResult.faceVerification.comparisonSource === "document_face_crop_missing"
                            ? "Document face crop missing"
                          : "Full document image"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Selfie similarity score</dt>
                      <dd className="mt-1 font-bold text-slate-950">
                        {verificationResult.faceVerification.similarityPercentage}%
                      </dd>
                    </div>
                    {verificationResult.faceVerification.documentFaceCropPath ? (
                      <div className="sm:col-span-2">
                        <dt className="text-slate-500">Stored cropped face image</dt>
                        <dd className="mt-1 break-all font-bold text-slate-950">
                          {verificationResult.faceVerification.documentFaceCropPath}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </section>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button onClick={resetFlow} className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  Try Another Scenario
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0">
          <div className="space-y-5 lg:sticky lg:top-24">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="flex items-center gap-2 font-black text-slate-950">
                <Activity className="h-5 w-5 text-teal-700" /> Live Intelligence
              </h3>
              <p className="mt-1 text-sm text-slate-500">Behavioral biometric signals from this session.</p>
              <div className="mt-5 flex items-center justify-between text-sm font-bold">
                <span>Human confidence</span>
                <span className="text-teal-700">{humanConfidence}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-teal-600" style={{ width: `${humanConfidence}%` }} />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Typing</div>
                  <div className="font-black text-slate-950">{typingSpeed || 0} cpm</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Mouse</div>
                  <div className="font-black text-slate-950">{mouseSpeed || 0} px/s</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Events</div>
                  <div className="font-black text-slate-950">{typingKeys + mouseMoves.current}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Step</div>
                  <div className="font-black text-slate-950">{step}/8</div>
                </div>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                These are local session indicators used as telemetry inputs for the backend risk model.
              </p>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="flex items-center gap-2 font-black text-slate-950">
                <Sparkles className="h-5 w-5 text-teal-700" /> Demo Scenarios
              </h3>
              <p className="mt-1 text-sm text-slate-500">Choose only the risk model. No personal details are inserted.</p>
              <div className="mt-5 space-y-3">
                {scenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    onClick={() => setPreset(scenario.id)}
                    className={`w-full rounded-lg border p-4 text-left transition ${
                      preset === scenario.id
                        ? "border-teal-300 bg-teal-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="font-black text-slate-950">{scenario.label}</div>
                    <div className="mt-1 text-sm leading-5 text-slate-600">{scenario.description}</div>
                    <span className="mt-3 inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                      {scenario.outcome}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
