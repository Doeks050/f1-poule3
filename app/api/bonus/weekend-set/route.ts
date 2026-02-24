import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const prefix = `[WEEKEND_SET][${reqId}] ${label}`;
  if (data !== undefined) console.log(prefix, data);
  else console.log(prefix);
}

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
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

export async function GET(req: Request) {
  const reqId = makeReqId();
  const DBG = isDbgEnabled(req);

  try {
    const url = new URL(req.url);

    const poolId = url.searchParams.get("poolId") ?? url.searchParams.get("pool_id");
    const eventId = url.searchParams.get("eventId") ?? url.searchParams.get("event_id");

    dbg(reqId, DBG, "query", { poolId, eventId });

    if (!poolId || !eventId) return jsonError("Missing poolId or eventId", 400);

    const accessToken = getBearerToken(req) || url.searchParams.get("accessToken");
    dbg(reqId, DBG, "token present", { hasAccessToken: !!accessToken });
    if (!accessToken) return jsonError("Missing accessToken", 401);

    const user = await getUserFromToken(accessToken);
    dbg(reqId, DBG, "auth.getUser", { ok: !!user });
    if (!user) return jsonError("Invalid session", 401);

    const admin = supabaseAdmin();

    // membership check
    const { data: mem, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    dbg(reqId, DBG, "membership", { ok: !!mem, err: memErr?.message ?? null });

    if (memErr) return jsonError(memErr.message, 500);
    if (!mem) return jsonError("Not a pool member", 403);

    // Fetch set (your current schema uses bonus_weekend_sets)
    const { data: setRow, error: setErr } = await admin
      .from("bonus_weekend_sets")
      .select("id,pool_id,event_id,question_1_id,question_2_id,question_3_id")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    dbg(reqId, DBG, "bonus_weekend_sets", {
      ok: !!setRow,
      err: setErr?.message ?? null,
      setId: setRow?.id ?? null,
    });

    if (setErr) return jsonError(setErr.message, 500);
    if (!setRow) return jsonError("No weekend set found for this pool/event", 404);

    const questionIds = [
      setRow.question_1_id,
      setRow.question_2_id,
      setRow.question_3_id,
    ].filter(Boolean) as string[];

    if (questionIds.length !== 3) {
      dbg(reqId, DBG, "invalid set questionIds", { questionIds });
      return jsonError("Weekend set does not have exactly 3 questions", 500);
    }

    // Load question prompts from bank
    const { data: qRows, error: qErr } = await admin
      .from("bonus_question_bank")
      .select("id,prompt,scope,answer_kind,is_active")
      .in("id", questionIds);

    dbg(reqId, DBG, "bonus_question_bank", {
      count: qRows?.length ?? 0,
      err: qErr?.message ?? null,
    });

    if (qErr) return jsonError(qErr.message, 500);

    const qById = new Map<string, any>();
    for (const q of qRows ?? []) qById.set(q.id, q);

    const ordered = questionIds.map((id, idx) => ({
      position: idx + 1,
      id,
      prompt: qById.get(id)?.prompt ?? "(missing prompt)",
      scope: qById.get(id)?.scope ?? null,
      answer_kind: qById.get(id)?.answer_kind ?? null,
      is_active: qById.get(id)?.is_active ?? null,
    }));

    dbg(reqId, DBG, "done", { returned: ordered.length });

    return NextResponse.json(
      {
        ok: true,
        poolId,
        eventId,
        questionIds,
        questions: ordered,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.log(`[WEEKEND_SET][${reqId}] ERROR 500`, e?.message ?? e, e?.stack ?? "");
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}
