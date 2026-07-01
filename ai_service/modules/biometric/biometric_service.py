
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
