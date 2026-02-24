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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supa = createClient(url, anon, { auth: { persistSession: false } });

  const { data, error } = await supa.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
}

function pickResultsJson(row: any): any {
  // event_results kan result_json of results (legacy) zijn
  return row?.result_json ?? row?.results ?? null;
}

function getResultTop10(resultsJson: any, sessionId: string): string[] | null {
  const top10 = resultsJson?.sessions?.[sessionId]?.top10;
  return normalizeTop10(top10);
}

function getPredTop10(predictionJson: any, sessionId: string): string[] | null {
  const top10 = predictionJson?.sessions?.[sessionId]?.top10;
  return normalizeTop10(top10);
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const poolId = params.id;

    const accessToken =
      getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");

    if (!accessToken) return jsonError("Missing accessToken", 401);

    const user = await getUserFromToken(accessToken);
    if (!user) return jsonError("Invalid session", 401);

    const admin = supabaseAdmin();

    // 1) toegang check
    const { data: membership, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) return jsonError(memErr.message, 500);
    if (!membership) return jsonError("Not a pool member", 403);

    // 2) events
    const { data: events, error: eventsErr } = await admin
      .from("events")
      .select("id,name,starts_at,format")
      .order("starts_at", { ascending: true });

    if (eventsErr) return jsonError(eventsErr.message, 500);

    const eventIds = (events ?? []).map((e: any) => e.id).filter(Boolean);
    if (eventIds.length === 0) {
      return NextResponse.json(
        { ok: true, poolId, leaderboard: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 3) sessions
    const { data: sessions, error: sessErr } = await admin
      .from("event_sessions")
      .select("id,event_id,session_key,name,starts_at,lock_at")
      .in("event_id", eventIds)
      .order("starts_at", { ascending: true });

    if (sessErr) return jsonError(sessErr.message, 500);

    // 4) pool members
    const { data: members, error: membersErr } = await admin
      .from("pool_members")
      .select("user_id,display_name")
      .eq("pool_id", poolId);

    if (membersErr) return jsonError(membersErr.message, 500);

    const memberIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

    // profiles fallback
    const { data: profiles, error: profErr } = await admin
      .from("profiles")
      .select("id,display_name")
      .in("id", memberIds);

    if (profErr) return jsonError(profErr.message, 500);

    const profileNameById: Record<string, string | null> = {};
    for (const p of profiles ?? []) {
      profileNameById[(p as any).id] = (p as any).display_name ?? null;
    }

    const memberNameById: Record<string, string | null> = {};
    for (const m of (members ?? []) as any[]) {
      const direct = ((m.display_name ?? "") as string).trim();
      memberNameById[m.user_id] = direct ? direct : (profileNameById[m.user_id] ?? null);
    }

    // 5) predictions
    const { data: predictions, error: predErr } = await admin
      .from("predictions")
      .select("user_id,pool_id,event_id,prediction_json")
      .eq("pool_id", poolId)
      .in("event_id", eventIds)
      .in("user_id", memberIds);

    if (predErr) return jsonError(predErr.message, 500);

    // 6) results
    const { data: resultsRows, error: resErr } = await admin
      .from("event_results")
      .select("event_id,result_json,results,updated_at")
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
    for (const evId of eventIds) officialByEvent[evId] = [];

    const { data: officialRows, error: offErr } = await admin
      .from("weekend_bonus_official_answers")
      .select("event_id,question_number,answer")
      .in("event_id", eventIds);

    if (offErr) return jsonError(offErr.message, 500);

    for (const r of officialRows ?? []) {
      const evId = (r as any).event_id as string;
      const qn = (r as any).question_number as number;
      const ans = ((r as any).answer ?? null) as boolean | null;
      if (!evId || typeof qn !== "number") continue;
      if (!officialByEvent[evId]) officialByEvent[evId] = [];
      officialByEvent[evId].push({ question_number: qn, answer: ans });
    }

    const userAnswersByUserEvent: Record<
      string,
      { question_number: number; answer: boolean | null }[]
    > = {};

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
      const ans = ((r as any).answer ?? null) as boolean | null;
      if (!uid || !evId || typeof qn !== "number") continue;

      const key = `${uid}__${evId}`;
      if (!userAnswersByUserEvent[key]) userAnswersByUserEvent[key] = [];
      userAnswersByUserEvent[key].push({ question_number: qn, answer: ans });
    }

    // quick lookup prediction by (user,event)
    const predByUserEvent = new Map<string, PredictionRow>();
    for (const p of (predictions ?? []) as any[]) {
      predByUserEvent.set(`${p.user_id}__${p.event_id}`, p as PredictionRow);
    }

    // sessions grouped by event
    const sessionsByEvent: Record<string, SessionRow[]> = {};
    for (const s of (sessions ?? []) as any[]) {
      const evId = (s as any).event_id;
      if (!sessionsByEvent[evId]) sessionsByEvent[evId] = [];
      sessionsByEvent[evId].push(s as SessionRow);
    }

    // 9) leaderboard rows
    const rows = memberIds.map((uid: string) => ({
      user_id: uid,
      display_name: memberNameById[uid] ?? null,
      total_points: 0,
    }));

    // 10) score optellen
    for (const row of rows) {
      for (const evId of eventIds) {
        // sessions
        const evSessions = sessionsByEvent[evId] ?? [];
        const resultsJson = resultsByEvent[evId];
        const pred = predByUserEvent.get(`${row.user_id}__${evId}`);
        const predJson = pred?.prediction_json ?? null;

        for (const s of evSessions) {
          const resultTop10 = getResultTop10(resultsJson, s.id);
          if (!resultTop10) continue;

          const predTop10 = getPredTop10(predJson, s.id);
          row.total_points += pointsForSession(s.session_key, predTop10, resultTop10);
        }

        // weekend bonus V2 (question_number 1..3)
        const official = officialByEvent[evId] ?? [];
        const userBonus = userAnswersByUserEvent[`${row.user_id}__${evId}`] ?? [];
        row.total_points += pointsForWeekendBonus(userBonus, official);
      }
    }

    rows.sort((a, b) => b.total_points - a.total_points);

    return NextResponse.json(
      { ok: true, poolId, leaderboard: rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}
