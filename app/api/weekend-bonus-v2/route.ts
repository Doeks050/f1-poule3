import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json();
  const { eventId, answers } = body;

  const rows = answers.map((a: any) => ({
    event_id: eventId,
    question_number: a.question_number,
    answer: a.answer ?? null
  }));

  const { error } = await supabase
    .from("weekend_bonus_official_answers_v2")
    .upsert(rows, {
      onConflict: "event_id,question_number"
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
