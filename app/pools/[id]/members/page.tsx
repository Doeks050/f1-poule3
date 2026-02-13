"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";

type MemberRow = {
  user_id: string;
  created_at?: string;
};

type PoolRow = {
  id: string;
  name: string;
};

type ProfileRow = {
  id: string;
  display_name: string;
};

export default function MembersPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const poolId = (params?.id ?? "") as string;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [pool, setPool] = useState<PoolRow | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});

  const isUuid = useMemo(() => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(poolId);
  }, [poolId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      // 1) auth
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) {
        setMsg(uErr.message);
        setLoading(false);
        return;
      }
      if (!u.user) {
        router.replace("/login");
        return;
      }
      const user = u.user;

      // 2) username gate
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();

      if (profErr) {
        setMsg(profErr.message);
        setLoading(false);
        return;
      }
      if (!prof?.display_name) {
        router.replace("/onboarding/username");
        return;
      }

      // 3) poolId validatie
      if (!poolId || !isUuid) {
        setMsg("Ongeldige pool id.");
        setLoading(false);
        return;
      }

      // 4) membership check (invite-only)
      const { data: membership, error: memErr } = await supabase
        .from("pool_members")
        .select("pool_id,user_id")
        .eq("pool_id", poolId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (memErr) {
        setMsg(memErr.message);
        setLoading(false);
        return;
      }
      if (!membership) {
        router.replace("/pools");
        return;
      }

      // 5) pool naam
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

      // 6) members lijst
      const { data: m, error: mErr } = await supabase
        .from("pool_members")
        .select("user_id,created_at")
        .eq("pool_id", poolId)
        .order("created_at", { ascending: true });

      if (mErr) {
        setMsg(mErr.message);
        setLoading(false);
        return;
      }

      const list = (m ?? []) as MemberRow[];
      setMembers(list);

      // 7) haal display_names uit profiles
      const ids = Array.from(new Set(list.map((x) => x.user_id))).filter(Boolean);

      if (ids.length === 0) {
        setProfilesById({});
        setLoading(false);
        return;
      }

      const { data: pr, error: prErr } = await supabase
        .from("profiles")
        .select("id,display_name")
        .in("id", ids);

      if (prErr) {
        // Niet hard failen; we tonen dan fallback
        setProfilesById({});
        setLoading(false);
        return;
      }

      const map: Record<string, ProfileRow> = {};
      for (const row of (pr ?? []) as ProfileRow[]) map[row.id] = row;
      setProfilesById(map);

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
          {members.map((m, idx) => {
            const dn = profilesById[m.user_id]?.display_name?.trim();
            return (
              <li key={`${m.user_id}_${idx}`} style={{ marginBottom: 8 }}>
                <strong>#{idx + 1}</strong> — {dn ? dn : "(geen username)"}{" "}
                <span style={{ opacity: 0.6, fontSize: 12 }}>({m.user_id.slice(0, 8)}…)</span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
