"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { F1_DRIVERS_2026 } from "../../../lib/f1_2026";


/**
 * NOTE:
 * - This page is intentionally "simple admin UI" (no shadcn/tailwind dependency).
 * - It supports 2 tabs:
 *   1) Sessions: per session Top10 (stored in event_results.result_json.sessions[sessionId].top10)
 *   2) Season bonus: 3 season questions (stored in bonus_question_bank where scope='season')
 */

type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  format: string | null;
};

type SessionRow = {
  id: string;
  event_id: string;
  name: string;
  session_key: string | null;
  starts_at: string | null;
  lock_at: string | null;
};

type EventResultsRow = {
  event_id: string;
  result_json: any;
  created_at: string;
  updated_at: string;
};

type BonusQuestionRow = {
  id: string;
  scope: "weekend" | "season";
  prompt: string;
  answer_kind: "boolean" | "text" | "number" | "driver" | "team";
  is_active: boolean;
  // recommended: add this column in DB
  question_key?: string | null;
};

type SeasonOfficialAnswerRow = {
  id?: string;
  season_year: number;
  question_key: string;
  correct_answer: string | boolean | number | null;
  created_at?: string;
  updated_at?: string;
};

type TeamOpt = { key: string; name: string };

const F1_TEAMS_2026: TeamOpt[] = [
  { key: "RED_BULL", name: "Red Bull" },
  { key: "FERRARI", name: "Ferrari" },
  { key: "MERCEDES", name: "Mercedes" },
  { key: "MCLAREN", name: "McLaren" },
  { key: "ASTON_MARTIN", name: "Aston Martin" },
  { key: "ALPINE", name: "Alpine" },
  { key: "WILLIAMS", name: "Williams" },
  { key: "HAAS", name: "Haas" },
  { key: "RACING_BULLS", name: "Racing Bulls" },
  { key: "AUDI", name: "Audi" },
  { key: "CADILLAC", name: "Cadillac" },
];

function fmtLocal(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function getTeamColorByTeamKey(teamKey: string) {
  // Optional: keep simple. You can expand later with real colors.
  switch (teamKey) {
    case "FERRARI":
      return "#dc0000";
    case "MCLAREN":
      return "#ff8700";
    case "MERCEDES":
      return "#00d2be";
    case "RED_BULL":
      return "#1e41ff";
    case "ASTON_MARTIN":
      return "#006f62";
    case "ALPINE":
      return "#0090ff";
    case "WILLIAMS":
      return "#005aff";
    case "HAAS":
      return "#b6babd";
    case "RACING_BULLS":
      return "#2b4562";
    case "AUDI":
      return "#111111";
    case "CADILLAC":
      return "#0b3d91";
    default:
      return "#999";
  }
}

function getTeamColorByDriverCode(driverCode: string | null) {
  if (!driverCode) return "#999";
  const d = F1_DRIVERS_2026.find((x) => x.code === driverCode);
  if (!d) return "#999";
  // Map by teamName -> find key
  const teamKey =
    F1_TEAMS_2026.find((t) => t.name.toLowerCase() === d.teamName.toLowerCase())?.key ?? "";
  return getTeamColorByTeamKey(teamKey);
}

async function requireAdminOrRedirect(setMsg: (s: string) => void, router: any, setEmail: (s: string) => void) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) {
    router.replace("/login");
    return { ok: false, userId: null as string | null };
  }
  setEmail(user.email ?? "");

  // app_admins table: rows { user_id uuid }
  const adminRes = await supabase.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();

  if (adminRes.error) {
    setMsg("Error checking admin: " + adminRes.error.message);
    router.replace("/pools");
    return { ok: false, userId: user.id };
  }
  if (!adminRes.data) {
    setMsg("Not an admin.");
    router.replace("/pools");
    return { ok: false, userId: user.id };
  }
  return { ok: true, userId: user.id };
}

export default function AdminResultsPage() {
  const router = useRouter();

  const [tab, setTab] = useState<"sessions" | "season">("sessions");

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [email, setEmail] = useState("");

  // LEFT: events + sessions
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  // RIGHT: event_results result_json
  const [eventResultsRow, setEventResultsRow] = useState<EventResultsRow | null>(null);
  const [top10, setTop10] = useState<(string | null)[]>(Array.from({ length: 10 }, () => null));
  const [saving, setSaving] = useState(false);

  // SEASON BONUS
  const [seasonYear, setSeasonYear] = useState<number>(2026);
  const [seasonQuestions, setSeasonQuestions] = useState<BonusQuestionRow[]>([]);
  const [seasonOfficialAnswers, setSeasonOfficialAnswers] = useState<Record<string, any>>({}); // question_key -> correct_answer

  // ----------- init admin + load events -----------
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const admin = await requireAdminOrRedirect(setMsg, router, setEmail);
      if (!admin.ok) {
        setLoading(false);
        return;
      }

      // load events
      const evRes = await supabase
        .from("events")
        .select("id,name,starts_at,format")
        .order("starts_at", { ascending: true });

      if (evRes.error) {
        setMsg("Error loading events: " + evRes.error.message);
        setLoading(false);
        return;
      }

      setEvents(evRes.data ?? []);
      if ((evRes.data ?? []).length > 0) setSelectedEventId(evRes.data![0].id);

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------- when event changes: load sessions + event_results -----------
  useEffect(() => {
    if (!selectedEventId) return;

    (async () => {
      setMsg(null);

      const sRes = await supabase
        .from("event_sessions")
        .select("id,event_id,name,session_key,starts_at,lock_at")
        .eq("event_id", selectedEventId)
        .order("starts_at", { ascending: true });

      if (sRes.error) {
        setMsg("Error loading sessions: " + sRes.error.message);
        setSessions([]);
        setSelectedSessionId("");
        return;
      }

      const list = (sRes.data ?? []) as SessionRow[];
      setSessions(list);
      setSelectedSessionId(list[0]?.id ?? "");

      // load event_results row for this event_id
      // IMPORTANT: do NOT select "id" because some schemas don't have it.
      const rRes = await supabase
        .from("event_results")
        .select("event_id, result_json, created_at, updated_at")
        .eq("event_id", selectedEventId)
        .maybeSingle();

      if (rRes.error) {
        setMsg("Error loading event_results: " + rRes.error.message);
        setEventResultsRow(null);
      } else {
        setEventResultsRow((rRes.data as any) ?? null);
      }
    })();
  }, [selectedEventId]);

  // ----------- when session OR eventResultsRow changes: hydrate top10 -----------
  useEffect(() => {
    const json = eventResultsRow?.result_json ?? {};
    const sessionBlock = json?.sessions?.[selectedSessionId] ?? {};
    const savedTop10: (string | null)[] = Array.isArray(sessionBlock?.top10) ? sessionBlock.top10 : [];
    const padded = Array.from({ length: 10 }, (_, i) => savedTop10[i] ?? null);
    setTop10(padded);
  }, [selectedSessionId, eventResultsRow]);

  function updatePos(idx: number, driverCode: string) {
    setTop10((prev) => {
      const next = [...prev];
      next[idx] = driverCode || null;
      return next;
    });
  }

  async function clearSession() {
    if (!selectedEventId || !selectedSessionId) return;
    setSaving(true);
    setMsg(null);

    const base = eventResultsRow?.result_json ?? {};
    const next = { ...base, sessions: { ...(base.sessions ?? {}) } };
    next.sessions[selectedSessionId] = { ...(next.sessions[selectedSessionId] ?? {}), top10: [] };

    const upRes = await supabase
      .from("event_results")
      .upsert(
        {
          event_id: selectedEventId,
          result_json: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id" }
      )
      .select("event_id,result_json,created_at,updated_at")
      .single();

    setSaving(false);

    if (upRes.error) {
      setMsg("Error clearing: " + upRes.error.message);
      return;
    }
    setEventResultsRow(upRes.data as any);
    setMsg("✅ Cleared session top10");
  }

  async function saveResultsForSession() {
    if (!selectedEventId || !selectedSessionId) return;
    setSaving(true);
    setMsg(null);

    const cleaned = top10.map((x) => (x && x.trim() ? x.trim().toUpperCase() : null)).filter((x) => x !== null);

    const base = eventResultsRow?.result_json ?? {};
    const next = { ...base, sessions: { ...(base.sessions ?? {}) } };
    next.sessions[selectedSessionId] = { ...(next.sessions[selectedSessionId] ?? {}), top10: cleaned };

    const upRes = await supabase
      .from("event_results")
      .upsert(
        {
          event_id: selectedEventId,
          result_json: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id" }
      )
      .select("event_id,result_json,created_at,updated_at")
      .single();

    setSaving(false);

    if (upRes.error) {
      setMsg("Error saving: " + upRes.error.message);
      return;
    }
    setEventResultsRow(upRes.data as any);
    setMsg("✅ Session results saved");
  }

  // ----------- SEASON BONUS: load questions + official answers -----------
  async function loadSeasonBonus() {
    setMsg(null);

    // load active season questions
    const qRes = await supabase
      .from("bonus_question_bank")
      .select("id,scope,prompt,answer_kind,is_active,question_key")
      .eq("scope", "season")
      .eq("is_active", true)
      .order("prompt", { ascending: true });

    if (qRes.error) {
      setMsg("Error loading season questions: " + qRes.error.message);
      setSeasonQuestions([]);
      return;
    }

    const qs = (qRes.data ?? []) as BonusQuestionRow[];
    setSeasonQuestions(qs);

    // load official answers for that season
    const aRes = await supabase
      .from("season_official_answers")
      .select("season_year,question_key,correct_answer")
      .eq("season_year", seasonYear);

    if (aRes.error) {
      setMsg("Error loading season official answers: " + aRes.error.message);
      setSeasonOfficialAnswers({});
      return;
    }

    const map: Record<string, any> = {};
    for (const row of (aRes.data ?? []) as any[]) {
      if (row.question_key) map[row.question_key] = row.correct_answer;
    }
    setSeasonOfficialAnswers(map);
  }

  // auto-load when switching to season tab or changing season year
  useEffect(() => {
    if (tab !== "season") return;
    loadSeasonBonus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, seasonYear]);

  async function saveSeasonOfficialAnswer(questionKey: string, value: any) {
    setSaving(true);
    setMsg(null);

    const upRes = await supabase
      .from("season_official_answers")
      .upsert(
        {
          season_year: seasonYear,
          question_key: questionKey,
          correct_answer: value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "season_year,question_key" }
      )
      .select("season_year,question_key,correct_answer")
      .single();

    setSaving(false);

    if (upRes.error) {
      setMsg("Error saving season answer: " + upRes.error.message);
      return;
    }

    setSeasonOfficialAnswers((prev) => ({ ...prev, [questionKey]: upRes.data.correct_answer }));
    setMsg("✅ Season official answer saved");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId) ?? null, [events, selectedEventId]);
  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  if (loading) return <main style={{ padding: 16 }}>Loading…</main>;

  return (
    <main style={{ padding: 16, maxWidth: 980 }}>
      <h1>Admin Results</h1>
      <p>Ingelogd als: {email}</p>

      <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
        <button
          onClick={() => setTab("sessions")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: tab === "sessions" ? "#111" : "white",
            color: tab === "sessions" ? "white" : "#111",
            cursor: "pointer",
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
            cursor: "pointer",
          }}
        >
          Season bonus
        </button>
      </div>

      {msg ? (
        <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>
      ) : null}

      {tab === "sessions" && (
        <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
          {/* LEFT */}
          <section style={{ flex: "1 1 320px" }}>
            <h2>Events</h2>

            {events.length === 0 ? (
              <p>Geen events. Importeer de kalender.</p>
            ) : (
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                style={{ width: "100%", padding: 8 }}
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} {e.starts_at ? `(${fmtLocal(e.starts_at)})` : ""}
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
                  <strong>Start:</strong> {selectedEvent.starts_at ? fmtLocal(selectedEvent.starts_at) : "—"}{" "}
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
                      {s.name} {s.session_key ? `(${s.session_key})` : ""} — {fmtLocal(s.starts_at)}
                    </option>
                  ))}
                </select>
              )}

              {selectedSession ? (
                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                  <div>
                    <strong>Sessie:</strong> {selectedSession.name}{" "}
                    {selectedSession.session_key ? `(${selectedSession.session_key})` : ""}
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
                  {saving ? "Opslaan..." : "Sessie results opslaan"}
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
                    <div style={{ fontWeight: 800 }}>P{pos}</div>

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
                        value={v ?? ""}
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
                  </div>
                );
              })}
            </div>

            <details style={{ marginTop: 16, opacity: 0.9 }}>
              <summary>Debug: opgeslagen JSON bekijken</summary>
              <pre
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: "#f7f7f7",
                  borderRadius: 10,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(eventResultsRow?.result_json ?? {}, null, 2)}
              </pre>
            </details>
          </section>
        </div>
      )}

      {tab === "season" && (
        <section style={{ marginTop: 16, maxWidth: 900 }}>
          <h2>Season Bonus</h2>

          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
            <label>Season:</label>
            <input
              value={seasonYear}
              onChange={(e) => setSeasonYear(parseInt(e.target.value || "0", 10))}
              style={{ width: 120, padding: 8 }}
            />
            <button onClick={loadSeasonBonus} disabled={saving}>
              Refresh
            </button>
          </div>

          <p style={{ marginTop: 10, opacity: 0.8 }}>
            Bron: <code>bonus_question_bank</code> (scope=season) + <code>season_official_answers</code>.
          </p>

          {seasonQuestions.length === 0 ? (
            <p style={{ marginTop: 12, opacity: 0.85 }}>
              No season questions found. Seed them in <code>bonus_question_bank</code>.
            </p>
          ) : (
            <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
              {seasonQuestions.map((q) => {
                const qKey = q.question_key ?? q.id; // fallback
                const current = seasonOfficialAnswers[qKey] ?? null;

                const kind = q.answer_kind;

                return (
                  <div
                    key={qKey}
                    style={{
                      border: "1px solid #e5e5e5",
                      borderRadius: 12,
                      padding: 14,
                      background: "white",
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{q.prompt}</div>
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
                      key: <code>{q.question_key ?? "— (missing)"}</code> · kind: <code>{kind}</code>
                    </div>

                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 160px", gap: 12 }}>
                      <div>
                        {kind === "team" && (
                          <select
                            value={current ?? ""}
                            onChange={(e) => saveSeasonOfficialAnswer(qKey, e.target.value || null)}
                            disabled={saving}
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                          >
                            <option value="">— Select team —</option>
                            {F1_TEAMS_2026.map((t) => (
                              <option key={t.key} value={t.key}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        )}

                        {kind === "driver" && (
                          <select
                            value={current ?? ""}
                            onChange={(e) => saveSeasonOfficialAnswer(qKey, e.target.value || null)}
                            disabled={saving}
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                          >
                            <option value="">— Select driver —</option>
                            {F1_DRIVERS_2026.map((d) => (
                              <option key={d.code} value={d.code}>
                                {d.code} — {d.name} ({d.teamName})
                              </option>
                            ))}
                          </select>
                        )}

                        {kind === "boolean" && (
                          <select
                            value={current === true ? "true" : current === false ? "false" : ""}
                            onChange={(e) =>
                              saveSeasonOfficialAnswer(qKey, e.target.value === "" ? null : e.target.value === "true")
                            }
                            disabled={saving}
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                          >
                            <option value="">— Select —</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        )}

                        {kind === "number" && (
                          <input
                            type="number"
                            value={current ?? ""}
                            onChange={(e) =>
                              saveSeasonOfficialAnswer(qKey, e.target.value === "" ? null : Number(e.target.value))
                            }
                            disabled={saving}
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                          />
                        )}

                        {kind === "text" && (
                          <input
                            value={current ?? ""}
                            onChange={(e) => saveSeasonOfficialAnswer(qKey, e.target.value || null)}
                            disabled={saving}
                            placeholder="Enter text"
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                          />
                        )}
                      </div>

                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        <div style={{ fontWeight: 700 }}>Current:</div>
                        <div style={{ marginTop: 6 }}>
                          {current === null || current === undefined || current === "" ? "—" : <code>{String(current)}</code>}
                        </div>
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
              {JSON.stringify(seasonOfficialAnswers, null, 2)}
            </pre>
          </details>

          <p style={{ marginTop: 16, fontSize: 13, opacity: 0.8 }}>
            Tip: als je <code>question_key</code> nog niet hebt in <code>bonus_question_bank</code>, voeg die kolom toe en
            geef je season vragen vaste keys (bijv. <code>season_driver_champion</code>).
          </p>
        </section>
      )}
    </main>
  );
}
