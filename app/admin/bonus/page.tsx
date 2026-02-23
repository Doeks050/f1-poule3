"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

// ---- Hardcoded lists (zoals je al had) ----
const F1_DRIVERS_2026 = [
  { code: "VER", name: "Max Verstappen", teamName: "Red Bull" },
  { code: "PER", name: "Sergio Pérez", teamName: "Red Bull" },
  { code: "LEC", name: "Charles Leclerc", teamName: "Ferrari" },
  { code: "HAM", name: "Lewis Hamilton", teamName: "Ferrari" },
  { code: "NOR", name: "Lando Norris", teamName: "McLaren" },
  { code: "PIA", name: "Oscar Piastri", teamName: "McLaren" },
  { code: "RUS", name: "George Russell", teamName: "Mercedes" },
  { code: "ANT", name: "Andrea Kimi Antonelli", teamName: "Mercedes" },
  { code: "ALO", name: "Fernando Alonso", teamName: "Aston Martin" },
  { code: "STR", name: "Lance Stroll", teamName: "Aston Martin" },
  { code: "SAI", name: "Carlos Sainz", teamName: "Williams" },
  { code: "ALB", name: "Alex Albon", teamName: "Williams" },
  { code: "OCO", name: "Esteban Ocon", teamName: "Haas" },
  { code: "BEA", name: "Oliver Bearman", teamName: "Haas" },
  { code: "GAS", name: "Pierre Gasly", teamName: "Alpine" },
  { code: "DOO", name: "Jack Doohan", teamName: "Alpine" },
  { code: "TSU", name: "Yuki Tsunoda", teamName: "Racing Bulls" },
  { code: "LAW", name: "Liam Lawson", teamName: "Racing Bulls" },
  { code: "BOT", name: "Valtteri Bottas", teamName: "Sauber" },
  { code: "ZHO", name: "Guanyu Zhou", teamName: "Sauber" },
  { code: "CAD1", name: "Cadillac Driver 1", teamName: "Cadillac" },
  { code: "CAD2", name: "Cadillac Driver 2", teamName: "Cadillac" },
  { code: "AUD1", name: "Audi Driver 1", teamName: "Audi" },
  { code: "AUD2", name: "Audi Driver 2", teamName: "Audi" },
];

const TEAM_OPTIONS = [
  { teamId: "red_bull", teamName: "Red Bull" },
  { teamId: "ferrari", teamName: "Ferrari" },
  { teamId: "mclaren", teamName: "McLaren" },
  { teamId: "mercedes", teamName: "Mercedes" },
  { teamId: "aston_martin", teamName: "Aston Martin" },
  { teamId: "williams", teamName: "Williams" },
  { teamId: "alpine", teamName: "Alpine" },
  { teamId: "haas", teamName: "Haas" },
  { teamId: "racing_bulls", teamName: "Racing Bulls" },
  { teamId: "sauber", teamName: "Sauber" },
  { teamId: "cadillac", teamName: "Cadillac" },
  { teamId: "audi", teamName: "Audi" },
];

type PoolRow = { id: string; name: string };
type EventRow = { id: string; name: string; starts_at: string | null; weekend_type: string | null };

type BonusQuestionRow = {
  id: string;
  prompt: string;
  answer_kind: "boolean" | "driver" | "team" | "text";
};

function normalizeCode(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export default function AdminBonusPage() {
  const router = useRouter();

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    return createClient(url, anon);
  }, []);

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState<string>("");

  const [tab, setTab] = useState<"season" | "weekend">("weekend");
  const [msg, setMsg] = useState<string>("");

  // Pools + events
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // Season
  const [seasonYear, setSeasonYear] = useState<number>(2026);
  const [seasonQuestions, setSeasonQuestions] = useState<BonusQuestionRow[]>([]);
  const [seasonAnswers, setSeasonAnswers] = useState<Record<string, any>>({});

  // Weekend
  const [weekendQuestions, setWeekendQuestions] = useState<BonusQuestionRow[]>([]);
  const [weekendAnswers, setWeekendAnswers] = useState<Record<string, any>>({});
  const [setId, setSetId] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg("");

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace("/login");
        return;
      }

      setEmail(user.email ?? "");

      // Check admin
      const { data: adminRow, error: adminErr } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminErr || !adminRow) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setIsAdmin(true);

      // Load pools
      const { data: poolsData, error: poolsErr } = await supabase
        .from("pools")
        .select("id,name")
        .order("created_at", { ascending: false });

      if (poolsErr) {
        setMsg(poolsErr.message);
        setLoading(false);
        return;
      }

      setPools(poolsData ?? []);
      const firstPool = poolsData?.[0]?.id ?? "";
      setSelectedPoolId(firstPool);

      // Load events
      const { data: eventsData, error: eventsErr } = await supabase
        .from("events")
        .select("id,name,starts_at,weekend_type")
        .order("starts_at", { ascending: true });

      if (eventsErr) {
        setMsg(eventsErr.message);
        setLoading(false);
        return;
      }

      setEvents(eventsData ?? []);
      const firstEvent = eventsData?.[0]?.id ?? "";
      setSelectedEventId(firstEvent);

      // Load season questions
      const { data: sQ, error: sQErr } = await supabase
        .from("bonus_questions")
        .select("id,prompt,answer_kind")
        .eq("scope", "season")
        .order("created_at", { ascending: true });

      if (sQErr) {
        setMsg(sQErr.message);
        setLoading(false);
        return;
      }

      setSeasonQuestions((sQ ?? []) as any);

      // Load weekend bank (vraagbank)
      const { data: wBank, error: wBankErr } = await supabase
        .from("bonus_question_bank")
        .select("id,prompt,answer_kind")
        .order("created_at", { ascending: true });

      if (wBankErr) {
        setMsg(wBankErr.message);
        setLoading(false);
        return;
      }

      // let op: weekendQuestions worden later overschreven naar “alleen de 3 gekozen”
      setWeekendQuestions((wBank ?? []) as any);

      setLoading(false);
    })();
  }, [router, supabase]);

  // -------- helpers ----------
  function setSeasonValue(qid: string, v: any) {
    setSeasonAnswers((prev) => ({ ...prev, [qid]: v }));
  }
  function setWeekendValue(qid: string, v: any) {
    setWeekendAnswers((prev) => ({ ...prev, [qid]: v }));
  }

  async function ensureWeekendSet(poolId: string, eventId: string) {
    // 1) bestaat set al?
    const { data: existing, error: exErr } = await supabase
      .from("pool_event_bonus_sets")
      .select("id")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (exErr) throw exErr;

    let sid = existing?.id as string | undefined;

    // 2) zo niet: create set
    if (!sid) {
      const { data: created, error: cErr } = await supabase
        .from("pool_event_bonus_sets")
        .insert({ pool_id: poolId, event_id: eventId })
        .select("id")
        .single();

      if (cErr) throw cErr;
      sid = created.id;
    }

    // 3) haal vragen in set op
    const { data: links, error: lErr } = await supabase
      .from("pool_event_bonus_set_questions")
      .select("question_id")
      .eq("set_id", sid);

    if (lErr) throw lErr;

    // 4) als nog leeg: kies random 3 uit bank en insert links
    let questionIds = (links ?? []).map((r: any) => r.question_id);

    if (questionIds.length < 3) {
      // load bank ids
      const { data: bankRows, error: bErr } = await supabase
        .from("bonus_question_bank")
        .select("id")
        .order("created_at", { ascending: true });

      if (bErr) throw bErr;

      const ids = (bankRows ?? []).map((r: any) => r.id);
      // simple shuffle
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      const picked = ids.slice(0, 3);

      const inserts = picked.map((qid) => ({ set_id: sid, question_id: qid }));
      const { error: insErr } = await supabase.from("pool_event_bonus_set_questions").insert(inserts);
      if (insErr) throw insErr;

      questionIds = picked;
    }

    // 5) haal question detail voor deze 3
    const { data: qRows, error: qErr } = await supabase
      .from("bonus_question_bank")
      .select("id,prompt,answer_kind")
      .in("id", questionIds);

    if (qErr) throw qErr;

    // behoud volgorde van questionIds
    const byId = new Map((qRows ?? []).map((q: any) => [q.id, q]));
    const ordered = questionIds.map((id) => byId.get(id)).filter(Boolean);

    return { setId: sid!, questionIds, questions: ordered as BonusQuestionRow[] };
  }

  async function loadSeasonOfficialAnswers() {
    setMsg("");
    const { data, error } = await supabase
      .from("season_official_answers")
      .select("question_id,answer_json")
      .eq("season", seasonYear);

    if (error) throw error;

    const map: Record<string, any> = {};
    (data ?? []).forEach((r: any) => (map[r.question_id] = r.answer_json?.value ?? null));
    setSeasonAnswers(map);
  }

  async function loadWeekendOfficialAnswers(poolId: string, eventId: string, sid: string, questionIds: string[]) {
    setMsg("");

    // IMPORTANT: we lezen per set, zodat dezelfde vraag later weer kan zonder collision
    const { data, error } = await supabase
      .from("weekend_bonus_official_answers")
      .select("question_id,answer_json")
      .eq("pool_id", poolId)
      .eq("set_id", sid)
      .in("question_id", questionIds);

    if (error) throw error;

    const map: Record<string, any> = {};
    (data ?? []).forEach((r: any) => (map[r.question_id] = r.answer_json?.value ?? null));
    setWeekendAnswers(map);
  }

  useEffect(() => {
    if (!isAdmin || loading) return;

    (async () => {
      try {
        await loadSeasonOfficialAnswers();
      } catch (e: any) {
        setMsg(e?.message ?? "Load season official answers error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, loading, seasonYear]);

  useEffect(() => {
    if (!isAdmin || loading) return;
    if (tab !== "weekend") return;
    if (!selectedPoolId || !selectedEventId) return;

    (async () => {
      try {
        const ensured = await ensureWeekendSet(selectedPoolId, selectedEventId);
        setSetId(ensured.setId);
        setWeekendQuestions(ensured.questions);

        await loadWeekendOfficialAnswers(selectedPoolId, selectedEventId, ensured.setId, ensured.questionIds);
      } catch (e: any) {
        setMsg(e?.message ?? "Load weekend bonus error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, loading, tab, selectedPoolId, selectedEventId]);

  async function saveSeasonAll() {
    setMsg("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) throw new Error("Not logged in");

      const rows = seasonQuestions.map((q) => ({
        season: seasonYear,
        question_id: q.id,
        answer_json: { value: seasonAnswers[q.id] ?? null },
        updated_by: user.id,
      }));

      const { error } = await supabase
        .from("season_official_answers")
        .upsert(rows, { onConflict: "season,question_id" });

      if (error) throw error;

      setMsg("✅ Season official answers saved.");
    } catch (e: any) {
      setMsg(e?.message ?? "Save season error");
    }
  }

  async function saveWeekendAll() {
    setMsg("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) throw new Error("Not logged in");

      if (!selectedPoolId) throw new Error("No pool selected");
      if (!selectedEventId) throw new Error("No event selected");
      if (!setId) throw new Error("No setId (set not generated)");

      const questionIds = weekendQuestions.map((q) => q.id);

      const rows = questionIds.map((qid) => ({
        pool_id: selectedPoolId,
        event_id: selectedEventId,
        set_id: setId,
        question_id: qid,
        answer_json: { value: weekendAnswers[qid] ?? null },
        decided_by: user.id,
      }));

      // IMPORTANT:
      // Dit vereist DB unique constraint: UNIQUE(pool_id, set_id, question_id)
      const { error } = await supabase
        .from("weekend_bonus_official_answers")
        .upsert(rows, { onConflict: "pool_id,set_id,question_id" });

      if (error) throw error;

      setMsg("✅ Weekend bonus official answers saved.");
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

  return (
    <main style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Logged in as: {email}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              onClick={() => setTab("season")}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid #ddd",
                background: tab === "season" ? "black" : "white",
                color: tab === "season" ? "white" : "black",
              }}
            >
              Season bonus
            </button>
            <button
              onClick={() => setTab("weekend")}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid #ddd",
                background: tab === "weekend" ? "black" : "white",
                color: tab === "weekend" ? "white" : "black",
              }}
            >
              Weekend bonus
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <button onClick={() => router.replace("/admin/results")}>Back to Results</button>
          <button onClick={logout}>Logout</button>
        </div>
      </div>

      <h1 style={{ marginTop: 18 }}>
        {tab === "season" ? "Season bonus official answers" : "Weekend bonus official answers"}
      </h1>

      {msg && <p style={{ color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>}

      {tab === "season" && (
        <section style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label>
              Season:&nbsp;
              <input
                type="number"
                value={seasonYear}
                onChange={(e) => setSeasonYear(Number(e.target.value))}
                style={{ width: 90 }}
              />
            </label>
            <button onClick={saveSeasonAll}>Save season answers</button>
          </div>

          <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
            {seasonQuestions.map((q) => (
              <div key={q.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 700 }}>{q.prompt}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  kind: {q.answer_kind} • id: {q.id}
                </div>

                {q.answer_kind === "boolean" ? (
                  <select
                    value={
                      seasonAnswers[q.id] === true
                        ? "true"
                        : seasonAnswers[q.id] === false
                        ? "false"
                        : ""
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setSeasonValue(q.id, v === "" ? null : v === "true");
                    }}
                    style={{ marginTop: 8, width: "100%", padding: 8 }}
                  >
                    <option value="">— Select —</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : q.answer_kind === "driver" ? (
                  <select
                    value={seasonAnswers[q.id] ?? ""}
                    onChange={(e) => setSeasonValue(q.id, normalizeCode(e.target.value))}
                    style={{ marginTop: 8, width: "100%", padding: 8 }}
                  >
                    <option value="">— Select driver —</option>
                    {F1_DRIVERS_2026.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name} ({d.code}) — {d.teamName}
                      </option>
                    ))}
                  </select>
                ) : q.answer_kind === "team" ? (
                  <select
                    value={seasonAnswers[q.id] ?? ""}
                    onChange={(e) => setSeasonValue(q.id, e.target.value)}
                    style={{ marginTop: 8, width: "100%", padding: 8 }}
                  >
                    <option value="">— Select team —</option>
                    {TEAM_OPTIONS.map((t) => (
                      <option key={t.teamId} value={t.teamId}>
                        {t.teamName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={seasonAnswers[q.id] ?? ""}
                    onChange={(e) => setSeasonValue(q.id, e.target.value)}
                    style={{ marginTop: 8, width: "100%", padding: 8 }}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "weekend" && (
        <section style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label>
              Pool:&nbsp;
              <select
                value={selectedPoolId}
                onChange={(e) => setSelectedPoolId(e.target.value)}
                style={{ minWidth: 340 }}
              >
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Event:&nbsp;
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                style={{ minWidth: 520 }}
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} {ev.starts_at ? `(${ev.starts_at})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <button onClick={saveWeekendAll}>Save weekend answers</button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            Selected:{" "}
            {events.find((e) => e.id === selectedEventId)?.name ?? "(none)"} •{" "}
            {events.find((e) => e.id === selectedEventId)?.weekend_type ?? "standard"}
          </div>

          <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
            {weekendQuestions.map((q) => (
              <div key={q.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 700 }}>{q.prompt}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  kind: {q.answer_kind} • id: {q.id}
                </div>

                {q.answer_kind === "boolean" ? (
                  <select
                    value={
                      weekendAnswers[q.id] === true
                        ? "true"
                        : weekendAnswers[q.id] === false
                        ? "false"
                        : ""
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setWeekendValue(q.id, v === "" ? null : v === "true");
                    }}
                    style={{ marginTop: 8, width: "100%", padding: 8 }}
                  >
                    <option value="">— Select —</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : q.answer_kind === "driver" ? (
                  <select
                    value={weekendAnswers[q.id] ?? ""}
                    onChange={(e) => setWeekendValue(q.id, normalizeCode(e.target.value))}
                    style={{ marginTop: 8, width: "100%", padding: 8 }}
                  >
                    <option value="">— Select driver —</option>
                    {F1_DRIVERS_2026.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name} ({d.code}) — {d.teamName}
                      </option>
                    ))}
                  </select>
                ) : q.answer_kind === "team" ? (
                  <select
                    value={weekendAnswers[q.id] ?? ""}
                    onChange={(e) => setWeekendValue(q.id, e.target.value)}
                    style={{ marginTop: 8, width: "100%", padding: 8 }}
                  >
                    <option value="">— Select team —</option>
                    {TEAM_OPTIONS.map((t) => (
                      <option key={t.teamId} value={t.teamId}>
                        {t.teamName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={weekendAnswers[q.id] ?? ""}
                    onChange={(e) => setWeekendValue(q.id, e.target.value)}
                    style={{ marginTop: 8, width: "100%", padding: 8 }}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
