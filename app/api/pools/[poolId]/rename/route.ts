import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

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

async function assertOwner(admin: ReturnType<typeof supabaseAdmin>, poolId: string, userId: string) {
  const { data, error } = await admin
    .from("pool_members")
    .select("role")
    .eq("pool_id", poolId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data || data.role !== "owner") return { ok: false as const, error: "Forbidden (owner only)" };
  return { ok: true as const };
}

export async function POST(
  req: Request,
  { params }: { params: { poolId: string } }
) {
  try {
    const poolId = String(params.poolId ?? "").trim();
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();

    if (!poolId) return NextResponse.json({ error: "Missing poolId" }, { status: 400 });
    if (!name || name.length < 2) {
      return NextResponse.json({ error: "Name must be at least 2 characters" }, { status: 400 });
    }
    if (name.length > 60) {
      return NextResponse.json({ error: "Name too long (max 60)" }, { status: 400 });
    }

    const accessToken =
      getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");

    if (!accessToken) {
      return NextResponse.json({ error: "Missing accessToken" }, { status: 401 });
    }

    const user = await getUserFromToken(accessToken);
    if (!user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const admin = supabaseAdmin();

    const ownerCheck = await assertOwner(admin, poolId, user.id);
    if (!ownerCheck.ok) return NextResponse.json({ error: ownerCheck.error }, { status: 403 });

    const { data: updated, error: upErr } = await admin
      .from("pools")
      .update({ name })
      .eq("id", poolId)
      .select("id,name")
      .maybeSingle();

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Pool not found" }, { status: 404 });

    return NextResponse.json({ ok: true, poolId: updated.id, name: updated.name });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
