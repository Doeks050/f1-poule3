"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../../lib/supabaseClient";

type BonusQuestion = {
  id: string;
  scope: "weekend" | "season";
  prompt: string;
  answer_kind: "boolean" | "text" | "number";
  options: any | null;
  is_active: boolean;
};

type BonusSet = {
  id: string;
  pool_id: string;
  event_id: string;
  lock_at: string | null;
  created_at: string;
};

type AnswersMap = Record<string, boolean>;

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

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

  const [answers, setAnswers] = useState<AnswersMap>({});
  const [savingId, setSavingId] = useState<string | null>(null);

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
        const res = await fetch(
          `/api/bonus/weekend-set?poolId=${poolId}&eventId=${eventId}`,
          {
            headers: { authorization: `Bearer ${token}` },
          }
        );

        const json = await safeJson(res);
        if (!res.ok) {
          throw new Error(json?.error || json?._raw || `Failed to load weekend bonus (${res.status})`);
        }

        if (!cancelled) {
          setSetRow(json?.set ?? null);
          setQuestions(json?.questions ?? []);
          setIsLocked(!!json?.isLocked);
          setAnswers((json?.answers ?? {}) as AnswersMap);
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

  const lockText = useMemo(() => {
    if (!setRow?.lock_at) return "Lock moment volgt zodra de eerste sessie bekend is.";
    const d = new Date(setRow.lock_at);
    return `Lockt op: ${d.toLocaleString()}`;
  }, [setRow?.lock_at]);

  async function saveAnswer(questionId: string, value: boolean | null) {
    setMsg(null);
    setSavingId(questionId);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      setMsg("Je bent niet ingelogd.");
      setSavingId(null);
      return;
    }

    try {
      // ✅ juiste route + juiste keys (snake_case)
      const res = await fetch("/api/bonus/weekend-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pool_id: poolId,
          event_id: eventId,
          question_id: questionId,
          answer_json: value, // true/false/null (null = wissen)
        }),
      });

      const json = await safeJson(res);
      if (!res.ok) {
        throw new Error(json?.error || json?._raw || `Opslaan mislukt (${res.status})`);
      }

      // Server hoeft geen answers terug te sturen; wij houden local state als UI-state.
    } catch (e: any) {
      setMsg(e?.message || "Onbekende fout");
    } finally {
      setSavingId(null);
    }
  }

  function setLocalAndSave(questionId: string, value: boolean) {
    // Optimistisch updaten
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    saveAnswer(questionId, value);
  }

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
          {questions.length || 0} vragen • 5 punten per goed antwoord
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
              {questions.map((q) => {
                const v = answers[q.id]; // true/false/undefined
                const disabled = isLocked || savingId === q.id;

                return (
                  <li key={q.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600 }}>{q.prompt}</div>

                    <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
                      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="radio"
                          name={`q_${q.id}`}
                          checked={v === true}
                          disabled={disabled}
                          onChange={() => setLocalAndSave(q.id, true)}
                        />
                        Ja
                      </label>

                      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="radio"
                          name={`q_${q.id}`}
                          checked={v === false}
                          disabled={disabled}
                          onChange={() => setLocalAndSave(q.id, false)}
                        />
                        Nee
                      </label>

                      {!isLocked && v !== undefined && (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            // remove answer locally
                            setAnswers((prev) => {
                              const copy = { ...prev };
                              delete copy[q.id];
                              return copy;
                            });
                            // ✅ send null to clear
                            saveAnswer(q.id, null);
                          }}
                          style={{
                            marginLeft: 6,
                            padding: "6px 10px",
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            background: "white",
                            cursor: "pointer",
                          }}
                        >
                          Wis
                        </button>
                      )}

                      <span style={{ fontSize: 12, opacity: 0.7 }}>
                        {isLocked ? "gelocked" : "open"}
                        {savingId === q.id ? " • opslaan…" : ""}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            <Link href={`/pools/${poolId}`}>Terug naar pool</Link>
          </div>
        </>
      )}
    </section>
  );
}
