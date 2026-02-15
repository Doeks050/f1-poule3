"use client";

import Link from "next/link";

// Deze pagina is puur informatief (geen Supabase calls nodig).
// Route: /pools/[id]/rules  (of hoe jij 'm hebt aangemaakt)

export default function PoolRulesPage() {
  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <Link href="..">← Terug naar pool</Link>

      <h1 style={{ marginTop: 12, marginBottom: 8 }}>Regels & puntenscoring</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Hier lees je hoe voorspellingen werken en hoeveel punten je per sessie kunt
        verdienen.
      </p>

      {/* Belangrijkste regels */}
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 16,
          marginTop: 14,
          background: "white",
          boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>Belangrijk</h2>

        <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
          <li>
            Je voorspelt <strong>altijd de volledige Top 10</strong>. Als je geen
            Top 10 invult, is je voorspelling <strong>niet geldig</strong> en scoor je{" "}
            <strong>0 punten</strong>.
          </li>
          <li>
            Punten krijg je alleen voor coureurs die je op de{" "}
            <strong>exacte juiste positie</strong> zet (positie 1 t/m 10).
          </li>
          <li>
            Je kunt je voorspellingen{" "}
            <strong>invullen en aanpassen tot 5 minuten vóór</strong> de start van
            een sessie. Daarna wordt de sessie <strong>gelockt</strong>.
          </li>
        </ul>

        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, opacity: 0.7 }}>
          Let op: lock-tijd = starttijd van de sessie minus 5 minuten.
        </p>
      </section>

      {/* Puntentabel */}
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
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 520,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 10px",
                    borderBottom: "1px solid #eee",
                    fontSize: 13,
                    opacity: 0.9,
                  }}
                >
                  Sessie
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 10px",
                    borderBottom: "1px solid #eee",
                    fontSize: 13,
                    opacity: 0.9,
                  }}
                >
                  Punten per juiste positie
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 10px",
                    borderBottom: "1px solid #eee",
                    fontSize: 13,
                    opacity: 0.9,
                  }}
                >
                  Max punten (Top 10)
                </th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  Free Practice (FP1/FP2/FP3)
                </td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  1
                </td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  10
                </td>
              </tr>

              <tr>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  Qualifying
                </td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  3
                </td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  30
                </td>
              </tr>

              <tr>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  Sprint Qualifying
                </td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  3
                </td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  30
                </td>
              </tr>

              <tr>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  Sprint Race
                </td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  4
                </td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f2f2f2" }}>
                  40
                </td>
              </tr>

              <tr>
                <td style={{ padding: "10px 10px" }}>Race</td>
                <td style={{ padding: "10px 10px" }}>5</td>
                <td style={{ padding: "10px 10px" }}>50</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12, opacity: 0.7 }}>
          Deze puntwaardes komen direct overeen met de scoring-logica in de app.
        </p>
      </section>

      {/* Weekend formats */}
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
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>
          Sprint weekend vs standaard weekend
        </h2>

        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Standaard weekend</div>
            <div style={{ opacity: 0.9, lineHeight: 1.6 }}>
              FP1, FP2, FP3, Qualifying en Race.
            </div>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
              Maximaal te behalen (als alle sessies aanwezig zijn):{" "}
              <strong>110 punten</strong>.
            </div>
          </div>

          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Sprint weekend</div>
            <div style={{ opacity: 0.9, lineHeight: 1.6 }}>
              FP1, Sprint Qualifying, Sprint Race, Qualifying en Race.
            </div>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
              Maximaal te behalen (als alle sessies aanwezig zijn):{" "}
              <strong>160 punten</strong>.
            </div>
          </div>
        </div>

        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, opacity: 0.7 }}>
          Welke sessies bij een event horen komt uit de kalender-import. De punten per
          sessietype blijven hetzelfde.
        </p>
      </section>
    </main>
  );
}
