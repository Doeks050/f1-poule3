// app/api/pools/[id]/leaderboard/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { pointsForSession, normalizeTop10 } from "../../../../lib/scoring";

type SessionRow = {
  id: string;
  event_id: string;
  session_key: string;
  name: string;
  starts_at: string;
  lock_at: string;
};

type PredictionRow = {
  user_id: string;
  pool_id: string;
  event_id: string;
  prediction_json: any;
};

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getUserFromToken(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supa = createClient(url, anon, { auth: { persistSession: false } });

  const { data, error } = await supa.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

function pickResultsJson(row: any): any {
  // jouw DB kolom kan result_json heten, of results (oude code)
  return row?.result_json ?? row?.results ?? null;
}

function getResultTop10(resultsJson: any, sessionId: string): string[] | null {
  // verwacht: resultsJson.sessions[sessionId].top10
  const top10 = resultsJson?.sessions?.[sessionId]?.top10;
  return normalizeTop10(top10);
}

function getPredTop10(predictionJson: any, sessionId: string): string[] | null {
  // verwacht: predictionJson.sessions[sessionId].top10
  const top10 = predictionJson?.sessions?.[sessionId]?.top10;
  return normalizeTop10(top10);
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const poolId = params.id;

    const accessToken = getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");
    if (!accessToken) {
      return NextResponse.json({ error: "Missing accessToken" }, { status: 401 });
    }

    const user = await getUserFromToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const admin = supabaseAdmin();

    // ✅ membership check
    const { data: membership, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    if (!membership) return NextResponse.json({ error: "Not a pool member" }, { status: 403 });

    // Optional: event filter
    const eventId = new URL(req.url).searchParams.get("eventId") || null;

    // 1) events (voor volgorde + label)
    let eventsQ = admin.from("events").select("id,name,starts_at,format").order("starts_at", { ascending: true });
    if (eventId) eventsQ = eventsQ.eq("id", eventId);

    const { data: events, error: eventsErr } = await eventsQ;
    if (eventsErr) return NextResponse.json({ error: eventsErr.message }, { status: 500 });

    const eventIds = (events ?? []).map((e: any) => e.id);
    if (eventIds.length === 0) {
      return NextResponse.json({ ok: true, leaderboard: [], events: [] });
    }

    // 2) sessions voor die events
    const { data: sessions, error: sessErr } = await admin
      .from("event_sessions")
      .select("id,event_id,session_key,name,starts_at,lock_at")
      .in("event_id", eventIds)
      .order("starts_at", { ascending: true });

    if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });

    // 3) pool members
    const { data: members, error: membersErr } = await admin
      .from("pool_members")
      .select("user_id")
      .eq("pool_id", poolId);

    if (membersErr) return NextResponse.json({ error: membersErr.message }, { status: 500 });

    const memberIds = (members ?? []).map((m: any) => m.user_id);

    // 4) predictions (event-based)
    const { data: predictions, error: predErr } = await admin
      .from("predictions")
      .select("user_id,pool_id,event_id,prediction_json")
      .eq("pool_id", poolId)
      .in("event_id", eventIds)
      .in("user_id", memberIds);

    if (predErr) return NextResponse.json({ error: predErr.message }, { status: 500 });

    // 5) results per event
    const { data: resultsRows, error: resErr } = await admin
      .from("event_results")
      .select("event_id,result_json,results,updated_at")
      .in("event_id", eventIds);

    if (resErr) return NextResponse.json({ error: resErr.message }, { status: 500 });

    const resultsByEvent: Record<string, any> = {};
    for (const r of resultsRows ?? []) {
      resultsByEvent[r.event_id] = pickResultsJson(r);
    }

    // index predictions: userId+eventId
    const predByUserEvent = new Map<string, PredictionRow>();
    for (const p of (predictions ?? []) as any[]) {
      predByUserEvent.set(`${p.user_id}__${p.event_id}`, p as PredictionRow);
    }

    // sessions by event
    const sessionsByEvent: Record<string, SessionRow[]> = {};
    for (const s of (sessions ?? []) as any[]) {
      (sessionsByEvent[s.event_id] ||= []).push(s as SessionRow);
    }

    // Compute leaderboard
    const rows: Array<{
      user_id: string;
      total_points: number;
      by_event: Record<string, { points: number; by_session: Record<string, number> }>;
    }> = memberIds.map((uid: string) => ({
      user_id: uid,
      total_points: 0,
      by_event: {},
    }));

    for (const row of rows) {
      for (const evId of eventIds) {
        const evSessions = sessionsByEvent[evId] ?? [];
        const resultsJson = resultsByEvent[evId];

        const pred = predByUserEvent.get(`${row.user_id}__${evId}`);
        const predJson = pred?.prediction_json ?? null;

        let evPoints = 0;
        const bySession: Record<string, number> = {};

        for (const s of evSessions) {
          const resultTop10 = getResultTop10(resultsJson, s.id);
          const predTop10 = getPredTop10(predJson, s.id);

          // als er nog geen results zijn voor deze sessie → 0
          if (!resultTop10) {
            bySession[s.id] = 0;
            continue;
          }

          const pts = pointsForSession(s.session_key, predTop10, resultTop10);
          bySession[s.id] = pts;
          evPoints += pts;
        }

        row.by_event[evId] = { points: evPoints, by_session: bySession };
        row.total_points += evPoints;
      }
    }

    rows.sort((a, b) => b.total_points - a.total_points);

    return NextResponse.json({
      ok: true,
      poolId,
      eventFilter: eventId,
      events: events ?? [],
      leaderboard: rows,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
