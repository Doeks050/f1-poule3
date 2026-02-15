import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

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
  if (error || !data.user) return null;
  return data.user;
}

async function requireAdmin(req: Request) {
  const token =
    getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");

  if (!token) return null;

  const user = await getUserFromToken(token);
  if (!user) return null;

  const admin = supabaseAdmin();

  const { data } = await admin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return data ? user : null;
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const user = await requireAdmin(req);
  if (!user)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = supabaseAdmin();

  const { error } = await admin
    .from("bonus_questions")
    .delete()
    .eq("id", params.id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
