
import easyocr
import re

class OCRService:
    def __init__(self):
        # Initialize reader for English
        self.reader = easyocr.Reader(['en'])

    def extract_text(self, image_path):
        results = self.reader.readtext(image_path)
        # results format: [([[x,y], [x,y], ...], text, confidence), ...]
        extracted_text = " ".join([res[1] for res in results])
        return extracted_text, results

    def check_inconsistencies(self, extracted_text):
        keywords = ['NAME', 'ID', 'DOB', 'EXP']
        missing = [kw for kw in keywords if kw not in extracted_text.upper()]
        is_consistent = len(missing) == 0
        return is_consistent, missing

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
                    "expiry": "UNKNOWN",
                },
                "missing_fields": ["NAME", "ID", "DOB", "EXP"],
                "error": str(exc),
            }

        upper_text = extracted_text.upper()
        dob_match = re.search(r"\b(?:DOB|DATE OF BIRTH)[:\s-]*([0-9]{2}[/-][0-9]{2}[/-][0-9]{4})", upper_text)
        expiry_match = re.search(r"\b(?:EXP|EXPIRY|EXPIRES)[:\s-]*([0-9]{2}[/-][0-9]{2}[/-][0-9]{4})", upper_text)
        name_match = re.search(r"\bNAME[:\s-]*([A-Z][A-Z\s]{2,40})", upper_text)

        confidence_values = [item[2] for item in raw_results if len(item) > 2]
        average_confidence = sum(confidence_values) / len(confidence_values) if confidence_values else 0
        completeness_score = 1 - (len(missing) / 4)
        ocr_score = round(max(0, min(1, (average_confidence + completeness_score) / 2)), 3)

        return {
            "ocr_consistency_score": ocr_score if is_consistent else round(ocr_score * 0.6, 3),
            "extracted_text": extracted_text,
            "extracted_data": {
                "name": name_match.group(1).strip() if name_match else "UNKNOWN",
                "dob": dob_match.group(1) if dob_match else "UNKNOWN",
                "expiry": expiry_match.group(1) if expiry_match else "UNKNOWN",
            },
            "missing_fields": missing,
        }
