
import logging
import os
import shutil
import sys

os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")


def ensure_tensorflow_keras_compat():
    try:
        __import__("tensorflow.keras")
        return
    except ModuleNotFoundError:
        pass

    try:
        import tensorflow as tf
        import tf_keras
        setattr(tf, "keras", tf_keras)
        sys.modules.setdefault("tensorflow.keras", tf_keras)
    except Exception:
        logging.exception("TensorFlow Keras compatibility setup failed")

class BiometricService:
    def __init__(self, model_name='VGG-Face'):
        self.model_name = model_name
        self.deepface_enabled = os.environ.get("AI_ENABLE_DEEPFACE", "0").lower() in ("1", "true", "yes")

    def _extract_largest_face(self, image_path):
        import cv2

        image = cv2.imread(image_path)
        if image is None:
            return None

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        cascades = [
            cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")),
            cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, "haarcascade_profileface.xml")),
        ]

        faces = []
        for cascade in cascades:
            detected = cascade.detectMultiScale(gray, scaleFactor=1.06, minNeighbors=4, minSize=(40, 40))
            if len(detected):
                faces.extend(detected)

        if not faces:
            return None

        x, y, w, h = max(faces, key=lambda box: box[2] * box[3])
        pad_x = int(w * 0.25)
        pad_y = int(h * 0.28)
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(image.shape[1], x + w + pad_x)
        y2 = min(image.shape[0], y + h + pad_y)
        return gray[y1:y2, x1:x2]

    def _lightweight_face_similarity(self, img1_path, img2_path):
        import cv2
        import numpy as np

        face1 = self._extract_largest_face(img1_path)
        face2 = self._extract_largest_face(img2_path)
        if face1 is None or face2 is None:
            return False, {
                "error": "face could not be detected in one or both comparison images",
                "model": "opencv_histogram_fallback",
            }

        size = (128, 128)
        face1 = cv2.resize(face1, size)
        face2 = cv2.resize(face2, size)
        face1 = cv2.GaussianBlur(face1, (3, 3), 0)
        face2 = cv2.GaussianBlur(face2, (3, 3), 0)

        hist1 = cv2.calcHist([face1], [0], None, [64], [0, 256])
        hist2 = cv2.calcHist([face2], [0], None, [64], [0, 256])
        cv2.normalize(hist1, hist1)
        cv2.normalize(hist2, hist2)
        histogram_score = float(cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL))

        diff_score = 1.0 - float(np.mean(cv2.absdiff(face1, face2)) / 255.0)
        similarity = max(0.0, min(1.0, (histogram_score * 0.55) + (diff_score * 0.45)))
        verified = similarity >= 0.62

        return verified, {
            "verified": verified,
            "distance": round(1.0 - similarity, 4),
            "threshold": 0.38,
            "similarity": round(similarity, 4),
            "model": "opencv_histogram_fallback",
        }

    def _ensure_local_weights(self):
        if self.model_name != "VGG-Face":
            return

        bundled_weights = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "models", "vgg_face_weights.h5")
        )
        deepface_weights = os.path.join(os.path.expanduser("~"), ".deepface", "weights", "vgg_face_weights.h5")

        if os.path.exists(bundled_weights) and not os.path.exists(deepface_weights):
            os.makedirs(os.path.dirname(deepface_weights), exist_ok=True)
            shutil.copy2(bundled_weights, deepface_weights)

    def verify_face(self, img1_path, img2_path):
        if not self.deepface_enabled:
            return self._lightweight_face_similarity(img1_path, img2_path)

        try:
            ensure_tensorflow_keras_compat()
            from deepface import DeepFace

            self._ensure_local_weights()
            # verify method returns a dictionary with 'verified' key
            result = DeepFace.verify(img1_path=img1_path, img2_path=img2_path, model_name=self.model_name, enforce_detection=False)
            return result.get('verified', False), result
        except Exception as e:
            logging.error(f'Face verification error: {e}')
            return False, {'error': str(e)}

    def check_liveness(self, image_path):
        # Placeholder logic for liveness detection
        # In a production system, this would involve eye-blink detection or 3D depth mapping
        # Here we just check if the image is provided and exists
        if os.path.exists(image_path):
            return True, "Liveness check passed (placeholder)"
        return False, "Image not found"

    def verify_identity(self, document_image_path, selfie_image_path, document_face_path=None):
        comparison_image_path = document_face_path or document_image_path
        is_verified, result = self.verify_face(comparison_image_path, selfie_image_path)
        distance = result.get("distance")
        threshold = result.get("threshold", 0.68)

        if isinstance(distance, (int, float)) and threshold:
            distance_ratio = distance / threshold
            if is_verified:
                confidence = 0.8 + (max(0, 1 - distance_ratio) * 0.2)
            else:
                confidence = min(0.79, 0.79 / max(distance_ratio, 1))
        else:
            confidence = 1.0 if is_verified else 0.0

        return {
            "is_verified": bool(is_verified),
            "biometric_confidence": round(confidence, 3),
            "cosine_distance": distance,
            "model": self.model_name,
            "comparison_source": "document_face_crop" if document_face_path else "document_image",
            "details": result,
        }
