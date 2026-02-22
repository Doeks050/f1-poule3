"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { F1_DRIVERS_2026 } from "../../../lib/f1_2026";

type BonusQuestionRow = {
  id: string;
  scope: "season" | "weekend";
  prompt: string;
  answer_kind: "boolean" | "text" | "number" | "driver" | "team";
  is_active: boolean;
};

type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  format?: string | null;
};

type PoolRow = {
  id: string;
  name: string | null;
};

function normalizeCode(v: string) {
  return (v ?? "").trim().toUpperCase();
}

function uniqBy<T>(arr: T[], keyFn: (t: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

const TEAM_OPTIONS = uniqBy(
  F1_DRIVERS_2026.map((d) => ({ teamId: d.teamId, teamName: d.teamName })),
  (t) => t.teamId
).sort((a, b) => a.teamName.localeCompare(b.teamName));

export default function AdminBonusPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");

  const [tab, setTab] = useState<"season" | "weekend">("season");

  // Season
  const [seasonYear, setSeasonYear] = useState<number>(2026);
  const [seasonQuestions, setSeasonQuestions] = useState<BonusQuestionRow[]>([]);
  const [seasonAnswers, setSeasonAnswers] = useState<Record<string, any>>({}); // question_id -> answer_json.value

  // Weekend
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");

  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  const [weekendQuestions, setWeekendQuestions] = useState<BonusQuestionRow[]>([]);
  const [weekendAnswers, setWeekendAnswers] = useState<Record<string, any>>({}); // question_id -> answer_json.value

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const selectedPool = useMemo(
    () => pools.find((p) => p.id === selectedPoolId) ?? null,
    [pools, selectedPoolId]
  );

  async function requireAdmin() {
    setLoading(true);
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      router.replace("/login");
      return { ok: false };
    }

    setEmail(user.email ?? "");

    const { data: adminRow, error: adminErr } = await supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminErr) {
      setMsg("Admin-check error: " + adminErr.message);
      setIsAdmin(false);
      setLoading(false);
      return { ok: false };
    }

    if (!adminRow) {
      setIsAdmin(false);
      setLoading(false);
      return { ok: false };
    }

    setIsAdmin(true);
    setLoading(false);
    return { ok: true, userId: user.id };
  }

  async function loadQuestions(scope: "season" | "weekend") {
    const { data, error } = await supabase
      .from("bonus_question_bank")
      .select("id,scope,prompt,answer_kind,is_active")
      .eq("scope", scope)
      .eq("is_active", true)
      .order("prompt", { ascending: true });

    if (error) throw error;
    return (data ?? []) as BonusQuestionRow[];
  }

  async function loadEvents() {
    const { data, error } = await supabase
      .from("events")
      .select("id,name,starts_at,format")
      .order("starts_at", { ascending: true });

    if (error) throw error;
    return (data ?? []) as EventRow[];
  }

  async function loadPools() {
    // Minimal: pak alle pools (admin kan dit zien), anders pas je dit later aan naar jouw gewenste scope.
    const { data, error } = await supabase.from("pools").select("id,name").order("name");
    if (error) throw error;
    return (data ?? []) as PoolRow[];
  }

  async function loadSeasonAnswers(year: number) {
    const { data, error } = await supabase
      .from("season_official_answers")
      .select("season,question_id,answer_json")
      .eq("season", year);

    if (error) throw error;

    const map: Record<string, any> = {};
    for (const row of data ?? []) {
      map[row.question_id] = row.answer_json?.value ?? null;
    }
    return map;
  }

  // ✅ set-based: haal set_id + 3 question_ids voor (pool,event)
  async function loadWeekendSetQuestionIds(poolId: string, eventId: string) {
    const { data: setRow, error: setErr } = await supabase
      .from("pool_event_bonus_sets")
      .select("id")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (setErr) throw setErr;
    if (!setRow?.id) return { setId: null as string | null, questionIds: [] as string[] };

    const setId = setRow.id as string;

    const { data: setQs, error: setQsErr } = await supabase
      .from("pool_event_bonus_set_questions")
      .select("question_id,position")
      .eq("set_id", setId)
      .order("position", { ascending: true });

    if (setQsErr) throw setQsErr;

    const questionIds = (setQs ?? [])
      .map((r: any) => r.question_id as string)
      .filter(Boolean)
      .slice(0, 3);

    return { setId, questionIds };
  }

  // ✅ laad alleen de 3 vragen uit de bank (in juiste volgorde)
  async function loadWeekendQuestionsForSet(questionIds: string[]) {
    if (questionIds.length === 0) return [] as BonusQuestionRow[];

    const { data, error } = await supabase
      .from("bonus_question_bank")
      .select("id,scope,prompt,answer_kind,is_active")
      .in("id", questionIds);

    if (error) throw error;

    const rows = (data ?? []) as BonusQuestionRow[];
    const byId: Record<string, BonusQuestionRow> = {};
    for (const r of rows) byId[r.id] = r;

    return questionIds.map((id) => byId[id]).filter(Boolean);
  }

  // ✅ official answers per set (niet per event)
  async function loadWeekendOfficialAnswersBySet(setId: string) {
    const { data, error } = await supabase
      .from("weekend_bonus_official_answers")
      .select("set_id,question_id,answer_json")
      .eq("set_id", setId);

    if (error) throw error;

    const map: Record<string, any> = {};
    for (const row of data ?? []) {
      map[row.question_id] = row.answer_json?.value ?? null;
    }
    return map;
  }

  async function init() {
    const res = await requireAdmin();
    if (!res.ok) return;

    try {
      const [sQ, ev, pls] = await Promise.all([loadQuestions("season"), loadEvents(), loadPools()]);

      setSeasonQuestions(sQ);
      setEvents(ev);
      setPools(pls);

      if (pls.length > 0) setSelectedPoolId(pls[0].id);
      if (ev.length > 0) setSelectedEventId(ev[0].id);

      // season answers
      const sa = await loadSeasonAnswers(seasonYear);
      setSeasonAnswers(sa);
    } catch (e: any) {
      setMsg(e?.message ?? "Load error");
    }
  }

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reload season answers when year changes
  useEffect(() => {
    (async () => {
      if (!isAdmin) return;
      try {
        setMsg(null);
        const sa = await loadSeasonAnswers(seasonYear);
        setSeasonAnswers(sa);
      } catch (e: any) {
        setMsg(e?.message ?? "Load season answers error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonYear, isAdmin]);

  // ✅ reload weekend set questions + answers when pool/event changes
  useEffect(() => {
    (async () => {
      if (!isAdmin) return;
      if (!selectedPoolId || !selectedEventId) return;

      try {
        setMsg(null);

        // 1) set + questionIds
        const { setId, questionIds } = await loadWeekendSetQuestionIds(
          selectedPoolId,
          selectedEventId
        );

        if (!setId) {
          setWeekendQuestions([]);
          setWeekendAnswers({});
          setMsg("No weekend bonus set found for this pool + event.");
          return;
        }

        // 2) fetch only those 3 questions
        const qs = await loadWeekendQuestionsForSet(questionIds);
        setWeekendQuestions(qs);

        // 3) fetch official answers for this set
        const wa = await loadWeekendOfficialAnswersBySet(setId);
        setWeekendAnswers(wa);
      } catch (e: any) {
        setMsg(e?.message ?? "Load weekend bonus error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoolId, selectedEventId, isAdmin]);

  function setSeasonValue(questionId: string, value: any) {
    setSeasonAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function setWeekendValue(questionId: string, value: any) {
    setWeekendAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function saveSeasonAll() {
    setMsg(null);
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    try {
      const rows = seasonQuestions.map((q) => ({
        season: seasonYear,
        question_id: q.id,
        answer_json: { value: seasonAnswers[q.id] ?? null },
        updated_by: user?.id ?? null,
      }));

      const { error } = await supabase
        .from("season_official_answers")
        .upsert(rows, { onConflict: "season,question_id" });

      if (error) throw error;

      setMsg("✅ Season bonus answers saved.");
    } catch (e: any) {
      setMsg(e?.message ?? "Save season error");
    }
  }

  // ✅ Save weekend official answers per set_id + question_id
  async function saveWeekendAll() {
    setMsg(null);
    if (!selectedPoolId) return setMsg("Select a pool first.");
    if (!selectedEventId) return setMsg("Select an event first.");

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    try {
      const { setId, questionIds } = await loadWeekendSetQuestionIds(
        selectedPoolId,
        selectedEventId
      );

      if (!setId) return setMsg("No weekend bonus set found for this pool + event.");
      if (questionIds.length === 0) return setMsg("No questions configured for this set.");

      // Alleen opslaan voor de 3 vragen in de set (niet de hele bank)
      const rows = questionIds.map((qid) => ({
        set_id: setId,
        pool_id: selectedPoolId,
        event_id: selectedEventId,
        question_id: qid,
        answer_json: { value: weekendAnswers[qid] ?? null },
        updated_by: user?.id ?? null,
      }));

      const { error } = await supabase
        .from("weekend_bonus_official_answers")
        .upsert(rows, { onConflict: "set_id,question_id" });

      if (error) throw error;

      setMsg("✅ Weekend bonus official answers saved for this set.");
    } catch (e: any) {
      setMsg(e?.message ?? "Save weekend error");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Admin Bonus</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Admin Bonus</h1>
        <p>You are not an admin.</p>
        <button onClick={() => router.replace("/pools")}>Back</button>
      </main>
    );
  }

  const renderAnswerInput = (
    q: BonusQuestionRow,
    value: any,
    onChange: (v: any) => void
  ) => {
    if (q.answer_kind === "boolean") {
      return (
        <select
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : e.target.value === "true")
          }
          style={{ width: "100%", padding: 8 }}
        >
          <option value="">— Select —</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }

    if (q.answer_kind === "number") {
      return (
        <input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          style={{ width: "100%", padding: 8 }}
          placeholder="Number…"
        />
      );
    }

    if (q.answer_kind === "driver") {
      return (
        <select
          value={value ?? ""}
          onChange={(e) => onChange(normalizeCode(e.target.value))}
          style={{ width: "100%", padding: 8 }}
        >
          <option value="">— Select driver —</option>
          {F1_DRIVERS_2026.map((d) => (
            <option key={d.code} value={d.code}>
              {d.code} — {d.name} ({d.teamName})
            </option>
          ))}
        </select>
      );
    }

    if (q.answer_kind === "team") {
      return (
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", padding: 8 }}
        >
          <option value="">— Select team —</option>
          {TEAM_OPTIONS.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.teamName}
            </option>
          ))}
        </select>
      );
    }

    // text
    return (
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: 8 }}
        placeholder="Text…"
      />
    );
  };

  return (
    <main style={{ padding: 16, maxWidth: 980 }}>
      <h1>Admin Bonus</h1>
      <p>Logged in as: {email}</p>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button
          onClick={() => setTab("season")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: tab === "season" ? "#111" : "#fff",
            color: tab === "season" ? "#fff" : "#111",
          }}
        >
          Season bonus
        </button>
        <button
          onClick={() => setTab("weekend")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: tab === "weekend" ? "#111" : "#fff",
            color: tab === "weekend" ? "#fff" : "#111",
          }}
        >
          Weekend bonus
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => router.replace("/admin/results")}>Back to Results</button>
          <button onClick={logout}>Logout</button>
        </div>
      </div>

      {tab === "season" && (
        <section style={{ marginTop: 18 }}>
          <h2>Season bonus official answers</h2>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <label style={{ fontWeight: 700 }}>Season:</label>
            <input
              type="number"
              value={seasonYear}
              onChange={(e) => setSeasonYear(Number(e.target.value))}
              style={{ width: 110, padding: 8 }}
            />
            <button onClick={saveSeasonAll} style={{ marginLeft: 8 }}>
              Save season answers
            </button>
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            {seasonQuestions.map((q) => (
              <div
                key={q.id}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div style={{ fontWeight: 800 }}>{q.prompt}</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  kind: {q.answer_kind} • id: {q.id}
                </div>
                <div style={{ marginTop: 10 }}>
                  {renderAnswerInput(q, seasonAnswers[q.id], (v) => setSeasonValue(q.id, v))}
                </div>
              </div>
            ))}
            {seasonQuestions.length === 0 && (
              <p style={{ opacity: 0.8 }}>No active season questions found.</p>
            )}
          </div>
        </section>
      )}

      {tab === "weekend" && (
        <section style={{ marginTop: 18 }}>
          <h2>Weekend bonus official answers</h2>

          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontWeight: 700 }}>Pool:</label>
              <select
                value={selectedPoolId}
                onChange={(e) => setSelectedPoolId(e.target.value)}
                style={{ width: 520, padding: 8 }}
              >
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ?? p.id}
                  </option>
                ))}
              </select>
              {selectedPool ? (
                <span style={{ fontSize: 12, opacity: 0.75 }}>({selectedPool.id})</span>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontWeight: 700 }}>Event:</label>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                style={{ width: 520, padding: 8 }}
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} {e.starts_at ? `(${e.starts_at})` : ""}
                  </option>
                ))}
              </select>

              <button onClick={saveWeekendAll} style={{ marginLeft: 8 }}>
                Save weekend answers
              </button>
            </div>
          </div>

          {selectedEvent ? (
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
              Selected: <strong>{selectedEvent.name}</strong>
              {selectedEvent.format ? ` • ${selectedEvent.format}` : ""}
            </div>
          ) : null}

          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            {weekendQuestions.map((q) => (
              <div
                key={q.id}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div style={{ fontWeight: 800 }}>{q.prompt}</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  kind: {q.answer_kind} • id: {q.id}
                </div>
                <div style={{ marginTop: 10 }}>
                  {renderAnswerInput(q, weekendAnswers[q.id], (v) => setWeekendValue(q.id, v))}
                </div>
              </div>
            ))}
            {weekendQuestions.length === 0 && (
              <p style={{ opacity: 0.8 }}>
                No weekend questions found for this pool+event set (check the set generator).
              </p>
            )}
          </div>
        </section>
      )}

      {msg ? (
        <p style={{ marginTop: 14, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>
      ) : null}
    </main>
  );
}
