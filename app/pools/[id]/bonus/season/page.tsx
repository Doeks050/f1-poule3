"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type QRow = {
  id: string;
  question: string;
  answer_type: string;
  answer: any;
  updated_at?: string | null;
};

function fmtLocal(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SeasonBonusPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const poolId = (params?.id ?? "") as string;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [lockAt, setLockAt] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const [questions, setQuestions] = useState<QRow[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const backHref = useMemo(() => `/pools/${poolId}`, [poolId]);

  async function load() {
    setLoading(true);
    setMsg(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }

    const res = await fetch(`/api/pools/${poolId}/bonus/season`, {
      headers: { authorization: `Bearer ${token}` },
    });

    const raw = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(raw);
    } catch {}

    if (!res.ok) {
      setLoading(false);
      setMsg(json?.error ?? raw);
      return;
    }

    setLockAt(json?.lockAt ?? null);
    setLocked(Boolean(json?.locked));
    const qs = (json?.questions ?? []) as QRow[];
    setQuestions(qs);

    const map: Record<string, any> = {};
    for (const q of qs) map[q.id] = q.answer ?? "";
    setAnswers(map);

    setLoading(false);
  }

  useEffect(() => {
    if (!poolId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId]);

  async function save() {
    setMsg(null);
    setSaving(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSaving(false);
      router.replace("/login");
      return;
    }

    const payload = {
      answers: questions.map((q) => ({
        question_id: q.id,
        answer: answers[q.id],
      })),
    };

    const res = await fetch(`/api/pools/${poolId}/bonus/season`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(raw);
    } catch {}

    setSaving(false);

    if (!res.ok) {
      setMsg(json?.error ?? raw);
      return;
    }

    setMsg("✅ Opgeslagen.");
    setTimeout(() => setMsg(null), 1500);
    load();
  }

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Seizoensbonus</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <Link href={backHref}>← Terug naar pool</Link>

      <h1 style={{ marginTop: 12 }}>Seizoensbonus</h1>
      <p style={{ opacity: 0.8, marginTop: 6 }}>
        Vul deze 3 bonusvragen in vóór de allereerste sessie van het seizoen start.
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, marginTop: 12 }}>
        <div>
          <strong>Status:</strong>{" "}
          {locked ? "🔒 Gelockt" : "🔓 Open"}
        </div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
          Lock-moment: {lockAt ? fmtLocal(lockAt) : "(nog geen sessies gevonden)"}
        </div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
          Je kunt antwoorden aanpassen tot <strong>5 minuten</strong> vóór de start van de eerste sessie.
        </div>
      </div>

      {msg ? <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p> : null}

      {questions.length === 0 ? (
        <p style={{ marginTop: 14 }}>Nog geen seizoensbonus vragen. (Admin moet ze toevoegen in bonus_questions)</p>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {questions.map((q, idx) => (
            <div key={q.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 800 }}>
                Bonusvraag {idx + 1}
              </div>
              <div style={{ marginTop: 6 }}>{q.question}</div>

              <input
                value={String(answers[q.id] ?? "")}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                disabled={locked}
                placeholder="Jouw antwoord…"
                style={{ marginTop: 10, width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc" }}
              />

              {q.updated_at ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                  Laatst opgeslagen: {fmtLocal(q.updated_at)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <button onClick={save} disabled={saving || locked || questions.length === 0} style={{ padding: "10px 12px", borderRadius: 10 }}>
          {saving ? "Opslaan…" : "Opslaan"}
        </button>
        <button onClick={load} disabled={saving} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Ververs
        </button>
      </div>
    </main>
  );
}
