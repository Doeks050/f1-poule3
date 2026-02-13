"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { F1_DRIVERS_2026, getTeamColorByDriverCode } from "../../../lib/f1_2026";

type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  format?: string | null;
};

type SessionRow = {
  id: string;
  event_id: string;
  session_key: string;
  name: string;
  starts_at: string;
  lock_at: string;
};

type EventResultsRow = {
  event_id: string;
  results: any; // jsonb
  updated_by?: string | null;
  updated_at?: string | null;
};

function normalizeCode(v: string) {
  return (v ?? "").trim().toUpperCase();
}

function defaultTop10() {
  return Array.from({ length: 10 }, () => "");
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

/**
 * event_results.results structure (versioned):
 * {
 *   "version": 1,
 *   "sessions": {
 *     "<sessionId>": { "session_key": "fp1|fp2|...|race", "top10": ["VER",...10] }
 *   }
 * }
 */
function readTop10FromResults(resultsJson: any, sessionId: string): string[] | null {
  const top10 = resultsJson?.sessions?.[sessionId]?.top10;
  if (Array.isArray(top10) && top10.length === 10) {
    return top10.map((x: any) => (typeof x === "string" ? normalizeCode(x) : ""));
  }
  return null;
}

function upsertSessionTop10IntoResults(
  resultsJson: any,
  sessionId: string,
  session_key: string,
  top10: string[]
) {
  const base = resultsJson && typeof resultsJson === "object" ? resultsJson : {};
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

export default function AdminResultsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");

  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // keep create event for testing
  const [newEventName, setNewEventName] = useState("");
  const [newEventStartsAt, setNewEventStartsAt] = useState("");

  // sessions for selected event
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  // loaded event_results row
  const [eventResultsRow, setEventResultsRow] = useState<EventResultsRow | null>(null);

  // editing top10 for selected session
  const [top10, setTop10] = useState<string[]>(defaultTop10());

  const [saving, setSaving] = useState(false);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  async function loadAll() {
    setLoading(true);
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      router.replace("/login");
      return;
    }

    setEmail(user.email ?? "");

    // admin check
    const { data: adminRow, error: adminErr } = await supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminErr) {
      setMsg("Admin-check error: " + adminErr.message);
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    if (!adminRow) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    setIsAdmin(true);

    // events
    const { data: eventRows, error: eventsErr } = await supabase
      .from("events")
      .select("id,name,starts_at,format")
      .order("starts_at", { ascending: true });

    if (eventsErr) {
      setMsg(eventsErr.message);
      setLoading(false);
      return;
    }

    const list = (eventRows ?? []) as EventRow[];
    setEvents(list);

    if (list.length > 0 && !selectedEventId) {
      setSelectedEventId(list[0].id);
    }

    setLoading(false);
  }

  async function loadEventResults(eventId: string) {
    const { data, error } = await supabase
      .from("event_results")
      .select("event_id,results,updated_by,updated_at")
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) {
      setMsg(error.message);
      setEventResultsRow(null);
      return;
    }

    setEventResultsRow((data ?? null) as any);
  }

  async function loadSessions(eventId: string) {
    const { data, error } = await supabase
      .from("event_sessions")
      .select("id,event_id,session_key,name,starts_at,lock_at")
      .eq("event_id", eventId)
      .order("starts_at", { ascending: true });

    if (error) {
      setMsg(error.message);
      setSessions([]);
      setSelectedSessionId("");
      return;
    }

    const list = (data ?? []) as SessionRow[];
    setSessions(list);

    // pick first session by default
    if (list.length > 0) {
      setSelectedSessionId(list[0].id);
    } else {
      setSelectedSessionId("");
    }
  }

  // when event changes: load sessions + event_results
  useEffect(() => {
    (async () => {
      if (!selectedEventId) return;
      setMsg(null);
      await loadSessions(selectedEventId);
      await loadEventResults(selectedEventId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  // when session changes OR event_results changes: load top10 for that session
  useEffect(() => {
    if (!selectedSessionId) {
      setTop10(defaultTop10());
      return;
    }

    const loaded = readTop10FromResults(eventResultsRow?.results, selectedSessionId);
    if (loaded) {
      setTop10(loaded);
    } else {
      setTop10(defaultTop10());
    }
  }, [selectedSessionId, eventResultsRow]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createEvent() {
    setMsg(null);

    const name = newEventName.trim();
    if (!name) {
      setMsg("Geef een event naam.");
      return;
    }

    setSaving(true);
    const startsAtValue = newEventStartsAt.trim() ? newEventStartsAt.trim() : null;

    const { data, error } = await supabase
      .from("events")
      .insert({ name, starts_at: startsAtValue })
      .select("id,name,starts_at,format")
      .single();

    setSaving(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setNewEventName("");
    setNewEventStartsAt("");
    setEvents((prev) =>
      [...prev, data].sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""))
    );
    setSelectedEventId(data.id);
  }

  function updatePos(idx: number, value: string) {
    setTop10((prev) => {
      const next = [...prev];
      next[idx] = normalizeCode(value);
      return next;
    });
  }

  function clearSession() {
    setTop10(defaultTop10());
    setMsg(null);
  }

  async function saveResultsForSession() {
    setMsg(null);

    if (!selectedEventId) {
      setMsg("Selecteer eerst een event.");
      return;
    }
    if (!selectedSession) {
      setMsg("Selecteer eerst een sessie.");
      return;
    }

    const warn = validateTop10(top10);
    if (warn) {
      setMsg(warn);
      return;
    }

    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    // reload existing (safe)
    const { data: existing, error: findErr } = await supabase
      .from("event_results")
      .select("event_id,results")
      .eq("event_id", selectedEventId)
      .maybeSingle();

    if (findErr) {
      setSaving(false);
      setMsg(findErr.message);
      return;
    }

    const cleanedTop10 = top10.map((x) => normalizeCode(x));
    const nextJson = upsertSessionTop10IntoResults(
      existing?.results,
      selectedSession.id,
      selectedSession.session_key,
      cleanedTop10
    );

    const { data: up, error: upErr } = await supabase
      .from("event_results")
      .upsert(
        {
          event_id: selectedEventId,
          results: nextJson,
          updated_by: user?.id ?? null,
        },
        { onConflict: "event_id" }
      )
      .select("event_id,results,updated_by,updated_at")
      .maybeSingle();

    setSaving(false);

    if (upErr) {
      setMsg(upErr.message);
      return;
    }

    // refresh local
    setEventResultsRow((up ?? { event_id: selectedEventId, results: nextJson }) as any);
    setMsg("✅ Results opgeslagen voor deze sessie.");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const formatText = selectedEvent?.format ? ` • ${selectedEvent.format}` : "";

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Admin Results</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Admin Results</h1>
        <p>Je bent niet admin.</p>
        <button onClick={() => router.replace("/pools")}>Terug</button>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, maxWidth: 980 }}>
      <h1>Admin Results</h1>
      <p>Ingelogd als: {email}</p>

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
                {selectedEvent.starts_at ? fmtLocal(selectedEvent.starts_at) : "—"}
                {formatText}
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <h3>Sessies</h3>

            {sessions.length === 0 ? (
              <p style={{ opacity: 0.8 }}>Geen sessies voor dit event (import?)</p>
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
          </div>

          {/* keep create event for testing */}
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
            Vul de officiële top 10 in voor de geselecteerde sessie. Opslag gaat naar{" "}
            <code>event_results.results.sessions[sessionId].top10</code>.
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
                          {d.code} — {d.name} ({d.teamName})
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
              {JSON.stringify(eventResultsRow?.results ?? {}, null, 2)}
            </pre>
          </details>
        </section>
      </div>
    </main>
  );
}
