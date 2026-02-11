"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";
import { F1_DRIVERS_2026, getTeamColorByDriverCode } from "../../../../../lib/f1_2026";

type SessionRow = {
  id: string;
  event_id: string;
  session_key: string;
  name: string;
  starts_at: string; // ISO
  lock_at: string; // ISO
};

type PredictionRow = {
  id: string;
  pool_id: string;
  event_id: string;
  user_id: string;
  prediction_json: any; // jsonb
  created_at?: string;
  updated_at?: string;
};

function fmtLocal(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function msToParts(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return { days, hours, mins, secs };
}

function fmtCountdown(ms: number) {
  const { days, hours, mins, secs } = msToParts(ms);
  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function defaultTop10() {
  return Array.from({ length: 10 }, () => "");
}

function normalizeCode(v: string) {
  return (v ?? "").trim().toUpperCase();
}

function validateTop10(arr: string[]) {
  const cleaned = arr.map((x) => normalizeCode(x)).map((x) => x.replace(/\s+/g, ""));
  const nonEmpty = cleaned.filter((x) => x.length > 0);
  const set = new Set(nonEmpty);
  if (set.size !== nonEmpty.length) return "Dubbele driver codes gevonden. Elke positie moet uniek zijn.";
  return null;
}

/**
 * prediction_json format:
 * {
 *   version: 1,
 *   sessions: {
 *     fp1: { top10: ["VER", ...] },
 *     quali: { top10: [...] },
 *     race: { top10: [...] }
 *   }
 * }
 */
function readSessionTop10FromJson(predictionJson: any, sessionKey: string): string[] | null {
  const top10 = predictionJson?.sessions?.[sessionKey]?.top10;
  if (Array.isArray(top10) && top10.length === 10) {
    return top10.map((x: any) => (typeof x === "string" ? x : ""));
  }
  return null;
}

function writeSessionTop10ToJson(predictionJson: any, sessionKey: string, top10: string[]) {
  const base = predictionJson && typeof predictionJson === "object" ? predictionJson : {};
  const version = base.version ?? 1;
  const sessions = base.sessions && typeof base.sessions === "object" ? base.sessions : {};
  return {
    ...base,
    version,
    sessions: {
      ...sessions,
      [sessionKey]: {
        ...(sessions?.[sessionKey] ?? {}),
        top10,
      },
    },
  };
}

export default function SessionPredictionsPage({
  params,
}: {
  params: { id: string; sessionId: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const poolId = params.id;
  const sessionId = params.sessionId;

  // eventId zit in query (om terug te linken naar weekend page)
  const eventIdFromQuery = searchParams.get("eventId");

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [sessionRow, setSessionRow] = useState<SessionRow | null>(null);

  const [top10, setTop10] = useState<string[]>(defaultTop10());
  const [saving, setSaving] = useState(false);

  // live clock for lock countdown
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const lockMs = useMemo(() => {
    if (!sessionRow) return null;
    return new Date(sessionRow.lock_at).getTime();
  }, [sessionRow]);

  const isLocked = useMemo(() => {
    if (!lockMs) return false;
    return now >= lockMs;
  }, [now, lockMs]);

  const lockInMs = useMemo(() => {
    if (!lockMs) return null;
    return lockMs - now;
  }, [lockMs, now]);

  const backToWeekendHref = useMemo(() => {
    if (!eventIdFromQuery) return `/pools/${poolId}`;
    // ✅ route is /event/[eventId]
    return `/pools/${poolId}/event/${eventIdFromQuery}`;
  }, [poolId, eventIdFromQuery]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      // auth
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        router.replace("/login");
        return;
      }
      setUserId(u.user.id);

      // session info
      const { data: sess, error: sessErr } = await supabase
        .from("event_sessions")
        .select("id,event_id,session_key,name,starts_at,lock_at")
        .eq("id", sessionId)
        .single();

      if (sessErr) {
        setMsg(sessErr.message);
        setLoading(false);
        return;
      }

      const sr = sess as SessionRow;
      setSessionRow(sr);

      // ✅ prediction row is per (pool_id, event_id, user_id)
      const { data: pred, error: predErr } = await supabase
        .from("predictions")
        .select("id,pool_id,event_id,user_id,prediction_json,created_at,updated_at")
        .eq("pool_id", poolId)
        .eq("event_id", sr.event_id)
        .eq("user_id", u.user.id)
        .maybeSingle();

      if (predErr) {
        setMsg(predErr.message);
        setLoading(false);
        return;
      }

      if (pred) {
        const loaded = readSessionTop10FromJson((pred as PredictionRow).prediction_json, sr.session_key);
        if (loaded) setTop10(loaded.map((x) => normalizeCode(x)));
      }

      setLoading(false);
    })();
  }, [router, poolId, sessionId]);

  function updatePos(idx: number, code: string) {
    setTop10((prev) => {
      const next = [...prev];
      next[idx] = normalizeCode(code);
      return next;
    });
  }

  function clearAll() {
    setTop10(defaultTop10());
    setMsg(null);
  }

  async function save() {
    setMsg(null);

    if (!userId) {
      setMsg("Geen user. Log opnieuw in.");
      return;
    }
    if (!sessionRow) {
      setMsg("Geen session data geladen.");
      return;
    }
    if (isLocked) {
      setMsg("Deze sessie is gelockt. Je kunt niet meer opslaan.");
      return;
    }

    const warn = validateTop10(top10);
    if (warn) {
      setMsg(warn);
      return;
    }

    setSaving(true);

    // Find existing row for this weekend
    const { data: existing, error: findErr } = await supabase
      .from("predictions")
      .select("id,prediction_json")
      .eq("pool_id", poolId)
      .eq("event_id", sessionRow.event_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (findErr) {
      setSaving(false);
      setMsg(findErr.message);
      return;
    }

    const cleanedTop10 = top10.map((x) => normalizeCode(x));
    const nextJson = writeSessionTop10ToJson(existing?.prediction_json, sessionRow.session_key, cleanedTop10);

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from("predictions")
        .update({ prediction_json: nextJson })
        .eq("id", existing.id);

      setSaving(false);

      if (updErr) {
        setMsg(updErr.message);
        return;
      }
      setMsg("✅ Opgeslagen.");
      return;
    } else {
      const { error: insErr } = await supabase.from("predictions").insert({
        pool_id: poolId,
        event_id: sessionRow.event_id,
        user_id: userId,
        prediction_json: nextJson,
      });

      setSaving(false);

      if (insErr) {
        setMsg(insErr.message);
        return;
      }
      setMsg("✅ Opgeslagen.");
      return;
    }
  }

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Session</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (msg && !sessionRow) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Session</h1>
        <p style={{ color: "crimson" }}>{msg}</p>
        <p>
          <Link href={backToWeekendHref}>← Terug</Link>
        </p>
      </main>
    );
  }

  const lockInfo = sessionRow
    ? isLocked
      ? `🔒 Gelockt sinds ${fmtLocal(sessionRow.lock_at)}`
      : `🔓 Open • Lock in ${fmtCountdown(lockInMs ?? 0)} (om ${fmtLocal(sessionRow.lock_at)})`
    : null;

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>{sessionRow?.name ?? "Session"}</h1>
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            <div>
              <strong>Start:</strong> {sessionRow ? fmtLocal(sessionRow.starts_at) : "-"}{" "}
              {sessionRow ? <span style={{ opacity: 0.7 }}>({sessionRow.session_key})</span> : null}
            </div>
            {lockInfo ? <div style={{ marginTop: 4 }}>{lockInfo}</div> : null}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href={backToWeekendHref} style={{ textDecoration: "underline" }}>
            ← Terug naar weekend
          </Link>
          <Link href={`/pools/${poolId}`} style={{ textDecoration: "underline" }}>
            Naar pool
          </Link>
        </div>
      </div>

      <hr style={{ margin: "16px 0" }} />

      <h2 style={{ marginTop: 0 }}>Voorspelling Top 10</h2>
      <p style={{ marginTop: 6, opacity: 0.8 }}>
        Kies per positie een coureur. Elke positie moet uniek zijn.
      </p>

      <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        {top10.map((v, idx) => {
          const pos = idx + 1;
          const color = v ? getTeamColorByDriverCode(v) : "#999";
          return (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "52px 16px 1fr",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 700 }}>P{pos}</div>

              <div
                title={v ? `Teamkleur (${v})` : "Teamkleur"}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  background: color,
                  border: "1px solid rgba(0,0,0,0.2)",
                }}
              />

              <select
                value={v}
                onChange={(e) => updatePos(idx, e.target.value)}
                disabled={isLocked}
                style={{
                  padding: "8px 10px",
                  border: "1px solid #ccc",
                  borderRadius: 8,
                }}
              >
                <option value="">— kies driver —</option>
                {F1_DRIVERS_2026.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.name} ({d.teamName})
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button onClick={save} disabled={saving || isLocked} style={{ padding: "8px 12px" }}>
          {saving ? "Opslaan…" : "Opslaan"}
        </button>

        <button onClick={clearAll} disabled={saving || isLocked} style={{ padding: "8px 12px" }}>
          Leegmaken
        </button>
      </div>

      {msg ? (
        <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>
      ) : null}

      {isLocked ? (
        <p style={{ marginTop: 12, opacity: 0.75 }}>
          Deze sessie is gelockt. Je kunt je voorspelling nog wel bekijken, maar niet wijzigen.
        </p>
      ) : (
        <p style={{ marginTop: 12, opacity: 0.75 }}>Tip: je kunt later terugkomen en aanpassen tot de lock-tijd.</p>
      )}
    </main>
  );
}
