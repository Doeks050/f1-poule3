"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ✅ BELANGRIJK: gebruik RELATIEVE import (geen @/)
// pas dit pad aan als jouw lib map anders staat
import { supabase } from "../../../../../lib/supabaseClient";

type BonusQuestion = {
  id: string;
  scope: "weekend" | "season";
  prompt: string;
  answer_kind: "boolean" | "text" | "number";
  options: any | null;
  is_active: boolean;
  created_at?: string;
};

type BonusSet = {
  id: string;
  pool_id: string;
  event_id: string;
  lock_at: string | null;
  created_at: string;
};

export default function BonusSection({
  poolId,
  eventId,
}: {
  poolId: string;
  eventId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [setRow, setSetRow] = useState<BonusSet | null>(null);
  const [questions, setQuestions] = useState<BonusQuestion[]>([]);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setMsg(null);

      const { data: sessionData, error: sesErr } = await supabase.auth.getSession();
      if (sesErr) {
        if (!cancelled) {
          setMsg(sesErr.message);
          setLoading(false);
        }
        return;
      }

      const token = sessionData?.session?.access_token;
      if (!token) {
        if (!cancelled) {
          setMsg("Je bent niet ingelogd.");
          setLoading(false);
        }
        return;
      }

      try {
        const res = await fetch(`/api/bonus/weekend-set?poolId=${poolId}&eventId=${eventId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load weekend bonus");

        if (!cancelled) {
          setSetRow(json.set ?? null);
          setQuestions(json.questions ?? []);
          setIsLocked(!!json.isLocked);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setMsg(e?.message || "Onbekende fout");
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [poolId, eventId]);

  const lockText = (() => {
    if (!setRow?.lock_at) return "Lock moment volgt zodra de eerste sessie bekend is.";
    const d = new Date(setRow.lock_at);
    return `Lockt op: ${d.toLocaleString()}`;
  })();

  return (
    <section
      style={{
        border: "1px solid #ddd",
        borderRadius: 14,
        padding: 16,
        marginTop: 12,
        background: "white",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Weekend bonusvragen</h2>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          3 vragen • 10 punten per goed antwoord
        </span>
      </div>

      <p style={{ marginTop: 8, marginBottom: 10, fontSize: 12, opacity: 0.75 }}>
        {lockText} • Je kunt aanpassen tot 5 minuten voor de eerste sessie van het weekend.
      </p>

      {loading && <p style={{ margin: 0 }}>Bonusvragen laden…</p>}

      {msg && (
        <p style={{ marginTop: 8, marginBottom: 0, color: "crimson" }}>
          {msg}
        </p>
      )}

      {!loading && !msg && (
        <>
          {questions.length === 0 ? (
            <p style={{ margin: 0 }}>
              Geen bonusvragen gevonden. (Check of er genoeg actieve weekend vragen in de bank staan.)
            </p>
          ) : (
            <ol style={{ marginTop: 10, marginBottom: 0, paddingLeft: 18 }}>
              {questions.map((q) => (
                <li key={q.id} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600 }}>{q.prompt}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Antwoord: ja/nee {isLocked ? "• (gelocked)" : "• (open)"}
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            Antwoorden invullen bouwen we hierna in.
            {" "}
            <Link href={`/pools/${poolId}`}>Terug naar pool</Link>
          </div>
        </>
      )}
    </section>
  );
}
