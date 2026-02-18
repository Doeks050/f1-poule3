"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { F1_DRIVERS_2026, getTeamColorByDriverCode } from "../../../lib/f1_2026";
import Link from "next/link";

type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  format?: string | null;
};

type SessionRow = {
  id: string;
  event_id: string;
  session_key: string;
  name: string;
  starts_at: string;
  lock_at: string;
};

type EventResultRow = {
  id: string;
  event_id: string;
  session_id: string;
  results: any;
  created_at: string;
};

function normalizeDriverCode(v: any): string {
  return (String(v ?? "").trim().toUpperCase() || "").replace(/\s+/g, "");
}

function safeArr(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function safeObj(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function uniqBy<T>(arr: T[], keyFn: (x: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

const SESSION_LABELS: Record<string, string> = {
  fp1: "FP1",
  fp2: "FP2",
  fp3: "FP3",
  quali: "Qualifying",
  race: "Race",
  sprint_quali: "Sprint Qualifying",
  sprint: "Sprint",
};

const DEFAULT_KEYS_STANDARD = ["fp1", "fp2", "fp3", "quali", "race"];
const DEFAULT_KEYS_SPRINT = ["fp1", "sprint_quali", "sprint", "quali", "race"];

function formatLocal(iso: string | null | undefined) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function isUuid(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
}

export default function AdminResultsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  const [existingResult, setExistingResult] = useState<EventResultRow | null>(null);
  const [saving, setSaving] = useState(false);

  // Simple results json editor (raw)
  const [resultsText, setResultsText] = useState<string>("");

  // -------- auth + admin check --------
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }

      // app_admin check (expects your existing system; keep as-is)
      const { data: adminRow, error: adminErr } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (adminErr) {
        setMsg(adminErr.message);
        setLoading(false);
        return;
      }
      if (!adminRow) {
        setMsg("Geen toegang (geen admin).");
        setLoading(false);
        return;
      }

      // Load events
      const { data: evRows, error: evErr } = await supabase
        .from("events")
        .select("id,name,starts_at,format")
        .order("starts_at", { ascending: true });

      if (evErr) {
        setMsg(evErr.message);
        setLoading(false);
        return;
      }

      const evs = (evRows ?? []) as EventRow[];
      setEvents(evs);

      // default select first upcoming or first
      const now = Date.now();
      const upcoming =
        evs.find((e) => (e.starts_at ? new Date(e.starts_at).getTime() : 0) >= now) ??
        evs[0] ??
        null;

      const firstId = upcoming?.id ?? "";
      setSelectedEventId(firstId);

      setLoading(false);
    })();
  }, [router]);

  // -------- load sessions per event --------
  useEffect(() => {
    (async () => {
      setSessions([]);
      setSelectedSessionId("");
      setExistingResult(null);
      setResultsText("");

      if (!selectedEventId) return;

      const { data: evOne, error: evOneErr } = await supabase
        .from("events")
        .select("id,format")
        .eq("id", selectedEventId)
        .maybeSingle();

      if (evOneErr) {
        setMsg(evOneErr.message);
        return;
      }

      const format = (evOne as any)?.format ?? "standard";
      const defaultKeys = format === "sprint" ? DEFAULT_KEYS_SPRINT : DEFAULT_KEYS_STANDARD;

      const { data: sesRows, error: sesErr } = await supabase
        .from("event_sessions")
        .select("id,event_id,session_key,name,starts_at,lock_at")
        .eq("event_id", selectedEventId)
        .order("starts_at", { ascending: true });

      if (sesErr) {
        setMsg(sesErr.message);
        return;
      }

      const ses = (sesRows ?? []) as SessionRow[];

      // If sessions missing, still allow selecting via default keys (keeps original behavior)
      // We'll just pick first available session if exists.
      setSessions(ses);

      const firstSession =
        ses.find((s) => defaultKeys.includes(s.session_key)) ?? ses[0] ?? null;

      setSelectedSessionId(firstSession?.id ?? "");
    })();
  }, [selectedEventId]);

  // -------- load existing result + prefill --------
  useEffect(() => {
    (async () => {
      setExistingResult(null);
      setResultsText("");

      if (!selectedEventId || !selectedSessionId) return;

      const { data: resRow, error: resErr } = await supabase
        .from("event_results")
        .select("id,event_id,session_id,results,created_at")
        .eq("event_id", selectedEventId)
        .eq("session_id", selectedSessionId)
        .maybeSingle();

      if (resErr) {
        setMsg(resErr.message);
        return;
      }

      if (resRow) {
        setExistingResult(resRow as any);
        try {
          setResultsText(JSON.stringify((resRow as any).results ?? {}, null, 2));
        } catch {
          setResultsText(String((resRow as any).results ?? ""));
        }
      } else {
        // Prefill template
        setResultsText(
          JSON.stringify(
            {
              // Example structure; keep your format as needed
              p1: "VER",
              p2: "NOR",
              p3: "LEC",
            },
            null,
            2
          )
        );
      }
    })();
  }, [selectedEventId, selectedSessionId]);

  const selectedEvent = useMemo(() => {
    return events.find((e) => e.id === selectedEventId) ?? null;
  }, [events, selectedEventId]);

  const selectedSession = useMemo(() => {
    return sessions.find((s) => s.id === selectedSessionId) ?? null;
  }, [sessions, selectedSessionId]);

  const sessionOptions = useMemo(() => {
    const opts = sessions.map((s) => ({
      id: s.id,
      key: s.session_key,
      label: SESSION_LABELS[s.session_key] ?? s.name ?? s.session_key,
      starts_at: s.starts_at,
      lock_at: s.lock_at,
    }));
    return uniqBy(opts, (o) => o.id);
  }, [sessions]);

  async function saveResults() {
    setMsg(null);

    if (!selectedEventId || !isUuid(selectedEventId)) {
      setMsg("Selecteer een geldig event.");
      return;
    }
    if (!selectedSessionId || !isUuid(selectedSessionId)) {
      setMsg("Selecteer een geldige sessie.");
      return;
    }

    let json: any = null;
    try {
      json = JSON.parse(resultsText || "{}");
    } catch (e: any) {
      setMsg(`JSON parse error: ${e?.message ?? e}`);
      return;
    }

    setSaving(true);

    // get token for admin API (keeps your existing style)
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setSaving(false);
      setMsg("Geen geldige sessie.");
      return;
    }

    const res = await fetch("/api/admin/results/upsert", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        eventId: selectedEventId,
        sessionId: selectedSessionId,
        results: json,
      }),
    });

    const raw = await res.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    if (!res.ok) {
      setSaving(false);
      setMsg(parsed?.error ?? raw ?? `Opslaan mislukt (status ${res.status})`);
      return;
    }

    // re-fetch existing result
    const { data: resRow, error: resErr } = await supabase
      .from("event_results")
      .select("id,event_id,session_id,results,created_at")
      .eq("event_id", selectedEventId)
      .eq("session_id", selectedSessionId)
      .maybeSingle();

    if (resErr) {
      setSaving(false);
      setMsg(resErr.message);
      return;
    }

    setExistingResult((resRow as any) ?? null);
    setSaving(false);
    setMsg("✅ Resultaat opgeslagen.");
  }

  if (loading) {
    return (
      <main style={{ padding: 20, maxWidth: 1100 }}>
        <h1 style={{ marginBottom: 8 }}>Admin Results</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginBottom: 8 }}>Admin Results</h1>

      {/* Admin portal tabs */}
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <Link
          href="/admin/results"
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "white",
            textDecoration: "none",
            fontWeight: 700,
          }}
        >
          Results
        </Link>
        <Link
          href="/admin/season-bonus"
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            color: "#111",
            textDecoration: "none",
            fontWeight: 700,
          }}
        >
          Season bonus
        </Link>
        <Link
          href="/admin/import-calendar"
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            color: "#111",
            textDecoration: "none",
            fontWeight: 700,
          }}
        >
          Import calendar
        </Link>
      </div>

      {msg ? (
        <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>
          {msg}
        </p>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: 14,
          marginTop: 14,
          border: "1px solid #eee",
          borderRadius: 14,
          padding: 14,
          background: "white",
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Event</div>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc" }}
          >
            <option value="">— selecteer —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} {e.starts_at ? `(${formatLocal(e.starts_at)})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Sessie</div>
          <select
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc" }}
            disabled={!selectedEventId}
          >
            <option value="">— selecteer —</option>
            {sessionOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} {s.starts_at ? `(${formatLocal(s.starts_at)})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Status</div>
          <div style={{ fontSize: 13 }}>
            {existingResult ? (
              <>
                ✅ Bestaat al (created: {formatLocal(existingResult.created_at)})
              </>
            ) : (
              "Nog geen resultaat voor deze sessie."
            )}
          </div>
          {selectedEvent ? (
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Event format: <strong>{selectedEvent.format ?? "standard"}</strong>
            </div>
          ) : null}
          {selectedSession ? (
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Lock at: <strong>{formatLocal(selectedSession.lock_at)}</strong>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
          Results JSON (raw)
        </div>
        <textarea
          value={resultsText}
          onChange={(e) => setResultsText(e.target.value)}
          rows={18}
          style={{
            width: "100%",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
          }}
          placeholder='{"p1":"VER","p2":"NOR","p3":"LEC"}'
        />
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <button
          onClick={saveResults}
          disabled={saving || !selectedEventId || !selectedSessionId}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "white",
            fontWeight: 700,
            cursor: "pointer",
            opacity: saving || !selectedEventId || !selectedSessionId ? 0.6 : 1,
          }}
        >
          {saving ? "Opslaan..." : "Opslaan"}
        </button>

        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Tip: gebruik driver codes (bijv. {F1_DRIVERS_2026[0]?.code ?? "VER"}). Teamkleur:
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 99,
              marginLeft: 6,
              background: getTeamColorByDriverCode(F1_DRIVERS_2026[0]?.code ?? "VER"),
              border: "1px solid #ddd",
              verticalAlign: "middle",
            }}
          />
        </div>
      </div>
    </main>
  );
}
