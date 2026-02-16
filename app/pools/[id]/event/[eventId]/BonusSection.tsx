"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

export default function BonusSection() {
  const params = useParams<{ id: string; eventId: string }>();
  const poolId = params.id;
  const eventId = params.eventId;

  const [bonus, setBonus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function ensureBonus() {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      const res = await fetch(
        `/api/pools/${poolId}/events/${eventId}/ensure-weekend-bonus`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
          },
        }
      );

      const json = await res.json();

      if (!res.ok) {
        setError(json?.error ?? "Bonus ensure failed");
        return;
      }

      setBonus(json);
    }

    ensureBonus();
  }, [poolId, eventId]);

  return (
    <div style={{ marginTop: 20 }}>
      <h2>Weekend Bonusvragen</h2>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {!bonus && !error && <p>Laden...</p>}

      {bonus && (
        <ol>
          {bonus.questions.map((q: any) => (
            <li key={q.id}>{q.prompt}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
