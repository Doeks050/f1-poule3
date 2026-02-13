"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";

type MemberRow = {
  user_id: string;
  display_name: string | null;
  created_at?: string;
};

type PoolRow = {
  id: string;
  name: string;
};

export default function MembersPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const poolId = (params?.id ?? "") as string;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [pool, setPool] = useState<PoolRow | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);

  const isUuid = useMemo(() => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(poolId);
  }, [poolId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        router.replace("/login");
        return;
      }

      if (!poolId || !isUuid) {
        setMsg("Ongeldige pool id.");
        setLoading(false);
        return;
      }

      const { data: p, error: pErr } = await supabase
        .from("pools")
        .select("id,name")
        .eq("id", poolId)
        .maybeSingle();

      if (pErr) {
        setMsg(pErr.message);
        setLoading(false);
        return;
      }

      setPool((p ?? null) as PoolRow | null);

      const { data: m, error: mErr } = await supabase
        .from("pool_members")
        .select("user_id,display_name,created_at")
        .eq("pool_id", poolId)
        .order("created_at", { ascending: true });

      if (mErr) {
        setMsg(mErr.message);
        setLoading(false);
        return;
      }

      setMembers((m ?? []) as MemberRow[]);
      setLoading(false);
    })();
  }, [router, poolId, isUuid]);

  return (
    <main style={{ padding: 16, maxWidth: 720 }}>
      <Link href={`/pools/${poolId}`}>← Terug naar pool</Link>

      <h1 style={{ marginTop: 10 }}>Members</h1>
      <p style={{ opacity: 0.8 }}>{pool?.name ?? "Pool"}</p>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : members.length === 0 ? (
        <p>Nog geen members.</p>
      ) : (
        <ul style={{ paddingLeft: 18 }}>
          {members.map((m, idx) => (
            <li key={m.user_id} style={{ marginBottom: 8 }}>
              <strong>#{idx + 1}</strong> — {m.display_name?.trim() ? m.display_name : "(geen username)"}{" "}
              <span style={{ opacity: 0.6, fontSize: 12 }}>({m.user_id.slice(0, 8)}…)</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
