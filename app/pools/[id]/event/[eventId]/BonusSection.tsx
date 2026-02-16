"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../../../lib/supabaseClient";

type BonusSectionProps = {
  poolId: string;
  eventId: string;
};

export default function BonusSection({ poolId, eventId }: BonusSectionProps) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMsg(null);

      try {
        // tijdelijke sanity check: alleen zodat build + runtime werkt
        const { data, error } = await supabase
          .from("pool_event_bonus_sets")
          .select("id")
          .eq("pool_id", poolId)
          .eq("event_id", eventId)
          .maybeSingle();

        if (error) throw error;
        if (!cancelled) {
          // later vullen we hier de echte UI/vragen
          setMsg(data ? "Bonus set gevonden ✅" : "Nog geen bonus set voor dit weekend.");
        }
      } catch (e: any) {
        if (!cancelled) setMsg(e?.message ?? "Onbekende fout");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (poolId && eventId) load();
    return () => {
      cancelled = true;
    };
  }, [poolId, eventId]);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 16, marginTop: 14 }}>
      <h2 style={{ marginTop: 0 }}>Weekend Bonusvragen</h2>
      {loading ? <p>Loading…</p> : <p style={{ opacity: 0.85 }}>{msg}</p>}
    </div>
  );
}
