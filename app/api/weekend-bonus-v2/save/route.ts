import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json();
  const { poolId, eventId, userId, answers } = body;
  // answers = [{ question_number: 1, answer: true }]

  const rows = answers.map((a: any) => ({
    pool_id: poolId,
    event_id: eventId,
    user_id: userId,
    question_number: a.question_number,
    answer: a.answer ?? null
  }));

  const { error } = await supabase
    .from("weekend_bonus_user_answers_v2")
    .upsert(rows, {
      onConflict: "pool_id,event_id,user_id,question_number"
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
