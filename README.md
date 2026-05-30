# AI-Driven Digital KYC Onboarding & Identity Threat Mitigation System

An enterprise-grade, secure, multi-layered digital KYC and continuous identity protection platform designed to stop advanced onboarding threats—specifically visual document forgery, webcam stream deepfakes, and synthetic identity fraud rings.

---

## 🚀 Architectural Paradigm (How It Works)

### 1. The Frontend (Client-Side)
*   **Micro-Telemetry Engine & Analytics**: Tracks user cursor displacement velocities and keystroke timing delays (keystroke interval pacing) to predict automation scripts or mechanical browser hijacks.
*   **Fluid Responsive Stepper (UX)**: A 6-step customer-centric onboarding process capturing textual profiles, document photos, biometric front portraits, and GDPR consents.
*   **Testing Scenario Simulators**: Features dynamic pre-populated threat triggers (e.g. Photoshop Tampering, Liveness Deepfake, or Synthetic IP-clusters) to let administrators instantly audit compliance outcomes.

### 2. API Request Pathways
*   **Encrypted Pipeline**: Relies on secure JSON structures passing textual criteria and base64 encoded document scans up to 20MB.
*   **Device Fingerprinting Gate**: Collects underlying network locations, client system agents, screen resolution metrics, and checks for VPN or proxy routing tunnels during step 1.
*   **AI KYC Verification Protocol**: Maps user form inputs to real-time AI classification models via the full-stack server endpoints.

### 3. The Backend (Server-Side)
*   **Express Web Services**: Coordinates requests securely on port `3000`, using Vite as development middleware and direct static bundles in production.
*   **Explainable AI Engine (XAI)**: Connects to server-side **Gemini 3.5-Flash** instances. It processes extracted OCR inputs, compares biometric similarity metrics, and converts mathematical weights into clear, compliance-ready logical justifications.

---

## 🛠️ Eight-Module Compliance & Security Pipelines

1.  **OCR Extractor Module**: Uses high-accuracy character analysis to extract passport and ID parameters, matching them against registration variables.
2.  **Visual Photoshop Forgery Detector**: Convolutional neural networks verify graphic alignments, metadata traces, and stamp hologram densities to flag edited images.
3.  **Smart Biometric Face Matching**: Calculates similarity percentages between doc avatars and active selfie biometrics using deep visual embeddings.
4.  **Liveness Verification Indicator**: Prevents webcam stream injects by tracking eye blinking patterns, head movements, and high-frequency textures.
5.  **Behavioral Analytics Engine**: Evaluates mouse movement intervals and key paste speeds, matching them against known robotic patterns.
6.  **Device Fingerprinting Gateway**: Captures device IDs, geolocated IP blocks, and routes alerts if VPN configurations match known fraud zones.
7.  **Synthetic Graph Networks Mapping**: Evaluates database nodes through Neo4j Graph Cypher paths, identifying shared phones or clusters.
8.  **Centralised Ensemble Classifier**: Combines all pipeline weights into a unified Random Forest score (0-100) to yield Approved, Review, or Rejected verdicts.

---

## 🗄️ Core Database Schemas

### PostgreSQL (Structured Customer Identity Profiles)
```sql
CREATE TABLE kyc_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    dob DATE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    consent_accepted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### MongoDB Class (Event Logs Telemetry Streams)
```json
{
  "timestamp": "2026-05-25T12:00:00Z",
  "sessionId": "SESS-W9023X",
  "eventType": "BEHAVIOR_DRIFT",
  "details": {
    "ip": "182.72.196.22",
    "location": "Mumbai, IN",
    "riskImpact": 48
  }
}
```

---

## 🐳 Docker Deployment Setup

### Dockerfile
```dockerfile
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
CMD ["npm", "run", "start"]
```

---

## ⚡ Local Verification Steps

### Prerequisite Dependencies
Verify the system has Node.js 20+ and the required keys configured:
```bash
# Define Gemini Credentials (Secure local variable)
export GEMINI_API_KEY="your-api-key"
```

1.  **Initialize packages**:
    ```bash
    npm install
    ```
2.  **Start development server**:
    ```bash
    npm run dev
    ```
3.  **Compile static binaries**:
    ```bash
    npm run build
    ```
4.  **Run production bundle**:
    ```bash
    npm run start
    ```
