"use client";

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

type Body = {
  pool_id?: string;
  event_id?: string;
  set_id?: string | null;
  question_id?: string;
  // expected shape: { value: ... } OR null to delete/clear
  answer_json?: any;
};

async function resolveSetId(admin: any, pool_id: string, event_id: string) {
  const { data, error } = await admin
    .from("pool_event_bonus_sets")
    .select("id")
    .eq("pool_id", pool_id)
    .eq("event_id", event_id)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing bearer token", 401);

    const user = await getUserFromToken(token);
    if (!user) return jsonError("Invalid token", 401);

    const body = (await req.json()) as Body;

    const pool_id = body.pool_id;
    const event_id = body.event_id;
    const question_id = body.question_id;

    if (!pool_id || !event_id || !question_id) {
      return jsonError("Missing pool_id/event_id/question_id", 400);
    }

    // supabaseAdmin can be a client OR a function returning a client (your case)
    const admin =
      typeof supabaseAdmin === "function" ? (supabaseAdmin as any)() : (supabaseAdmin as any);

    const set_id = (body.set_id ?? (await resolveSetId(admin, pool_id, event_id))) as
      | string
      | null;

    if (!set_id) {
      return jsonError("No set_id found for this pool/event (generate a set first).", 409);
    }

    const answer_json = body.answer_json ?? null;

    // If user clears the answer -> delete the row (so “wissen” works)
    const isClearing =
      answer_json === null ||
      answer_json === undefined ||
      (typeof answer_json === "object" &&
        answer_json !== null &&
        "value" in answer_json &&
        answer_json.value == null);

    if (isClearing) {
      const { error } = await admin
        .from("bonus_weekend_answers")
        .delete()
        .eq("set_id", set_id)
        .eq("user_id", user.id)
        .eq("question_id", question_id);

      if (error) return jsonError(error.message, 400);
      return NextResponse.json({ ok: true, deleted: true });
    }

    const row = {
      set_id,
      user_id: user.id,
      question_id,
      answer_json,
    };

    const { error } = await admin
      .from("bonus_weekend_answers")
      .upsert(row, { onConflict: "set_id,user_id,question_id" });

    if (error) return jsonError(error.message, 400);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return jsonError(e?.message ?? "Server error", 500);
  }
}
