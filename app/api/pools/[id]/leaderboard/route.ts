// app/api/pools/[id]/leaderboard/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import {
  pointsForSession,
  normalizeTop10,
  pointsForWeekendBonusAnswers,
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

    // 1) toegang check: user must be in pool
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

    // 4) pool members + display_name fallback profiles
    const { data: members, error: membersErr } = await admin
      .from("pool_members")
      .select("user_id,display_name")
      .eq("pool_id", poolId);

    if (membersErr) return jsonError(membersErr.message, 500);

    const memberIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

    const { data: profiles, error: profErr } = await admin
      .from("profiles")
      .select("id,display_name")
      .in("id", memberIds);

    if (profErr) return jsonError(profErr.message, 500);

    const profileNameById: Record<string, string | null> = {};
    for (const p of profiles ?? []) profileNameById[p.id] = (p as any).display_name ?? null;

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
    for (const r of resultsRows ?? []) resultsByEvent[(r as any).event_id] = pickResultsJson(r);

    // prediction lookup
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

    /** -----------------------------
     * WEEKEND BONUS SETS (3 vragen)
     * pool_event_bonus_sets: (id, pool_id, event_id)
     * pool_event_bonus_set_questions: (set_id, question_id, position)
     * weekend_official_answers: (event_id, question_id, answer_json)
     * bonus_weekend_answers: (pool_id, event_id, user_id, question_id, answer_json)
     * ----------------------------- */

    // A) set_id per event
    const { data: setRows, error: setErr } = await admin
      .from("pool_event_bonus_sets")
      .select("id,event_id,pool_id")
      .eq("pool_id", poolId)
      .in("event_id", eventIds);

    if (setErr) return jsonError(setErr.message, 500);

    const setIdByEvent: Record<string, string> = {};
    const allSetIds: string[] = [];
    for (const r of (setRows ?? []) as any[]) {
      if (r?.event_id && r?.id) {
        setIdByEvent[r.event_id] = r.id;
        allSetIds.push(r.id);
      }
    }

    // B) question_ids per set (ordered)
    let questionIdsByEvent: Record<string, string[]> = {};
    let allQuestionIds: string[] = [];

    if (allSetIds.length > 0) {
      const { data: setQRows, error: setQErr } = await admin
        .from("pool_event_bonus_set_questions")
        .select("set_id,question_id,position")
        .in("set_id", allSetIds)
        .order("position", { ascending: true });

      if (setQErr) return jsonError(setQErr.message, 500);

      const qidsBySet: Record<string, string[]> = {};
      for (const r of (setQRows ?? []) as any[]) {
        if (!r?.set_id || !r?.question_id) continue;
        if (!qidsBySet[r.set_id]) qidsBySet[r.set_id] = [];
        qidsBySet[r.set_id].push(r.question_id);
      }

      questionIdsByEvent = {};
      for (const evId of Object.keys(setIdByEvent)) {
        const sid = setIdByEvent[evId];
        const qids = qidsBySet[sid] ?? [];
        questionIdsByEvent[evId] = qids.slice(0, 3); // safety: max 3
      }

      allQuestionIds = Array.from(
        new Set(Object.values(questionIdsByEvent).flat().filter(Boolean))
      );
    }

    // C) official answers (alleen die qids)
    const officialByEvent: Record<string, Record<string, any>> = {};
    if (allQuestionIds.length > 0) {
      const { data: offRows, error: offErr } = await admin
        .from("weekend_official_answers")
        .select("event_id,question_id,answer_json")
        .in("event_id", eventIds)
        .in("question_id", allQuestionIds);

      if (offErr) return jsonError(offErr.message, 500);

      for (const r of (offRows ?? []) as any[]) {
        if (!r?.event_id || !r?.question_id) continue;
        if (!officialByEvent[r.event_id]) officialByEvent[r.event_id] = {};
        officialByEvent[r.event_id][r.question_id] = r.answer_json;
      }
    }

    // D) user answers (alleen die qids)
    const userAnswersByUserEvent: Record<string, Record<string, any>> = {};
    if (allQuestionIds.length > 0) {
      const { data: uaRows, error: uaErr } = await admin
        .from("bonus_weekend_answers")
        .select("pool_id,event_id,user_id,question_id,answer_json")
        .eq("pool_id", poolId)
        .in("event_id", eventIds)
        .in("user_id", memberIds)
        .in("question_id", allQuestionIds);

      if (uaErr) return jsonError(uaErr.message, 500);

      for (const r of (uaRows ?? []) as any[]) {
        if (!r?.user_id || !r?.event_id || !r?.question_id) continue;
        const key = `${r.user_id}__${r.event_id}`;
        if (!userAnswersByUserEvent[key]) userAnswersByUserEvent[key] = {};
        userAnswersByUserEvent[key][r.question_id] = r.answer_json;
      }
    }

    // leaderboard rows
    const rows = memberIds.map((uid: string) => ({
      user_id: uid,
      display_name: memberNameById[uid] ?? null,
      total_points: 0,
    }));

    // scoring: sessions + weekend bonus
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

        // weekend bonus (alleen de 3 van deze pool+event)
        const qids = questionIdsByEvent[evId] ?? [];
        if (qids.length > 0) {
          const offAll = officialByEvent[evId] ?? {};
          const offScoped: Record<string, any> = {};
          for (const qid of qids) offScoped[qid] = offAll[qid];

          const uaAll = userAnswersByUserEvent[`${row.user_id}__${evId}`] ?? {};
          const uaScoped: Record<string, any> = {};
          for (const qid of qids) uaScoped[qid] = uaAll[qid];

          row.total_points += pointsForWeekendBonusAnswers(uaScoped, offScoped);
        }
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
