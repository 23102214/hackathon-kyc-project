
import easyocr
import re
import cv2
import numpy as np
import os
from uuid import uuid4

class OCRService:
    def __init__(self):
        # Initialize reader for English
        self.reader = easyocr.Reader(['en'], gpu=False, verbose=False)

    def prepare_ocr_image(self, image_path):
        image = cv2.imread(image_path)
        if image is None:
            return image_path, None

        height, width = image.shape[:2]
        max_side = max(height, width)
        if max_side <= 1600:
            return image_path, None

        scale = 1600 / max_side
        resized = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
        resized_path = os.path.join(os.path.dirname(image_path), f"ocr_{uuid4().hex}.jpg")
        cv2.imwrite(resized_path, resized, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        return resized_path, resized_path

    def extract_text(self, image_path):
        ocr_path, cleanup_path = self.prepare_ocr_image(image_path)
        try:
            results = self.reader.readtext(ocr_path)
            # results format: [([[x,y], [x,y], ...], text, confidence), ...]
            extracted_text = " ".join([res[1] for res in results])
            return extracted_text, results
        finally:
            if cleanup_path and os.path.exists(cleanup_path):
                os.remove(cleanup_path)

    def check_inconsistencies(self, extracted_text):
        keywords = ['NAME', 'ID', 'DOB', 'EXP']
        missing = [kw for kw in keywords if kw not in extracted_text.upper()]
        is_consistent = len(missing) == 0
        return is_consistent, missing

    def extract_document_number(self, upper_text):
        patterns = [
            r"\b[A-Z]{5}[0-9]{4}[A-Z]\b",              # PAN
            r"\b[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}\b",    # Aadhaar
            r"\b[A-Z][0-9]{7}\b",                      # Passport
            r"\b[A-Z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4,11}\b",
            r"\b(?:ID|NO|NUMBER|DOCUMENT|DL|LICENSE|PASSPORT|AADHAAR|PAN)[:\s-]*([A-Z0-9][A-Z0-9\s-]{4,24})\b",
        ]
        for pattern in patterns:
            match = re.search(pattern, upper_text)
            if match:
                value = match.group(1) if match.lastindex else match.group(0)
                return re.sub(r"\s+", " ", value).strip()
        return "UNKNOWN"

    def extract_name(self, upper_text, raw_results):
        labeled_match = re.search(r"\bNAME[:\s-]*([A-Z][A-Z\s]{2,40})", upper_text)
        if labeled_match:
            return labeled_match.group(1).strip()

        blocked_terms = [
            "INCOME TAX", "GOVT", "GOVERNMENT", "INDIA", "PERMANENT", "ACCOUNT",
            "NUMBER", "CARD", "FATHER", "DATE", "BIRTH", "SIGNATURE", "PAN",
        ]
        for item in raw_results:
            text = item[1] if len(item) > 1 else ""
            candidate = re.sub(r"[^A-Z\s]", " ", text.upper())
            candidate = re.sub(r"\s+", " ", candidate).strip()
            if len(candidate) < 3 or len(candidate) > 40:
                continue
            if any(term in candidate for term in blocked_terms):
                continue
            words = candidate.split()
            if 1 <= len(words) <= 5 and all(len(word) > 1 for word in words):
                return candidate

        return "UNKNOWN"

    def extract_date(self, upper_text, labels, fallback_to_first_date=False):
        month_names = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER"
        date_patterns = [
            r"([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})",
            r"([0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2})",
            rf"([0-9]{{1,2}}\s+(?:{month_names})\s+[0-9]{{2,4}})",
        ]

        for date_pattern in date_patterns:
            match = re.search(rf"\b(?:{labels})[\s:.-]*{date_pattern}", upper_text)
            if match:
                return match.group(1).strip()

        if fallback_to_first_date:
            for date_pattern in date_patterns:
                match = re.search(date_pattern, upper_text)
                if match:
                    return match.group(1).strip()

        return "UNKNOWN"

    def extract_address(self, extracted_text):
        match = re.search(
            r"\b(?:ADDRESS|ADDR)[:\s-]*([A-Z0-9,./#\-\s]{8,120})(?=\b(?:DOB|DATE OF BIRTH|EXP|EXPIRES|ID|NO|NUMBER|$))",
            extracted_text.upper(),
        )
        if match:
            return re.sub(r"\s+", " ", match.group(1)).strip(" ,.-")
        return "UNKNOWN"

    def extract_and_validate(self, image_path):
        try:
            extracted_text, raw_results = self.extract_text(image_path)
            is_consistent, missing = self.check_inconsistencies(extracted_text)
        except Exception as exc:
            return {
                "ocr_consistency_score": 0,
                "extracted_text": "",
                "extracted_data": {
                    "name": "UNKNOWN",
                    "dob": "UNKNOWN",
                    "document_number": "UNKNOWN",
                    "address": "UNKNOWN",
                    "expiry": "UNKNOWN",
                },
                "missing_fields": ["NAME", "ID", "DOB", "EXP"],
                "error": str(exc),
            }

        upper_text = extracted_text.upper()
        dob = self.extract_date(upper_text, r"DOB|D\s*\.?\s*O\s*\.?\s*B|DATE OF BIRTH|BIRTH", True)
        expiry = self.extract_date(upper_text, r"EXP|EXPIRY|EXPIRES|VALID UNTIL|VALID TILL", False)
        name = self.extract_name(upper_text, raw_results)
        document_number = self.extract_document_number(upper_text)
        address = self.extract_address(extracted_text)

        confidence_values = [item[2] for item in raw_results if len(item) > 2]
        average_confidence = sum(confidence_values) / len(confidence_values) if confidence_values else 0
        extracted_field_count = sum([
            1 if name != "UNKNOWN" else 0,
            1 if dob != "UNKNOWN" else 0,
            1 if document_number != "UNKNOWN" else 0,
        ])
        completeness_score = extracted_field_count / 3
        ocr_score = round(max(0, min(1, (average_confidence + completeness_score) / 2)), 3)

        return {
            "ocr_consistency_score": ocr_score,
            "extracted_text": extracted_text,
            "extracted_data": {
                "name": name,
                "dob": dob,
                "document_number": document_number,
                "address": address,
                "expiry": expiry,
            },
            "missing_fields": missing,
        }

    def extract_document_face(self, image_path, output_dir):
        image = cv2.imread(image_path)
        if image is None:
            return {
                "face_detected": False,
                "cropped_face_path": None,
                "face_box": None,
                "confidence": 0,
                "error": "document image could not be decoded",
            }

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

        if len(faces) == 0:
            return {
                "face_detected": False,
                "cropped_face_path": None,
                "face_box": None,
                "confidence": 0,
                "error": "no face/photo region detected in document",
            }

        x, y, w, h = max(faces, key=lambda box: box[2] * box[3])
        pad_x = int(w * 0.25)
        pad_y = int(h * 0.28)
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(image.shape[1], x + w + pad_x)
        y2 = min(image.shape[0], y + h + pad_y)
        crop = image[y1:y2, x1:x2]

        os.makedirs(output_dir, exist_ok=True)
        cropped_face_path = os.path.join(output_dir, f"document_face_{uuid4().hex}.jpg")
        cv2.imwrite(cropped_face_path, crop)

        image_area = image.shape[0] * image.shape[1]
        face_area_ratio = (w * h) / image_area if image_area else 0
        confidence = round(max(0.35, min(0.98, 0.55 + face_area_ratio * 8)), 3)

        return {
            "face_detected": True,
            "cropped_face_path": cropped_face_path,
            "face_box": {"x": int(x1), "y": int(y1), "width": int(x2 - x1), "height": int(y2 - y1)},
            "confidence": confidence,
        }

    def analyze_forgery(self, image_path):
        image = cv2.imread(image_path)
        if image is None:
            return {
                "forgery_detected": True,
                "forgery_score": 1,
                "details_edited_score": 100,
                "tampered_photo_score": 100,
                "metadata_trace_level": 100,
                "hologram_match": False,
                "confidence_score": 100,
                "signals": ["document image could not be decoded"],
            }

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 80, 180)
        edge_density = float(np.mean(edges > 0))
        blur_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        block_size = 32
        h, w = gray.shape
        block_variances = []
        for y in range(0, h - block_size, block_size):
            for x in range(0, w - block_size, block_size):
                block_variances.append(float(np.var(gray[y:y + block_size, x:x + block_size])))

        variance_spread = float(np.std(block_variances)) if block_variances else 0.0
        compression_noise = float(np.mean(cv2.absdiff(gray, cv2.GaussianBlur(gray, (5, 5), 0))))

        score = 0
        signals = []
        if edge_density > 0.18:
            score += 0.25
            signals.append("unusually dense edge boundaries around document regions")
        if blur_variance < 45:
            score += 0.2
            signals.append("low texture sharpness suggests recapture or smoothing")
        if variance_spread > 2500:
            score += 0.25
            signals.append("inconsistent local texture variance across document blocks")
        if compression_noise > 9:
            score += 0.2
            signals.append("elevated compression/noise residue")

        score = round(min(score, 1.0), 3)
        edited_score = round(score * 100)
        tamper_score = round(min(100, edited_score + (15 if edge_density > 0.18 else 0)))

        return {
            "forgery_detected": score >= 0.45,
            "forgery_score": score,
            "details_edited_score": edited_score,
            "tampered_photo_score": tamper_score,
            "metadata_trace_level": round(min(100, compression_noise * 8)),
            "hologram_match": score < 0.55,
            "confidence_score": round(max(55, min(96, 60 + edited_score * 0.4))),
            "signals": signals or ["no strong visual forgery indicators detected"],
        }
