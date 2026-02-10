import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createClient } from "@supabase/supabase-js";

// Officiële F1 ICS url (die jij nu als “link” ziet)
const F1_ICS_URL = "https://ics.ecal.com/ecal-sub/698b622912dba00002769424/Formula%201.ics";

// Officiële sprintweekenden 2026 (F1 bevestigd):
// China, Miami, Canada, Great Britain, Netherlands, Singapore
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

function isSprintWeekend(eventName: string): boolean {
  const n = toLowerSafe(eventName);
  return SPRINT_WEEKEND_KEYWORDS_2026.some((k) => n.includes(k));
}

function isoMinusMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - minutes);
  return d.toISOString();
}

// Parse common ICS date formats:
// - 20260306T103000Z
// - 20260306T103000
function parseIcsDateToIso(value: string): string | null {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;

  const [_, yyyy, mm, dd, HH, MM, SS, z] = m;
  const sec = SS ?? "00";

  if (z === "Z") {
    return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${sec}Z`).toISOString();
  }
  // No timezone → treat as UTC to keep consistent
  return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${sec}Z`).toISOString();
}

function detectSession(summary: string): { key: string; name: string } | null {
  const s = toLowerSafe(summary);

  if (s.includes("sprint qualifying") || s.includes("sprint shootout") || s.includes("sprint quali")) {
    return { key: "sq", name: "Sprint Qualifying" };
  }
  if (s.includes("sprint") && !s.includes("sprint qualifying") && !s.includes("shootout")) {
    return { key: "sprint", name: "Sprint" };
  }

  if (s.includes("practice 1") || s.includes("fp1")) return { key: "fp1", name: "Free Practice 1" };
  if (s.includes("practice 2") || s.includes("fp2")) return { key: "fp2", name: "Free Practice 2" };
  if (s.includes("practice 3") || s.includes("fp3")) return { key: "fp3", name: "Free Practice 3" };

  if (s.includes("qualifying") || s.includes("quali")) return { key: "quali", name: "Qualifying" };
  if (s.includes("race")) return { key: "race", name: "Race" };

  return null;
}

function extractEventName(summary: string): string {
  let s = summary.trim();
  const removePhrases = [
    "Practice 1","Practice 2","Practice 3",
    "Free Practice 1","Free Practice 2","Free Practice 3",
    "Qualifying",
    "Sprint Qualifying","Sprint Shootout","Sprint",
    "Race",
  ];

  for (const p of removePhrases) s = s.replace(new RegExp(p, "ig"), "");
  s = s.replace(/\s+-\s+/g, " ");
  s = s.replace(/\s+\|\s+/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s || summary.trim();
}

type ParsedSession = {
  eventName: string;
  sessionKey: string;
  sessionName: string;
  startsAtIso: string;
};

function parseIcs(text: string): ParsedSession[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  // Unfold ICS lines
  const unfolded: string[] = [];
  for (const line of lines) {
    if (line.startsWith(" ") && unfolded.length > 0) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  }

  const events: { dtstart?: string; summary?: string }[] = [];
  let inEvent = false;
  let cur: any = {};

  for (const line of unfolded) {
    if (line.startsWith("BEGIN:VEVENT")) { inEvent = true; cur = {}; continue; }
    if (line.startsWith("END:VEVENT")) { inEvent = false; events.push(cur); cur = {}; continue; }
    if (!inEvent) continue;

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

    const iso = parseIcsDateToIso(e.dtstart);
    if (!iso) continue;

    // Alleen seizoen 2026
    if (new Date(iso).getUTCFullYear() !== 2026) continue;

    const sess = detectSession(e.summary);
    if (!sess) continue;

    const eventName = extractEventName(e.summary);

    out.push({
      eventName,
      sessionKey: sess.key,
      sessionName: sess.name,
      startsAtIso: iso,
    });
  }

  // Dedupe eventName+sessionKey keep earliest
  const map = new Map<string, ParsedSession>();
  for (const p of out) {
    const k = `${p.eventName}__${p.sessionKey}`;
    const ex = map.get(k);
    if (!ex || new Date(p.startsAtIso) < new Date(ex.startsAtIso)) map.set(k, p);
  }

  return Array.from(map.values()).sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
}

async function isCallerAdmin(accessToken: string): Promise<{ ok: boolean; userId?: string; error?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Verify token and get user id
  const supa = createClient(url, anon, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await supa.auth.getUser(accessToken);
  if (userErr || !userData.user) return { ok: false, error: "Not logged in / invalid token" };

  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "Not admin" };

  return { ok: true, userId: userData.user.id };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const accessToken = body?.accessToken as string | undefined;

    if (!accessToken) {
      return NextResponse.json({ error: "Missing accessToken" }, { status: 400 });
    }

    const adminCheck = await isCallerAdmin(accessToken);
    if (!adminCheck.ok) {
      return NextResponse.json({ error: adminCheck.error ?? "Forbidden" }, { status: 403 });
    }

    const res = await fetch(F1_ICS_URL, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch ICS: ${res.status}` }, { status: 500 });
    }

    const ics = await res.text();
    const parsed = parseIcs(ics);

    if (parsed.length === 0) {
      return NextResponse.json({ error: "No 2026 sessions found in ICS." }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // group by event
    const byEvent = new Map<string, ParsedSession[]>();
    for (const p of parsed) byEvent.set(p.eventName, [...(byEvent.get(p.eventName) ?? []), p]);

    let createdEvents = 0;
    let upsertedSessions = 0;

    for (const [eventName, sessions] of byEvent.entries()) {
      // weekend starts_at = earliest session start
      const weekendStart = sessions.map(s => s.startsAtIso).sort()[0];
      const format = isSprintWeekend(eventName) ? "sprint" : "standard";

      // find event by name+starts_at
      const { data: existing, error: findErr } = await admin
        .from("events")
        .select("id,format")
        .eq("name", eventName)
        .eq("starts_at", weekendStart)
        .maybeSingle();

      if (findErr) {
        return NextResponse.json({ error: "Events select error: " + findErr.message }, { status: 500 });
      }

      let eventId = existing?.id as string | undefined;

      if (!eventId) {
        const { data: inserted, error: insErr } = await admin
          .from("events")
          .insert({ name: eventName, starts_at: weekendStart, format })
          .select("id")
          .single();

        if (insErr) {
          return NextResponse.json({ error: "Events insert error: " + insErr.message }, { status: 500 });
        }
        eventId = inserted.id;
        createdEvents++;
      } else {
        if (existing?.format !== format) {
          const { error: updErr } = await admin.from("events").update({ format }).eq("id", eventId);
          if (updErr) {
            return NextResponse.json({ error: "Events update error: " + updErr.message }, { status: 500 });
          }
        }
      }

      for (const s of sessions) {
        const lockAt = isoMinusMinutes(s.startsAtIso, 5);

        const { error: upErr } = await admin
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
          return NextResponse.json({ error: "Sessions upsert error: " + upErr.message }, { status: 500 });
        }
        upsertedSessions++;
      }
    }

    return NextResponse.json({
      ok: true,
      createdEvents,
      upsertedSessions,
      parsedSessions: parsed.length,
      note: "lock_at = starts_at - 5 minutes",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
