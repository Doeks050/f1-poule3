"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
};

export default function AdminResultsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");

  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  const [newEventName, setNewEventName] = useState("");
  const [newEventStartsAt, setNewEventStartsAt] = useState(""); // optional text

  const [resultsText, setResultsText] = useState<string>('{\n  "race": {\n    "p1": "VER",\n    "p2": "NOR",\n    "p3": "LEC"\n  }\n}');
  const [saving, setSaving] = useState(false);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
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

    // Admin check: mag alleen als jij in app_admins staat
    const { data: adminRow, error: adminErr } = await supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminErr) {
      // Als je RLS no-access policy hebt gezet op app_admins,
      // dan kan select falen. Dan doen we admin-check via een test-write op events later.
      // Maar jij zei dat je erin staat; we houden dit simpel:
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

    // Events laden
    const { data: eventRows, error: eventsErr } = await supabase
      .from("events")
      .select("id,name,starts_at")
      .order("starts_at", { ascending: true });

    if (eventsErr) {
      setMsg(eventsErr.message);
      setLoading(false);
      return;
    }

    setEvents(eventRows ?? []);
    if ((eventRows ?? []).length > 0 && !selectedEventId) {
      setSelectedEventId((eventRows ?? [])[0].id);
    }

    setLoading(false);
  }

  // Load results JSON for selected event
  async function loadResultsForEvent(eventId: string) {
    setMsg(null);

    const { data, error } = await supabase
      .from("event_results")
      .select("results")
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) {
      setMsg(error.message);
      return;
    }

    if (!data) {
      // No results yet
      setResultsText("{\n}\n");
      return;
    }

    setResultsText(JSON.stringify(data.results ?? {}, null, 2));
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedEventId) {
      loadResultsForEvent(selectedEventId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

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
      .select("id,name,starts_at")
      .single();

    setSaving(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setNewEventName("");
    setNewEventStartsAt("");
    setEvents((prev) => [...prev, data].sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? "")));
    setSelectedEventId(data.id);
  }

  async function saveResults() {
    setMsg(null);

    if (!selectedEventId) {
      setMsg("Selecteer eerst een event.");
      return;
    }

    // Validate JSON
    let parsed: any;
    try {
      parsed = JSON.parse(resultsText);
    } catch (e: any) {
      setMsg("JSON is ongeldig: " + e.message);
      return;
    }

    setSaving(true);

    // Upsert results
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    const { error } = await supabase
      .from("event_results")
      .upsert(
        {
          event_id: selectedEventId,
          results: parsed,
          updated_by: user?.id ?? null,
        },
        { onConflict: "event_id" }
      );

    setSaving(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("✅ Results opgeslagen.");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

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
    <main style={{ padding: 16, maxWidth: 900 }}>
      <h1>Admin Results</h1>
      <p>Ingelogd als: {email}</p>

      <div style={{ display: "flex", gap: 24, marginTop: 16 }}>
        <section style={{ flex: 1 }}>
          <h2>Events</h2>

          {events.length === 0 ? (
            <p>Geen events. Maak er 1 aan.</p>
          ) : (
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={{ width: "100%" }}
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} {e.starts_at ? `(${e.starts_at})` : ""}
                </option>
              ))}
            </select>
          )}

          <div style={{ marginTop: 16 }}>
            <h3>Nieuw event</h3>
            <input
              placeholder="Event naam (bv. Round 1 - Australia)"
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              style={{ width: "100%" }}
            />
            <input
              placeholder="starts_at (optioneel, bv. 2026-03-01T12:00:00Z)"
              value={newEventStartsAt}
              onChange={(e) => setNewEventStartsAt(e.target.value)}
              style={{ width: "100%", marginTop: 8 }}
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

        <section style={{ flex: 2 }}>
          <h2>Results</h2>
          {selectedEvent ? (
            <p>
              Event: <strong>{selectedEvent.name}</strong>
            </p>
          ) : (
            <p>Selecteer een event.</p>
          )}

          <p style={{ marginTop: 8, marginBottom: 8 }}>
            Plak hier JSON. Voorbeeld structuur mag je later aanpassen.
          </p>

          <textarea
            value={resultsText}
            onChange={(e) => setResultsText(e.target.value)}
            rows={18}
            style={{ width: "100%", fontFamily: "monospace" }}
          />

          <div style={{ marginTop: 8 }}>
            <button onClick={saveResults} disabled={saving || !selectedEventId}>
              Results opslaan
            </button>
          </div>

          {msg && <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>}
        </section>
      </div>
    </main>
  );
}
