
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from ai_service.modules.ocr.ocr_service import OCRService
from ai_service.modules.biometric.biometric_service import BiometricService
from ai_service.modules.behavioral.behavioral_service import BehavioralService
from ai_service.modules.risk_engine.risk_service import RiskEngine

app = FastAPI(title='IDV & Fraud Prevention Platform')

# Initialize services
ocr_svc = OCRService()
bio_svc = BiometricService()
beh_svc = BehavioralService()
risk_engine = RiskEngine()
risk_engine.load_model()

class VerificationRequest(BaseModel):
    image_path: str
    metadata: dict
    activities: List[dict]

@app.get('/')
def read_root():
    return {'message': 'Identity Verification API is running'}

@app.post('/risk/analyze')
def analyze_risk(request: VerificationRequest):
    # 1. OCR Check
    text, _ = ocr_svc.extract_text(request.image_path)
    consistent, _ = ocr_svc.check_inconsistencies(text)
    ocr_score = 1.0 if consistent else 0.0
    
    # 2. Biometric (Simplified for demo)
    # In real flow, we'd compare image_path against a stored profile
    liveness, _ = bio_svc.check_liveness(request.image_path)
    biometric_score = 0.9 if liveness else 0.1
    
    # 3. Behavioral
    beh_score, flags = beh_svc.analyze_behavior(request.activities)
    
    # 4. Centralized Risk Engine
    features = {
        'ocr_score': int(ocr_score),
        'biometric_score': biometric_score,
        'behavioral_score': beh_score
    }
    
    prob, explanation = risk_engine.predict_risk(features)
    
    return {
        'fraud_probability': prob,
        'explanation': explanation,
        'behavioral_flags': flags,
        'status': 'High Risk' if prob > 0.7 else 'Low Risk'
    }
