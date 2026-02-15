import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export async function GET() {
  const admin = supabaseAdmin();

  const { data, error } = await admin
    .from("bonus_questions")
    .select("*")
    .eq("type", "weekend")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, questions: data ?? [] });
}

export async function POST(req: Request) {
  const admin = supabaseAdmin();
  const body = await req.json();

  const question = String(body?.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "Question required" }, { status: 400 });
  }

  const { error } = await admin.from("bonus_questions").insert({
    question,
    type: "weekend",
    points: 10,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
