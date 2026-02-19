import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import {
  normalizeTop10,
  pointsForSession,
  scoreWeekendBonus,
  scoreSeasonBonus,
} from "../../../../../lib/scoring";

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

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
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

/**
 * BONUS TABLE ASSUMPTIONS (defensive):
 *
 * Weekend:
 * - bonus_weekend_sets: { id, pool_id, event_id, lock_at }
 * - bonus_weekend_set_questions: { set_id, question_id }   (not strictly needed for scoring)
 * - bonus_weekend_answers: { set_id, user_id, answer_json }  (user answers)
 * - bonus_weekend_results: { set_id, correct_json }          (admin correct answers)
 *
 * Season:
 * - bonus_season_answers: { pool_id, user_id, answer_json }
 * - bonus_season_results: { pool_id, correct_json }
 *
 * If any of these tables don't exist yet, leaderboard still works (bonus = 0).
 */

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const poolId = params.id;

    const accessToken =
      getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");
    if (!accessToken) return jsonError("Missing accessToken", 401);

    const user = await getUserFromToken(accessToken);
    if (!user) return jsonError("Invalid session", 401);

    const admin = supabaseAdmin();

    // ✅ access check: must be pool member
    const { data: membership, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) return jsonError(memErr.message, 500);
    if (!membership) return jsonError("Not a pool member", 403);

    // ✅ events (global season)
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

    // ✅ sessions
    const { data: sessions, error: sessErr } = await admin
      .from("event_sessions")
      .select("id,event_id,session_key,name,starts_at,lock_at")
      .in("event_id", eventIds)
      .order("starts_at", { ascending: true });

    if (sessErr) return jsonError(sessErr.message, 500);

    // ✅ pool members + display_name (fallback profiles)
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
    for (const p of profiles ?? []) {
      profileNameById[(p as any).id] = (p as any).display_name ?? null;
    }

    const memberNameById: Record<string, string | null> = {};
    for (const m of (members ?? []) as any[]) {
      const direct = String(m.display_name ?? "").trim();
      memberNameById[m.user_id] = direct ? direct : (profileNameById[m.user_id] ?? null);
    }

    // ✅ predictions
    const { data: predictions, error: predErr } = await admin
      .from("predictions")
      .select("user_id,pool_id,event_id,prediction_json")
      .eq("pool_id", poolId)
      .in("event_id", eventIds)
      .in("user_id", memberIds);

    if (predErr) return jsonError(predErr.message, 500);

    // ✅ results per event
    const { data: resultsRows, error: resErr } = await admin
      .from("event_results")
      .select("event_id,result_json,results,updated_at")
      .in("event_id", eventIds);

    if (resErr) return jsonError(resErr.message, 500);

    const resultsByEvent: Record<string, any> = {};
    for (const r of resultsRows ?? []) {
      resultsByEvent[(r as any).event_id] = pickResultsJson(r);
    }

    // prediction lookup by (user,event)
    const predByUserEvent = new Map<string, PredictionRow>();
    for (const p of (predictions ?? []) as any[]) {
      predByUserEvent.set(`${p.user_id}__${p.event_id}`, p as PredictionRow);
    }

    // sessions grouped by event
    const sessionsByEvent: Record<string, SessionRow[]> = {};
    for (const s of (sessions ?? []) as any[]) {
      const evId = (s as any).event_id;
      (sessionsByEvent[evId] ||= []).push(s as SessionRow);
    }

    /* ------------------------------------------------------------
     * BONUS FETCH (DEFENSIVE)
     * ------------------------------------------------------------ */
    // Weekend sets for this pool+events
    const weekendSetByEventId: Record<string, string> = {};
    let weekendCorrectBySetId: Record<string, any> = {};
    let weekendAnswerBySetUser: Record<string, any> = {};

    try {
      const { data: sets } = await admin
        .from("bonus_weekend_sets")
        .select("id,event_id,pool_id")
        .eq("pool_id", poolId)
        .in("event_id", eventIds);

      for (const s of (sets ?? []) as any[]) {
        weekendSetByEventId[s.event_id] = s.id;
      }

      const setIds = Object.values(weekendSetByEventId).filter(Boolean);

      if (setIds.length > 0) {
        const { data: wr } = await admin
          .from("bonus_weekend_results")
          .select("set_id,correct_json")
          .in("set_id", setIds);

        weekendCorrectBySetId = {};
        for (const r of (wr ?? []) as any[]) {
          weekendCorrectBySetId[r.set_id] = r.correct_json ?? null;
        }

        const { data: wa } = await admin
          .from("bonus_weekend_answers")
          .select("set_id,user_id,answer_json")
          .in("set_id", setIds)
          .in("user_id", memberIds);

        weekendAnswerBySetUser = {};
        for (const a of (wa ?? []) as any[]) {
          weekendAnswerBySetUser[`${a.set_id}__${a.user_id}`] = a.answer_json ?? null;
        }
      }
    } catch {
      // ignore: bonus tables may not exist yet
    }

    // Season bonus (pool-wide)
    let seasonCorrectJson: any = null;
    let seasonAnswerByUserId: Record<string, any> = {};

    try {
      const { data: sr } = await admin
        .from("bonus_season_results")
        .select("pool_id,correct_json")
        .eq("pool_id", poolId)
        .maybeSingle();

      seasonCorrectJson = (sr as any)?.correct_json ?? null;

      const { data: sa } = await admin
        .from("bonus_season_answers")
        .select("pool_id,user_id,answer_json")
        .eq("pool_id", poolId)
        .in("user_id", memberIds);

      seasonAnswerByUserId = {};
      for (const a of (sa ?? []) as any[]) {
        seasonAnswerByUserId[a.user_id] = a.answer_json ?? null;
      }
    } catch {
      // ignore: season bonus tables may not exist yet
    }

    /* ------------------------------------------------------------
     * BUILD LEADERBOARD
     * ------------------------------------------------------------ */
    const rows = memberIds.map((uid: string) => ({
      user_id: uid,
      display_name: memberNameById[uid] ?? null,
      total_points: 0,

      // optional breakdown (handy for debugging later)
      top10_points: 0,
      weekend_bonus_points: 0,
      season_bonus_points: 0,
    }));

    for (const row of rows) {
      // TOP10 points across events/sessions
      for (const evId of eventIds) {
        const evSessions = sessionsByEvent[evId] ?? [];
        const resultsJson = resultsByEvent[evId];
        const pred = predByUserEvent.get(`${row.user_id}__${evId}`);
        const predJson = pred?.prediction_json ?? null;

        for (const s of evSessions) {
          const resultTop10 = getResultTop10(resultsJson, s.id);
          if (!resultTop10) continue; // no result yet

          const predTop10 = getPredTop10(predJson, s.id);
          const pts = pointsForSession(s.session_key, predTop10, resultTop10);

          row.top10_points += pts;
          row.total_points += pts;
        }

        // WEEKEND BONUS for this event (if set exists + admin answered)
        const setId = weekendSetByEventId[evId];
        if (setId) {
          const correctJson = weekendCorrectBySetId[setId];
          const answerJson = weekendAnswerBySetUser[`${setId}__${row.user_id}`];

          if (correctJson && answerJson) {
            const sc = scoreWeekendBonus(answerJson, correctJson);
            row.weekend_bonus_points += sc.points;
            row.total_points += sc.points;
          }
        }
      }

      // SEASON BONUS (pool-wide)
      if (seasonCorrectJson) {
        const mySeasonAns = seasonAnswerByUserId[row.user_id];
        if (mySeasonAns) {
          const sc = scoreSeasonBonus(mySeasonAns, seasonCorrectJson);
          row.season_bonus_points += sc.points;
          row.total_points += sc.points;
        }
      }
    }

    rows.sort((a, b) => b.total_points - a.total_points);

    return NextResponse.json(
      {
        ok: true,
        poolId,
        leaderboard: rows,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}
