"use client";

import Link from "next/link";

type Row = {
  label: string;
  pointsPerCorrect: number;
  maxPoints: number;
};

export default function PoolRulesPage() {
  const rows: Row[] = [
    { label: "Free Practice (FP1/FP2/FP3)", pointsPerCorrect: 1, maxPoints: 10 },
    { label: "Qualifying", pointsPerCorrect: 3, maxPoints: 30 },
    { label: "Sprint Qualifying", pointsPerCorrect: 3, maxPoints: 30 },
    { label: "Sprint Race", pointsPerCorrect: 4, maxPoints: 40 },
    { label: "Race", pointsPerCorrect: 5, maxPoints: 50 },
  ];

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <Link href="..">← Terug</Link>

      <h1 style={{ marginTop: 10, marginBottom: 8 }}>Regels & puntenscoring</h1>
      <p style={{ marginTop: 0, opacity: 0.85, lineHeight: 1.6 }}>
        In deze poule voorspel je <strong>altijd de volledige Top 10</strong> per sessie. Je
        krijgt punten voor elke coureur die je op de <strong>juiste positie</strong> hebt
        gezet. De puntwaardes hieronder komen direct overeen met de scoring-logica die de app
        gebruikt.
      </p>

      {/* Lock info */}
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 16,
          marginTop: 12,
          background: "white",
          boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>Voorspellingen aanpassen & lock</h2>
        <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
          <li>
            Je kunt je voorspelling invullen en aanpassen tot <strong>5 minuten vóór</strong>{" "}
            de start van een sessie.
          </li>
          <li>
            Na het lock-moment is de sessie <strong>gesloten</strong> en kun je je voorspelling
            niet meer wijzigen.
          </li>
          <li>
            Voorspellingen zonder volledige Top 10 zijn <strong>niet geldig</strong>.
          </li>
        </ul>
      </section>

      {/* Table */}
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 16,
          marginTop: 16,
          background: "white",
          boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Punten per sessie</h2>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>
                  Sessie
                </th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>
                  Punten per juiste positie
                </th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>
                  Max punten (Top 10)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.label}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                    {r.pointsPerCorrect}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.maxPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12, opacity: 0.7 }}>
          Let op: je scoort alleen op posities die exact matchen met de uitslag (Top 10).
        </p>
      </section>

      {/* Weekend types */}
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 16,
          marginTop: 16,
          background: "white",
          boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Sprint weekend vs standaard weekend</h2>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Standaard weekend</div>
            <div style={{ opacity: 0.85, lineHeight: 1.6 }}>
              Sessies: <strong>FP1, FP2, FP3, Quali, Race</strong>
            </div>
            <div style={{ marginTop: 8, opacity: 0.85 }}>
              Maximaal te scoren (als alle sessies aanwezig zijn): <strong>110 punten</strong>.
            </div>
          </div>

          <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Sprint weekend</div>
            <div style={{ opacity: 0.85, lineHeight: 1.6 }}>
              Sessies: <strong>FP1, Sprint Quali, Sprint Race, Quali, Race</strong>
            </div>
            <div style={{ marginTop: 8, opacity: 0.85 }}>
              Maximaal te scoren (als alle sessies aanwezig zijn): <strong>160 punten</strong>.
            </div>
          </div>
        </div>

        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, opacity: 0.7 }}>
          De exacte sessies per event komen uit de kalender-import. De puntwaarde per sessietype
          blijft altijd zoals hierboven.
        </p>
      </section>

      {/* BONUSVRAGEN (toekomstig onderdeel) */}
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 16,
          marginTop: 16,
          background: "white",
          boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Bonusvragen</h2>

        <p style={{ marginTop: 0, opacity: 0.85, lineHeight: 1.6 }}>
          Naast de sessie-voorspellingen komen er bonusvragen. Dit zijn extra vragen waarmee je
          aanvullende punten kunt verdienen.
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          {/* Seizoensbonus */}
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Seizoensbonus (3 vaste vragen)</div>

            <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
              <li>
                Je vult <strong>3 bonusvragen</strong> in vóór de start van het seizoen.
              </li>
              <li>
                Deze antwoorden worden <strong>gelockt</strong> zodra de{" "}
                <strong>allereerste sessie van het seizoen</strong> begint.
              </li>
              <li>
                Daarna blijven ze <strong>gelockt tot het einde van het seizoen</strong>.
              </li>
            </ul>

            <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12, opacity: 0.7 }}>
              (Wordt later gebouwd: éénmalige invulperiode + seizoenslock.)
            </p>
          </div>

          {/* Weekendbonus */}
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              Weekendbonus (per weekend 3 random vragen)
            </div>

            <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
              <li>
                Per raceweekend krijg je <strong>3 random bonusvragen</strong>.
              </li>
              <li>
                Je kunt ze invullen tot de start van de <strong>eerste sessie van dat weekend</strong>.
              </li>
              <li>
                Bij start van die eerste sessie worden ze <strong>gelockt</strong> en blijven gelockt
                tot het weekend voorbij is.
              </li>
            </ul>

            <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12, opacity: 0.7 }}>
              (Wordt later gebouwd: vraagselectie per event + weekend-lock op de eerste sessie.)
            </p>
          </div>
        </div>

        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, opacity: 0.7 }}>
          Let op: de exacte puntverdeling van bonusvragen voegen we toe zodra de bonusvragen-feature gebouwd is.
        </p>
      </section>
    </main>
  );
}
