"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

type PoolRow = { id: string; name?: string | null; pool_name?: string | null };
type EventRow = { id: string; name?: string | null; starts_at?: string | null };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || (process.env as any).NEXT_PUBLIC_SUPABASE_ANON || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

function poolLabel(p: PoolRow) {
  return p.name ?? p.pool_name ?? p.id;
}
function eventLabel(e: EventRow) {
  return e.name ?? e.id;
}

export default function AdminBonusPage() {
  const [userEmail, setUserEmail] = useState<string>("");

  // selector data
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // load state + errors
  const [initLoading, setInitLoading] = useState<boolean>(true);
  const [initError, setInitError] = useState<string>("");

  // Weekend official answers UI state
  const [weekendLoading, setWeekendLoading] = useState(false);
  const [weekendError, setWeekendError] = useState<string>("");
  const [weekendQuestions, setWeekendQuestions] = useState<any[]>([]);
  const [weekendOfficialAnswers, setWeekendOfficialAnswers] = useState<Record<string, boolean>>({});

  // Season official answers UI state
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState<string>("");
  const [seasonQuestions, setSeasonQuestions] = useState<any[]>([]);
  const [seasonOfficialAnswers, setSeasonOfficialAnswers] = useState<Record<string, boolean>>({});

  const canLoadWeekend = !!selectedPoolId && !!selectedEventId;
  const canLoadSeason = !!selectedPoolId;

  const selectedPool = useMemo(() => pools.find((p) => p.id === selectedPoolId), [pools, selectedPoolId]);
  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId), [events, selectedEventId]);

  // ------------------------------------------------------------
  // INIT: auth + pools (via pool_members) + events
  // ------------------------------------------------------------
  useEffect(() => {
    (async () => {
      setInitLoading(true);
      setInitError("");

      try {
        // Auth
        const { data: uData, error: uErr } = await supabase.auth.getUser();
        if (uErr) throw new Error(uErr.message);
        const user = uData?.user;
        if (!user) throw new Error("Niet ingelogd (geen user sessie gevonden).");

        setUserEmail(user.email ?? "");

        // Pools via pool_members -> pools IN(ids)
        const { data: memberRows, error: pmErr } = await supabase
          .from("pool_members")
          .select("pool_id")
          .eq("user_id", user.id);

        if (pmErr) throw new Error(`pool_members select error: ${pmErr.message}`);

        const poolIds = (memberRows ?? []).map((r: any) => r.pool_id).filter(Boolean);

        if (poolIds.length === 0) {
          // fallback: probeer pools direct (admin setups)
          const { data: pFallback, error: pFallbackErr } = await supabase
            .from("pools")
            .select("id,name,pool_name")
            .limit(200);

          if (pFallbackErr) throw new Error(`pools fallback select error: ${pFallbackErr.message}`);

          const list = ((pFallback as any) ?? []) as PoolRow[];
          setPools(list);
          if (list[0]?.id) setSelectedPoolId(list[0].id);
        } else {
          const { data: poolRows, error: pErr } = await supabase
            .from("pools")
            .select("id,name,pool_name")
            .in("id", poolIds)
            .limit(200);

          if (pErr) throw new Error(`pools select error: ${pErr.message}`);

          const list = ((poolRows as any) ?? []) as PoolRow[];
          setPools(list);
          if (list[0]?.id) setSelectedPoolId(list[0].id);
        }

        // Events
        const { data: evRows, error: evErr } = await supabase
          .from("events")
          .select("id,name,starts_at")
          .order("starts_at", { ascending: false })
          .limit(200);

        if (evErr) throw new Error(`events select error: ${evErr.message}`);

        setEvents(((evRows as any) ?? []) as EventRow[]);
      } catch (e: any) {
        setInitError(e?.message ?? String(e));
      } finally {
        setInitLoading(false);
      }
    })();
  }, []);

  // ------------------------------------------------------------
  // WEEKEND: load questions + existing official answers
  // ------------------------------------------------------------
  useEffect(() => {
    if (!canLoadWeekend) {
      setWeekendQuestions([]);
      setWeekendOfficialAnswers({});
      setWeekendError("");
      return;
    }

    (async () => {
      setWeekendLoading(true);
      setWeekendError("");

      try {
        // 1) Weekend set vragen
        const qsRes = await fetch(`/api/bonus/weekend-set?poolId=${selectedPoolId}&eventId=${selectedEventId}`, {
          cache: "no-store",
        });
        const qsJson = await qsRes.json().catch(() => ({}));
        if (!qsRes.ok) throw new Error(qsJson?.error ?? "Failed to load weekend-set");

        const questions = qsJson?.questions ?? qsJson?.data ?? [];
        setWeekendQuestions(questions);

        // 2) Official answers ophalen
        const aRes = await fetch(`/api/bonus/weekend-official?poolId=${selectedPoolId}&eventId=${selectedEventId}`, {
          cache: "no-store",
        });
        const aJson = await aRes.json().catch(() => ({}));
        if (!aRes.ok) throw new Error(aJson?.error ?? "Failed to load weekend official answers");

        const rows = aJson?.answers ?? aJson?.data ?? [];
        const map: Record<string, boolean> = {};
        for (const r of rows) {
          if (typeof r?.answer_json === "boolean") map[r.question_id] = r.answer_json;
        }
        setWeekendOfficialAnswers(map);
      } catch (e: any) {
        setWeekendError(e?.message ?? String(e));
      } finally {
        setWeekendLoading(false);
      }
    })();
  }, [canLoadWeekend, selectedPoolId, selectedEventId]);

  async function setWeekendOfficial(questionId: string, value: boolean | null) {
    if (!selectedPoolId || !selectedEventId) return;

    // NIET null upserten -> NOT NULL errors (answer_json)
    const body =
      value === null
        ? { action: "clear", pool_id: selectedPoolId, event_id: selectedEventId, question_id: questionId }
        : {
            action: "upsert",
            pool_id: selectedPoolId,
            event_id: selectedEventId,
            question_id: questionId,
            answer_json: value,
          };

    const res = await fetch("/api/bonus/weekend-official", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const js = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(js?.error ?? "Save failed");

    setWeekendOfficialAnswers((prev) => {
      const next = { ...prev };
      if (value === null) delete next[questionId];
      else next[questionId] = value;
      return next;
    });
  }

  // ------------------------------------------------------------
  // SEASON: vragen uit bank + antwoorden in season_bonus_answers
  // ------------------------------------------------------------
  useEffect(() => {
    if (!canLoadSeason) {
      setSeasonQuestions([]);
      setSeasonOfficialAnswers({});
      setSeasonError("");
      return;
    }

    (async () => {
      setSeasonLoading(true);
      setSeasonError("");

      try {
        const { data: qRows, error: qErr } = await supabase
          .from("bonus_question_bank")
          .select("id,prompt,scope,is_active,answer_kind")
          .eq("scope", "season")
          .eq("is_active", true)
          .limit(50);

        if (qErr) throw new Error(qErr.message);

        const qList = (qRows ?? []) as any[];
        setSeasonQuestions(qList);

        const qIds = qList.map((q) => q.id);
        if (qIds.length === 0) {
          setSeasonOfficialAnswers({});
          setSeasonLoading(false);
          return;
        }

        const { data: aRows, error: aErr } = await supabase
          .from("season_bonus_answers")
          .select("question_id,answer_json")
          .eq("pool_id", selectedPoolId)
          .in("question_id", qIds);

        if (aErr) throw new Error(aErr.message);

        const map: Record<string, boolean> = {};
        for (const r of aRows ?? []) {
          if (typeof (r as any).answer_json === "boolean") map[(r as any).question_id] = (r as any).answer_json;
        }
        setSeasonOfficialAnswers(map);
      } catch (e: any) {
        setSeasonError(e?.message ?? String(e));
      } finally {
        setSeasonLoading(false);
      }
    })();
  }, [canLoadSeason, selectedPoolId]);

  async function setSeasonOfficial(questionId: string, value: boolean | null) {
    if (!selectedPoolId) return;

    if (value === null) {
      const { error } = await supabase
        .from("season_bonus_answers")
        .delete()
        .eq("pool_id", selectedPoolId)
        .eq("question_id", questionId);

      if (error) throw new Error(error.message);

      setSeasonOfficialAnswers((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      return;
    }

    const { error } = await supabase
      .from("season_bonus_answers")
      .upsert(
        { pool_id: selectedPoolId, question_id: questionId, answer_json: value, updated_at: new Date().toISOString() },
        { onConflict: "pool_id,question_id" }
      );

    if (error) throw new Error(error.message);

    setSeasonOfficialAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------
  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui, Arial" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Admin Bonus</h1>
      <div style={{ color: "#555", marginBottom: 8 }}>Ingelogd als: {userEmail || "-"}</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Link href="/admin/results" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
          Terug naar Admin Results
        </Link>
        <Link href="/pools" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
          Terug naar Pools
        </Link>
        <Link href="/logout" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
          Logout
        </Link>
      </div>

      {initLoading && <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}>Loading…</div>}
      {initError && (
        <div style={{ padding: 10, border: "1px solid #f5c2c7", background: "#f8d7da", borderRadius: 8, color: "#842029" }}>
          {initError}
        </div>
      )}

      <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: 0, marginBottom: 10 }}>Selectie</h2>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ minWidth: 40 }}>Pool</span>
            <select
              value={selectedPoolId}
              onChange={(e) => setSelectedPoolId(e.target.value)}
              style={{ padding: 6, minWidth: 240 }}
              disabled={initLoading || pools.length === 0}
            >
              {pools.length === 0 ? <option value="">— Geen pools —</option> : null}
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {poolLabel(p)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ minWidth: 90 }}>Event (weekend)</span>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={{ padding: 6, minWidth: 320 }}
              disabled={initLoading || events.length === 0}
            >
              <option value="">— Kies event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {eventLabel(ev)}
                  {ev.starts_at ? ` — ${new Date(ev.starts_at).toLocaleString()}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
          Tip: Weekend answers zijn per <b>pool + event</b>. Season answers zijn per <b>pool</b>.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* WEEKEND */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          <h2 style={{ fontSize: 20, margin: 0, marginBottom: 6 }}>Weekend bonus (official answers)</h2>

          {!canLoadWeekend && <div style={{ color: "#999" }}>Kies pool + event</div>}

          {weekendLoading && <div>Loading…</div>}
          {weekendError && <div style={{ color: "crimson" }}>{weekendError}</div>}

          {canLoadWeekend && !weekendLoading && !weekendError && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {weekendQuestions.length === 0 ? (
                <div style={{ color: "#999" }}>Geen weekendvragen gevonden.</div>
              ) : (
                weekendQuestions.map((q: any, idx: number) => {
                  const qid = q.id ?? q.question_id;
                  const prompt = q.prompt ?? q.question_prompt ?? q.text ?? `Vraag ${idx + 1}`;
                  const val = typeof weekendOfficialAnswers[qid] === "boolean" ? weekendOfficialAnswers[qid] : null;

                  return (
                    <div key={qid} style={{ border: "1px solid #f1f1f1", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        {idx + 1}. {prompt}
                      </div>

                      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            name={`w_${qid}`}
                            checked={val === true}
                            onChange={async () => {
                              try {
                                await setWeekendOfficial(qid, true);
                              } catch (e: any) {
                                setWeekendError(e?.message ?? String(e));
                              }
                            }}
                          />
                          Ja
                        </label>

                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            name={`w_${qid}`}
                            checked={val === false}
                            onChange={async () => {
                              try {
                                await setWeekendOfficial(qid, false);
                              } catch (e: any) {
                                setWeekendError(e?.message ?? String(e));
                              }
                            }}
                          />
                          Nee
                        </label>

                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await setWeekendOfficial(qid, null);
                            } catch (e: any) {
                              setWeekendError(e?.message ?? String(e));
                            }
                          }}
                          style={{
                            marginLeft: "auto",
                            padding: "6px 10px",
                            border: "1px solid #ddd",
                            borderRadius: 6,
                            background: "#fff",
                            cursor: "pointer",
                          }}
                        >
                          Wis
                        </button>
                      </div>

                      <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>
                        Status: {val === null ? "open" : val ? "Ja" : "Nee"}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 12, color: "#777" }}>
            Pool: <b>{selectedPool ? poolLabel(selectedPool) : "-"}</b>
            <br />
            Event: <b>{selectedEvent ? eventLabel(selectedEvent) : "-"}</b>
          </div>
        </div>

        {/* SEASON */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          <h2 style={{ fontSize: 20, margin: 0, marginBottom: 6 }}>Season bonus (official answers)</h2>

          {!canLoadSeason && <div style={{ color: "#999" }}>Kies eerst een pool</div>}

          {seasonLoading && <div>Loading…</div>}
          {seasonError && <div style={{ color: "crimson" }}>{seasonError}</div>}

          {canLoadSeason && !seasonLoading && !seasonError && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {seasonQuestions.length === 0 ? (
                <div style={{ color: "#999" }}>Geen seasonvragen gevonden in bonus_question_bank (scope=season).</div>
              ) : (
                seasonQuestions.map((q: any, idx: number) => {
                  const qid = q.id;
                  const prompt = q.prompt ?? `Vraag ${idx + 1}`;
                  const val = typeof seasonOfficialAnswers[qid] === "boolean" ? seasonOfficialAnswers[qid] : null;

                  return (
                    <div key={qid} style={{ border: "1px solid #f1f1f1", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        {idx + 1}. {prompt}
                      </div>

                      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            name={`s_${qid}`}
                            checked={val === true}
                            onChange={async () => {
                              try {
                                await setSeasonOfficial(qid, true);
                              } catch (e: any) {
                                setSeasonError(e?.message ?? String(e));
                              }
                            }}
                          />
                          Ja
                        </label>

                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            name={`s_${qid}`}
                            checked={val === false}
                            onChange={async () => {
                              try {
                                await setSeasonOfficial(qid, false);
                              } catch (e: any) {
                                setSeasonError(e?.message ?? String(e));
                              }
                            }}
                          />
                          Nee
                        </label>

                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await setSeasonOfficial(qid, null);
                            } catch (e: any) {
                              setSeasonError(e?.message ?? String(e));
                            }
                          }}
                          style={{
                            marginLeft: "auto",
                            padding: "6px 10px",
                            border: "1px solid #ddd",
                            borderRadius: 6,
                            background: "#fff",
                            cursor: "pointer",
                          }}
                        >
                          Wis
                        </button>
                      </div>

                      <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>
                        Status: {val === null ? "open" : val ? "Ja" : "Nee"}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 12, color: "#777" }}>
            Pool: <b>{selectedPool ? poolLabel(selectedPool) : "-"}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
