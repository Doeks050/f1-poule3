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
  event_id: string | null;
  event_session_id: string;
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

function normalizeCode(v: string) {
  return v.trim().toUpperCase();
}

function defaultTop10() {
  return Array.from({ length: 10 }, () => "");
}

/**
 * We bewaren in predictions.prediction_json dit formaat:
 * {
 *   version: 1,
 *   top10: ["VER","HAM","ALO",...]
 * }
 */
function readTop10FromJson(prediction_json: any): string[] | null {
  if (!prediction_json) return null;
  if (Array.isArray(prediction_json?.top10) && prediction_json.top10.length === 10) {
    return prediction_json.top10.map((x: any) => (typeof x === "string" ? x : ""));
  }
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

  // eventId wordt gebruikt voor "terug naar weekend"
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
    // jouw weekend route is /pools/[id]/event/[eventId]
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

      // laad bestaande prediction (per pool + session + user)
      const { data: pred, error: predErr } = await supabase
        .from("predictions")
        .select("id,pool_id,event_id,event_session_id,user_id,prediction_json,created_at,updated_at")
        .eq("pool_id", poolId)
        .eq("event_session_id", sessionId)
        .eq("user_id", u.user.id)
        .maybeSingle();

      if (predErr) {
        setMsg(predErr.message);
        setLoading(false);
        return;
      }

      if (pred) {
        const loaded = readTop10FromJson((pred as PredictionRow).prediction_json);
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

    if (!userId) return setMsg("Geen user. Log opnieuw in.");
    if (!sessionRow) return setMsg("Geen session data geladen.");
    if (isLocked) return setMsg("Deze sessie is gelockt. Je kunt niet meer opslaan.");

    const warn = validateTop10(top10);
    if (warn) return setMsg(warn);

    setSaving(true);

    const payload = {
      version: 1,
      top10: top10.map((x) => normalizeCode(x)),
    };

    // Upsert op (user_id, pool_id, event_session_id) — werkt pas goed na de unique index in SQL
    const { error: upErr } = await supabase.from("predictions").upsert(
      {
        user_id: userId,
        pool_id: poolId,
        event_id: sessionRow.event_id, // handig voor queries later
        event_session_id: sessionId,
        prediction_json: payload,
      },
      { onConflict: "user_id,pool_id,event_session_id" }
    );

    setSaving(false);

    if (upErr) return setMsg(upErr.message);
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
        (Voor nu) driver codes invullen. Straks vervangen we dit door dropdowns met teamkleur/logo.
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
    </main>
  );
}
