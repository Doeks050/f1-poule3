"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";

type PoolRow = {
  id: string;
  name: string;
};

export default function PoolRulesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const poolId = (params?.id ?? "") as string;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolRow | null>(null);

  const isUuid = useMemo(() => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      poolId
    );
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
      const { data: myProf, error: myProfErr } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();

      if (myProfErr) {
        setMsg(myProfErr.message);
        setLoading(false);
        return;
      }
      if (!myProf?.display_name) {
        router.replace("/onboarding/username");
        return;
      }

      // 3) poolId validatie
      if (!poolId || !isUuid) {
        setMsg("Ongeldige pool id.");
        setLoading(false);
        return;
      }

      // 4) membership check
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
      setLoading(false);
    })();
  }, [router, poolId, isUuid]);

  return (
    <main style={{ padding: 16, maxWidth: 820 }}>
      <Link href={`/pools/${poolId}`}>← Terug naar pool</Link>

      <h1 style={{ marginTop: 10 }}>Regels & Puntenscoring</h1>
      <p style={{ opacity: 0.8 }}>{pool?.name ?? "Pool"}</p>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <div
          style={{
            marginTop: 14,
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 14,
            background: "white",
            lineHeight: 1.6,
          }}
        >
          <h2 style={{ marginTop: 0 }}>⏱ Lock regels</h2>
          <ul>
            <li>Voorspellingen sluiten <strong>5 minuten vóór start</strong> (lock_at).</li>
            <li>Na lock kun je niet meer aanpassen.</li>
          </ul>

          <h2>🏁 Puntenscoring</h2>
          <p style={{ opacity: 0.85 }}>
            Hieronder staat de standaard uitleg. (Later kunnen we dit 1-op-1 koppelen aan je scoring logica in code.)
          </p>

          <h3>Race</h3>
          <ul>
            <li>Exacte positie juist = punten volgens het gekozen schema.</li>
            <li>Juiste coureur maar verkeerde positie = (optioneel) partial points.</li>
          </ul>

          <h3>Qualifying</h3>
          <ul>
            <li>Pole correct = bonuspunten (optioneel).</li>
            <li>Top 3 correct = bonuspunten (optioneel).</li>
          </ul>

          <h3>Sprint (als sprint weekend)</h3>
          <ul>
            <li>Extra sessies tellen mee volgens sprint-regels.</li>
          </ul>

          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
            Tip: als jij “event_points” / “scoring.ts” als bron van waarheid wil gebruiken,
            kunnen we deze pagina automatisch laten genereren.
          </div>
        </div>
      )}
    </main>
  );
}
