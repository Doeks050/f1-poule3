"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";
import BonusSection from "./BonusSection";

type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  format: "standard" | "sprint" | string | null;
};

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

function formatLabel(format: string | null) {
  if (format === "sprint") return "Sprint weekend";
  if (format === "standard") return "Standaard weekend";
  return "Weekend";
}

// prediction_json.sessions[sessionId] => { version: 1, top10: [...] }
function getSessionTop10FromPrediction(predictionJson: any, sessionId: string): string[] | null {
  const sessions = predictionJson?.sessions;
  const entry = sessions?.[sessionId];
  const top10 = entry?.top10;
  if (Array.isArray(top10) && top10.length === 10) {
    return top10.map((x: any) => (typeof x === "string" ? x : ""));
  }
  return null;
}

function countFilled(arr: string[] | null): number {
  if (!arr) return 0;
  return arr.filter((x) => String(x ?? "").trim().length > 0).length;
}

export default function WeekendOverviewPage({
  params,
}: {
  params: { id: string; eventId: string };
}) {
  const router = useRouter();
  const poolId = params.id;
  const eventId = params.eventId;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [poolName, setPoolName] = useState<string>("Pool");
  const [eventRow, setEventRow] = useState<EventRow | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  // auth user
  const [userId, setUserId] = useState<string | null>(null);

  // prediction row for this user/pool/event
  const [prediction, setPrediction] = useState<PredictionRow | null>(null);

  // live clock for countdowns
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        setMsg(userErr.message);
        setLoading(false);
        return;
      }
      if (!userData.user) {
        router.replace("/login");
        return;
      }
      setUserId(userData.user.id);

      // pool name (nice-to-have)
      const { data: pool, error: poolErr } = await supabase
        .from("pools")
        .select("name")
        .eq("id", poolId)
        .maybeSingle();

      if (!poolErr && pool?.name) setPoolName(pool.name);

      // event
      const { data: ev, error: evErr } = await supabase
        .from("events")
        .select("id,name,starts_at,format")
        .eq("id", eventId)
        .single();

      if (evErr) {
        setMsg(evErr.message);
        setLoading(false);
        return;
      }
      setEventRow(ev as EventRow);

      // sessions
      const { data: sess, error: sessErr } = await supabase
        .from("event_sessions")
        .select("id,event_id,session_key,name,starts_at,lock_at")
        .eq("event_id", eventId)
        .order("starts_at", { ascending: true });

      if (sessErr) {
        setMsg(sessErr.message);
        setLoading(false);
        return;
      }
      setSessions((sess ?? []) as SessionRow[]);

      // prediction row for this event/pool/user (event-based schema)
      const { data: pred, error: predErr } = await supabase
        .from("predictions")
        .select("id,user_id,pool_id,event_id,prediction_json,created_at,updated_at")
        .eq("pool_id", poolId)
        .eq("event_id", eventId)
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (predErr) {
        // Niet hard falen; weekend moet nog steeds renderen
        setPrediction(null);
      } else {
        setPrediction((pred ?? null) as PredictionRow | null);
      }

      setLoading(false);
    })();
  }, [router, poolId, eventId]);

  const nextOpenSessionId = useMemo(() => {
    for (const s of sessions) {
      const lockMs = new Date(s.lock_at).getTime();
      if (now < lockMs) return s.id;
    }
    return null;
  }, [sessions, now]);

  // Build a quick lookup: sessionId -> filled count
  const predictedBySession = useMemo(() => {
    const map: Record<string, { filled: number; hasAny: boolean }> = {};
    for (const s of sessions) {
      const top10 = getSessionTop10FromPrediction(prediction?.prediction_json, s.id);
      const filled = countFilled(top10);
      map[s.id] = { filled, hasAny: filled > 0 };
    }
    return map;
  }, [sessions, prediction]);

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Weekend</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (msg) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Weekend</h1>
        <p style={{ color: "crimson" }}>{msg}</p>
        <p>
          <Link href={`/pools/${poolId}`}>Terug naar pool</Link>
        </p>
      </main>
    );
  }

  if (!eventRow) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Weekend</h1>
        <p>Event niet gevonden.</p>
        <p>
          <Link href={`/pools/${poolId}`}>Terug naar pool</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        <h1 style={{ margin: 0 }}>{eventRow.name}</h1>
      </div>

      {/* Weekend Bonusvragen */}
      <BonusSection
       poolId={poolId}
       eventId={eventId}
      />

      <p style={{ marginTop: 8, marginBottom: 16 }}>
        <strong>{poolName}</strong> • {formatLabel(eventRow.format)}
        {eventRow.starts_at ? (
          <>
            {" "}
            • Weekend start: <strong>{fmtLocal(eventRow.starts_at)}</strong>
          </>
        ) : null}
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Link href={`/pools/${poolId}`}>← Terug naar pool</Link>
        <span style={{ opacity: 0.6 }}>|</span>
        <Link href={`/admin/results`}>Admin Results</Link>
      </div>

      <h2 style={{ marginTop: 0 }}>Sessies</h2>

      {sessions.length === 0 ? (
        <p>Geen sessies gevonden voor dit weekend.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {sessions.map((s) => {
            const lockMs = new Date(s.lock_at).getTime();
            const startMs = new Date(s.starts_at).getTime();

            const isLocked = now >= lockMs;
            const lockInMs = lockMs - now;

            const highlight = nextOpenSessionId === s.id;

            const status = isLocked ? "🔒 Gesloten" : "🔓 Open";
            const countdown = isLocked
              ? `Locked sinds ${fmtLocal(s.lock_at)}`
              : `Lock in ${fmtCountdown(lockInMs)} (om ${fmtLocal(s.lock_at)})`;

            const startLine = `Start: ${fmtLocal(s.starts_at)}`;

            const href = `/pools/${poolId}/sessions/${s.id}?eventId=${eventId}`;

            const predInfo = predictedBySession[s.id];
            const predictedLabel =
              predInfo?.hasAny ? `✅ Voorspeld (${predInfo.filled}/10)` : "—";

            return (
              <div
                key={s.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 12,
                  background: highlight ? "#f6fff6" : "white",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      {s.name}{" "}
                      <span style={{ fontWeight: 400, opacity: 0.7 }}>
                        ({s.session_key})
                      </span>
                    </div>

                    <div style={{ marginTop: 6, opacity: 0.85 }}>
                      {status} • {countdown}
                    </div>

                    <div style={{ marginTop: 4, opacity: 0.85 }}>{startLine}</div>

                    <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                      <strong>Jouw voorspelling:</strong>{" "}
                      <span style={{ color: predInfo?.hasAny ? "green" : "#666" }}>
                        {predictedLabel}
                      </span>
                    </div>

                    {now > startMs ? (
                      <div style={{ marginTop: 4, opacity: 0.7 }}>(Sessie is gestart/voorbij)</div>
                    ) : null}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Link href={href} style={{ textDecoration: "underline" }}>
                      Open session →
                    </Link>
                    <button
                      onClick={() => router.push(href)}
                      style={{ padding: "6px 10px" }}
                    >
                      {isLocked ? "Bekijk" : predInfo?.hasAny ? "Aanpassen" : "Voorspel"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ marginTop: 18, opacity: 0.7 }}>
        Lock-regel: sessies sluiten automatisch <strong>5 minuten</strong> voor start (op basis van{" "}
        <code>lock_at</code>).
      </p>

      <p style={{ marginTop: 8, opacity: 0.7 }}>
        {userId ? (
          <>
            (Debug: user geladen) •{" "}
            {prediction?.id ? "prediction row bestaat" : "nog geen prediction row voor dit event"}
          </>
        ) : null}
      </p>
    </main>
  );
}
