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
  if (error || !data.user) return null;
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

    // membership check
    const { data: membership, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) return jsonError(memErr.message, 500);
    if (!membership) return jsonError("Not a pool member", 403);

    // events
    const { data: events, error: eventsErr } = await admin
      .from("events")
      .select("id,name,starts_at,format")
      .order("starts_at", { ascending: true });

    if (eventsErr) return jsonError(eventsErr.message, 500);

    const eventIds = (events ?? []).map((e: any) => e.id);
    if (eventIds.length === 0) {
      return NextResponse.json({ ok: true, poolId, leaderboard: [] });
    }

    // sessions
    const { data: sessions, error: sessErr } = await admin
      .from("event_sessions")
      .select("id,event_id,session_key,name,starts_at,lock_at")
      .in("event_id", eventIds)
      .order("starts_at", { ascending: true });

    if (sessErr) return jsonError(sessErr.message, 500);

    // pool members
    const { data: members, error: membersErr } = await admin
      .from("pool_members")
      .select("user_id,display_name")
      .eq("pool_id", poolId);

    if (membersErr) return jsonError(membersErr.message, 500);

    const memberIds = (members ?? []).map((m: any) => m.user_id);

    // predictions
    const { data: predictions, error: predErr } = await admin
      .from("predictions")
      .select("user_id,pool_id,event_id,prediction_json")
      .eq("pool_id", poolId)
      .in("event_id", eventIds)
      .in("user_id", memberIds);

    if (predErr) return jsonError(predErr.message, 500);

    // results
    const { data: resultsRows, error: resErr } = await admin
      .from("event_results")
      .select("event_id,result_json,results,updated_at")
      .in("event_id", eventIds);

    if (resErr) return jsonError(resErr.message, 500);

    const resultsByEvent: Record<string, any> = {};
    for (const r of resultsRows ?? []) resultsByEvent[r.event_id] = pickResultsJson(r);

    const predByUserEvent = new Map<string, PredictionRow>();
    for (const p of (predictions ?? []) as any[]) {
      predByUserEvent.set(`${p.user_id}__${p.event_id}`, p as PredictionRow);
    }

    const sessionsByEvent: Record<string, SessionRow[]> = {};
    for (const s of (sessions ?? []) as any[]) {
      (sessionsByEvent[s.event_id] ||= []).push(s as SessionRow);
    }

    // ✅ BONUS (weekend) – per event set
    // - bonus_weekend_sets: per (pool_id,event_id) 1 set
    // - bonus_set_questions: koppelt set -> 3 question_id’s (position 1-3)
    // - bonus_answers: user antwoorden in answer_json; admin correct in correct_json

    const { data: bonusSets, error: setsErr } = await admin
      .from("bonus_weekend_sets")
      .select("id,event_id")
      .eq("pool_id", poolId)
      .in("event_id", eventIds);

    if (setsErr) return jsonError(setsErr.message, 500);

    const setByEvent: Record<string, string> = {};
    for (const s of bonusSets ?? []) setByEvent[(s as any).event_id] = (s as any).id;

    const setIds = Object.values(setByEvent).filter(Boolean);

    let setQuestionsBySet: Record<string, string[]> = {};

    if (setIds.length > 0) {
      const { data: sq, error: sqErr } = await admin
        .from("bonus_set_questions")
        .select("set_id,question_id,position")
        .in("set_id", setIds)
        .order("position", { ascending: true });

      if (sqErr) return jsonError(sqErr.message, 500);

      setQuestionsBySet = {};
      for (const row of sq ?? []) {
        const setId = (row as any).set_id as string;
        const qid = (row as any).question_id as string;
        if (!setId || !qid) continue;
        (setQuestionsBySet[setId] ||= []).push(qid);
      }

      // Hard guarantee: alleen 3 unieke question_ids
      for (const sid of Object.keys(setQuestionsBySet)) {
        setQuestionsBySet[sid] = Array.from(new Set(setQuestionsBySet[sid])).slice(0, 3);
      }
    }

    // bonus answers for members (user rows)
    const { data: bonusAnswers, error: ansErr } = await admin
      .from("bonus_answers")
      .select("pool_id,event_id,user_id,answer_json,correct_json")
      .eq("pool_id", poolId)
      .in("event_id", eventIds)
      .in("user_id", memberIds);

    if (ansErr) return jsonError(ansErr.message, 500);

    // admin correct answers: in dezelfde table, maar met user_id='admin'
    const correctByUserId = "admin";
    const { data: adminCorrectAnswers, error: corrErr } = await admin
      .from("bonus_answers")
      .select("pool_id,event_id,user_id,correct_json")
      .eq("pool_id", poolId)
      .in("event_id", eventIds)
      .eq("user_id", correctByUserId);

    if (corrErr) return jsonError(corrErr.message, 500);

    const correctByEvent: Record<string, any> = {};
    for (const row of adminCorrectAnswers ?? []) {
      correctByEvent[(row as any).event_id] = (row as any).correct_json ?? null;
    }

    const bonusByUserEvent = new Map<string, any>();
    for (const a of bonusAnswers ?? []) {
      bonusByUserEvent.set(`${(a as any).user_id}__${(a as any).event_id}`, a);
    }

    // rows
    const rows = (members ?? []).map((m: any) => ({
      user_id: m.user_id as string,
      display_name: (m.display_name ?? null) as string | null,
      total_points: 0,
    }));

    for (const row of rows) {
      for (const evId of eventIds) {
        // ---- TOP10 punten ---- (NIET AANRAKEN)
        const evSessions = sessionsByEvent[evId] ?? [];
        const resultsJson = resultsByEvent[evId];
        const pred = predByUserEvent.get(`${row.user_id}__${evId}`);
        const predJson = pred?.prediction_json ?? null;

        for (const s of evSessions) {
          const resultTop10 = getResultTop10(resultsJson, s.id);
          const predTop10 = getPredTop10(predJson, s.id);
          if (!resultTop10) continue;

          row.total_points += pointsForSession(s.session_key, predTop10, resultTop10);
        }

        // ---- WEEKEND BONUS punten ----
        const setId = setByEvent[evId];
        if (!setId) continue;

        const questionIds = setQuestionsBySet[setId] ?? [];
        if (questionIds.length === 0) continue;

        const ansRow = bonusByUserEvent.get(`${row.user_id}__${evId}`);
        const correctJson = correctByEvent[evId];

        // als admin nog niks gezet heeft: 0 punten
        if (!correctJson) continue;

        // ✅ bonus score: alleen deze 3 vragen
        const bonusPoints = pointsForWeekendBonusAnswers({
          questionIds,
          answerJson: ansRow?.answer_json ?? null,
          correctJson,
        });

        row.total_points += bonusPoints;
      }
    }

    rows.sort((a, b) => b.total_points - a.total_points);

    return NextResponse.json({ ok: true, poolId, leaderboard: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
