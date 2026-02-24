// app/api/pools/[id]/leaderboard/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import {
  pointsForSession,
  normalizeTop10,
  pointsForWeekendBonus,
} from "../../../../../lib/scoring";

export const runtime = "nodejs";

type SessionRow = {
  id: string;
  event_id: string;
  session_key: string;
  name: string;
  starts_at: string | null;
  lock_at: string | null;
};

type PredictionRow = {
  user_id: string;
  pool_id: string;
  event_id: string;
  prediction_json: any;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getUserFromToken(accessToken: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  );

  const { data, error } = await supabase.auth.getUser();
  if (error) return { user: null, error: error.message };
  return { user: data.user, error: null };
}

function pickResultsJson(row: any) {
  return row?.result_json ?? row?.results ?? row?.results_json ?? null;
}

function getResultTop10(resultsJson: any, sessionId: string): string[] | null {
  if (!resultsJson) return null;

  // Support a few possible shapes:
  // 1) resultsJson[sessionId] = [...]
  // 2) resultsJson.sessions[sessionId].top10 = [...]
  // 3) resultsJson.top10BySession[sessionId] = [...]
  const a = resultsJson?.[sessionId];
  const b = resultsJson?.sessions?.[sessionId]?.top10;
  const c = resultsJson?.top10BySession?.[sessionId];

  return normalizeTop10(a) ?? normalizeTop10(b) ?? normalizeTop10(c);
}

function getPredTop10(predJson: any, sessionId: string): string[] | null {
  if (!predJson) return null;

  // Support a few possible shapes:
  // 1) predJson[sessionId] = [...]
  // 2) predJson.sessions[sessionId].top10 = [...]
  const a = predJson?.[sessionId];
  const b = predJson?.sessions?.[sessionId]?.top10;

  return normalizeTop10(a) ?? normalizeTop10(b);
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const poolId = params.id;

    const accessToken = getBearerToken(req);
    if (!accessToken) return jsonError("Missing bearer token", 401);

    const { user, error: userErr } = await getUserFromToken(accessToken);
    if (userErr || !user) return jsonError("Unauthorized", 401);

    const admin = supabaseAdmin();

    // 1) membership check
    const { data: memberRow, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) return jsonError(memErr.message, 500);
    if (!memberRow) return jsonError("Not a member of this pool", 403);

    // 2) members list
    const { data: members, error: membersErr } = await admin
      .from("pool_members")
      .select("user_id")
      .eq("pool_id", poolId);

    if (membersErr) return jsonError(membersErr.message, 500);

    const memberIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

    // 3) user profiles (if you have it; if not, it will just omit names)
    const { data: profiles } = await admin
      .from("profiles")
      .select("id,display_name,username,email")
      .in("id", memberIds);

    const profileById = new Map<string, any>();
    for (const p of profiles ?? []) profileById.set((p as any).id, p);

    // 4) events in pool (assuming you use events table)
    const { data: events, error: evErr } = await admin
      .from("events")
      .select("id,name,starts_at")
      .order("starts_at", { ascending: true });

    if (evErr) return jsonError(evErr.message, 500);

    const eventIds = (events ?? []).map((e: any) => e.id).filter(Boolean);

    // 5) sessions
    const { data: sessions, error: sessErr } = await admin
      .from("event_sessions")
      .select("id,event_id,session_key,name,starts_at,lock_at")
      .in("event_id", eventIds)
      .order("starts_at", { ascending: true });

    if (sessErr) return jsonError(sessErr.message, 500);

    // 6) predictions
    const { data: predictions, error: predErr } = await admin
      .from("predictions")
      .select("user_id,pool_id,event_id,prediction_json")
      .eq("pool_id", poolId)
      .in("event_id", eventIds)
      .in("user_id", memberIds);

    if (predErr) return jsonError(predErr.message, 500);

    // 7) results
    const { data: resultsRows, error: resErr } = await admin
      .from("event_results")
      .select("*")
      .in("event_id", eventIds);

    if (resErr) return jsonError(resErr.message, 500);

    const resultsByEvent: Record<string, any> = {};
    for (const r of resultsRows ?? []) {
      resultsByEvent[(r as any).event_id] = pickResultsJson(r);
    }

    // --- BONUS V2: batch fetch official + user weekend bonus answers (question_number 1..3) ---
    const officialByEvent: Record<
      string,
      { question_number: number; answer: boolean | null }[]
    > = {};
    const userAnswersByUserEvent: Record<
      string,
      { question_number: number; answer: boolean | null }[]
    > = {};

    // Official answers for all events
    const { data: officialRows, error: offErr } = await admin
      .from("weekend_bonus_official_answers")
      .select("event_id,question_number,answer")
      .in("event_id", eventIds);

    if (offErr) return jsonError(offErr.message, 500);

    for (const evId of eventIds) officialByEvent[evId] = [];
    for (const r of officialRows ?? []) {
      const evId = (r as any).event_id as string;
      const qn = (r as any).question_number as number;
      const ans = (r as any).answer as boolean | null;
      if (!evId || typeof qn !== "number") continue;
      if (!officialByEvent[evId]) officialByEvent[evId] = [];
      officialByEvent[evId].push({ question_number: qn, answer: ans ?? null });
    }

    // User answers for all members + events (pool scoped)
    const { data: userBonusRows, error: ubErr } = await admin
      .from("weekend_bonus_user_answers")
      .select("user_id,event_id,question_number,answer")
      .eq("pool_id", poolId)
      .in("event_id", eventIds)
      .in("user_id", memberIds);

    if (ubErr) return jsonError(ubErr.message, 500);

    for (const r of userBonusRows ?? []) {
      const uid = (r as any).user_id as string;
      const evId = (r as any).event_id as string;
      const qn = (r as any).question_number as number;
      const ans = (r as any).answer as boolean | null;
      if (!uid || !evId || typeof qn !== "number") continue;

      const key = `${uid}__${evId}`;
      if (!userAnswersByUserEvent[key]) userAnswersByUserEvent[key] = [];
      userAnswersByUserEvent[key].push({ question_number: qn, answer: ans ?? null });
    }

    // quick lookup prediction by (user,event)
    const predByUserEvent = new Map<string, PredictionRow>();
    for (const p of (predictions ?? []) as any[]) {
      predByUserEvent.set(`${p.user_id}__${p.event_id}`, p as PredictionRow);
    }

    // sessions grouped by event
    const sessionsByEvent = new Map<string, SessionRow[]>();
    for (const s of (sessions ?? []) as any[]) {
      const evId = (s as any).event_id;
      if (!sessionsByEvent.has(evId)) sessionsByEvent.set(evId, []);
      sessionsByEvent.get(evId)!.push(s as SessionRow);
    }

    // build leaderboard rows
    const rows: any[] = [];

    for (const uid of memberIds) {
      const p = profileById.get(uid);
      rows.push({
        user_id: uid,
        display_name: p?.display_name ?? p?.username ?? p?.email ?? uid,
        total_points: 0,
      });
    }

    for (const row of rows) {
      for (const ev of events ?? []) {
        const evId = (ev as any).id as string;
        const evSessions = sessionsByEvent.get(evId) ?? [];
        const pred = predByUserEvent.get(`${row.user_id}__${evId}`);
        const predJson = pred?.prediction_json ?? null;

        const resultsJson = resultsByEvent[evId] ?? null;

        for (const s of evSessions) {
          const resultTop10 = getResultTop10(resultsJson, s.id);
          if (!resultTop10) continue;

          const predTop10 = getPredTop10(predJson, s.id);
          row.total_points += pointsForSession(s.session_key, predTop10, resultTop10);
        }

        // weekend bonus (3 vragen: question_number 1..3)
        const official = officialByEvent[evId] ?? [];
        const user = userAnswersByUserEvent[`${row.user_id}__${evId}`] ?? [];
        row.total_points += pointsForWeekendBonus(user, official);
      }
    }

    rows.sort((a, b) => b.total_points - a.total_points);

    return NextResponse.json(
      { ok: true, poolId, leaderboard: rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return jsonError(e?.message ?? "Unexpected error", 500);
  }
}
