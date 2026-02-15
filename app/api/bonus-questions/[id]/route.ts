import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const admin = supabaseAdmin();

  const { error } = await admin
    .from("bonus_questions")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
