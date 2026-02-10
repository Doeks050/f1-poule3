"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

type ParsedSession = {
  eventName: string;
  sessionKey: string; // fp1/fp2/fp3/sq/sprint/quali/race
  sessionName: string;
  startsAtIso: string; // ISO string
};

const SPRINT_WEEKEND_KEYWORDS_2026 = [
  "china",
  "miami",
  "canada",
  "great britain",
  "british",
  "netherlands",
  "dutch",
  "singapore",
];

function toLowerSafe(s: string) {
  return (s ?? "").toLowerCase();
}

// Parse common ICS date formats:
// - 20260306T103000Z
// - 20260306T103000
function parseIcsDateToIso(value: string): string | null {
  const v = value.trim();
  // Expect YYYYMMDDTHHMMSS(Z?) or YYYYMMDDTHHMM(Z?)
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;

  const [_, yyyy, mm, dd, HH, MM, SS, z] = m;
  const sec = SS ?? "00";

  if (z === "Z") {
    return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${sec}Z`).toISOString();
  }

  // Floating time (no Z). Treat as UTC to avoid local-time surprises.
  // (Als jouw ICS TZID gebruikt, dan is dit niet perfect; maar voor F1-ICS is Z vaak aanwezig.)
  return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${sec}Z`).toISOString();
}

function detectSession(summary: string): { key: string; name: string } | null {
  const s = toLowerSafe(summary);

  // Sprint weekend sessions
  if (s.includes("sprint qualifying") || s.includes("sprint shootout") || s.includes("sprint quali")) {
    return { key: "sq", name: "Sprint Qualifying" };
  }
  if (s.includes("sprint") && !s.includes("sprint qualifying") && !s.includes("shootout")) {
    return { key: "sprint", name: "Sprint" };
  }

  // Standard sessions
  if (s.includes("practice 1") || s.includes("fp1")) return { key: "fp1", name: "Free Practice 1" };
  if (s.includes("practice 2") || s.includes("fp2")) return { key: "fp2", name: "Free Practice 2" };
  if (s.includes("practice 3") || s.includes("fp3")) return { key: "fp3", name: "Free Practice 3" };

  // Qualifying
  if (s.includes("qualifying") || s.includes("quali")) return { key: "quali", name: "Qualifying" };

  // Race
  if (s.includes("race")) return { key: "race", name: "Race" };

  return null;
}

// Try to extract event name from SUMMARY.
// F1 titles differ a bit; we keep it robust by:
// - removing common session words
// - trimming separators
function extractEventName(summary: string): string {
  let s = summary.trim();

  // Remove session parts
  const removePhrases = [
    "Practice 1",
    "Practice 2",
    "Practice 3",
    "Free Practice 1",
    "Free Practice 2",
    "Free Practice 3",
    "Qualifying",
    "Sprint Qualifying",
    "Sprint Shootout",
    "Sprint",
    "Race",
  ];

  for (const p of removePhrases) {
    s = s.replace(new RegExp(p, "ig"), "");
  }

  // Common separators
  s = s.replace(/\s+-\s+/g, " ");
  s = s.replace(/\s+\|\s+/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim();

  // If it still contains "Grand Prix", keep it as part of name
  return s || summary.trim();
}

function isSprintWeekend(eventName: string): boolean {
  const n = toLowerSafe(eventName);
  return SPRINT_WEEKEND_KEYWORDS_2026.some((k) => n.includes(k));
}

function isoMinusMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - minutes);
  return d.toISOString();
}

export default function ImportCalendarPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [fileName, setFileName] = useState<string>("");
  const [icsText, setIcsText] = useState<string>("");

  const [parsed, setParsed] = useState<ParsedSession[]>([]);
  const [importing, setImporting] = useState(false);

  const summary = useMemo(() => {
    const events = new Map<string, number>();
    for (const p of parsed) {
      events.set(p.eventName, (events.get(p.eventName) ?? 0) + 1);
    }
    return {
      eventCount: events.size,
      sessionCount: parsed.length,
    };
  }, [parsed]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.replace("/login");

      const { data: adminRow, error } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (error) {
        setMsg(error.message);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setIsAdmin(!!adminRow);
      setLoading(false);
    })();
  }, [router]);

  function parseIcs(text: string) {
    setMsg(null);

    const lines = text.replace(/\r\n/g, "\n").split("\n");

    // Unfold lines (ICS spec): lines starting with space are continuation
    const unfolded: string[] = [];
    for (const line of lines) {
      if (line.startsWith(" ") && unfolded.length > 0) {
        unfolded[unfolded.length - 1] += line.slice(1);
      } else {
        unfolded.push(line);
      }
    }

    const events: { dtstart?: string; summary?: string }[] = [];
    let inEvent = false;
    let cur: any = {};

    for (const line of unfolded) {
      if (line.startsWith("BEGIN:VEVENT")) {
        inEvent = true;
        cur = {};
        continue;
      }
      if (line.startsWith("END:VEVENT")) {
        inEvent = false;
        events.push(cur);
        cur = {};
        continue;
      }
      if (!inEvent) continue;

      // DTSTART can appear as:
      // DTSTART:20260306T103000Z
      // DTSTART;TZID=Europe/London:20260306T103000
      if (line.startsWith("DTSTART")) {
        const parts = line.split(":");
        cur.dtstart = parts.slice(1).join(":").trim();
      }

      if (line.startsWith("SUMMARY")) {
        const parts = line.split(":");
        cur.summary = parts.slice(1).join(":").trim();
      }
    }

    const out: ParsedSession[] = [];

    for (const e of events) {
      if (!e.dtstart || !e.summary) continue;

      const startsAtIso = parseIcsDateToIso(e.dtstart);
      if (!startsAtIso) continue;

      const sess = detectSession(e.summary);
      if (!sess) continue; // we ignore non-session events

      const eventName = extractEventName(e.summary);

      out.push({
        eventName,
        sessionKey: sess.key,
        sessionName: sess.name,
        startsAtIso,
      });
    }

    // Dedupe (eventName + sessionKey) keep earliest startsAt
    const keyMap = new Map<string, ParsedSession>();
    for (const p of out) {
      const k = `${p.eventName}__${p.sessionKey}`;
      const existing = keyMap.get(k);
      if (!existing || new Date(p.startsAtIso) < new Date(existing.startsAtIso)) {
        keyMap.set(k, p);
      }
    }

    const final = Array.from(keyMap.values()).sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
    setParsed(final);

    if (final.length === 0) {
      setMsg("Geen sessies gevonden in deze ICS. Check of je de officiële F1 kalender hebt gedownload.");
    } else {
      setMsg(`Parsed: ${final.length} sessies.`);
    }
  }

  async function doImport() {
    setMsg(null);
    if (parsed.length === 0) {
      setMsg("Eerst een ICS uploaden en parsen.");
      return;
    }

    setImporting(true);

    // 1) Group by eventName
    const byEvent = new Map<string, ParsedSession[]>();
    for (const p of parsed) {
      byEvent.set(p.eventName, [...(byEvent.get(p.eventName) ?? []), p]);
    }

    // 2) Upsert events + sessions
    for (const [eventName, sessions] of byEvent.entries()) {
      // Determine weekend starts_at as earliest session starts
      const weekendStart = sessions
        .map((s) => s.startsAtIso)
        .sort()[0];

      const format = isSprintWeekend(eventName) ? "sprint" : "standard";

      // Find existing event by (name + starts_at)
      const { data: existing, error: findErr } = await supabase
        .from("events")
        .select("id,name,starts_at,format")
        .eq("name", eventName)
        .eq("starts_at", weekendStart)
        .maybeSingle();

      if (findErr) {
        setImporting(false);
        setMsg("Events select error: " + findErr.message);
        return;
      }

      let eventId = existing?.id as string | undefined;

      if (!eventId) {
        const { data: inserted, error: insErr } = await supabase
          .from("events")
          .insert({ name: eventName, starts_at: weekendStart, format })
          .select("id")
          .single();

        if (insErr) {
          setImporting(false);
          setMsg("Events insert error: " + insErr.message);
          return;
        }
        eventId = inserted.id;
      } else {
        // ensure format is correct (sprint vs standard)
        if (existing?.format !== format) {
          const { error: updErr } = await supabase
            .from("events")
            .update({ format })
            .eq("id", eventId);

          if (updErr) {
            setImporting(false);
            setMsg("Events update error: " + updErr.message);
            return;
          }
        }
      }

      // Upsert sessions
      for (const s of sessions) {
        const lockAt = isoMinusMinutes(s.startsAtIso, 5);

        const { error: upErr } = await supabase
          .from("event_sessions")
          .upsert(
            {
              event_id: eventId,
              session_key: s.sessionKey,
              name: s.sessionName,
              starts_at: s.startsAtIso,
              lock_at: lockAt,
            },
            { onConflict: "event_id,session_key" }
          );

        if (upErr) {
          setImporting(false);
          setMsg("Session upsert error: " + upErr.message);
          return;
        }
      }
    }

    setImporting(false);
    setMsg("✅ Import klaar. Events + sessies zijn gevuld.");
  }

  async function onPickFile(file: File | null) {
    setMsg(null);
    setParsed([]);
    setIcsText("");
    setFileName(file?.name ?? "");

    if (!file) return;

    const text = await file.text();
    setIcsText(text);
    parseIcs(text);
  }

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Import F1 kalender</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Import F1 kalender</h1>
        <p>Je bent niet admin.</p>
        <button onClick={() => router.replace("/pools")}>Terug</button>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <h1>Import F1 kalender (ICS)</h1>

      <p style={{ opacity: 0.8 }}>
        Download de officiële kalender via Formula1.com (die bevat practice/quali/sprint/race) en upload de .ics hier.
      </p>

      <div style={{ marginTop: 12 }}>
        <input
          type="file"
          accept=".ics,text/calendar"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
        />
        {fileName && <p>Bestand: <strong>{fileName}</strong></p>}
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={doImport} disabled={importing || parsed.length === 0}>
          {importing ? "Importeren…" : "Import naar database"}
        </button>
        <button onClick={() => router.replace("/admin/results")} style={{ marginLeft: 8 }}>
          Naar admin results
        </button>
      </div>

      {msg && <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>}

      <hr style={{ marginTop: 16, marginBottom: 16 }} />

      <h2>Preview</h2>
      <p>
        Events gevonden: <strong>{summary.eventCount}</strong> — Sessies gevonden: <strong>{summary.sessionCount}</strong>
      </p>

      <p style={{ fontSize: 12, opacity: 0.7 }}>
        Sprint weekends 2026 worden automatisch gezet op basis van officiële lijst (China, Miami, Canada, Great Britain, Netherlands, Singapore).
      </p>

      <div style={{ maxHeight: 380, overflow: "auto", border: "1px solid #ddd", padding: 12 }}>
        {parsed.length === 0 ? (
          <p>Upload een ICS om preview te zien.</p>
        ) : (
          <ul>
            {parsed.slice(0, 200).map((p, idx) => (
              <li key={idx}>
                <strong>{p.eventName}</strong> — {p.sessionKey} — {new Date(p.startsAtIso).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </div>

      <hr style={{ marginTop: 16, marginBottom: 16 }} />

      <details>
        <summary>Debug (ICS tekst ingeladen)</summary>
        <textarea value={icsText} readOnly rows={10} style={{ width: "100%", fontFamily: "monospace" }} />
      </details>
    </main>
  );
}
