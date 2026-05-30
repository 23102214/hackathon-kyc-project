
# app/modules/risk_engine/risk_service.py
import xgboost as xgb
import os
import pandas as pd

class RiskEngine:
    def __init__(self):
        # This points to: app/models/risk_scorer.json
        # Since risk_service.py is inside app/modules/risk_engine/,
        # we navigate two folders up ('..', '..') to reach the 'models' directory.
        self.model_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "models", "risk_scorer.json")
        )
        
        # Load the native XGBoost model from the JSON file
        self.model = xgb.Booster()
        self.model.load_model(self.model_path)

    def load_model(self):
        return self.model

    def assess_risk(self, biometric_conf: float, ocr_const: float, behavioral_score: float) -> dict:
        feature_names = ["ocr_score", "biometric_score", "behavioral_score"]
        features_df = pd.DataFrame([[ocr_const, biometric_conf, behavioral_score]], columns=feature_names)
        
        # Convert to XGBoost DMatrix format
        dmatrix = xgb.DMatrix(features_df)
        
        # Predict probability
        probability = float(self.model.predict(dmatrix)[0])
        
        risk_level = "Low"
        if probability > 0.7:
            risk_level = "High"
        elif probability > 0.4:
            risk_level = "Medium"
            
        return {
            "risk_score": probability,
            "risk_level": risk_level
        }

    def predict_risk(self, features: dict):
        result = self.assess_risk(
            float(features.get("biometric_score", 0)),
            float(features.get("ocr_score", 0)),
            float(features.get("behavioral_score", 0)),
        )
        explanation = (
            f"Risk level is {result['risk_level']} with score "
            f"{result['risk_score']:.3f} from OCR, biometric, and behavioral signals."
        )
        return result["risk_score"], explanation
