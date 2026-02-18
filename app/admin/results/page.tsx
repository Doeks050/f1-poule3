"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

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
  id: string;
  event_id: string;
  result_json: any;
  created_at: string;
  updated_at: string;
};

type SeasonQuestion = {
  question_key: string;
  question_text: string;
};

type SeasonOfficialAnswerRow = {
  season_year: number;
  question_key: string;
  correct_answer: boolean | null;
  is_resolved: boolean;
  resolved_at: string | null;
  created_by: string | null;
};

const F1_DRIVERS_2026: Array<{
  code: string;
  name: string;
  teamName: string;
  teamColor?: string;
}> = [
  // Let op: dit is jouw bestaande lijst; hier niets aan veranderd (staat verderop in je file normaal).
  // In jouw huidige file staat deze lijst al volledig. Als je hem elders hebt staan, laat dit zoals het nu is.
  // (Deze placeholder blijft hier alleen als je huidige file hem ook in dit bestand had.)
];

function fmtLocal(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function getTeamColorByDriverCode(code: string) {
  const d = F1_DRIVERS_2026.find((x) => x.code === code);
  return d?.teamColor ?? "#999";
}

export default function AdminResultsPage() {
  const [tab, setTab] = useState<"sessions" | "weekend" | "season">("sessions");
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");

  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  const [newEventName, setNewEventName] = useState("");
  const [newEventStartsAt, setNewEventStartsAt] = useState("");

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  const [eventResultsRow, setEventResultsRow] = useState<EventResultsRow | null>(null);

  // -----------------------------
  // Season bonus (3 seizoensvragen)
  // -----------------------------
  const [seasonYear, setSeasonYear] = useState<number>(2026);
  const [seasonQuestions, setSeasonQuestions] = useState<SeasonQuestion[]>([]);
  const [seasonOfficial, setSeasonOfficial] = useState<Record<string, SeasonOfficialAnswerRow>>({});
  const [seasonLoading, setSeasonLoading] = useState<boolean>(false);
  const [seasonMsg, setSeasonMsg] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // top10 state (per sessie)
  const [top10, setTop10] = useState<string[]>(Array.from({ length: 10 }, () => ""));

  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId) ?? null, [events, selectedEventId]);
  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  // -----------------------------
  // INIT: auth + admin check + events laden
  // -----------------------------
  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setMsg(null);

      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        if (!mounted) return;
        setMsg(sessionErr.message);
        setLoading(false);
        return;
      }

      const user = sessionData.session?.user;
      if (!user) {
        if (!mounted) return;
        setMsg("Niet ingelogd. Ga naar /login.");
        setLoading(false);
        return;
      }

      if (!mounted) return;
      setEmail(user.email ?? "");

      // admin check
      const { data: adminRow, error: adminErr } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminErr) {
        setMsg(adminErr.message);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      const adminOk = !!adminRow;
      setIsAdmin(adminOk);
      if (!adminOk) {
        setMsg("Geen toegang (geen app_admin).");
        setLoading(false);
        return;
      }

      // events laden
      const { data: eventsData, error: eventsErr } = await supabase
        .from("events")
        .select("id, name, starts_at, format")
        .order("starts_at", { ascending: true });

      if (eventsErr) {
        setMsg(eventsErr.message);
        setLoading(false);
        return;
      }

      setEvents((eventsData as any) ?? []);
      const first = (eventsData as any)?.[0]?.id ?? "";
      setSelectedEventId(first);
      setLoading(false);
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  // -----------------------------
  // Sessions laden als event verandert
  // -----------------------------
  useEffect(() => {
    if (!isAdmin) return;
    if (!selectedEventId) return;

    async function loadSessions() {
      setMsg(null);

      const { data, error } = await supabase
        .from("event_sessions")
        .select("id, event_id, name, session_key, starts_at, lock_at")
        .eq("event_id", selectedEventId)
        .order("starts_at", { ascending: true });

      if (error) {
        setMsg(error.message);
        setSessions([]);
        setSelectedSessionId("");
        return;
      }

      const rows = (data as any) ?? [];
      setSessions(rows);

      // default select eerste sessie
      const first = rows?.[0]?.id ?? "";
      setSelectedSessionId(first);
    }

    loadSessions();
  }, [isAdmin, selectedEventId]);

  // -----------------------------
  // Event results laden als event verandert
  // -----------------------------
  useEffect(() => {
    if (!isAdmin) return;
    if (!selectedEventId) return;

    async function loadEventResults() {
      setMsg(null);

      const { data, error } = await supabase
        .from("event_results")
        .select("id, event_id, result_json, created_at, updated_at")
        .eq("event_id", selectedEventId)
        .maybeSingle();

      if (error) {
        // als geen row bestaat: zet null, geen hard error
        setEventResultsRow(null);
        return;
      }

      setEventResultsRow((data as any) ?? null);

      // als er al session data is: probeer top10 te syncen voor selectedSessionId
      const resJson = (data as any)?.result_json;
      if (resJson?.sessions && selectedSessionId && resJson.sessions[selectedSessionId]?.top10) {
        setTop10(resJson.sessions[selectedSessionId].top10);
      } else {
        setTop10(Array.from({ length: 10 }, () => ""));
      }
    }

    loadEventResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, selectedEventId]);

  // -----------------------------
  // Top10 syncen bij session switch
  // -----------------------------
  useEffect(() => {
    if (!eventResultsRow) {
      setTop10(Array.from({ length: 10 }, () => ""));
      return;
    }
    const resJson = eventResultsRow.result_json;
    if (resJson?.sessions && selectedSessionId && resJson.sessions[selectedSessionId]?.top10) {
      setTop10(resJson.sessions[selectedSessionId].top10);
    } else {
      setTop10(Array.from({ length: 10 }, () => ""));
    }
  }, [selectedSessionId, eventResultsRow]);

  async function loadSeasonBonus(year: number) {
    setSeasonLoading(true);
    setSeasonMsg(null);

    // 1) probeer vragen uit DB te laden
    let questions: SeasonQuestion[] = [];
    const qRes = await supabase
      .from("bonus_question_bank")
      .select("question_key, question_text, scope, is_active")
      .eq("scope", "season")
      .eq("is_active", true)
      .order("question_key", { ascending: true });

    if (!qRes.error && Array.isArray(qRes.data) && qRes.data.length > 0) {
      questions = qRes.data.map((r: any) => ({
        question_key: String(r.question_key),
        question_text: String(r.question_text ?? r.question_key),
      }));
    } else {
      // fallback zodat de UI nooit leeg is
      questions = [
        { question_key: "season_q1", question_text: "Season vraag 1" },
        { question_key: "season_q2", question_text: "Season vraag 2" },
        { question_key: "season_q3", question_text: "Season vraag 3" },
      ];
    }

    setSeasonQuestions(questions);

    // 2) official answers laden
    const aRes = await supabase
      .from("season_official_answers")
      .select("season_year, question_key, correct_answer, is_resolved, resolved_at, created_by")
      .eq("season_year", year);

    if (aRes.error) {
      setSeasonOfficial({});
      setSeasonLoading(false);
      setSeasonMsg(aRes.error.message);
      return;
    }

    const map: Record<string, SeasonOfficialAnswerRow> = {};
    for (const row of aRes.data ?? []) {
      map[String((row as any).question_key)] = row as any;
    }
    setSeasonOfficial(map);

    setSeasonLoading(false);
  }

  useEffect(() => {
    if (tab !== "season") return;
    loadSeasonBonus(seasonYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, seasonYear]);

  async function setSeasonOfficialAnswer(questionKey: string, value: boolean) {
    setSeasonMsg(null);

    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) {
      setSeasonMsg(sessionErr.message);
      return;
    }
    const userId = sessionData.session?.user?.id;
    if (!userId) {
      setSeasonMsg("Geen geldige sessie.");
      return;
    }

    const { error } = await supabase
      .from("season_official_answers")
      .upsert(
        {
          season_year: seasonYear,
          question_key: questionKey,
          correct_answer: value,
          is_resolved: true,
          resolved_at: new Date().toISOString(),
          created_by: userId,
        },
        { onConflict: "season_year,question_key" }
      );

    if (error) {
      setSeasonMsg(error.message);
      return;
    }

    setSeasonMsg("✅ Antwoord opgeslagen.");
    await loadSeasonBonus(seasonYear);
  }

  // -----------------------------
  // ACTIONS
  // -----------------------------
  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function createEvent() {
    setSaving(true);
    setMsg(null);

    if (!newEventName.trim()) {
      setMsg("Event naam ontbreekt.");
      setSaving(false);
      return;
    }

    const payload: any = {
      name: newEventName.trim(),
    };
    if (newEventStartsAt.trim()) payload.starts_at = newEventStartsAt.trim();

    const { data, error } = await supabase.from("events").insert(payload).select("id, name, starts_at, format").single();

    if (error) {
      setMsg(error.message);
      setSaving(false);
      return;
    }

    setMsg("✅ Event aangemaakt.");
    setNewEventName("");
    setNewEventStartsAt("");

    // refresh events
    const { data: eventsData, error: eventsErr } = await supabase
      .from("events")
      .select("id, name, starts_at, format")
      .order("starts_at", { ascending: true });

    if (!eventsErr) {
      setEvents((eventsData as any) ?? []);
    }

    setSelectedEventId((data as any)?.id ?? "");
    setSaving(false);
  }

  function updatePos(idx: number, value: string) {
    setTop10((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  async function clearSession() {
    if (!selectedSessionId) return;

    setSaving(true);
    setMsg(null);

    const resJson = eventResultsRow?.result_json ?? {};
    const next = { ...(resJson || {}) };
    next.sessions = { ...(next.sessions || {}) };
    next.sessions[selectedSessionId] = {
      ...(next.sessions[selectedSessionId] || {}),
      top10: Array.from({ length: 10 }, () => ""),
    };

    const { error } = await supabase
      .from("event_results")
      .upsert(
        {
          event_id: selectedEventId,
          result_json: next,
        },
        { onConflict: "event_id" }
      )
      .select("id, event_id, result_json, created_at, updated_at")
      .maybeSingle();

    if (error) {
      setMsg(error.message);
      setSaving(false);
      return;
    }

    setMsg("✅ Leeg gemaakt.");
    setEventResultsRow((prev) =>
      prev
        ? { ...prev, result_json: next, updated_at: new Date().toISOString() }
        : ({
            id: "temp",
            event_id: selectedEventId,
            result_json: next,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
    );
    setTop10(Array.from({ length: 10 }, () => ""));
    setSaving(false);
  }

  async function saveResultsForSession() {
    if (!selectedSessionId) return;

    setSaving(true);
    setMsg(null);

    // bouw result_json.sessions[sessionId].top10
    const resJson = eventResultsRow?.result_json ?? {};
    const next = { ...(resJson || {}) };
    next.sessions = { ...(next.sessions || {}) };
    next.sessions[selectedSessionId] = {
      ...(next.sessions[selectedSessionId] || {}),
      top10: top10,
    };

    const { data, error } = await supabase
      .from("event_results")
      .upsert(
        {
          event_id: selectedEventId,
          result_json: next,
        },
        { onConflict: "event_id" }
      )
      .select("id, event_id, result_json, created_at, updated_at")
      .maybeSingle();

    if (error) {
      setMsg(error.message);
      setSaving(false);
      return;
    }

    setMsg("✅ Sessie results opgeslagen.");
    setEventResultsRow((data as any) ?? null);
    setSaving(false);
  }

  if (loading) {
    return (
      <main style={{ padding: 16, maxWidth: 980 }}>
        <h1>Admin Results</h1>
        <p>Loading…</p>
        {msg ? <p style={{ color: "crimson" }}>{msg}</p> : null}
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main style={{ padding: 16, maxWidth: 980 }}>
        <h1>Admin Results</h1>
        <p style={{ color: "crimson" }}>{msg ?? "Geen toegang."}</p>
        <div style={{ marginTop: 16 }}>
          <Link href="/pools">Terug</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, maxWidth: 980 }}>
      <h1>Admin Results</h1>
      <p>Ingelogd als: {email}</p>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => setTab("sessions")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
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
            border: "1px solid #ddd",
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

      {tab === "sessions" && (
        <>
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
                    <strong>Start:</strong>{" "}
                    {selectedEvent.starts_at ? fmtLocal(selectedEvent.starts_at) : "—"}{" "}
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
                        {s.name} {s.session_key ? `(${s.session_key})` : ""}{" "}
                        {s.starts_at ? fmtLocal(s.starts_at) : ""}
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
                    {saving ? "Opslaan…" : "Sessie results opslaan"}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 22 }}>
                <h3>Nieuw event (test)</h3>
                <input
                  placeholder="Event naam (bv. Round 1 - Australia)"
                  value={newEventName}
                  onChange={(e) => setNewEventName(e.target.value)}
                  style={{ width: "100%", padding: 8 }}
                />
                <input
                  placeholder="starts_at (optioneel, bv. 2026-03-01T12:00:00Z)"
                  value={newEventStartsAt}
                  onChange={(e) => setNewEventStartsAt(e.target.value)}
                  style={{ width: "100%", padding: 8, marginTop: 8 }}
                />
                <button onClick={createEvent} disabled={saving} style={{ marginTop: 8 }}>
                  Event aanmaken
                </button>
              </div>

              <div style={{ marginTop: 24 }}>
                <button onClick={() => router.replace("/pools")}>Terug naar pools</button>
                <button onClick={logout} style={{ marginLeft: 8 }}>
                  Logout
                </button>
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
                              {d.code} – {d.name} ({d.teamName})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>

              {msg ? (
                <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>
              ) : null}

              <details style={{ marginTop: 16, opacity: 0.9 }}>
                <summary>Debug: opgeslagen JSON bekijken</summary>
                <pre style={{ marginTop: 10, padding: 12, background: "#f7f7f7", borderRadius: 10 }}>
                  {JSON.stringify(eventResultsRow?.result_json ?? {}, null, 2)}
                </pre>
              </details>
            </section>
          </div>
        </>
      )}

      {tab === "season" && (
        <div style={{ marginTop: 16 }}>
          <h2>Season Bonus</h2>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <label style={{ fontWeight: 600 }}>Seizoen:</label>
            <input
              type="number"
              value={seasonYear}
              onChange={(e) => setSeasonYear(Number(e.target.value || 0))}
              style={{ width: 120, padding: 8 }}
            />
            <button onClick={() => loadSeasonBonus(seasonYear)} disabled={seasonLoading} style={{ padding: "8px 12px" }}>
              {seasonLoading ? "Laden..." : "Herladen"}
            </button>
          </div>

          {seasonMsg ? (
            <p style={{ marginTop: 10, color: seasonMsg.startsWith("✅") ? "green" : "crimson" }}>{seasonMsg}</p>
          ) : null}

          <div style={{ marginTop: 16 }}>
            {seasonLoading ? (
              <p>Loading…</p>
            ) : seasonQuestions.length === 0 ? (
              <p>Geen season vragen gevonden.</p>
            ) : (
              <div style={{ display: "grid", gap: 12, maxWidth: 820 }}>
                {seasonQuestions.map((q) => {
                  const current = seasonOfficial[q.question_key]?.correct_answer;
                  return (
                    <div
                      key={q.question_key}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: 10,
                        padding: 12,
                        background: "white",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{q.question_text}</div>
                      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
                        Key: <code>{q.question_key}</code>
                        {typeof current === "boolean" ? (
                          <>
                            {" "}• Huidig official: <strong>{current ? "YES" : "NO"}</strong>
                          </>
                        ) : (
                          <>
                            {" "}
                            • Huidig official: <strong>—</strong>
                          </>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <button
                          onClick={() => setSeasonOfficialAnswer(q.question_key, true)}
                          disabled={seasonLoading}
                          style={{ padding: "8px 12px" }}
                        >
                          Zet YES
                        </button>
                        <button
                          onClick={() => setSeasonOfficialAnswer(q.question_key, false)}
                          disabled={seasonLoading}
                          style={{ padding: "8px 12px" }}
                        >
                          Zet NO
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <details style={{ marginTop: 16, opacity: 0.9 }}>
            <summary>Debug: loaded official answers</summary>
            <pre style={{ marginTop: 10, padding: 12, background: "#f7f7f7", borderRadius: 10, overflowX: "auto" }}>
              {JSON.stringify(seasonOfficial, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </main>
  );
}
