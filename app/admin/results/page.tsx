"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

/**
 * IMPORTANT
 * - This page is a combined Admin portal:
 *   - Sessions tab: existing per-session results editor (event_sessions -> event_results.result_json)
 *   - Season bonus tab: official season answers (bonus_question_bank scope='season' -> season_official_answers.correct_answer_json)
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnon);

// =======================
// 2026 Drivers (codes used as stored values)
// Source used in this project flow: your requirement “dropdown with 2026 drivers/teams incl Audi + Cadillac”
// =======================
const F1_DRIVERS_2026 = [
  { code: "NORRIS", name: "Lando Norris", teamName: "McLaren" },
  { code: "PIASTRI", name: "Oscar Piastri", teamName: "McLaren" },
  { code: "LECLERC", name: "Charles Leclerc", teamName: "Ferrari" },
  { code: "HAMILTON", name: "Lewis Hamilton", teamName: "Ferrari" },
  { code: "VERSTAPPEN", name: "Max Verstappen", teamName: "Red Bull" },
  { code: "HADJAR", name: "Isack Hadjar", teamName: "Red Bull" },
  { code: "RUSSELL", name: "George Russell", teamName: "Mercedes" },
  { code: "ANTONELLI", name: "Kimi Antonelli", teamName: "Mercedes" },
  { code: "ALONSO", name: "Fernando Alonso", teamName: "Aston Martin" },
  { code: "STROLL", name: "Lance Stroll", teamName: "Aston Martin" },
  { code: "GASLY", name: "Pierre Gasly", teamName: "Alpine" },
  { code: "COLAPINTO", name: "Franco Colapinto", teamName: "Alpine" },
  { code: "OCON", name: "Esteban Ocon", teamName: "Haas" },
  { code: "BEARMAN", name: "Oliver Bearman", teamName: "Haas" },
  { code: "LAWSON", name: "Liam Lawson", teamName: "Racing Bulls" },
  { code: "LINDBLAD", name: "Arvid Lindblad", teamName: "Racing Bulls" },
  { code: "SAINZ", name: "Carlos Sainz", teamName: "Williams" },
  { code: "ALBON", name: "Alex Albon", teamName: "Williams" },
  { code: "HULKENBERG", name: "Nico Hülkenberg", teamName: "Audi" },
  { code: "BORTOLETO", name: "Gabriel Bortoleto", teamName: "Audi" },
  { code: "PEREZ", name: "Sergio Pérez", teamName: "Cadillac" },
  { code: "BOTTAS", name: "Valtteri Bottas", teamName: "Cadillac" },
] as const;

const F1_TEAMS_2026 = Array.from(new Set(F1_DRIVERS_2026.map((d) => d.teamName))).sort();

function fmtLocal(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// =======================
// Types (Sessions tab)
// =======================
type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  format?: string | null;
};

type SessionRow = {
  id: string;
  event_id: string;
  name: string;
  session_key: string;
  starts_at: string;
  lock_at: string;
};

type EventResultsRow = {
  id: string;
  event_id: string;
  result_json: any;
  created_at?: string;
  updated_at?: string;
};

// =======================
// Types (Season bonus tab)
// =======================
type SeasonQuestion = {
  id: string;
  question_key: string;
  prompt: string;
  answer_kind: "boolean" | "driver" | "team";
};

export default function AdminResultsPage() {
  const router = useRouter();

  // Tabs
  const [tab, setTab] = useState<"sessions" | "season">("sessions");

  // Auth info
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");

  // General message
  const [msg, setMsg] = useState<string | null>(null);

  // ================
  // Sessions tab state
  // ================
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId) ?? null, [events, selectedEventId]);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  const [eventResultsRow, setEventResultsRow] = useState<EventResultsRow | null>(null);
  const [saving, setSaving] = useState(false);

  // Existing UI top10 (per session)
  const [top10, setTop10] = useState<string[]>(Array.from({ length: 10 }, () => ""));

  // ================
  // Season bonus tab state
  // ================
  const [seasonYear, setSeasonYear] = useState<number>(2026);
  const [seasonQuestions, setSeasonQuestions] = useState<SeasonQuestion[]>([]);
  const [seasonAnswers, setSeasonAnswers] = useState<Record<string, boolean | string | null>>({});
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonSaving, setSeasonSaving] = useState(false);
  const [seasonMsg, setSeasonMsg] = useState<string | null>(null);

  // ==========================================
  // Auth + Admin gate
  // ==========================================
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (!user) {
        router.replace("/login");
        return;
      }

      setEmail(user.email ?? "");

      // Check admin
      const { data: adminRow, error } = await supabase.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();

      if (error) {
        setMsg(`Admin check failed: ${error.message}`);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      if (!adminRow) {
        setMsg("Not an admin.");
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setIsAdmin(true);
      setLoading(false);

      // Load initial sessions tab data
      await loadEvents();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================
  // Sessions tab loaders
  // ==========================================
  async function loadEvents() {
    setMsg(null);

    const { data, error } = await supabase
      .from("events")
      .select("id, name, starts_at, format")
      .order("starts_at", { ascending: true });

    if (error) {
      setMsg(`Error loading events: ${error.message}`);
      return;
    }

    setEvents((data as any) ?? []);

    // keep selection if possible, else select first
    const firstId = (data as any)?.[0]?.id ?? "";
    setSelectedEventId((prev) => prev || firstId);
  }

  useEffect(() => {
    if (!isAdmin) return;
    if (!selectedEventId) return;
    (async () => {
      setSelectedSessionId("");
      setSessions([]);
      setEventResultsRow(null);
      setTop10(Array.from({ length: 10 }, () => ""));
      await loadSessions(selectedEventId);
      await loadEventResults(selectedEventId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId, isAdmin]);

  async function loadSessions(eventId: string) {
    const { data, error } = await supabase
      .from("event_sessions")
      .select("id, event_id, name, session_key, starts_at, lock_at")
      .eq("event_id", eventId)
      .order("starts_at", { ascending: true });

    if (error) {
      setMsg(`Error loading sessions: ${error.message}`);
      return;
    }

    setSessions((data as any) ?? []);
    const firstSessionId = (data as any)?.[0]?.id ?? "";
    setSelectedSessionId((prev) => prev || firstSessionId);
  }

  async function loadEventResults(eventId: string) {
    const { data, error } = await supabase
      .from("event_results")
      .select("id, event_id, result_json, created_at, updated_at")
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) {
      setMsg(`Error loading event_results: ${error.message}`);
      return;
    }

    const row = (data as any) ?? null;
    setEventResultsRow(row);

    // hydrate top10 for selected session
    const sessionId = selectedSessionId;
    if (row?.result_json?.sessions && sessionId && row.result_json.sessions[sessionId]?.top10) {
      setTop10(row.result_json.sessions[sessionId].top10 ?? Array.from({ length: 10 }, () => ""));
    }
  }

  // Keep top10 updated when switching sessions
  useEffect(() => {
    if (!selectedSessionId) return;
    const row = eventResultsRow;
    if (row?.result_json?.sessions?.[selectedSessionId]?.top10) {
      setTop10(row.result_json.sessions[selectedSessionId].top10 ?? Array.from({ length: 10 }, () => ""));
    } else {
      setTop10(Array.from({ length: 10 }, () => ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  function updatePos(idx: number, value: string) {
    setTop10((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  async function clearSession() {
    if (!selectedEventId || !selectedSessionId) return;

    setSaving(true);
    setMsg(null);

    // Ensure row exists
    let row = eventResultsRow;
    if (!row) {
      const { data: created, error: createErr } = await supabase
        .from("event_results")
        .insert({ event_id: selectedEventId, result_json: { sessions: {} } })
        .select("id, event_id, result_json")
        .single();

      if (createErr) {
        setMsg(createErr.message);
        setSaving(false);
        return;
      }

      row = created as any;
      setEventResultsRow(row as any);
    }

    const nextJson = { ...(row!.result_json ?? {}) };
    nextJson.sessions = { ...(nextJson.sessions ?? {}) };
    nextJson.sessions[selectedSessionId] = { ...(nextJson.sessions[selectedSessionId] ?? {}), top10: Array.from({ length: 10 }, () => "") };

    const { error } = await supabase.from("event_results").update({ result_json: nextJson }).eq("id", row!.id);

    if (error) {
      setMsg(error.message);
      setSaving(false);
      return;
    }

    setEventResultsRow((prev) => (prev ? { ...prev, result_json: nextJson } : prev));
    setTop10(Array.from({ length: 10 }, () => ""));
    setMsg("✅ Cleared session results.");
    setSaving(false);
  }

  async function saveResultsForSession() {
    if (!selectedEventId || !selectedSessionId) return;

    setSaving(true);
    setMsg(null);

    // Ensure row exists
    let row = eventResultsRow;
    if (!row) {
      const { data: created, error: createErr } = await supabase
        .from("event_results")
        .insert({ event_id: selectedEventId, result_json: { sessions: {} } })
        .select("id, event_id, result_json")
        .single();

      if (createErr) {
        setMsg(createErr.message);
        setSaving(false);
        return;
      }

      row = created as any;
      setEventResultsRow(row as any);
    }

    const nextJson = { ...(row!.result_json ?? {}) };
    nextJson.sessions = { ...(nextJson.sessions ?? {}) };
    nextJson.sessions[selectedSessionId] = {
      ...(nextJson.sessions[selectedSessionId] ?? {}),
      top10: top10,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("event_results").update({ result_json: nextJson }).eq("id", row!.id);

    if (error) {
      setMsg(error.message);
      setSaving(false);
      return;
    }

    setEventResultsRow((prev) => (prev ? { ...prev, result_json: nextJson } : prev));
    setMsg("✅ Saved session results.");
    setSaving(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // ==========================================
  // Season bonus tab logic
  // ==========================================
  useEffect(() => {
    if (!isAdmin) return;
    if (tab !== "season") return;
    loadSeasonBonus(seasonYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, seasonYear, isAdmin]);

  async function loadSeasonBonus(year: number) {
    setSeasonLoading(true);
    setSeasonMsg(null);

    // 1) Load season questions from question bank
    const { data: qData, error: qErr } = await supabase
      .from("bonus_question_bank")
      .select("id, question_key, prompt, answer_kind")
      .eq("scope", "season")
      .order("created_at", { ascending: true });

    if (qErr) {
      setSeasonMsg(`Error loading season questions: ${qErr.message}`);
      setSeasonLoading(false);
      return;
    }

    setSeasonQuestions((qData as any) ?? []);

    // 2) Load already saved official answers for this season year
    const { data: aData, error: aErr } = await supabase
      .from("season_official_answers")
      .select("question_key, correct_answer_json")
      .eq("season_year", year);

    if (aErr) {
      setSeasonMsg(`Error loading season official answers: ${aErr.message}`);
      setSeasonLoading(false);
      return;
    }

    const map: Record<string, boolean | string | null> = {};
    for (const row of (aData as any[]) ?? []) {
      map[row.question_key] =
        row.correct_answer_json === null || row.correct_answer_json === undefined ? null : row.correct_answer_json;
    }
    setSeasonAnswers(map);
    setSeasonLoading(false);
  }

  async function setSeasonOfficialAnswer(year: number, question: SeasonQuestion, value: boolean | string) {
    setSeasonSaving(true);
    setSeasonMsg(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) {
      setSeasonMsg("No valid session.");
      setSeasonSaving(false);
      return;
    }

    const { error } = await supabase.from("season_official_answers").upsert({
      season_year: year,
      question_key: question.question_key,
      correct_answer_json: value,
      is_resolved: true,
      resolved_at: new Date().toISOString(),
      created_by: userId,
    });

    if (error) {
      setSeasonMsg(error.message);
      setSeasonSaving(false);
      return;
    }

    setSeasonAnswers((prev) => ({ ...prev, [question.question_key]: value }));
    setSeasonMsg("✅ Answer saved.");
    setSeasonSaving(false);
  }

  // ==========================================
  // Render
  // ==========================================
  if (loading) return <main style={{ padding: 16 }}>Loading…</main>;
  if (!isAdmin) return <main style={{ padding: 16 }}>{msg ?? "Not authorized."}</main>;

  return (
    <main style={{ padding: 16, maxWidth: 980 }}>
      <h1>Admin Results</h1>
      <p>Ingelogd als: {email}</p>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          onClick={() => setTab("sessions")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: tab === "sessions" ? "#111" : "white",
            color: tab === "sessions" ? "white" : "#111",
          }}
        >
          Sessies
        </button>
        <button
          onClick={() => setTab("season")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: tab === "season" ? "#111" : "white",
            color: tab === "season" ? "white" : "#111",
          }}
        >
          Season bonus
        </button>
      </div>

      {msg ? (
        <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>
      ) : null}

      {/* =========================
          TAB: SESSIONS
         ========================= */}
      {tab === "sessions" && (
        <div>
          <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
            {/* LEFT */}
            <section style={{ flex: "1 1 320px" }}>
              <h2>Events</h2>

              {events.length === 0 ? (
                <p>Geen events. Maak er 1 aan.</p>
              ) : (
                <select
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  style={{ width: "100%", padding: 8 }}
                >
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} {e.starts_at ? `(${e.starts_at})` : ""}
                    </option>
                  ))}
                </select>
              )}

              {selectedEvent ? (
                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                  <div>
                    <strong>Gekozen event:</strong> {selectedEvent.name}
                  </div>
                  <div>
                    <strong>Start:</strong> {selectedEvent.starts_at ? fmtLocal(selectedEvent.starts_at) : "—"}
                    {selectedEvent.format ? ` • ${selectedEvent.format}` : ""}
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop: 16 }}>
                <h3>Sessies</h3>

                {sessions.length === 0 ? (
                  <p style={{ opacity: 0.8 }}>Geen sessies voor dit event (import?).</p>
                ) : (
                  <select
                    value={selectedSessionId}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                    style={{ width: "100%", padding: 8 }}
                  >
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.session_key}) — {fmtLocal(s.starts_at)}
                      </option>
                    ))}
                  </select>
                )}

                {selectedSession ? (
                  <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                    <div>
                      <strong>Sessie:</strong> {selectedSession.name} ({selectedSession.session_key})
                    </div>
                    <div>
                      <strong>Start:</strong> {fmtLocal(selectedSession.starts_at)}
                    </div>
                    <div>
                      <strong>Lock:</strong> {fmtLocal(selectedSession.lock_at)}
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <button onClick={clearSession} disabled={saving || !selectedSessionId}>
                    Leegmaken
                  </button>
                  <button onClick={saveResultsForSession} disabled={saving || !selectedSessionId}>
                    {saving ? "Opslaan…" : "Sessie results opslaan"}
                  </button>
                </div>

                <div style={{ marginTop: 24 }}>
                  <button onClick={() => router.replace("/pools")}>Terug naar pools</button>
                  <button onClick={logout} style={{ marginLeft: 8 }}>
                    Logout
                  </button>
                </div>
              </div>
            </section>

            {/* RIGHT */}
            <section style={{ flex: "2 1 520px" }}>
              <h2>Results: Top 10 (per sessie)</h2>

              <p style={{ marginTop: 6, opacity: 0.85 }}>
                Opslag gaat naar <code>event_results.result_json.sessions[sessionId].top10</code>
              </p>

              <div style={{ marginTop: 14, display: "grid", gap: 8, maxWidth: 720 }}>
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
                      <div style={{ fontWeight: 800 }}>P{pos}</div>

                      <select
                        value={v}
                        onChange={(e) => updatePos(idx, e.target.value)}
                        disabled={!selectedSessionId || saving}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          border: "1px solid #ccc",
                          borderRadius: 8,
                          background: "white",
                        }}
                      >
                        <option value="">— Kies coureur —</option>
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

              <details style={{ marginTop: 16, opacity: 0.9 }}>
                <summary>Debug: opgeslagen JSON bekijken</summary>
                <pre style={{ marginTop: 10, padding: 12, background: "#f7f7f7", borderRadius: 10, overflowX: "auto" }}>
                  {JSON.stringify(eventResultsRow?.result_json ?? {}, null, 2)}
                </pre>
              </details>
            </section>
          </div>
        </div>
      )}

      {/* =========================
          TAB: SEASON BONUS
         ========================= */}
      {tab === "season" && (
        <div style={{ marginTop: 18 }}>
          <h2>Season Bonus</h2>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Season:
              <input
                type="number"
                value={seasonYear}
                onChange={(e) => setSeasonYear(parseInt(e.target.value || "2026", 10))}
                style={{ width: 120, padding: 8 }}
              />
            </label>

            <button onClick={() => loadSeasonBonus(seasonYear)} disabled={seasonLoading || seasonSaving}>
              {seasonLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {seasonMsg ? (
            <p style={{ marginTop: 12, color: seasonMsg.startsWith("✅") ? "green" : "crimson" }}>{seasonMsg}</p>
          ) : null}

          {seasonLoading ? (
            <p style={{ marginTop: 12 }}>Loading season questions…</p>
          ) : seasonQuestions.length === 0 ? (
            <p style={{ marginTop: 12, opacity: 0.8 }}>No season questions found. (Insert scope='season' questions into bonus_question_bank.)</p>
          ) : (
            <div style={{ marginTop: 14 }}>
              {seasonQuestions.map((q) => {
                const current = seasonAnswers[q.question_key] ?? null;

                return (
                  <div
                    key={q.id}
                    style={{
                      border: "1px solid #ddd",
                      borderRadius: 12,
                      padding: 12,
                      marginTop: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{q.prompt}</div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                      key: <code>{q.question_key}</code> · kind: <code>{q.answer_kind}</code>
                    </div>

                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {q.answer_kind === "boolean" ? (
                        <>
                          <button onClick={() => setSeasonOfficialAnswer(seasonYear, q, true)} disabled={seasonSaving}>
                            Set YES
                          </button>
                          <button onClick={() => setSeasonOfficialAnswer(seasonYear, q, false)} disabled={seasonSaving}>
                            Set NO
                          </button>
                        </>
                      ) : q.answer_kind === "driver" ? (
                        <select
                          value={typeof current === "string" ? current : ""}
                          disabled={seasonSaving}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            setSeasonOfficialAnswer(seasonYear, q, v);
                          }}
                          style={{ padding: 8, minWidth: 320 }}
                        >
                          <option value="">— Select driver —</option>
                          {F1_DRIVERS_2026.map((d) => (
                            <option key={d.code} value={d.code}>
                              {d.code} — {d.name} ({d.teamName})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={typeof current === "string" ? current : ""}
                          disabled={seasonSaving}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            setSeasonOfficialAnswer(seasonYear, q, v);
                          }}
                          style={{ padding: 8, minWidth: 320 }}
                        >
                          <option value="">— Select team —</option>
                          {F1_TEAMS_2026.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      )}

                      <div style={{ fontSize: 13, opacity: 0.85 }}>
                        Current:{" "}
                        <strong>
                          {current === null || current === undefined
                            ? "—"
                            : typeof current === "boolean"
                            ? current
                              ? "YES"
                              : "NO"
                            : q.answer_kind === "driver"
                            ? (() => {
                                const d = F1_DRIVERS_2026.find((x) => x.code === current);
                                return d ? `${d.name} (${d.teamName})` : String(current);
                              })()
                            : String(current)}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <details style={{ marginTop: 16, opacity: 0.9 }}>
            <summary>Debug: loaded official answers</summary>
            <pre style={{ marginTop: 10, padding: 12, background: "#f7f7f7", borderRadius: 10, overflowX: "auto" }}>
              {JSON.stringify(seasonAnswers, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </main>
  );
}
