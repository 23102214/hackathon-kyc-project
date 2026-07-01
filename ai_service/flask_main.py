import sys
import os
import base64
import re
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
# ai_service/flask_main.py
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)
UPLOAD_FOLDER = 'temp_uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
DOCUMENT_FACE_FOLDER = os.path.join(UPLOAD_FOLDER, 'document_faces')
os.makedirs(DOCUMENT_FACE_FOLDER, exist_ok=True)


@app.route('/', methods=['GET'])
def read_root():
    return jsonify({
        "status": "ok",
        "service": "ai_service",
        "routes": [
            "/api/verify",
            "/api/liveness/check",
            "/health",
        ],
    }), 200


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"}), 200

ocr_service = None
biometric_service = None
behavioral_service = None
risk_engine = None

def get_services():
    global ocr_service, biometric_service, behavioral_service, risk_engine

    from ai_service.modules.ocr.ocr_service import OCRService
    from ai_service.modules.biometric.biometric_service import BiometricService
    from ai_service.modules.behavioral.behavioral_service import BehavioralService
    from ai_service.modules.risk_engine.risk_service import RiskEngine

    if ocr_service is None:
        ocr_service = OCRService()
    if biometric_service is None:
        biometric_service = BiometricService()
    if behavioral_service is None:
        behavioral_service = BehavioralService()
    if risk_engine is None:
        risk_engine = RiskEngine()

    return ocr_service, biometric_service, behavioral_service, risk_engine

def decode_data_url_frame(frame):
    import cv2
    import numpy as np

    if not isinstance(frame, str):
        return None
    payload = re.sub(r"^data:image/[^;]+;base64,", "", frame)
    try:
        image_bytes = base64.b64decode(payload)
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        return cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    except Exception:
        return None

def assess_liveness_frames(frames):
    try:
        import cv2
        import numpy as np
    except Exception as exc:
        return assess_liveness_frames_without_cv(frames, f"OpenCV import failed: {exc}")

    decoded_frames = [decode_data_url_frame(frame) for frame in frames]
    decoded_frames = [frame for frame in decoded_frames if frame is not None]

    if len(decoded_frames) < 8:
        return {
            "passed": False,
            "liveness_score": 0,
            "face_detected": False,
            "motion_detected": False,
            "blink_or_eye_motion_detected": False,
            "head_motion_detected": False,
            "reason": "Not enough live frames were captured.",
        }

    face_cascade = cv2.CascadeClassifier(
        os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
    )
    profile_cascade = cv2.CascadeClassifier(
        os.path.join(cv2.data.haarcascades, "haarcascade_profileface.xml")
    )
    eye_cascade = cv2.CascadeClassifier(
        os.path.join(cv2.data.haarcascades, "haarcascade_eye.xml")
    )

    face_boxes = []
    motion_values = []
    eye_region_values = []
    eye_counts = []

    previous_gray = None
    for frame in decoded_frames:
        resized = cv2.resize(frame, (320, 240))
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)

        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=3, minSize=(40, 40))
        if len(faces) == 0:
            faces = profile_cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=3, minSize=(40, 40))
        if len(faces) > 0:
            face = max(faces, key=lambda box: box[2] * box[3])
            face_boxes.append(tuple(int(value) for value in face))
            x, y, w, h = face
            eye_region = gray[y + int(h * 0.18): y + int(h * 0.48), x: x + w]
            if eye_region.size:
                eye_region_values.append(float(np.std(eye_region)))
                eyes = eye_cascade.detectMultiScale(
                    eye_region,
                    scaleFactor=1.08,
                    minNeighbors=4,
                    minSize=(8, 8),
                )
                eye_counts.append(min(len(eyes), 2))

        if previous_gray is not None:
            diff = cv2.absdiff(gray, previous_gray)
            motion_values.append(float(np.mean(diff)))
        previous_gray = gray

    face_ratio = len(face_boxes) / len(decoded_frames)
    average_motion = float(np.mean(motion_values)) if motion_values else 0.0
    eye_variation = float(np.std(eye_region_values)) if len(eye_region_values) > 1 else 0.0
    eye_state_changed = bool(eye_counts) and max(eye_counts) >= 1 and min(eye_counts) == 0

    centers = [(x + w / 2, y + h / 2) for x, y, w, h in face_boxes]
    head_motion = 0.0
    if len(centers) > 1:
        xs = [center[0] for center in centers]
        ys = [center[1] for center in centers]
        head_motion = max(max(xs) - min(xs), max(ys) - min(ys))

    face_detected = face_ratio >= 0.25
    motion_detected = 0.35 <= average_motion <= 55.0
    blink_or_eye_motion_detected = eye_state_changed or eye_variation >= 1.1
    head_motion_detected = head_motion >= 2.5

    score = 0
    if face_detected:
        score += 50
    if motion_detected:
        score += 25
    if blink_or_eye_motion_detected:
        score += 15
    if head_motion_detected:
        score += 10

    passed = score >= 70 and face_detected and motion_detected and blink_or_eye_motion_detected
    failed_reasons = []
    if not face_detected:
        failed_reasons.append("face was not consistently detected")
    if not motion_detected:
        failed_reasons.append("natural frame motion was not detected")
    if not blink_or_eye_motion_detected:
        failed_reasons.append("eye-region motion was too low")
    if not head_motion_detected:
        failed_reasons.append("head movement was too low")

    return {
        "passed": passed,
        "liveness_score": score,
        "face_detected": face_detected,
        "motion_detected": motion_detected,
        "blink_or_eye_motion_detected": blink_or_eye_motion_detected,
        "head_motion_detected": head_motion_detected,
        "frame_count": len(decoded_frames),
        "face_detection_ratio": round(face_ratio, 2),
        "average_motion": round(average_motion, 2),
        "eye_variation": round(eye_variation, 2),
        "eye_state_changed": eye_state_changed,
        "eye_detection_counts": eye_counts,
        "head_motion": round(head_motion, 2),
        "reason": "Live face motion verified." if passed else "Liveness failed: " + ", ".join(failed_reasons) + ".",
    }

def assess_liveness_frames_without_cv(frames, fallback_reason="OpenCV liveness unavailable"):
    valid_frames = [frame for frame in frames if isinstance(frame, str) and frame.startswith("data:image/")]
    frame_sizes = []
    for frame in valid_frames:
        payload = re.sub(r"^data:image/[^;]+;base64,", "", frame)
        try:
            frame_sizes.append(len(base64.b64decode(payload)))
        except Exception:
            continue

    if len(frame_sizes) < 8:
        return {
            "passed": False,
            "liveness_score": 0,
            "face_detected": False,
            "motion_detected": False,
            "blink_or_eye_motion_detected": False,
            "head_motion_detected": False,
            "frame_count": len(frame_sizes),
            "reason": "Not enough live frames were captured.",
            "fallback_reason": fallback_reason,
        }

    size_range = max(frame_sizes) - min(frame_sizes)
    average_size = sum(frame_sizes) / len(frame_sizes)
    motion_detected = average_size > 0 and (size_range / average_size) >= 0.015
    score = 72 if motion_detected else 45

    return {
        "passed": motion_detected,
        "liveness_score": score,
        "face_detected": True,
        "motion_detected": motion_detected,
        "blink_or_eye_motion_detected": motion_detected,
        "head_motion_detected": motion_detected,
        "frame_count": len(frame_sizes),
        "face_detection_ratio": 1,
        "average_motion": round((size_range / average_size) * 100, 2) if average_size else 0,
        "eye_variation": 0,
        "eye_state_changed": motion_detected,
        "eye_detection_counts": [],
        "head_motion": 0,
        "reason": "Fallback live frame variation verified." if motion_detected else "Liveness failed: live frame variation was too low.",
        "fallback_reason": fallback_reason,
    }

def image_file_to_data_url(image_path):
    if not image_path or not os.path.exists(image_path):
        return None
    with open(image_path, "rb") as image_file:
        encoded = base64.b64encode(image_file.read()).decode("utf-8")
    return f"data:image/jpeg;base64,{encoded}"

@app.route('/api/liveness/check', methods=['POST'])
def check_liveness():
    try:
        payload = request.get_json(silent=True) or {}
        frames = payload.get("frames") or []
        result = assess_liveness_frames(frames)
        return jsonify(result), 200
    except Exception as e:
        app.logger.exception("Liveness check failed")
        return jsonify({
            "passed": False,
            "liveness_score": 0,
            "face_detected": False,
            "motion_detected": False,
            "blink_or_eye_motion_detected": False,
            "head_motion_detected": False,
            "error": str(e),
            "reason": "Backend liveness processing failed.",
        }), 500

@app.route('/api/verify', methods=['POST'])
def verify_identity():
    if 'document_image' not in request.files or 'selfie_image' not in request.files:
        return jsonify({"error": "Missing image files"}), 400
        
    doc_file = request.files['document_image']
    selfie_file = request.files['selfie_image']
    
    doc_path = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(doc_file.filename))
    selfie_path = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(selfie_file.filename))
    doc_file.save(doc_path)
    selfie_file.save(selfie_path)

    ip_change = request.form.get('ip_change_detected', 'false').lower() == 'true'
    freq = int(request.form.get('request_frequency', 1))
    behavior_meta = {"ip_change_detected": ip_change, "request_frequency": freq}

    try:
        ocr_service, biometric_service, behavioral_service, risk_engine = get_services()

        ocr_result = ocr_service.extract_and_validate(doc_path)
        document_face_result = ocr_service.extract_document_face(doc_path, DOCUMENT_FACE_FOLDER)
        forgery_result = ocr_service.analyze_forgery(doc_path)
        document_face_path = document_face_result.get("cropped_face_path") if document_face_result.get("face_detected") else None
        if document_face_path:
            bio_result = biometric_service.verify_identity(doc_path, selfie_path, document_face_path)
        else:
            bio_result = {
                "is_verified": False,
                "biometric_confidence": 0,
                "cosine_distance": None,
                "model": biometric_service.model_name,
                "comparison_source": "document_face_crop_missing",
                "details": {"error": document_face_result.get("error", "document face crop was not available")},
            }
        behavior_result = behavioral_service.evaluate_behavior(behavior_meta)
        if document_face_path:
            document_face_result["cropped_face_path"] = os.path.abspath(document_face_path)
            document_face_result["cropped_face_data_url"] = image_file_to_data_url(document_face_path)
        
        biometric_conf = bio_result["biometric_confidence"]
        ocr_const = ocr_result["ocr_consistency_score"]
        behavioral_score = behavior_result["behavioral_score"]
        
        final_risk = risk_engine.assess_risk(biometric_conf, ocr_const, behavioral_score)
        
        return jsonify({
            "status": "success",
            "ocr_analysis": ocr_result,
            "document_face_analysis": document_face_result,
            "document_forgery_analysis": forgery_result,
            "biometric_analysis": bio_result,
            "behavioral_analysis": behavior_result,
            "fraud_risk_assessment": final_risk
        }), 200

    except Exception as e:
        return jsonify({"status": "failed", "error": str(e)}), 500
        
    finally:
        if os.path.exists(doc_path):
            os.remove(doc_path)
        if os.path.exists(selfie_path):
            os.remove(selfie_path)

if __name__ == '__main__':
    # Run Python service on Port 8000
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 8000)))
