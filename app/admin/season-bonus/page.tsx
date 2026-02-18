"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type SeasonQuestion = {
  id: string;
  season_year: number;
  question_key: string;
  question_text: string;
  points: number;
};

type OfficialAnswer = {
  question_key: string;
  correct_answer: boolean | null;
  is_resolved: boolean;
};

export default function SeasonBonusAdminPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [seasonYear, setSeasonYear] = useState(2026);

  const [questions, setQuestions] = useState<SeasonQuestion[]>([]);
  const [official, setOfficial] = useState<Record<string, OfficialAnswer>>(
    {}
  );

  const [msg, setMsg] = useState<string | null>(null);

  // ===============================
  // INIT
  // ===============================
  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        setLoading(false);
        return;
      }

      const { data: adminRow } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (!adminRow) {
        setLoading(false);
        return;
      }

      setIsAdmin(true);

      await loadData(seasonYear);

      setLoading(false);
    })();
  }, [seasonYear]);

  async function loadData(year: number) {
    // Questions
    const { data: qRows } = await supabase
      .from("season_questions")
      .select("*")
      .eq("season_year", year)
      .order("created_at", { ascending: true });

    setQuestions(qRows ?? []);

    // Official answers
    const { data: oRows } = await supabase
      .from("season_official_answers")
      .select("*")
      .eq("season_year", year);

    const map: Record<string, OfficialAnswer> = {};
    (oRows ?? []).forEach((row) => {
      map[row.question_key] = row;
    });

    setOfficial(map);
  }

  // ===============================
  // SAVE ANSWER
  // ===============================
  async function setAnswer(
    question: SeasonQuestion,
    value: boolean
  ) {
    setMsg(null);

    const { data: sessionData } =
      await supabase.auth.getSession();

    const token = sessionData.session?.access_token;
    if (!token) {
      setMsg("Geen geldige sessie.");
      return;
    }

    const { error } = await supabase
      .from("season_official_answers")
      .upsert({
        season_year: seasonYear,
        question_key: question.question_key,
        correct_answer: value,
        is_resolved: true,
        resolved_at: new Date().toISOString(),
        created_by: sessionData.session.user.id,
      });

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("✅ Antwoord opgeslagen.");
    await loadData(seasonYear);
  }

  // ===============================
  // UI
  // ===============================
  if (loading) {
    return <div style={{ padding: 20 }}>Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 20 }}>
        Geen toegang.
      </div>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ marginBottom: 20 }}>
        Season Bonus Admin
      </h1>

      <div style={{ marginBottom: 20 }}>
        <label>Seizoen: </label>
        <input
          type="number"
          value={seasonYear}
          onChange={(e) =>
            setSeasonYear(Number(e.target.value))
          }
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #ccc",
            width: 120,
          }}
        />
      </div>

      {msg && (
        <div
          style={{
            marginBottom: 16,
            color: "green",
            fontWeight: 600,
          }}
        >
          {msg}
        </div>
      )}

      {questions.length === 0 ? (
        <div>Geen season vragen gevonden.</div>
      ) : (
        questions.map((q) => {
          const current =
            official[q.question_key];

          return (
            <div
              key={q.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 16,
                marginBottom: 16,
                background: "white",
                boxShadow:
                  "0 4px 14px rgba(0,0,0,0.05)",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {q.question_text}
              </div>

              <div
                style={{
                  fontSize: 13,
                  opacity: 0.6,
                  marginBottom: 12,
                }}
              >
                {q.points} punten
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() =>
                    setAnswer(q, true)
                  }
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border:
                      current?.correct_answer === true
                        ? "2px solid green"
                        : "1px solid #ccc",
                    background:
                      current?.correct_answer === true
                        ? "#e6ffe6"
                        : "white",
                    cursor: "pointer",
                  }}
                >
                  YES
                </button>

                <button
                  onClick={() =>
                    setAnswer(q, false)
                  }
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border:
                      current?.correct_answer === false
                        ? "2px solid red"
                        : "1px solid #ccc",
                    background:
                      current?.correct_answer === false
                        ? "#ffe6e6"
                        : "white",
                    cursor: "pointer",
                  }}
                >
                  NO
                </button>
              </div>

              {current?.is_resolved && (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    opacity: 0.6,
                  }}
                >
                  Afgerond
                </div>
              )}
            </div>
          );
        })
      )}
    </main>
  );
}
