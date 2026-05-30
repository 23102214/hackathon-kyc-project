
import hashlib
import json
from datetime import datetime

class BehavioralService:
    def generate_fingerprint(self, metadata):
        encoded_data = json.dumps(metadata, sort_keys=True).encode()
        return hashlib.sha256(encoded_data).hexdigest()

    def analyze_behavior(self, activities):
        flags = []
        risk_score = 0.0

        if not activities:
            return risk_score, flags

        # Helper to convert potential string timestamps to datetime
        def get_dt(val):
            if isinstance(val, str):
                return datetime.fromisoformat(val)
            return val

        # Rule 1: High frequency (e.g., > 3 actions in 5 minutes)
        if len(activities) >= 3:
            t_start = get_dt(activities[0]['timestamp'])
            t_end = get_dt(activities[-1]['timestamp'])
            time_diff = (t_end - t_start).total_seconds()
            if time_diff < 300:  # 5 minutes
                flags.append('high_frequency_activity')
                risk_score += 0.4

        # Rule 2: Rapid IP changes
        unique_ips = set(a['ip'] for a in activities)
        if len(unique_ips) > 1:
            flags.append('multiple_ip_sources')
            risk_score += 0.3

        return min(risk_score, 1.0), flags

    def evaluate_behavior(self, metadata):
        flags = []
        risk_score = 0.0

        ip_anomaly = bool(metadata.get("ip_change_detected", False))
        request_frequency = int(metadata.get("request_frequency", 1) or 1)

        if ip_anomaly:
            flags.append("multiple_ip_sources")
            risk_score += 0.35

        high_frequency = request_frequency > 5
        if high_frequency:
            flags.append("high_frequency_activity")
            risk_score += min(0.5, (request_frequency - 5) * 0.08)

        return {
            "behavioral_score": round(min(risk_score, 1.0), 3),
            "ip_anomaly": ip_anomaly,
            "high_frequency_flag": high_frequency,
            "flags": flags,
        }
