// app/api/bonus/weekend-answers/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

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

type Body = {
  pool_id: string;
  event_id: string;
  set_id: string;
  question_id: string;
  answer_json: any; // { value: ... }
};

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing bearer token", 401);

    const user = await getUserFromToken(token);
    if (!user) return jsonError("Invalid token", 401);

    const body = (await req.json()) as Body;

    const { pool_id, event_id, set_id, question_id, answer_json } = body || ({} as any);
    if (!pool_id || !event_id || !set_id || !question_id) {
      return jsonError("Missing pool_id/event_id/set_id/question_id", 400);
    }

    // ✅ BELANGRIJK: bij jou is supabaseAdmin() een functie (factory)
    const admin = supabaseAdmin();

    const row = {
      pool_id,
      event_id,
      set_id,
      user_id: user.id,
      question_id,
      answer_json: answer_json ?? null,
    };

    const { error } = await admin
      .from("bonus_weekend_answers")
      .upsert(row, { onConflict: "set_id,user_id,question_id" });

    if (error) return jsonError(error.message, 400);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return jsonError(e?.message ?? "Unexpected error", 500);
  }
}

// (optioneel) als jouw frontend per ongeluk PUT doet:
export const PUT = POST;
