"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

type PoolRow = { id: string; name?: string; title?: string; pool_name?: string };
type EventRow = { id: string; name?: string; title?: string; starts_at?: string | null };
type BankQ = {
  id: string;
  scope: "season" | "weekend";
  prompt: string;
  answer_kind: "boolean" | "text" | "number" | "driver" | "team";
  is_active: boolean;
  question_key?: string | null;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

function poolLabel(p: PoolRow) {
  return p.name ?? p.title ?? p.pool_name ?? p.id;
}
function eventLabel(e: EventRow) {
  return e.name ?? e.title ?? e.id;
}

export default function AdminBonusPage() {
  const [userEmail, setUserEmail] = useState<string>("");

  // selectors
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // weekend official answers view
  const [weekendQuestions, setWeekendQuestions] = useState<any[]>([]);
  const [weekendOfficialAnswers, setWeekendOfficialAnswers] = useState<Record<string, any>>({});
  const [weekendLoading, setWeekendLoading] = useState(false);
  const [weekendError, setWeekendError] = useState<string>("");

  // season official answers view
  const [seasonQuestions, setSeasonQuestions] = useState<BankQ[]>([]);
  const [seasonOfficialAnswers, setSeasonOfficialAnswers] = useState<Record<string, boolean | null>>({});
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState<string>("");

  const canLoadWeekend = !!selectedPoolId && !!selectedEventId;
  const canLoadSeason = !!selectedPoolId;

  // --- initial auth + pools/events
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email ?? "";
      setUserEmail(email);

      // Pools where user is member OR owner (we show both)
      // Try pool_members join first; if that fails, fall back to pools only.
      const { data: pm, error: pmErr } = await supabase
        .from("pool_members")
        .select("pool_id, pools:pool_id(id,name,title,pool_name)")
        .limit(200);

      if (!pmErr && pm) {
        const rows = pm
          .map((r: any) => r.pools)
          .filter(Boolean)
          .reduce((acc: PoolRow[], p: PoolRow) => {
            if (!acc.find((x) => x.id === p.id)) acc.push(p);
            return acc;
          }, []);
        setPools(rows);
        if (rows[0]?.id) setSelectedPoolId(rows[0].id);
      } else {
        // fallback
        const { data: p2 } = await supabase.from("pools").select("id,name,title,pool_name").limit(200);
        setPools((p2 as any) ?? []);
        if ((p2 as any)?.[0]?.id) setSelectedPoolId((p2 as any)[0].id);
      }

      // events list (all)
      const { data: evs } = await supabase
        .from("events")
        .select("id,name,title,starts_at")
        .order("starts_at", { ascending: false })
        .limit(200);
      setEvents((evs as any) ?? []);
    })();
  }, []);

  // -----------------------
  // WEEKEND: official answers
  // -----------------------
  useEffect(() => {
    if (!canLoadWeekend) {
      setWeekendQuestions([]);
      setWeekendOfficialAnswers({});
      setWeekendError("");
      return;
    }

    setWeekendLoading(true);
    setWeekendError("");

    (async () => {
      try {
        // Use your existing API routes (already wired to the new schema)
        // GET questions for selected pool+event
        const qsRes = await fetch(`/api/bonus/weekend-set?poolId=${selectedPoolId}&eventId=${selectedEventId}`, {
          cache: "no-store",
        });
        const qsJson = await qsRes.json().catch(() => ({}));
        if (!qsRes.ok) throw new Error(qsJson?.error ?? "Failed to load weekend-set");

        // expected: { questions: [...] } or { returned: 3, questions: [...] }
        const questions = qsJson?.questions ?? qsJson?.data ?? [];
        setWeekendQuestions(questions);

        // Load existing official answers for this pool+event
        const ansRes = await fetch(`/api/bonus/weekend-official?poolId=${selectedPoolId}&eventId=${selectedEventId}`, {
          cache: "no-store",
        });
        const ansJson = await ansRes.json().catch(() => ({}));
        if (!ansRes.ok) throw new Error(ansJson?.error ?? "Failed to load weekend official answers");

        // expected: { answers: [{question_id, answer_json}] }
        const rows = ansJson?.answers ?? ansJson?.data ?? [];
        const map: Record<string, any> = {};
        for (const r of rows) map[r.question_id] = r.answer_json;
        setWeekendOfficialAnswers(map);
      } catch (e: any) {
        setWeekendError(e?.message ?? String(e));
      } finally {
        setWeekendLoading(false);
      }
    })();
  }, [canLoadWeekend, selectedPoolId, selectedEventId]);

  async function saveWeekendOfficial(questionId: string, value: boolean | null) {
    if (!selectedPoolId || !selectedEventId) return;
    // Do not save nulls to a NOT NULL column.
    if (value === null) {
      // treat as "clear": call API that deletes, or skip.
      // We'll call API with action=clear to avoid NOT NULL violations.
      const res = await fetch(`/api/bonus/weekend-official`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear",
          pool_id: selectedPoolId,
          event_id: selectedEventId,
          question_id: questionId,
        }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(js?.error ?? "Failed to clear weekend official answer");
      setWeekendOfficialAnswers((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      return;
    }

    const res = await fetch(`/api/bonus/weekend-official`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert",
        pool_id: selectedPoolId,
        event_id: selectedEventId,
        question_id: questionId,
        answer_json: value,
      }),
    });

    const js = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(js?.error ?? "Failed to save weekend official answer");

    setWeekendOfficialAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  // -----------------------
  // SEASON: official answers
  // -----------------------
  useEffect(() => {
    if (!canLoadSeason) {
      setSeasonQuestions([]);
      setSeasonOfficialAnswers({});
      setSeasonError("");
      return;
    }

    setSeasonLoading(true);
    setSeasonError("");

    (async () => {
      try {
        // 0) Find the season set for this pool (latest)
        // Some schema variants: pool_season_bonus_sets has { id, pool_id, ... } (no set_id)
        const { data: seasonSets, error: ssErr } = await supabase
          .from("pool_season_bonus_sets")
          .select("*")
          .eq("pool_id", selectedPoolId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (ssErr) throw new Error(ssErr.message);

        const seasonSet = (seasonSets ?? [])[0] as any | undefined;
        const seasonSetId: string | null =
          (seasonSet as any)?.set_id ?? (seasonSet as any)?.id ?? null;

        // 1) Koppeltabel met season vragen per pool/set
        // Let op: in sommige schema-varianten bestaat 'order_index' niet.
        // Daarom halen we ongesorteerd op en sorteren we client-side als er een sort-kolom aanwezig is.
        const { data: sLink, error: sLinkErr } = await supabase
          .from("pool_season_bonus_set_questions")
          .select("*");

        if (sLinkErr) throw new Error(sLinkErr.message);

        // Filter client-side omdat we niet zeker weten hoe de FK heet
        const filteredSeasonLinksUnsorted = (sLink ?? []).filter((r: any) => {
          if (!seasonSetId) return true;
          if ("set_id" in r) return r.set_id === seasonSetId;
          if ("pool_season_bonus_set_id" in r) return r.pool_season_bonus_set_id === seasonSetId;
          // als geen kolom gevonden → laat hem door (dan zie je tenminste iets)
          return true;
        });

        const filteredSeasonLinks = [...filteredSeasonLinksUnsorted].sort((a: any, b: any) => {
          const ao = ("order_index" in a ? a.order_index : "position" in a ? a.position : "sort" in a ? a.sort : null) as
            | number
            | null;
          const bo = ("order_index" in b ? b.order_index : "position" in b ? b.position : "sort" in b ? b.sort : null) as
            | number
            | null;
          if (ao == null && bo == null) return 0;
          if (ao == null) return 1;
          if (bo == null) return -1;
          return ao - bo;
        });

        const sQuestionIds = filteredSeasonLinks
          .map((r: any) => r.question_id)
          .filter(Boolean) as string[];

        if (sQuestionIds.length === 0) {
          setSeasonQuestions([]);
          setSeasonOfficialAnswers({});
          setSeasonLoading(false);
          return;
        }

        // 2) Haal vragen uit bonus_question_bank
        const { data: qRows, error: qErr } = await supabase
          .from("bonus_question_bank")
          .select("id,scope,prompt,answer_kind,is_active,question_key")
          .in("id", sQuestionIds)
          .eq("scope", "season")
          .eq("is_active", true);

        if (qErr) throw new Error(qErr.message);

        // Keep link order if possible
        const qById = new Map((qRows ?? []).map((q: any) => [q.id, q]));
        const orderedQs: BankQ[] = sQuestionIds.map((id) => qById.get(id)).filter(Boolean) as any;

        setSeasonQuestions(orderedQs);

        // 3) Load existing official answers (season_bonus_answers)
        const { data: aRows, error: aErr } = await supabase
          .from("season_bonus_answers")
          .select("question_id,answer_json")
          .eq("pool_id", selectedPoolId)
          .in("question_id", sQuestionIds);

        if (aErr) throw new Error(aErr.message);

        const ansMap: Record<string, boolean | null> = {};
        for (const a of aRows ?? []) {
          // boolean only
          ansMap[(a as any).question_id] =
            typeof (a as any).answer_json === "boolean" ? (a as any).answer_json : null;
        }
        setSeasonOfficialAnswers(ansMap);
      } catch (e: any) {
        setSeasonError(e?.message ?? String(e));
      } finally {
        setSeasonLoading(false);
      }
    })();
  }, [canLoadSeason, selectedPoolId]);

  async function saveSeasonOfficial(questionId: string, value: boolean | null) {
    if (!selectedPoolId) return;

    // avoid NOT NULL violations: delete on clear
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

    const payload: any = {
      pool_id: selectedPoolId,
      question_id: questionId,
      answer_json: value,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("season_bonus_answers")
      .upsert(payload, { onConflict: "pool_id,question_id" });

    if (error) throw new Error(error.message);

    setSeasonOfficialAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const selectedPool = useMemo(() => pools.find((p) => p.id === selectedPoolId), [pools, selectedPoolId]);
  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId), [events, selectedEventId]);

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

      <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: 0, marginBottom: 10 }}>Selectie</h2>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ minWidth: 40 }}>Pool</span>
            <select
              value={selectedPoolId}
              onChange={(e) => setSelectedPoolId(e.target.value)}
              style={{ padding: 6, minWidth: 240 }}
            >
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
          <div style={{ color: "#666", fontSize: 13, marginBottom: 10 }}>Kies pool + event</div>

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
                                await saveWeekendOfficial(qid, true);
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
                                await saveWeekendOfficial(qid, false);
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
                              await saveWeekendOfficial(qid, null);
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
          <div style={{ color: "#666", fontSize: 13, marginBottom: 10 }}>Pool gekozen</div>

          {!canLoadSeason && <div style={{ color: "#999" }}>Kies eerst een pool</div>}

          {seasonLoading && <div>Loading…</div>}
          {seasonError && <div style={{ color: "crimson" }}>{seasonError}</div>}

          {canLoadSeason && !seasonLoading && !seasonError && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {seasonQuestions.length === 0 ? (
                <div style={{ color: "#999" }}>Geen seasonvragen gevonden (check pool_season_bonus_set_questions).</div>
              ) : (
                seasonQuestions.map((q, idx) => {
                  const qid = q.id;
                  const val =
                    typeof seasonOfficialAnswers[qid] === "boolean" ? (seasonOfficialAnswers[qid] as boolean) : null;

                  return (
                    <div key={qid} style={{ border: "1px solid #f1f1f1", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        {idx + 1}. {q.prompt}
                      </div>

                      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            name={`s_${qid}`}
                            checked={val === true}
                            onChange={async () => {
                              try {
                                await saveSeasonOfficial(qid, true);
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
                                await saveSeasonOfficial(qid, false);
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
                              await saveSeasonOfficial(qid, null);
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
