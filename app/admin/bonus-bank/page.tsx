"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type Question = {
  id: string;
  question: string;
};

export default function BonusBankPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`/api/bonus-questions?accessToken=${token}`);
  const json = await res.json();
  setQuestions(json.questions ?? []);
}


  useEffect(() => {
    load();
  }, []);

  async function addQuestion() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`/api/bonus-questions?accessToken=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: newQuestion }),
  });

    if (!res.ok) {
      setMsg("Toevoegen mislukt");
      setLoading(false);
      return;
    }

    setNewQuestion("");
    await load();
    setLoading(false);
  }

  async function deleteQuestion(id: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  await fetch(`/api/bonus-questions/${id}?accessToken=${token}`, {
    method: "DELETE",
  });

  await load();
}

  return (
    <main style={{ padding: 20, maxWidth: 800 }}>
      <h1>Weekend Bonusvragen Bank</h1>

      <div style={{ marginBottom: 20 }}>
        <input
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          placeholder="Nieuwe ja/nee vraag..."
          style={{ width: "70%", padding: 8 }}
        />
        <button onClick={addQuestion} disabled={loading}>
          {loading ? "Toevoegen…" : "Toevoegen"}
        </button>
      </div>

      <ul>
        {questions.map((q) => (
          <li key={q.id} style={{ marginBottom: 8 }}>
            {q.question}
            <button
              style={{ marginLeft: 10 }}
              onClick={() => deleteQuestion(q.id)}
            >
              Verwijder
            </button>
          </li>
        ))}
      </ul>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}
    </main>
  );
}
