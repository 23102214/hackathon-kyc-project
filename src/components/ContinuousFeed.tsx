/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  Activity, ShieldAlert, BadgeAlert, AlertCircle, Play, Pause,
  Terminal, ShieldCheck, Globe, RefreshCw, Zap, Server
} from "lucide-react";
import { ContinuousMonitoringLog } from "../types";
import { supabase } from "../lib/supabaseClient";

export default function ContinuousFeed() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [logs, setLogs] = useState<ContinuousMonitoringLog[]>([]);

  const [sparkRate, setSparkRate] = useState(0);
  const [kafkaClusterStatus, setKafkaClusterStatus] = useState("API CONNECTING");

  useEffect(() => {
    if (!isPlaying) return;

    async function loadMonitoringLogs() {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const response = await fetch("/api/monitoring/logs", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const payload = await response.json();
        if (payload.success) {
          setLogs(payload.logs || []);
          setSparkRate(payload.logs?.length || 0);
          setKafkaClusterStatus("API CONNECTED");
        } else {
          setKafkaClusterStatus("API ERROR");
        }
      } catch (error) {
        console.warn("Could not load monitoring logs from API.", error);
        setKafkaClusterStatus("API OFFLINE");
      }
    }

    loadMonitoringLogs();
    const interval = setInterval(loadMonitoringLogs, 5000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const highRiskCount = logs.filter((log) => log.riskRating === "HIGH" || log.riskRating === "CRITICAL").length;
  const approvedCount = logs.filter((log) => log.mitigationApplied.toLowerCase().includes("approved")).length;
  const reviewCount = logs.filter((log) => log.mitigationApplied.toLowerCase().includes("review")).length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 md:p-8 space-y-8" id="monitoring-dashboard-root">
      
      {/* Top Telemetry Feed Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <Activity className="text-emerald-500 h-6 w-6 animate-pulse" />
            Continuous AML & Transaction Monitoring
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            API-backed monitoring stream generated from saved verification records.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Spark streaming KPIs */}
          <div className="flex items-center gap-4 bg-slate-50 border border-slate-100 rounded-lg px-4 py-2 font-mono text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span className="text-slate-500">API Records:</span>
              <span className="font-bold text-slate-800">{sparkRate}</span>
            </div>
            
            <div className="border-l border-slate-200 h-4"></div>

            <div className="flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-slate-500">Backend:</span>
              <span className="font-bold text-green-600">{kafkaClusterStatus}</span>
            </div>
          </div>

          <button
            id="stream-stop-start-btn"
            onClick={() => setIsPlaying(!isPlaying)}
            className={`p-2.5 rounded-lg border transition ${
              isPlaying 
                ? "bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100" 
                : "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
            }`}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Grid distribution metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* KPI Panel 1: Security Trigger */}
        <div className="border border-slate-100 p-5 rounded-xl bg-slate-50/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Post-Onboarding Safety</span>
            <BadgeAlert className="h-4 w-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">{highRiskCount}</div>
          <p className="text-[11px] text-slate-400">
            High or critical risk records returned by the backend API.
          </p>
        </div>

        {/* KPI Panel 2: Live Mitigations */}
        <div className="border border-slate-100 p-5 rounded-xl bg-slate-50/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Automated Mitigations</span>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">{approvedCount} sessions</div>
          <p className="text-[11px] text-slate-400">
            Approved verification records currently loaded from Supabase.
          </p>
        </div>

        {/* KPI Panel 3: Impossible Travel index */}
        <div className="border border-slate-100 p-5 rounded-xl bg-slate-50/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Geographical Outliers</span>
            <Globe className="h-4 w-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">{reviewCount} alerts</div>
          <p className="text-[11px] text-slate-400">
            Verification records currently held for manual review.
          </p>
        </div>
      </div>

      {/* Interactive Log Streaming Visualizer */}
      <div className="border border-slate-150 rounded-xl overflow-hidden shadow-sm">
        <div className="bg-slate-900 text-slate-300 font-mono text-xs px-4 py-3 flex justify-between items-center border-b border-slate-800">
          <span className="flex items-center gap-1.5">
            <Terminal className="h-4 w-4 text-emerald-400" /> API STREAM: /api/monitoring/logs
          </span>
          <span className="text-slate-500 animate-pulse text-[10px]">API POLLING ACTIVE</span>
        </div>

        <div className="divide-y divide-slate-100 h-96 overflow-y-auto" id="kafka-log-feed">
          {logs.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm font-mono">
              No API-backed monitoring records found.
            </div>
          ) : logs.map((log) => {
            const isHighRisk = log.riskRating === "HIGH" || log.riskRating === "CRITICAL";
            const isMedium = log.riskRating === "MEDIUM";
            
            return (
              <div key={log.id} className="p-4 md:p-5 hover:bg-slate-50 transition flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                <div className="space-y-1 md:max-w-xl">
                  {/* Category badging */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded font-mono">
                      {log.timestamp}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                      log.eventType === "GEOLOCATION_SWAP" ? "bg-red-50 text-red-700 border border-red-200" :
                      log.eventType === "BEHAVIOR_DRIFT" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                      log.eventType === "DEVICE_SWAP" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-700"
                    }`}>
                      {log.eventType}
                    </span>
                    <span className="text-slate-900 font-semibold text-xs font-mono">{log.userName}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({log.email})</span>
                  </div>
                  <p className="text-xs text-slate-600 font-mono leading-relaxed mt-1">
                    {log.details}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 font-mono">
                    <span>IP Location: <span className="text-slate-600">{log.location} ({log.ip})</span></span>
                    <span>•</span>
                    <span>Device: <span className="text-slate-600">{log.device}</span></span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 w-full md:w-auto border-t md:border-t-0 border-slate-100 pt-3.5 md:pt-0 font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase">Risk Score Tracker</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      isHighRisk ? "bg-rose-100 text-rose-800" : isMedium ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                    }`}>
                      {log.riskRating} ({log.riskScore}%)
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-md text-right">
                    🛠️ Mitigation: {log.mitigationApplied}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

