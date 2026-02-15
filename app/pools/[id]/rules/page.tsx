"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";
import { pointsPerCorrectPosition } from "../../../../lib/scoring";

type PoolRow = { id: string; name: string };

type Row = {
  label: string;
  keys: string[];
  ppc: number;
  max: number;
};

function buildScoringRows(): Row[] {
  // We gebruiken exact dezelfde keys als je scoring.ts accepteert.
  // Voor de uitleg tonen we 1 “canonical” key per sessie, maar vermelden aliases.
  const rows: Row[] = [
    { label: "Free Practice (FP1/FP2/FP3)", keys: ["fp1", "fp2", "fp3"], ppc: pointsPerCorrectPosition("fp1"), max: 10 * pointsPerCorrectPosition("fp1") },
    { label: "Qualifying", keys: ["quali", "q"], ppc: pointsPerCorrectPosition("quali"), max: 10 * pointsPerCorrectPosition("quali") },
    { label: "Sprint Qualifying", keys: ["sprint_quali", "sprintquali", "sq"], ppc: pointsPerCorrectPosition("sprint_quali"), max: 10 * pointsPerCorrectPosition("sprint_quali") },
    { label: "Sprint Race", keys: ["sprint_race", "sprintrace", "sr"], ppc: pointsPerCorrectPosition("sprint_race"), max: 10 * pointsPerCorrectPosition("sprint_race") },
    { label: "Race", keys: ["race", "r"], ppc: pointsPerCorrectPosition("race"), max: 10 * pointsPerCorrectPosition("race") },
  ];

  // Filter eventuele 0-rows (veiligheid)
  return rows.filter((r) => r.ppc > 0);
}

export default function PoolRulesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const poolId = (params?.id ?? "") as string;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolRow | null>(null);

  const isUuid = useMemo(() => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(poolId);
  }, [poolId]);

  const rows = useMemo(() => buildScoringRows(), []);

  // Max per weekend (uitleg): we geven ranges omdat niet elk weekend dezelfde sessies hoeft te hebben.
  // Standaard: (FP1 + FP2 + FP3 + Quali + Race) = 10+10+10+30+50 = 110
  // Sprint: (FP1 + SprintQuali + SprintRace + Quali + Race) = 10+30+40+30+50 = 160
  const maxStandardWeekend = 10 + 10 + 10 + 30 + 50; // 110
  const maxSprintWeekend = 10 + 30 + 40 + 30 + 50;   // 160

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

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

      if (!poolId || !isUuid) {
        setMsg("Ongeldige pool id.");
        setLoading(false);
        return;
      }

      // membership check
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

      // pool naam
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
    <main style={{ padding: 16, maxWidth: 900 }}>
      <Link href={`/pools/${poolId}`}>← Terug naar pool</Link>

      <h1 style={{ marginTop: 10, marginBottom: 6 }}>Regels & puntenscoring</h1>
      <p style={{ opacity: 0.8, marginTop: 0 }}>{pool?.name ?? "Pool"}</p>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 14,
              padding: 16,
              background: "white",
              boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
              marginTop: 12,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Hoe scoren werkt</h2>

            <ul style={{ paddingLeft: 18, marginTop: 8 }}>
              <li>
                Je voorspelt <strong>altijd een Top 10 per sessie</strong>.
              </li>
              <li>
                Alleen een <strong>volledige Top 10</strong> telt. Als je geen 10 posities invult (of alles leeg laat), is die sessie <strong>0 punten</strong>.
              </li>
              <li>
                Score per sessie: <strong>(# juiste posities) × (punten per juiste positie)</strong>.
              </li>
              <li>
                “Juiste positie” betekent: jouw P1 = echte P1, jouw P2 = echte P2, etc. (dus exact match per plek).
              </li>
            </ul>
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 14,
              padding: 16,
              background: "white",
              marginTop: 14,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Punten per sessie</h2>

            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 650 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "10px 8px" }}>Sessie</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "10px 8px" }}>Punten per juiste positie</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "10px 8px" }}>Max punten (Top 10)</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "10px 8px" }}>Session keys (aliases)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: "10px 8px", fontWeight: 700 }}>{r.label}</td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: "10px 8px" }}>{r.ppc}</td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: "10px 8px" }}>{r.max}</td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: "10px 8px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                        {r.keys.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
              Let op: deze waardes komen direct uit dezelfde scoring-logica die de app gebruikt.
            </p>
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 14,
              padding: 16,
              background: "white",
              marginTop: 14,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Sprint weekend vs standaard weekend</h2>

            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 800 }}>Standaard weekend</div>
                <div style={{ opacity: 0.85 }}>
                  Meestal: <strong>FP1, FP2, FP3, Quali, Race</strong>
                </div>
                <div style={{ marginTop: 4, opacity: 0.85 }}>
                  Maximaal te scoren (als alle sessies aanwezig zijn): <strong>{maxStandardWeekend}</strong> punten.
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 800 }}>Sprint weekend</div>
                <div style={{ opacity: 0.85 }}>
                  Meestal: <strong>FP1, Sprint Quali, Sprint Race, Quali, Race</strong>
                </div>
                <div style={{ marginTop: 4, opacity: 0.85 }}>
                  Maximaal te scoren (als alle sessies aanwezig zijn): <strong>{maxSprintWeekend}</strong> punten.
                </div>
              </div>

              <div style={{ fontSize: 12, opacity: 0.7 }}>
                De exacte sessies per event komen uit de kalender-import. De puntwaarde per sessietype blijft altijd zoals hierboven.
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
