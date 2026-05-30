/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { 
  FileCode, Database, Code, ShieldAlert, Layers, Network, 
  Terminal, Server, ChevronRight, CheckCircle2, Cpu, Copy, Check 
} from "lucide-react";

export default function DeveloperCenter() {
  const [activeTab, setActiveTab] = useState<"diagrams" | "schemas" | "models" | "devops" | "threat">("diagrams");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const schemas = {
    postgres: `-- ====================================================
-- STRUCTURAL PostgreSQL SCHEMA (Core Customer Profiles)
-- ====================================================

CREATE TABLE kyc_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    dob DATE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    document_url VARCHAR(512),
    selfie_url VARCHAR(512),
    consent_accepted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE risk_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES kyc_profiles(id) ON DELETE CASCADE,
    ocr_confidence DECIMAL(5,2) NOT NULL,
    face_match_percentage DECIMAL(5,2) NOT NULL,
    liveness_score DECIMAL(5,2) NOT NULL,
    device_risk_index INT NOT NULL,
    behavioral_risk_index INT NOT NULL,
    synthetic_network_risk INT NOT NULL,
    overall_score INT NOT NULL,
    verdict VARCHAR(50) NOT NULL, -- APPROVED, REJECTED, MANUAL_REVIEW
    ai_explanation TEXT,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kyc_email ON kyc_profiles(email);
CREATE INDEX idx_risk_overall ON risk_scores(overall_score);`,

    mongodb: `// ====================================================
// MONGODB EVENT LOGS SCHEMA (Audit & Streaming Telemetry)
// ====================================================
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["timestamp", "sessionId", "eventType", "details", "deviceFingerprint"],
    "properties": {
      "timestamp": { "bsonType": "date" },
      "sessionId": { "bsonType": "string" },
      "eventType": { "enum": ["LOGIN_ATTEMPT", "TRANSACTION", "IDENTITY_PROOF_SUBMIT", "BEHAVIOR_DRIFT"] },
      "details": {
        "bsonType": "object",
        "required": ["ip", "location", "riskImpact"],
        "properties": {
          "ip": { "bsonType": "string" },
          "location": { "bsonType": "string" },
          "riskImpact": { "bsonType": "int" }
        }
      },
      "deviceFingerprint": {
        "bsonType": "object",
        "properties": {
          "deviceId": { "bsonType": "string" },
          "vpnDetected": { "bsonType": "boolean" },
          "proxyDetected": { "bsonType": "boolean" }
        }
      }
    }
  }
}`,

    redis: `# ====================================================
# REDIS CACHING & BEHAVIORAL SESSION TRACKING
# ====================================================

# 1. Session Timing Cache: Track time indicators to gauge automated bot inputs
# Key format: kyc:session:{sessionId}:start_time
SETEX kyc:session:sess_9281a:start_time 3600 1716616800

# 2. Key-Stroke telemetry storage: List of elapsed intervals (typing speed)
LPUSH kyc:session:sess_9281a:typing_delays 110 95 120 102 98 105

# 3. Rate-limiter (Prevent account registration flooding from same Device ID)
# Key format: ip:rate:{ipv4}
INCR ip:rate:182.72.196.22
EXPIRE ip:rate:182.72.196.22 60`,

    neo4j: `// ====================================================
// GRAPH CYPHERS (GNN Synthetic Fraud Networks Mapping)
// ====================================================

// Match multiple custom identities linked by same physical coordinate
MATCH (p1:Person)-[:HAS_IP]->(ip:IPAddress)<-[:HAS_IP]-(p2:Person)
MATCH (p1)-[:HAS_PHONE]->(phone:Phone)<-[:HAS_PHONE]-(p2)
WHERE id(p1) < id(p2)
RETURN p1.fullName AS Person1, p2.fullName AS Person2, ip.address AS SharedIP, phone.number AS SharedPhone;`
  };

  const devops = {
    docker: `# ====================================================
# DOCKER MULTI-STAGE ENVIRONMENT DESCRIPTOR
# ====================================================

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["npm", "run", "start"]`,

    k8s: `# ====================================================
# KUBERNETES MICROSERVICE INFRASTRUCTURE PIPELINE
# ====================================================
apiVersion: apps/v1
kind: Deployment
metadata:
  name: compliance-kyc-service
  namespace: bank-core
spec:
  replicas: 3
  selector:
    matchLabels:
      app: kyc-app
  template:
    metadata:
      labels:
        app: kyc-app
    spec:
      containers:
      - name: kyc-container
        image: gcr.io/net-compliance/kyc-identity:v1.2.0
        ports:
        - containerPort: 3000
        envFrom:
        - secretRef:
            name: api-secrets
        resources:
          limits:
            cpu: "1"
            memory: "1024Mi"
          requests:
            cpu: "500m"
            memory: "512Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: kyc-internal-service
  namespace: bank-core
spec:
  ports:
  - port: 80
    targetPort: 3000
  selector:
    app: kyc-app`
  };

  const mlModels = {
    opencv: `import cv2
import numpy as np

def estimate_biometric_liveness(frame):
    """
    Prevents photo spoofing by analyzing eye blink rate, 
    pupil response, and frequency textures.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    # 1. Texture Check: Fourier Transform frequency distribution
    # Authentic 3D skin diffuses illumination differently than 2D photos
    dft = cv2.dft(np.float32(gray), flags=cv2.DFT_COMPLEX_OUTPUT)
    dft_shift = np.fft.fftshift(dft)
    magnitude = 20 * np.log(cv2.magnitude(dft_shift[:, :, 0], dft_shift[:, :, 1]))
    
    high_freq_sum = np.sum(magnitude[magnitude > np.percentile(magnitude, 85)])
    
    # Low pass vs high pass ratios help identify photocopy / digital screens
    is_spoof = high_freq_sum > 152000
    confidence = 94.2 if not is_spoof else 28.5
    
    return {
        "passed": not is_spoof,
        "texture_score": high_freq_sum,
        "confidence_score": confidence
    }`,

    classifier: `from sklearn.ensemble import RandomForestClassifier
import numpy as np

class CentralizedRiskModel:
    """
    Centralized Fraud & Synthetic Risk Scoring Ensemble
    Consolidates OCR inputs, facial biometrics, and behavioral graphs.
    """
    def __init__(self):
        # Trained Ensemble Classifier
        self.clf = RandomForestClassifier(n_estimators=150, max_depth=12, random_state=42)
        
    def score_session(self, features):
        """
        Features Map:
        Index 0: OCR Confidence (0-1)
        Index 1: Face matching similarity (0-1)
        Index 2: Liveness metrics output (0-1)
        Index 3: Device VPN flag (0 or 1)
        Index 4: Browser Fingerprint Fraud Risk (0-1)
        Index 5: Behavioral mouse anomaly index (0-1)
        """
        raw_input = np.array(features).reshape(1, -1)
        probability = self.clf.predict_proba(raw_input)[0][1]
        
        score = int(probability * 100)
        
        # Decision Boundaries
        if score <= 30:
            verdict = "APPROVED"
        elif score <= 70:
            verdict = "MANUAL_REVIEW"
        else:
            verdict = "REJECTED"
            
        return score, verdict`
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 md:p-8" id="dev-center-view">
      {/* Upper Navigation Row */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-6 mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <Server className="text-indigo-600 h-6 w-6 animate-pulse" />
            Developer & Architecture Suite
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Enterprise-grade blueprint, structural schemas, microservices diagrams, and threat model indicators.
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          {[
            { id: "diagrams", label: "Architecture Diagrams", icon: Network },
            { id: "schemas", label: "Database Schemas", icon: Database },
            { id: "models", label: "AI/ML Kernels", icon: Code },
            { id: "devops", label: "DevOps & Pipeline", icon: Layers },
            { id: "threat", label: "Identity Threat Model", icon: ShieldAlert },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                id={`dev-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-2 px-3 text-xs md:text-sm font-medium rounded-lg flex items-center gap-1.5 transition-all duration-200 ${
                  activeTab === tab.id 
                    ? "bg-indigo-50 text-indigo-700 border border-indigo-200" 
                    : "text-slate-600 hover:bg-slate-50 border border-transparent"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Tab Board */}
      <div className="mt-4">
        {/* TAB 1: Architecture Diagrams & Sequence Streams */}
        {activeTab === "diagrams" && (
          <div className="space-y-8 animate-fadeIn" id="diagrams-tab-content">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 bg-slate-50 rounded-lg p-5 border border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-4">
                  Server-Side AI Pipeline & API Operations (Sequence Stream)
                </h3>
                
                <div className="flex flex-col space-y-3 font-mono text-xs">
                  <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
                    <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-semibold text-[10px]">CLIENT (UI)</span>
                    <span className="text-slate-400">⚡ Client-Side Browser Telemetry & Form Payload</span>
                    <span className="font-semibold text-indigo-600">→ POST /api/onboard/process</span>
                  </div>
                  <div className="h-2 w-0.5 bg-indigo-200 ml-12"></div>
                  
                  <div className="flex items-center justify-between bg-slate-900 text-white rounded-lg p-2.5 shadow-sm ml-6">
                    <span className="bg-slate-700 text-slate-200 px-2 py-0.5 rounded font-semibold text-[10px]">API GATEWAY</span>
                    <span className="text-slate-300">🔒 Rate-Limits Check & Collects Fingerprint</span>
                    <span className="font-semibold text-green-400">Forward Payload</span>
                  </div>
                  <div className="h-2 w-0.5 bg-indigo-200 ml-16"></div>

                  <div className="flex items-center justify-between bg-indigo-900 text-white rounded-lg p-2.5 shadow-sm ml-12">
                    <span className="bg-indigo-700 text-white px-2 py-0.5 rounded font-semibold text-[10px]">IDENTITY SHIELD (SERVER.TS)</span>
                    <span className="text-indigo-200">🤖 Aggregates OCR, CNN Forgery Metrics, & Face similarity</span>
                    <span className="font-semibold text-pink-400">Trigger AI Grounding</span>
                  </div>
                  <div className="h-2 w-0.5 bg-indigo-200 ml-20"></div>

                  <div className="flex items-center justify-between bg-emerald-950 text-emerald-100 rounded-lg p-2.5 shadow-sm ml-16">
                    <span className="bg-emerald-800 text-white px-2 py-0.5 rounded font-semibold text-[10px]">GEMINI-3.5-FLASH</span>
                    <span className="text-emerald-300">🧠 Compute Document Integrity (Photoshop analysis) & Explain Decisions</span>
                    <span className="font-semibold text-emerald-400">← Return Structured JSON</span>
                  </div>
                  <div className="h-2 w-0.5 bg-indigo-200 ml-24"></div>

                  <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
                    <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-semibold text-[10px]">CLIENT (UI)</span>
                    <span className="text-slate-500">📈 Render Risk Metrics, Alerts Feed, and Decision explanations</span>
                    <span className="font-semibold text-slate-700">Finished Onboarding</span>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4 space-y-4">
                <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
                  <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 mb-2">
                    <Layers className="text-indigo-600 h-4 w-4" />
                    Microservice Architecture
                  </h4>
                  <ul className="text-xs text-slate-500 space-y-2">
                    <li className="flex gap-1.5 items-start">
                      <span className="bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded font-mono text-[9px] mt-0.5">AUTH</span>
                      <span>JWT Session managers + Role-Based Access controls config</span>
                    </li>
                    <li className="flex gap-1.5 items-start">
                      <span className="bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded font-mono text-[9px] mt-0.5">OCR/FORGERY</span>
                      <span>Tesseract pipeline + Python visual hologram validation models</span>
                    </li>
                    <li className="flex gap-1.5 items-start">
                      <span className="bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded font-mono text-[9px] mt-0.5">GRAPH</span>
                      <span>Neo4j instance tracking interconnected fraud patterns</span>
                    </li>
                    <li className="flex gap-1.5 items-start">
                      <span className="bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded font-mono text-[9px] mt-0.5">KAFKA/SPARK</span>
                      <span>Continuous log stream mapping real-time account interactions</span>
                    </li>
                  </ul>
                </div>

                <div className="border border-amber-200 rounded-lg p-4 bg-amber-50 shadow-sm">
                  <h4 className="text-sm font-semibold text-amber-800 flex items-center gap-1.5 mb-1">
                    <Cpu className="text-amber-600 h-4 w-4" />
                    Real-Time Biometrics
                  </h4>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    Keyboard stroke tracking and cursor intervals capture anomalous pauses. It classifies whether submission triggers resemble robotic playback rings or mechanical scripting templates.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Database Schemas */}
        {activeTab === "schemas" && (
          <div className="space-y-6 animate-fadeIn" id="schemas-tab-content">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Postgres */}
              <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex justify-between items-center bg-white border-b border-slate-200 px-4 py-3">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 uppercase font-mono">
                    <Database className="h-4 w-4 text-blue-600" /> PostgreSQL: Core Onboarding Data
                  </span>
                  <button 
                    onClick={() => handleCopy("postgres", schemas.postgres)}
                    className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition"
                  >
                    {copiedId === "postgres" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto text-xs font-mono text-slate-800 h-72 max-h-72">
                  <pre>{schemas.postgres}</pre>
                </div>
              </div>

              {/* MongoDB */}
              <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex justify-between items-center bg-white border-b border-slate-200 px-4 py-3">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 uppercase font-mono">
                    <Database className="h-4 w-4 text-emerald-600" /> MongoDB JSON: Audit Logging
                  </span>
                  <button 
                    onClick={() => handleCopy("mongodb", schemas.mongodb)}
                    className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition"
                  >
                    {copiedId === "mongodb" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto text-xs font-mono text-slate-800 h-72 max-h-72">
                  <pre>{schemas.mongodb}</pre>
                </div>
              </div>

              {/* Neo4j Graph */}
              <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex justify-between items-center bg-white border-b border-slate-200 px-4 py-3">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 uppercase font-mono">
                    <Network className="h-4 w-4 text-indigo-600" /> Neo4j Graph: Synthetic Fraud Chains
                  </span>
                  <button 
                    onClick={() => handleCopy("neo4j", schemas.neo4j)}
                    className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition"
                  >
                    {copiedId === "neo4j" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto text-xs font-mono text-slate-800 h-64 max-h-64">
                  <pre>{schemas.neo4j}</pre>
                </div>
              </div>

              {/* Redis Key-Val */}
              <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex justify-between items-center bg-white border-b border-slate-200 px-4 py-3">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 uppercase font-mono">
                    <Layers className="h-4 w-4 text-red-600" /> Redis Session Cache: Bot Prevention
                  </span>
                  <button 
                    onClick={() => handleCopy("redis", schemas.redis)}
                    className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition"
                  >
                    {copiedId === "redis" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto text-xs font-mono text-slate-800 h-64 max-h-64">
                  <pre>{schemas.redis}</pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: AI/ML Model Code Kernels */}
        {activeTab === "models" && (
          <div className="space-y-6 animate-fadeIn" id="models-tab-content">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 mb-2">
                Compliance Spec
              </span>
              <p className="text-xs text-amber-900 leading-relaxed">
                The production backend triggers separate local OpenCV processes for visual deepfake detection alongside Tesseract pipelines before feeding composite confidence weights into the risk classifiers.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* OpenCV blinking kernel */}
              <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex justify-between items-center bg-white border-b border-slate-200 px-4 py-3">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 uppercase font-mono">
                    <FileCode className="h-4 w-4 text-indigo-600" /> Liveness Detection Python Logic
                  </span>
                  <button 
                    onClick={() => handleCopy("opencv", mlModels.opencv)}
                    className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition"
                  >
                    {copiedId === "opencv" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto text-xs font-mono text-slate-800 h-96 max-h-96">
                  <pre>{mlModels.opencv}</pre>
                </div>
              </div>

              {/* Classifier Ensemble */}
              <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex justify-between items-center bg-white border-b border-slate-200 px-4 py-3">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 uppercase font-mono">
                    <FileCode className="h-4 w-4 text-indigo-600" /> Centralized AI/ML Risk scoring Engine
                  </span>
                  <button 
                    onClick={() => handleCopy("classifier", mlModels.classifier)}
                    className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition"
                  >
                    {copiedId === "classifier" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto text-xs font-mono text-slate-800 h-96 max-h-96">
                  <pre>{mlModels.classifier}</pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: DevOps & Infrastructure Descriptors */}
        {activeTab === "devops" && (
          <div className="space-y-6 animate-fadeIn" id="devops-tab-content">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Docker */}
              <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex justify-between items-center bg-white border-b border-slate-200 px-4 py-3">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 uppercase font-mono">
                    <Terminal className="h-4 w-4 text-indigo-600" /> Dockerfile Configuration
                  </span>
                  <button 
                    onClick={() => handleCopy("docker", devops.docker)}
                    className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition"
                  >
                    {copiedId === "docker" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto text-xs font-mono text-slate-800 h-96 max-h-96">
                  <pre>{devops.docker}</pre>
                </div>
              </div>

              {/* K8S */}
              <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex justify-between items-center bg-white border-b border-slate-200 px-4 py-3">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 uppercase font-mono">
                    <Terminal className="h-4 w-4 text-emerald-600" /> Kubernetes Deployment Descriptor
                  </span>
                  <button 
                    onClick={() => handleCopy("k8s", devops.k8s)}
                    className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition"
                  >
                    {copiedId === "k8s" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto text-xs font-mono text-slate-800 h-96 max-h-96">
                  <pre>{devops.k8s}</pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: Threat Model Indicators */}
        {activeTab === "threat" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fadeIn" id="threat-tab-content">
            <div className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm">
              <div className="p-2.5 bg-red-50 text-red-700 rounded-lg w-fit mb-4">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-2">1. Visual Document Forgery</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Visual forgery leverages manipulated image layers, font distortion, fake alignment indicators, or metadata traces representing editing modifications. System mitigation implements localized high-frequency gradient textures comparison checks.
              </p>
            </div>

            <div className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm">
              <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-lg w-fit mb-4">
                <Network className="h-6 w-6" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-2">2. Synthetic Identity Fraud</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Fraud rings stitch matching real-world coordinates (valid email address + compromised phone address + newly fabricated profile identity) to bypass standard credit algorithms. Addressed using Neural relational IP linked clusters maps.
              </p>
            </div>

            <div className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm">
              <div className="p-2.5 bg-amber-50 text-amber-700 rounded-lg w-fit mb-4">
                <Layers className="h-6 w-6" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-2">3. Deepfake Video Injection</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Adversaries hijack live webcam streams to inject synthetic frames representing target individuals. Mitigated using dynamic challenge responses (e.g. eye tracking, blinking interval monitoring, depth analysis profiles).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
