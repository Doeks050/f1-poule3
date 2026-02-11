"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

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
  // kan session_id OF event_session_id zijn, afhankelijk van jouw schema
  session_id?: string;
  event_session_id?: string;
  user_id: string;
  picks: any; // jsonb
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
  return v.trim().toUpperCase();
}

function defaultTop10() {
  return Array.from({ length: 10 }, () => "");
}

/**
 * We bewaren in predictions.picks dit formaat:
 * {
 *   version: 1,
 *   top10: ["VER","HAM","ALO",...]
 * }
 */
function readTop10FromPicks(picks: any): string[] | null {
  if (!picks) return null;
  if (Array.isArray(picks?.top10) && picks.top10.length === 10) {
    return picks.top10.map((x: any) => (typeof x === "string" ? x : ""));
  }
  if (picks?.positions) {
    const arr: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const k = `p${i}`;
      arr.push(typeof picks.positions?.[k] === "string" ? picks.positions[k] : "");
    }
    if (arr.length === 10) return arr;
  }
  return null;
}

// ---- helpers om te werken met predictions kolomnaam verschillen ----
type PredCol = "event_session_id" | "session_id";

/**
 * Probeert een query met kolom `event_session_id`, en valt terug naar `session_id`
 * als die kolom niet bestaat in jouw schema.
 */
async function findPredictionFlexible(args: {
  poolId: string;
  sessionId: string;
  userId: string;
}): Promise<{ pred: PredictionRow | null; col: PredCol; error?: string }> {
  // 1) probeer event_session_id
  {
    const { data, error } = await supabase
      .from("predictions")
      .select("id,pool_id,event_session_id,user_id,picks,created_at,updated_at")
      .eq("pool_id", args.poolId)
      .eq("event_session_id", args.sessionId)
      .eq("user_id", args.userId)
      .maybeSingle();

    if (!error) {
      return { pred: (data as any) ?? null, col: "event_session_id" };
    }

    // alleen fallbacken als het echt een "column does not exist" is
    if (!String(error.message).toLowerCase().includes("does not exist")) {
      return { pred: null, col: "event_session_id", error: error.message };
    }
  }

  // 2) fallback: session_id
  {
    const { data, error } = await supabase
      .from("predictions")
      .select("id,pool_id,session_id,user_id,picks,created_at,updated_at")
      .eq("pool_id", args.poolId)
      .eq("session_id", args.sessionId)
      .eq("user_id", args.userId)
      .maybeSingle();

    if (error) return { pred: null, col: "session_id", error: error.message };
    return { pred: (data as any) ?? null, col: "session_id" };
  }
}

async function insertPredictionFlexible(args: {
  poolId: string;
  sessionId: string;
  userId: string;
  picks: any;
  col: PredCol;
}) {
  // insert met de kolom die we eerder hebben gedetecteerd
  const row: any = {
    pool_id: args.poolId,
    user_id: args.userId,
    picks: args.picks,
  };
  row[args.col] = args.sessionId;

  return supabase.from("predictions").insert(row);
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

  // eventId wordt gebruikt voor "terug naar weekend"
  const eventIdFromQuery = searchParams.get("eventId");

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  const [sessionRow, setSessionRow] = useState<SessionRow | null>(null);

  const [top10, setTop10] = useState<string[]>(defaultTop10());
  const [saving, setSaving] = useState(false);

  // we onthouden welke predictions-kolom jouw DB gebruikt
  const [predSessionCol, setPredSessionCol] = useState<PredCol>("event_session_id");

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

  // ✅ jouw route is /event/[eventId] (niet /weekends)
  const backToWeekendHref = useMemo(() => {
    if (!eventIdFromQuery) return `/pools/${poolId}`;
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
      setSessionRow(sess as SessionRow);

      // laad bestaande prediction (flexibel op kolomnaam)
      const found = await findPredictionFlexible({
        poolId,
        sessionId,
        userId: u.user.id,
      });

      if (found.error) {
        setMsg(found.error);
        setLoading(false);
        return;
      }

      setPredSessionCol(found.col);

      if (found.pred) {
        const loaded = readTop10FromPicks(found.pred.picks);
        if (loaded) setTop10(loaded.map((x) => normalizeCode(x)));
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

  function validateTop10(arr: string[]) {
    const cleaned = arr.map((x) => normalizeCode(x)).map((x) => x.replace(/\s+/g, ""));
    const nonEmpty = cleaned.filter((x) => x.length > 0);
    const set = new Set(nonEmpty);
    if (set.size !== nonEmpty.length) return "Dubbele driver codes gevonden. Elke positie moet uniek zijn.";
    return null;
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

    const payload = {
      version: 1,
      top10: top10.map((x) => normalizeCode(x)),
    };

    // check bestaande prediction (flexibel)
    const found = await findPredictionFlexible({
      poolId,
      sessionId,
      userId,
    });

    if (found.error) {
      setSaving(false);
      setMsg(found.error);
      return;
    }

    // onthoud kolom
    setPredSessionCol(found.col);

    if (found.pred?.id) {
      const { error: updErr } = await supabase
        .from("predictions")
        .update({ picks: payload })
        .eq("id", found.pred.id);

      setSaving(false);

      if (updErr) {
        setMsg(updErr.message);
        return;
      }
      setMsg("✅ Opgeslagen.");
      return;
    }

    // insert
    const { error: insErr } = await insertPredictionFlexible({
      poolId,
      sessionId,
      userId,
      picks: payload,
      col: found.col ?? predSessionCol,
    });

    setSaving(false);

    if (insErr) {
      setMsg(insErr.message);
      return;
    }
    setMsg("✅ Opgeslagen.");
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
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
              Predictions-kolom: <code>{predSessionCol}</code>
            </div>
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
        Vul driver codes in (bijv. <strong>VER</strong>, <strong>HAM</strong>, <strong>ALO</strong>). Elke positie moet
        uniek zijn.
      </p>

      <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        {top10.map((v, idx) => {
          const pos = idx + 1;
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
              <input
                value={v}
                onChange={(e) => updatePos(idx, e.target.value)}
                disabled={isLocked}
                placeholder="bv. VER"
                style={{
                  padding: "8px 10px",
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  textTransform: "uppercase",
                }}
              />
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

      {msg ? <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p> : null}

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
