"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

type PoolRow = { id: string; name: string };
type EventRow = { id: string; name: string; starts_at?: string | null };

type WeekendSetResponse = {
  ok: boolean;
  poolId: string;
  eventId: string;
  setId?: string | null;
  questions: Array<{
    id: string; // question_id
    prompt: string;
    answer_kind: string;
    options?: any;
  }>;
  error?: string;
};

type WeekendOfficialResponse = {
  ok: boolean;
  setId: string;
  table: string;
  rows: Array<{ question_id: string; answer_json: any; set_id: string }>;
  error?: string;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function authedFetch(url: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = {};

  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  return fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  });
}

function formatDate(s?: string | null) {
  if (!s) return "";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default function AdminBonusPage() {
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  const [poolId, setPoolId] = useState<string>("");
  const [eventId, setEventId] = useState<string>("");

  const [weekendQuestions, setWeekendQuestions] = useState<WeekendSetResponse["questions"]>([]);
  const [weekendSetId, setWeekendSetId] = useState<string>("");

  const [officialMap, setOfficialMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [topError, setTopError] = useState<string>("");

  const selectedPool = useMemo(() => pools.find((p) => p.id === poolId) ?? null, [pools, poolId]);
  const selectedEvent = useMemo(() => events.find((e) => e.id === eventId) ?? null, [events, eventId]);

  // Load pools + events
  useEffect(() => {
    (async () => {
      setTopError("");
      const poolsRes = await supabase
        .from("pools")
        .select("id,name")
        .order("created_at", { ascending: false });

      if (poolsRes.error) {
        setTopError(`pools select error: ${poolsRes.error.message}`);
        setPools([]);
      } else {
        setPools((poolsRes.data ?? []) as PoolRow[]);
      }

      const eventsRes = await supabase
        .from("events")
        .select("id,name,starts_at")
        .order("starts_at", { ascending: false });

      if (eventsRes.error) {
        // events table name might differ in your project; if so you'll see it here
        setTopError((prev) => prev || `events select error: ${eventsRes.error.message}`);
        setEvents([]);
      } else {
        setEvents((eventsRes.data ?? []) as EventRow[]);
      }
    })();
  }, []);

  // When pool+event selected -> fetch weekend set + official answers
  useEffect(() => {
    (async () => {
      setWeekendQuestions([]);
      setWeekendSetId("");
      setOfficialMap({});
      setTopError("");

      if (!poolId || !eventId) return;

      setLoading(true);
      try {
        // 1) weekend set (questions)
        const setRes = await authedFetch(
  `/api/bonus/weekend-set?poolId=${poolId}&eventId=${eventId}`
);
        const setJson = (await setRes.json()) as WeekendSetResponse;

        if (!setRes.ok || !setJson.ok) {
          setTopError(setJson.error || "Failed to load weekend set");
          setLoading(false);
          return;
        }

        setWeekendQuestions(setJson.questions ?? []);
        setWeekendSetId(setJson.setId ?? "");

        // 2) official answers
        const offRes = await authedFetch(
  `/api/weekend-official?poolId=${poolId}&eventId=${eventId}`
);

if (!offRes.ok) {
  const text = await offRes.text();
  console.error("Official fetch failed:", text);
  setTopError("Failed to load official answers");
  setLoading(false);
  return;
}

const offJson = (await offRes.json()) as WeekendOfficialResponse;

if (!offJson.ok) {
  setTopError(offJson.error || "Failed to load official answers");
  setLoading(false);
  return;
}

        const m: Record<string, any> = {};
        for (const r of offJson.rows ?? []) m[r.question_id] = r.answer_json;
        setOfficialMap(m);
      } catch (e: any) {
        setTopError(e?.message ?? "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [poolId, eventId]);

  async function saveOfficial(questionId: string, value: any | null) {
    if (!poolId || !eventId) return;

    // If user selects "open" -> clear (DELETE) instead of saving null (avoids NOT NULL issue)
    const body =
      value === null
        ? { action: "clear", pool_id: poolId, event_id: eventId, question_id: questionId }
        : { action: "upsert", pool_id: poolId, event_id: eventId, question_id: questionId, answer_json: value };

    const { data: sessionData } = await supabase.auth.getSession();
const accessToken = sessionData?.session?.access_token;

if (!accessToken) {
  setTopError("Not authenticated (missing token)");
  return;
}

const res = await fetch("/api/weekend-official", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify(body),
});

    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setTopError(json?.error || "Save failed");
      return;
    }

    setTopError("");
    setOfficialMap((prev) => {
      const next = { ...prev };
      if (value === null) delete next[questionId];
      else next[questionId] = value;
      return next;
    });
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Admin Bonus</h1>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <Link href="/admin/results">Terug naar Admin Results</Link>
        <span>·</span>
        <Link href="/pools">Terug naar Pools</Link>
        <span>·</span>
        <Link href="/logout">Logout</Link>
      </div>

      {topError ? (
        <div style={{ background: "#ffd7d7", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {topError}
        </div>
      ) : null}

      <div style={{ background: "#f6f6f6", padding: 16, borderRadius: 10, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Selectie</h2>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ minWidth: 60 }}>Pool</span>
            <select value={poolId} onChange={(e) => setPoolId(e.target.value)} style={{ minWidth: 240 }}>
              <option value="">— Kies pool —</option>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ minWidth: 110 }}>Event (weekend)</span>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ minWidth: 340 }}>
              <option value="">— Kies event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} {ev.starts_at ? `(${formatDate(ev.starts_at)})` : ""}
                </option>
              ))}
            </select>
          </label>

          {loading ? <span style={{ opacity: 0.75 }}>laden…</span> : null}
        </div>

        <div style={{ marginTop: 8, opacity: 0.8 }}>
          Tip: Weekend answers zijn per <b>pool + event</b>.
          {weekendSetId ? (
            <span style={{ marginLeft: 10 }}>
              (setId: <code>{weekendSetId}</code>)
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 10, padding: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Weekend bonus (official answers)</h2>

          {!poolId || !eventId ? (
            <div style={{ opacity: 0.75 }}>Kies eerst pool + event.</div>
          ) : weekendQuestions.length === 0 ? (
            <div style={{ opacity: 0.75 }}>Geen vragen gevonden voor dit pool+event.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {weekendQuestions.map((q, idx) => {
                const cur = officialMap[q.id]; // true/false/other
                const curStr =
                  typeof cur === "boolean" ? (cur ? "true" : "false") : cur === null || typeof cur === "undefined" ? "" : String(cur);

                return (
                  <div key={q.id} style={{ padding: 12, borderRadius: 10, background: "#fafafa", border: "1px solid #eee" }}>
                    <div style={{ fontWeight: 700 }}>
                      {idx + 1}. {q.prompt}
                    </div>

                    {q.answer_kind === "boolean" ? (
                      <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 8 }}>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            name={`q_${q.id}`}
                            checked={cur === true}
                            onChange={() => saveOfficial(q.id, true)}
                          />
                          Ja
                        </label>

                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            name={`q_${q.id}`}
                            checked={cur === false}
                            onChange={() => saveOfficial(q.id, false)}
                          />
                          Nee
                        </label>

                        <button
                          type="button"
                          onClick={() => saveOfficial(q.id, null)}
                          style={{
                            marginLeft: 8,
                            padding: "6px 10px",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                            background: "white",
                            cursor: "pointer",
                          }}
                        >
                          Open / wis
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                        <input
                          value={curStr}
                          onChange={(e) => {
                            const v = e.target.value;
                            setOfficialMap((prev) => ({ ...prev, [q.id]: v }));
                          }}
                          placeholder="Typ official answer…"
                          style={{ width: 360, padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                        />

                        <button
                          type="button"
                          onClick={() => saveOfficial(q.id, (officialMap[q.id] ?? "").toString())}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                            background: "white",
                            cursor: "pointer",
                          }}
                        >
                          Opslaan
                        </button>

                        <button
                          type="button"
                          onClick={() => saveOfficial(q.id, null)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                            background: "white",
                            cursor: "pointer",
                          }}
                        >
                          Wis
                        </button>
                      </div>
                    )}

                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                      question_id: <code>{q.id}</code>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18, opacity: 0.7, fontSize: 12 }}>
        Gekozen: Pool <code>{selectedPool?.name ?? "-"}</code> · Event <code>{selectedEvent?.name ?? "-"}</code>
      </div>
    </div>
  );
}
