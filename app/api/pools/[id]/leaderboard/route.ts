// app/api/pools/[id]/leaderboard/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import {
  pointsForSession,
  normalizeTop10,
  pointsForWeekendBonusAnswers,
  mapAnswersByQuestionId,
  pointsForWeekendBonusAnswersDebug,
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

// ------------------------------
// DEBUG helpers (NOOP tenzij DBG aan staat)
// ------------------------------
function makeReqId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isDbgEnabled(req: Request) {
  if (process.env.DBG === "1") return true;
  try {
    return new URL(req.url).searchParams.get("dbg") === "1";
  } catch {
    return false;
  }
}

function dbg(reqId: string, enabled: boolean, label: string, data?: any) {
  if (!enabled) return;
  const prefix = `[LEADERBOARD][${reqId}] ${label}`;
  if (data !== undefined) console.log(prefix, data);
  else console.log(prefix);
}

function jsonError(message: string, status = 400, reqId?: string, dbgEnabled?: boolean, extra?: any) {
  if (dbgEnabled) {
    console.log(`[LEADERBOARD][${reqId ?? "no-reqid"}] ERROR ${status}: ${message}`, extra ?? "");
  }
  return NextResponse.json({ error: message }, { status });
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getUserFromToken(accessToken: string, reqId: string, dbgEnabled: boolean) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supa = createClient(url, anon, { auth: { persistSession: false } });

  const { data, error } = await supa.auth.getUser(accessToken);
  dbg(reqId, dbgEnabled, "auth.getUser", { ok: !!data?.user, err: error?.message ?? null });
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
  const reqId = makeReqId();
  const DBG = isDbgEnabled(req);

  try {
    const poolId = params.id;
    dbg(reqId, DBG, "start", { poolId });

    const accessToken =
      getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");

    dbg(reqId, DBG, "token present", { hasAccessToken: !!accessToken });

    if (!accessToken) return jsonError("Missing accessToken", 401, reqId, DBG);

    const user = await getUserFromToken(accessToken, reqId, DBG);
    if (!user) return jsonError("Invalid session", 401, reqId, DBG);

    dbg(reqId, DBG, "user", { userId: user.id });

    const admin = supabaseAdmin();

    // 1) toegang check
    const { data: membership, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    dbg(reqId, DBG, "membership", { ok: !!membership, err: memErr?.message ?? null });

    if (memErr) return jsonError(memErr.message, 500, reqId, DBG);
    if (!membership) return jsonError("Not a pool member", 403, reqId, DBG);

    // 2) events
    const { data: events, error: eventsErr } = await admin
      .from("events")
      .select("id,name,starts_at,format")
      .order("starts_at", { ascending: true });

    dbg(reqId, DBG, "events", { count: (events ?? []).length, err: eventsErr?.message ?? null });

    if (eventsErr) return jsonError(eventsErr.message, 500, reqId, DBG);

    const eventIds = (events ?? []).map((e: any) => e.id).filter(Boolean);
    dbg(reqId, DBG, "eventIds", { count: eventIds.length });

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

    dbg(reqId, DBG, "sessions", { count: (sessions ?? []).length, err: sessErr?.message ?? null });

    if (sessErr) return jsonError(sessErr.message, 500, reqId, DBG);

    // 4) pool members
    const { data: members, error: membersErr } = await admin
      .from("pool_members")
      .select("user_id,display_name")
      .eq("pool_id", poolId);

    dbg(reqId, DBG, "members", { count: (members ?? []).length, err: membersErr?.message ?? null });

    if (membersErr) return jsonError(membersErr.message, 500, reqId, DBG);

    const memberIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
    dbg(reqId, DBG, "memberIds", { count: memberIds.length });

    // profiles fallback
    const { data: profiles, error: profErr } = await admin
      .from("profiles")
      .select("id,display_name")
      .in("id", memberIds);

    dbg(reqId, DBG, "profiles", { count: (profiles ?? []).length, err: profErr?.message ?? null });

    if (profErr) return jsonError(profErr.message, 500, reqId, DBG);

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

    dbg(reqId, DBG, "predictions", { count: (predictions ?? []).length, err: predErr?.message ?? null });

    if (predErr) return jsonError(predErr.message, 500, reqId, DBG);

    // 6) results
    const { data: resultsRows, error: resErr } = await admin
      .from("event_results")
      .select("event_id,result_json,results,updated_at")
      .in("event_id", eventIds);

    dbg(reqId, DBG, "results", { count: (resultsRows ?? []).length, err: resErr?.message ?? null });

    if (resErr) return jsonError(resErr.message, 500, reqId, DBG);

    const resultsByEvent: Record<string, any> = {};
    for (const r of resultsRows ?? []) {
      resultsByEvent[(r as any).event_id] = pickResultsJson(r);
    }

    // --- BONUS: bepaal per (pool,event) de 3 geselecteerde question_ids ---
    // --- BONUS: gebruik bonus_weekend_sets (V1 systeem) ---

const selectedQidsByEvent: Record<string, string[]> = {};

const { data: weekendSets, error: wsErr } = await admin
  .from("bonus_weekend_sets")
  .select("event_id,question_ids")
  .eq("pool_id", poolId)
  .in("event_id", eventIds);

dbg(reqId, DBG, "bonus_weekend_sets", {
  count: (weekendSets ?? []).length,
  err: wsErr?.message ?? null,
});

if (wsErr) return jsonError(wsErr.message, 500, reqId, DBG);

for (const row of weekendSets ?? []) {
  selectedQidsByEvent[(row as any).event_id] =
    ((row as any).question_ids ?? []).slice(0, 3);
}

const allSelectedQids = Array.from(
  new Set(Object.values(selectedQidsByEvent).flat().filter(Boolean))
);

dbg(reqId, DBG, "allSelectedQids", { count: allSelectedQids.length });

    // 7) official weekend answers (alleen selected qids)
    const officialByEvent: Record<string, Record<string, any>> = {};
    if (allSelectedQids.length > 0) {
      const { data: officialRows, error: offErr } = await admin
        .from("weekend_bonus_official_answers")
        .select("event_id,question_id,answer_json")
        .in("event_id", eventIds)
        .in("question_id", allSelectedQids);

      dbg(reqId, DBG, "officialRows", { count: (officialRows ?? []).length, err: offErr?.message ?? null });

      if (offErr) return jsonError(offErr.message, 500, reqId, DBG);

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

      dbg(reqId, DBG, "userBonusRows", { count: (userBonusRows ?? []).length, err: ubErr?.message ?? null });

      if (ubErr) return jsonError(ubErr.message, 500, reqId, DBG);

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

            // Debug wrapper (zelfde score)
            const bonusPts = pointsForWeekendBonusAnswersDebug(userBoolMap, correctBoolMap, (msg, data) =>
              dbg(reqId, DBG, msg, { evId, userId: row.user_id, ...data })
            );

            // (score blijft exact hetzelfde)
            row.total_points += bonusPts;

            // Extra context log
            dbg(reqId, DBG, "bonus applied", {
              evId,
              userId: row.user_id,
              selectedQids: selectedQids.length,
              correctRows: correctRows.length,
              userRows: userRows.length,
              bonusPts,
            });
          } else {
            dbg(reqId, DBG, "bonus skipped (no official answers)", { evId, userId: row.user_id });
          }
        } else {
          dbg(reqId, DBG, "bonus skipped (no selectedQids)", { evId, userId: row.user_id });
        }
      }
    }

    rows.sort((a, b) => b.total_points - a.total_points);

    dbg(reqId, DBG, "done", { rows: rows.length });

    return NextResponse.json(
      { ok: true, poolId, leaderboard: rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return jsonError(e?.message ?? "Unknown error", 500, reqId, DBG, { stack: e?.stack });
  }
}
