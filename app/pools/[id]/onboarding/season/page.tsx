"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";

type Q = {
  position: number;
  question_id: string;
  question_key: string;
  prompt: string;
  answer_kind: "boolean" | "text" | "number" | "driver" | "team";
};

// TODO: vervang/upgrade later via DB table (drivers/teams).
const DRIVERS_2026 = [
  { code: "VER", name: "Max Verstappen" },
  { code: "NOR", name: "Lando Norris" },
  { code: "LEC", name: "Charles Leclerc" },
  { code: "HAM", name: "Lewis Hamilton" },
  { code: "RUS", name: "George Russell" },
  { code: "PIA", name: "Oscar Piastri" },
];

const TEAMS_2026 = [
  { code: "RBR", name: "Red Bull" },
  { code: "MER", name: "Mercedes" },
  { code: "FER", name: "Ferrari" },
  { code: "MCL", name: "McLaren" },
  { code: "AUD", name: "Audi" },      // door jou gewenst
  { code: "CAD", name: "Cadillac" },  // door jou gewenst
];

const SEASON_YEAR = 2026;

export default function SeasonOnboardingPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const poolId = params.id;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({}); // key = question_key

  const driverOptions = useMemo(() => DRIVERS_2026, []);
  const teamOptions = useMemo(() => TEAMS_2026, []);

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
      setUserId(u.user.id);

      // 1) Als al ingevuld: skip direct naar pool
      const { data: existing, error: exErr } = await supabase
        .from("season_predictions")
        .select("id")
        .eq("pool_id", poolId)
        .eq("user_id", u.user.id)
        .eq("season_year", SEASON_YEAR)
        .maybeSingle();

      if (exErr) {
        setMsg(exErr.message);
        setLoading(false);
        return;
      }
      if (existing?.id) {
        router.replace(`/pools/${poolId}`);
        return;
      }

      // 2) Vragen ophalen uit season_bonus_set_questions + bonus_question_bank
      const { data: rows, error: qErr } = await supabase
        .from("season_bonus_set_questions")
        .select(
          `
          position,
          question_id,
          bonus_question_bank:question_id (
            question_key,
            prompt,
            answer_kind
          )
        `
        )
        .eq("season_year", SEASON_YEAR)
        .order("position", { ascending: true });

      if (qErr) {
        setMsg(qErr.message);
        setLoading(false);
        return;
      }

      const qs: Q[] =
        (rows ?? []).map((r: any) => ({
          position: r.position,
          question_id: r.question_id,
          question_key: r.bonus_question_bank?.question_key,
          prompt: r.bonus_question_bank?.prompt,
          answer_kind: r.bonus_question_bank?.answer_kind,
        }))?.filter((x: any) => x.question_key && x.prompt && x.answer_kind) ?? [];

      setQuestions(qs);
      setLoading(false);
    })();
  }, [router, poolId]);

  function setAnswer(question_key: string, value: any) {
    setAnswers((prev) => ({ ...prev, [question_key]: value }));
  }

  function isComplete() {
    return questions.every((q) => {
      const v = answers[q.question_key];
      return v !== undefined && v !== null && String(v).trim().length > 0;
    });
  }

  async function submit() {
    setMsg(null);

    if (!userId) {
      setMsg("Geen user. Log opnieuw in.");
      return;
    }
    if (!isComplete()) {
      setMsg("Beantwoord alle vragen.");
      return;
    }

    setSaving(true);

    const payload = {
      pool_id: poolId,
      user_id: userId,
      season_year: SEASON_YEAR,
      answers_json: answers,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("season_predictions")
      .upsert(payload, { onConflict: "pool_id,user_id,season_year" });

    setSaving(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    router.replace(`/pools/${poolId}`);
  }

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Season vragen</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Season vragen ({SEASON_YEAR})</h1>
      <p style={{ opacity: 0.8 }}>
        Vul deze éénmalig in. Daarna ga je door naar je pool.
      </p>

      {msg ? <p style={{ color: "crimson" }}>{msg}</p> : null}

      {questions.map((q) => (
        <div
          key={q.question_key}
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
            Vraag {q.position}
          </div>
          <div style={{ fontWeight: 800 }}>{q.prompt}</div>

          <div style={{ marginTop: 10 }}>
            {q.answer_kind === "driver" ? (
              <select
                value={answers[q.question_key] ?? ""}
                onChange={(e) => setAnswer(q.question_key, e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10 }}
              >
                <option value="">Kies een driver…</option>
                {driverOptions.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            ) : q.answer_kind === "team" ? (
              <select
                value={answers[q.question_key] ?? ""}
                onChange={(e) => setAnswer(q.question_key, e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10 }}
              >
                <option value="">Kies een team…</option>
                {teamOptions.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name} ({t.code})
                  </option>
                ))}
              </select>
            ) : q.answer_kind === "boolean" ? (
              <select
                value={answers[q.question_key] ?? ""}
                onChange={(e) => setAnswer(q.question_key, e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10 }}
              >
                <option value="">Kies…</option>
                <option value="true">Ja</option>
                <option value="false">Nee</option>
              </select>
            ) : (
              <input
                value={answers[q.question_key] ?? ""}
                onChange={(e) => setAnswer(q.question_key, e.target.value)}
                placeholder="Antwoord…"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10 }}
              />
            )}
          </div>
        </div>
      ))}

      <button
        onClick={submit}
        disabled={saving}
        style={{
          marginTop: 16,
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid #111",
          fontWeight: 900,
        }}
      >
        {saving ? "Opslaan…" : "Opslaan & doorgaan →"}
      </button>
    </main>
  );
}
