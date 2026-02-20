// app/api/pools/[id]/leaderboard/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import {
  pointsForSession,
  normalizeTop10,
  pointsForWeekendBonusAnswers,
  mapAnswersByQuestionId,
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

    // --- BONUS: bepaal per (pool,event) de 3 geselecteerde question_ids ---
    const { data: bonusSets, error: setErr } = await admin
      .from("pool_event_bonus_sets")
      .select("id,event_id")
      .eq("pool_id", poolId)
      .in("event_id", eventIds);

    if (setErr) return jsonError(setErr.message, 500);

    const setIds = (bonusSets ?? []).map((s: any) => s.id).filter(Boolean);

    const setIdByEventId: Record<string, string> = {};
    for (const s of bonusSets ?? []) {
      setIdByEventId[(s as any).event_id] = (s as any).id;
    }

    let selectedQidsByEvent: Record<string, string[]> = {};
    if (setIds.length > 0) {
      const { data: setQs, error: setQsErr } = await admin
        .from("pool_event_bonus_set_questions")
        .select("set_id,question_id,position")
        .in("set_id", setIds)
        .order("position", { ascending: true });

      if (setQsErr) return jsonError(setQsErr.message, 500);

      // set_id -> [question_id...]
      const qidsBySet: Record<string, string[]> = {};
      for (const r of setQs ?? []) {
        const sid = (r as any).set_id;
        const qid = (r as any).question_id;
        if (!sid || !qid) continue;
        if (!qidsBySet[sid]) qidsBySet[sid] = [];
        qidsBySet[sid].push(qid);
      }

      // event_id -> [question_id...]
      for (const evId of Object.keys(setIdByEventId)) {
        const sid = setIdByEventId[evId];
        selectedQidsByEvent[evId] = (qidsBySet[sid] ?? []).slice(0, 3);
      }
    }

    // flatten alle geselecteerde qids (voor batch fetch)
    const allSelectedQids = Array.from(
      new Set(Object.values(selectedQidsByEvent).flat().filter(Boolean))
    );

    // 7) official weekend answers (alleen selected qids)
    const officialByEvent: Record<string, Record<string, any>> = {};
    if (allSelectedQids.length > 0) {
      const { data: officialRows, error: offErr } = await admin
        .from("weekend_official_answers")
        .select("event_id,question_id,answer_json")
        .in("event_id", eventIds)
        .in("question_id", allSelectedQids);

      if (offErr) return jsonError(offErr.message, 500);

      for (const evId of eventIds) officialByEvent[evId] = {};

      for (const r of officialRows ?? []) {
        const evId = (r as any).event_id;
        const qid = (r as any).question_id;
        if (!evId || !qid) continue;
        if (!officialByEvent[evId]) officialByEvent[evId] = {};
        officialByEvent[evId][qid] = (r as any).answer_json;
      }
    }

    // 8) user weekend answers (alleen selected qids)
    const userAnswersByUserEvent: Record<string, Record<string, any>> = {};
    if (allSelectedQids.length > 0) {
      const { data: userBonusRows, error: ubErr } = await admin
        .from("bonus_weekend_answers")
        .select("user_id,event_id,question_id,answer_json")
        .eq("pool_id", poolId)
        .in("event_id", eventIds)
        .in("user_id", memberIds)
        .in("question_id", allSelectedQids);

      if (ubErr) return jsonError(ubErr.message, 500);

      for (const r of userBonusRows ?? []) {
        const uid = (r as any).user_id;
        const evId = (r as any).event_id;
        const qid = (r as any).question_id;
        if (!uid || !evId || !qid) continue;

        const key = `${uid}__${evId}`;
        if (!userAnswersByUserEvent[key]) userAnswersByUserEvent[key] = {};
        userAnswersByUserEvent[key][qid] = (r as any).answer_json;
      }
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

        // weekend bonus (alleen 3 selected questions)
        const selectedQids = selectedQidsByEvent[evId] ?? [];
        if (selectedQids.length > 0) {
          const correctMap = officialByEvent[evId] ?? {};
          const userMap = userAnswersByUserEvent[`${row.user_id}__${evId}`] ?? {};

          // ✅ FIX: normaliseer raw answer_json naar boolean-maps via scoring helper
          const correctRows = selectedQids
            .filter((qid) => qid in correctMap)
            .map((qid) => ({ question_id: qid, answer_json: correctMap[qid] }));

          // Alleen tellen als er official answers bestaan
          if (correctRows.length > 0) {
            const userRows = selectedQids
              .filter((qid) => qid in userMap)
              .map((qid) => ({ question_id: qid, answer_json: userMap[qid] }));

            const correctBoolMap = mapAnswersByQuestionId(correctRows);
            const userBoolMap = mapAnswersByQuestionId(userRows);

            row.total_points += pointsForWeekendBonusAnswers(userBoolMap, correctBoolMap);
          }
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
