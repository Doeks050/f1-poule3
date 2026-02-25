import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function dbg(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log("[WEEKEND_OFFICIAL]", ...args);
}

function jsonError(message: string, status = 400, extra?: any) {
  dbg("ERROR", status, message, extra ?? "");
  return NextResponse.json({ ok: false, error: message, extra }, { status });
}

function getTokenFromRequest(req: Request) {
  // 1) Authorization: Bearer <token>
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  // 2) Cookie fallback (common names)
  const cookie = req.headers.get("cookie") ?? "";
  const parts = cookie.split(";").map((p) => p.trim());
  const map = new Map(parts.map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))] as const;
  }));

  return (
    map.get("sb-access-token") ||
    map.get("supabase-auth-token") || // sometimes stored as JSON; but keeping fallback
    null
  );
}

async function assertUser(req: Request) {
  const token = getTokenFromRequest(req);
  if (!token) return { ok: false as const, error: "Not authenticated (missing token)" };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { ok: false as const, error: "Not authenticated" };

  return { ok: true as const, userId: data.user.id };
}

async function assertPoolMembership(poolId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("pool_members")
    .select("pool_id,user_id,role")
    .eq("pool_id", poolId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Not a pool member" };

  return { ok: true as const, role: data.role as string };
}

async function ensureWeekendSetId(poolId: string, eventId: string) {
  // bonus_weekend_sets: id, pool_id, event_id, question_ids (jsonb/array)
  const existing = await supabaseAdmin
    .from("bonus_weekend_sets")
    .select("id")
    .eq("pool_id", poolId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (existing.error) return { ok: false as const, error: existing.error.message };
  if (existing.data?.id) return { ok: true as const, setId: existing.data.id as string };

  // If set does not exist yet, create an empty one (questions are managed by /api/bonus/weekend-set anyway)
  const created = await supabaseAdmin
    .from("bonus_weekend_sets")
    .insert({ pool_id: poolId, event_id: eventId, question_ids: [] })
    .select("id")
    .single();

  if (created.error) return { ok: false as const, error: created.error.message };
  return { ok: true as const, setId: created.data.id as string };
}

async function pickOfficialTable() {
  // prefer non-v2; fallback to v2 if non-v2 doesn't exist
  const try1 = await supabaseAdmin.from("weekend_bonus_official_answers").select("id").limit(1);
  if (!try1.error) return "weekend_bonus_official_answers";

  const try2 = await supabaseAdmin.from("weekend_bonus_official_answers_v2").select("id").limit(1);
  if (!try2.error) return "weekend_bonus_official_answers_v2";

  return null;
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const poolId = u.searchParams.get("poolId") ?? "";
    const eventId = u.searchParams.get("eventId") ?? "";
    if (!poolId || !eventId) return jsonError("Missing poolId or eventId", 400);

    const auth = await assertUser(req);
    if (!auth.ok) return jsonError(auth.error, 401);

    const mem = await assertPoolMembership(poolId, auth.userId);
    if (!mem.ok) return jsonError(mem.error, 403);

    const setRes = await ensureWeekendSetId(poolId, eventId);
    if (!setRes.ok) return jsonError(setRes.error, 500);

    const table = await pickOfficialTable();
    if (!table) return jsonError("No official answers table found (weekend_bonus_official_answers[_v2])", 500);

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("question_id,answer_json,set_id")
      .eq("set_id", setRes.setId);

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({
      ok: true,
      table,
      setId: setRes.setId,
      rows: data ?? [],
    });
  } catch (e: any) {
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const poolId = (body.pool_id ?? body.poolId ?? "") as string;
    const eventId = (body.event_id ?? body.eventId ?? "") as string;
    const questionId = (body.question_id ?? body.questionId ?? "") as string;
    const answerJson = body.answer_json ?? body.answerJson ?? null;
    const action = (body.action ?? "upsert") as "upsert" | "clear";

    if (!poolId || !eventId || !questionId) {
      return jsonError("Missing pool_id/event_id/question_id", 400, { poolId, eventId, questionId });
    }

    const auth = await assertUser(req);
    if (!auth.ok) return jsonError(auth.error, 401);

    const mem = await assertPoolMembership(poolId, auth.userId);
    if (!mem.ok) return jsonError(mem.error, 403);

    const setRes = await ensureWeekendSetId(poolId, eventId);
    if (!setRes.ok) return jsonError(setRes.error, 500);

    const table = await pickOfficialTable();
    if (!table) return jsonError("No official answers table found (weekend_bonus_official_answers[_v2])", 500);

    if (action === "clear") {
      const del = await supabaseAdmin
        .from(table)
        .delete()
        .eq("set_id", setRes.setId)
        .eq("question_id", questionId);

      if (del.error) return jsonError(del.error.message, 500);

      return NextResponse.json({ ok: true, table, setId: setRes.setId, deleted: true });
    }

    // IMPORTANT: we do NOT allow null answer_json insert because your column is NOT NULL in some tables.
    if (answerJson === null || typeof answerJson === "undefined") {
      return jsonError("answer_json is required for upsert (use action=clear to remove)", 400);
    }

    const up = await supabaseAdmin
      .from(table)
      .upsert(
        {
          set_id: setRes.setId,
          question_id: questionId,
          answer_json: answerJson,
        },
        { onConflict: "set_id,question_id" }
      )
      .select("question_id,answer_json,set_id")
      .single();

    if (up.error) return jsonError(up.error.message, 500, { table });

    return NextResponse.json({ ok: true, table, setId: setRes.setId, row: up.data });
  } catch (e: any) {
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}
