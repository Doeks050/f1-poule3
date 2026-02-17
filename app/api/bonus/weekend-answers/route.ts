import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  // Auth header
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return jsonError("Missing bearer token", 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supabaseUrl || !anonKey || !serviceKey) return jsonError("Server env missing", 500);

  // 1) user via token
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userData?.user) return jsonError("Invalid session", 401);
  const userId = userData.user.id;

  // 2) payload
  const body = await req.json().catch(() => null);
  const poolId = body?.poolId as string | undefined;
  const eventId = body?.eventId as string | undefined;
  const questionId = body?.questionId as string | undefined;
  const value = body?.value as boolean | null | undefined;

  if (!poolId || !eventId || !questionId) return jsonError("Missing poolId/eventId/questionId", 400);
  if (!(value === true || value === false || value === null)) return jsonError("Invalid value", 400);

  // 3) service db
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Membership check (pool_members heeft GEEN id, dus select 1)
  const { data: memberRow, error: memberErr } = await db
    .from("pool_members")
    .select("pool_id")
    .eq("pool_id", poolId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr) return jsonError(memberErr.message, 500);
  if (!memberRow) return jsonError("Not a pool member", 403);

  // Bestaat set?
  const { data: setRow, error: setErr } = await db
    .from("pool_event_bonus_sets")
    .select("id, lock_at")
    .eq("pool_id", poolId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (setErr) return jsonError(setErr.message, 500);
  if (!setRow) return jsonError("No bonus set for this weekend", 404);

  // Locked?
  const isLocked = !!setRow.lock_at && new Date(setRow.lock_at).getTime() <= Date.now();
  if (isLocked) return jsonError("Bonusvragen zijn gelocked", 423);

  // Check dat questionId echt in deze set zit
  const { data: linkRow, error: linkErr } = await db
    .from("pool_event_bonus_set_questions")
    .select("question_id")
    .eq("set_id", setRow.id)
    .eq("question_id", questionId)
    .maybeSingle();

  if (linkErr) return jsonError(linkErr.message, 500);
  if (!linkRow) return jsonError("Question not in this set", 400);

  // Haal huidige answer op (alleen voor deze vraag)
const { data: existing, error: exErr } = await db
  .from("bonus_weekend_answers")
  .select("answer_json")
  .eq("pool_id", poolId)
  .eq("event_id", eventId)
  .eq("user_id", userId)
  .eq("question_id", questionId)
  .maybeSingle();

if (exErr) return jsonError(exErr.message, 500);

  // value kan true/false/number/string/null zijn
if (value === null) {
  // delete answer row voor deze vraag
  const { error: delErr } = await db
    .from("bonus_weekend_answers")
    .delete()
    .eq("pool_id", poolId)
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("question_id", questionId);

  if (delErr) return jsonError(delErr.message, 500);
  return NextResponse.json({ ok: true });
}

// upsert 1 rij per vraag
const payload = {
  pool_id: poolId,
  event_id: eventId,
  user_id: userId,
  question_id: questionId,
  answer_json: value,
};

const { data, error: upErr } = await db
  .from("bonus_weekend_answers")
  .upsert(payload, { onConflict: "pool_id,event_id,user_id,question_id" })
  .select("question_id, answer_json");

if (upErr) return jsonError(upErr.message, 500);

const row = Array.isArray(data) ? data[0] : data;

return NextResponse.json({
  ok: true,
  answers: row ? { [row.question_id]: row.answer_json } : {},
});
}
