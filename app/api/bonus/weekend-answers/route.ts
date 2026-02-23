// app/api/bonus/weekend-answers/route.ts
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
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token", 401);

    const user = await getUserFromToken(token);
    if (!user) return jsonError("Invalid token", 401);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { pool_id, event_id, set_id, question_id, value } = body;

    if (!pool_id || !event_id || !set_id || !question_id) {
      return jsonError("Missing pool_id/event_id/set_id/question_id", 400);
    }

    // 1 row per vraag per set per user
    // IMPORTANT: je DB unique index moet bestaan op (set_id, user_id, question_id)
    const row = {
      pool_id,
      event_id,
      set_id,
      question_id,
      user_id: user.id,
      answer_json: { value: value ?? null },
    };

    const { error } = await supabaseAdmin
      .from("bonus_weekend_answers")
      .upsert(row, { onConflict: "set_id,user_id,question_id" });

    if (error) return jsonError(error.message, 400);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return jsonError(e?.message ?? "Unexpected server error", 500);
  }
}
