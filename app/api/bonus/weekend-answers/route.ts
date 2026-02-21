// app/api/bonus/weekend-answer/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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

export async function POST(req: Request) {
  try {
    const accessToken =
      getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");
    if (!accessToken) return jsonError("Missing accessToken", 401);

    const user = await getUserFromToken(accessToken);
    if (!user) return jsonError("Invalid session", 401);

    const body = await req.json();

    // Verwacht minimaal dit:
    const poolId = String(body.pool_id ?? "");
    const eventId = String(body.event_id ?? "");
    const questionId = String(body.question_id ?? "");
    const answerJson = body.answer_json; // boolean / jsonb

    if (!poolId || !eventId || !questionId) {
      return jsonError("Missing pool_id/event_id/question_id", 400);
    }

    const admin = supabaseAdmin();

    // 1) membership check: user moet in pool zitten
    const { data: membership, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) return jsonError(memErr.message, 500);
    if (!membership) return jsonError("Not a pool member", 403);

    // 2) haal set_id op voor dit weekend (pool+event)
    const { data: setRow, error: setErr } = await admin
      .from("pool_event_bonus_sets")
      .select("id")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (setErr) return jsonError(setErr.message, 500);
    if (!setRow?.id) return jsonError("No bonus set for this event", 400);

    const setId = setRow.id as string;

    // 3) check: questionId moet in de 3 gekozen vragen van deze set zitten
    const { data: sq, error: sqErr } = await admin
      .from("pool_event_bonus_set_questions")
      .select("question_id")
      .eq("set_id", setId)
      .eq("question_id", questionId)
      .maybeSingle();

    if (sqErr) return jsonError(sqErr.message, 500);
    if (!sq) return jsonError("Question not part of this weekend set", 400);

    // 4) upsert row-per-question
    const { error: upErr } = await admin
      .from("bonus_weekend_answers")
      .upsert(
        {
          set_id: setId,
          pool_id: poolId,
          event_id: eventId,
          user_id: user.id,
          question_id: questionId,
          answer_json: answerJson,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "set_id,user_id,question_id" }
      );

    if (upErr) return jsonError(upErr.message, 500);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}
