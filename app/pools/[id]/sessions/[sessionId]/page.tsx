"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";
import {
  F1_DRIVERS_2026,
  getDriversByTeam,
  getTeamColorByDriverCode,
} from "../../../../../lib/f1_2026";

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
  user_id: string;
  pool_id: string;
  event_id: string;
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

function normalizeCode(v: string) {
  return (v ?? "").trim().toUpperCase();
}

function defaultTop10() {
  return Array.from({ length: 10 }, () => "");
}

/**
 * prediction_json:
 * {
 *   version: 1,
 *   sessions: {
 *     [sessionId]: { session_key: "...", top10: [...] }
 *   }
 * }
 */
function readTop10FromPrediction(prediction_json: any, sessionId: string): string[] | null {
  if (!prediction_json) return null;
  const sess = prediction_json?.sessions?.[sessionId];
  if (sess && Array.isArray(sess?.top10) && sess.top10.length === 10) {
    return sess.top10.map((x: any) => (typeof x === "string" ? normalizeCode(x) : ""));
  }
  return null;
}

function upsertSessionTop10(
  prediction_json: any,
  sessionId: string,
  session_key: string,
  top10: string[]
) {
  const base = prediction_json && typeof prediction_json === "object" ? prediction_json : {};
  const sessions = base.sessions && typeof base.sessions === "object" ? base.sessions : {};

  return {
    version: 1,
    ...base,
    sessions: {
      ...sessions,
      [sessionId]: {
        session_key,
        top10,
      },
    },
  };
}

function validateTop10(arr: string[]) {
  const cleaned = arr.map((x) => normalizeCode(x)).filter((x) => x.length > 0);
  const set = new Set(cleaned);
  if (set.size !== cleaned.length) return "Dubbele coureurs gekozen. Elke positie moet uniek zijn.";
  return null;
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

  const eventIdFromQuery = searchParams.get("eventId");

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [sessionRow, setSessionRow] = useState<SessionRow | null>(null);

  const [predictionRow, setPredictionRow] = useState<PredictionRow | null>(null);

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
    const eventId = eventIdFromQuery ?? sessionRow?.event_id ?? null;
    if (!eventId) return `/pools/${poolId}`;
    return `/pools/${poolId}/event/${eventId}`;
  }, [poolId, eventIdFromQuery, sessionRow?.event_id]);

  // teams->drivers voor nette dropdown
  const driversByTeam = useMemo(() => getDriversByTeam(), []);

  // set met gekozen drivers (voor duplicate prevention)
  const selectedSet = useMemo(() => {
    const s = new Set<string>();
    for (const c of top10) {
      const cc = normalizeCode(c);
      if (cc) s.add(cc);
    }
    return s;
  }, [top10]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        router.replace("/login");
        return;
      }
      setUserId(u.user.id);

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

      const srow = sess as SessionRow;
      setSessionRow(srow);

      const { data: pred, error: predErr } = await supabase
        .from("predictions")
        .select("id,user_id,pool_id,event_id,prediction_json,created_at,updated_at")
        .eq("pool_id", poolId)
        .eq("event_id", srow.event_id)
        .eq("user_id", u.user.id)
        .maybeSingle();

      if (predErr) {
        setMsg(predErr.message);
        setLoading(false);
        return;
      }

      if (pred) {
        const prow = pred as PredictionRow;
        setPredictionRow(prow);
        const loaded = readTop10FromPrediction(prow.prediction_json, sessionId);
        if (loaded) setTop10(loaded);
      } else {
        setPredictionRow(null);
      }

      setLoading(false);
    })();
  }, [router, poolId, sessionId]);

  function updatePos(idx: number, value: string) {
    setTop10((prev) => {
      const next = [...prev];
      next[idx] = normalizeCode(value);
      return next;
    });
  }

  function clearAll() {
    setTop10(defaultTop10());
    setMsg(null);
  }

  async function save() {
    setMsg(null);

    if (!userId) return setMsg("Geen user. Log opnieuw in.");
    if (!sessionRow) return setMsg("Geen session data geladen.");
    if (isLocked) return setMsg("Deze sessie is gelockt. Je kunt niet meer opslaan.");

    const warn = validateTop10(top10);
    if (warn) return setMsg(warn);

    setSaving(true);

    const { data: existing, error: findErr } = await supabase
      .from("predictions")
      .select("id,prediction_json")
      .eq("pool_id", poolId)
      .eq("event_id", sessionRow.event_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (findErr) {
      setSaving(false);
      return setMsg(findErr.message);
    }

    const cleanedTop10 = top10.map((x) => normalizeCode(x));

    const nextJson = upsertSessionTop10(
      existing?.prediction_json,
      sessionId,
      sessionRow.session_key,
      cleanedTop10
    );

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from("predictions")
        .update({ prediction_json: nextJson })
        .eq("id", existing.id);

      setSaving(false);

      if (updErr) return setMsg(updErr.message);

      setMsg("✅ Opgeslagen.");
      setPredictionRow((prev) => (prev ? { ...prev, prediction_json: nextJson } : prev));
      return;
    }

    const { data: ins, error: insErr } = await supabase
      .from("predictions")
      .insert({
        pool_id: poolId,
        event_id: sessionRow.event_id,
        user_id: userId,
        prediction_json: nextJson,
      })
      .select("id,user_id,pool_id,event_id,prediction_json,created_at,updated_at")
      .single();

    setSaving(false);

    if (insErr) return setMsg(insErr.message);

    setMsg("✅ Opgeslagen.");
    setPredictionRow(ins as PredictionRow);
  }

  const lockInfo = sessionRow
    ? isLocked
      ? `🔒 Gelockt sinds ${fmtLocal(sessionRow.lock_at)}`
      : `🔓 Open • Lock in ${fmtCountdown(lockInMs ?? 0)} (om ${fmtLocal(sessionRow.lock_at)})`
    : null;

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
          <Link href={`/pools/${poolId}`}>← Terug</Link>
        </p>
      </main>
    );
  }

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
          const selected = F1_DRIVERS_2026.find((d) => d.code === v);

          return (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "52px 1fr",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 700 }}>P{pos}</div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  title={selected?.teamName ?? ""}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    background: color,
                    display: "inline-block",
                    border: "1px solid rgba(0,0,0,0.2)",
                    flex: "0 0 auto",
                  }}
                />

                <select
                  value={v}
                  onChange={(e) => updatePos(idx, e.target.value)}
                  disabled={isLocked}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    background: "white",
                  }}
                >
                  <option value="">— Kies coureur —</option>

                  {driversByTeam.map(({ team, drivers }) => (
                    <optgroup key={team.id} label={team.name}>
                      {drivers.map((d) => {
                        // duplicate-preventie: disable als al gekozen in andere positie
                        const isTakenElsewhere = selectedSet.has(d.code) && d.code !== v;
                        return (
                          <option key={d.code} value={d.code} disabled={isTakenElsewhere}>
                            {d.code} — {d.name}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </select>
              </div>
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
        <p style={{ marginTop: 12, opacity: 0.75 }}>
          Tip: je kunt later terugkomen en aanpassen tot de lock-tijd.
        </p>
      )}

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
        <div>
          <strong>Opslag:</strong> predictions (event-based) →{" "}
          <code>prediction_json.sessions[sessionId].top10</code>
        </div>
      </div>
    </main>
  );
}
