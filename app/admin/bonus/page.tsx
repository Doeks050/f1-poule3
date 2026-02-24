"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type UUID = string;

type EventRow = {
  id: UUID;
  name: string;
  starts_at: string | null;
};

type BonusQuestionBankRow = {
  id: UUID;
  scope: "season" | "weekend";
  prompt: string;
  answer_kind: "boolean" | "text" | "number" | "driver" | "team";
  options?: any;
  is_active: boolean;
  question_key?: string | null;
};

export default function AdminBonusPage() {
  const router = useRouter();

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return createClient(url ?? "", anon ?? "");
  }, []);

  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Pools + events
  const [pools, setPools] = useState<{ id: UUID; name: string }[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<UUID | "">("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<UUID | "">("");

  // Weekend
  const [weekendQuestions, setWeekendQuestions] = useState<BonusQuestionBankRow[]>([]);
  const [weekendOfficialAnswers, setWeekendOfficialAnswers] = useState<Record<UUID, boolean | null>>({});
  const [weekendLoading, setWeekendLoading] = useState(false);
  const [weekendError, setWeekendError] = useState<string | null>(null);

  // Season
  const [seasonQuestions, setSeasonQuestions] = useState<BonusQuestionBankRow[]>([]);
  const [seasonOfficialAnswers, setSeasonOfficialAnswers] = useState<Record<UUID, boolean | null>>({});
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState<string | null>(null);

  async function requireAdmin() {
    const { data, error } = await supabase.auth.getUser();

    if (error) console.log("[ADMIN_BONUS] getUser error", error);

    if (!data?.user) {
      router.replace("/login");
      return null;
    }

    setUserEmail(data.user.email ?? null);

    const adminRes = await supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (adminRes.error) {
      console.log("[ADMIN_BONUS] admin check error", adminRes.error);
      router.replace("/pools");
      return null;
    }

    if (!adminRes.data) {
      router.replace("/pools");
      return null;
    }

    return data.user;
  }

  useEffect(() => {
    (async () => {
      const user = await requireAdmin();
      if (!user) return;

      const { data: poolRows, error: poolErr } = await supabase
        .from("pools")
        .select("id,name")
        .order("created_at", { ascending: false });

      if (poolErr) console.log("[ADMIN_BONUS] pools error", poolErr);
      setPools(poolRows ?? []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!selectedPoolId) return;

      const { data: eventRows, error: eventErr } = await supabase
        .from("events")
        .select("id,name,starts_at")
        .eq("pool_id", selectedPoolId as string)
        .order("starts_at", { ascending: true });

      if (eventErr) console.log("[ADMIN_BONUS] events error", eventErr);

      setEvents((eventRows as any) ?? []);
      setSelectedEventId("");
      setWeekendQuestions([]);
      setWeekendOfficialAnswers({});
      setSeasonQuestions([]);
      setSeasonOfficialAnswers({});
      setWeekendError(null);
      setSeasonError(null);
    })();
  }, [selectedPoolId, supabase]);

  // ==============
  // WEEKEND LOAD
  // ==============
  useEffect(() => {
    (async () => {
      if (!selectedPoolId || !selectedEventId) return;

      setWeekendLoading(true);
      setWeekendError(null);

      // 1) Welke vragen zijn gekoppeld aan pool/weekend
      const { data: linkRows, error: linkErr } = await supabase
        .from("bonus_questions")
        .select("question_id,order_index")
        .eq("pool_id", selectedPoolId as string)
        .eq("scope", "weekend")
        .order("order_index", { ascending: true });

      if (linkErr) {
        console.log("[ADMIN_BONUS] weekend links error", linkErr);
        setWeekendError(linkErr.message);
        setWeekendLoading(false);
        return;
      }

      const questionIds = (linkRows ?? []).map((r: any) => r.question_id).filter(Boolean);

      // 2) Vragen ophalen uit bank
      if (!questionIds.length) {
        setWeekendQuestions([]);
      } else {
        const { data: qRows, error: qErr } = await supabase
          .from("bonus_question_bank")
          .select("id,scope,prompt,answer_kind,options,is_active,question_key")
          .in("id", questionIds)
          .eq("scope", "weekend");

        if (qErr) {
          console.log("[ADMIN_BONUS] weekend questions error", qErr);
          setWeekendError(qErr.message);
          setWeekendLoading(false);
          return;
        }

        const byId = new Map<string, any>((qRows ?? []).map((q: any) => [q.id, q]));
        const ordered = questionIds.map((id: string) => byId.get(id)).filter(Boolean);
        setWeekendQuestions(ordered);
      }

      // 3) Official answers ophalen
      const { data: aRows, error: aErr } = await supabase
        .from("weekend_bonus_official_answers")
        .select("question_id,answer_json")
        .eq("pool_id", selectedPoolId as string)
        .eq("event_id", selectedEventId as string);

      if (aErr) {
        console.log("[ADMIN_BONUS] weekend official answers error", aErr);
        setWeekendError(aErr.message);
        setWeekendLoading(false);
        return;
      }

      const map: Record<string, boolean | null> = {};
      for (const row of aRows ?? []) {
        map[(row as any).question_id] = (row as any).answer_json ?? null;
      }
      setWeekendOfficialAnswers(map);

      setWeekendLoading(false);
    })();
  }, [selectedPoolId, selectedEventId, supabase]);

  // =============
  // SEASON LOAD
  // =============
  useEffect(() => {
    (async () => {
      if (!selectedPoolId) return;

      setSeasonLoading(true);
      setSeasonError(null);

      /**
       * BELANGRIJK:
       * jouw tabel pool_season_bonus_sets heeft GEEN set_id kolom.
       * Dus: we selecten "*", en gebruiken gewoon seasonSet.id als "setId" indien nodig.
       */
      const { data: seasonSet, error: sSetErr } = await supabase
        .from("pool_season_bonus_sets")
        .select("*")
        .eq("pool_id", selectedPoolId as string)
        .maybeSingle();

      if (sSetErr) {
        console.log("[ADMIN_BONUS] season set error", sSetErr);
        setSeasonError(sSetErr.message);
        setSeasonLoading(false);
        return;
      }

      const seasonSetId: string | null =
        (seasonSet as any)?.set_id ?? (seasonSet as any)?.id ?? null;

      // 1) Koppeltabel met season vragen per pool
      const { data: sLink, error: sLinkErr } = await supabase
        .from("pool_season_bonus_set_questions")
        .select("*")
        .eq("pool_id", selectedPoolId as string)
        .order("order_index", { ascending: true });

      if (sLinkErr) {
        console.log("[ADMIN_BONUS] season links error", sLinkErr);
        setSeasonError(sLinkErr.message);
        setSeasonLoading(false);
        return;
      }

      // Als jouw link table set_id heeft, filteren we client-side op de juiste set
      const filteredLinks = (sLink ?? []).filter((r: any) => {
        if (!("set_id" in r) || !seasonSetId) return true;
        return r.set_id === seasonSetId;
      });

      const sQuestionIds = filteredLinks.map((r: any) => r.question_id).filter(Boolean);

      // 2) Vragen ophalen
      if (!sQuestionIds.length) {
        setSeasonQuestions([]);
      } else {
        const { data: sQRows, error: sQErr } = await supabase
          .from("bonus_question_bank")
          .select("id,scope,prompt,answer_kind,options,is_active,question_key")
          .in("id", sQuestionIds)
          .eq("scope", "season");

        if (sQErr) {
          console.log("[ADMIN_BONUS] season questions error", sQErr);
          setSeasonError(sQErr.message);
          setSeasonLoading(false);
          return;
        }

        const byId = new Map<string, any>((sQRows ?? []).map((q: any) => [q.id, q]));
        const ordered = sQuestionIds.map((id: string) => byId.get(id)).filter(Boolean);
        setSeasonQuestions(ordered);
      }

      // 3) Official answers ophalen (hier geen set_id verplicht)
      const { data: sAns, error: sAnsErr } = await supabase
        .from("season_bonus_answers")
        .select("question_id,answer_json")
        .eq("pool_id", selectedPoolId as string);

      if (sAnsErr) {
        console.log("[ADMIN_BONUS] season official answers error", sAnsErr);
        setSeasonError(sAnsErr.message);
        setSeasonLoading(false);
        return;
      }

      const map: Record<string, boolean | null> = {};
      for (const row of sAns ?? []) {
        map[(row as any).question_id] = (row as any).answer_json ?? null;
      }
      setSeasonOfficialAnswers(map);

      setSeasonLoading(false);
    })();
  }, [selectedPoolId, supabase]);

  async function saveWeekendOfficialAnswer(questionId: UUID, answer: boolean) {
    if (!selectedPoolId || !selectedEventId) return;
    setWeekendError(null);

    const { data: userData } = await supabase.auth.getUser();
    const decidedBy = userData.user?.id ?? null;

    const payload = {
      pool_id: selectedPoolId as string,
      event_id: selectedEventId as string,
      question_id: questionId,
      answer_json: answer,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("weekend_bonus_official_answers")
      .upsert(payload, { onConflict: "pool_id,event_id,question_id" });

    if (error) {
      console.log("[ADMIN_BONUS] save weekend answer error", error);
      setWeekendError(error.message);
      return;
    }

    setWeekendOfficialAnswers((prev) => ({ ...prev, [questionId]: answer }));
  }

  async function saveSeasonOfficialAnswer(questionId: UUID, answer: boolean) {
    if (!selectedPoolId) return;
    setSeasonError(null);

    const { data: userData } = await supabase.auth.getUser();
    const decidedBy = userData.user?.id ?? null;

    const payload = {
      pool_id: selectedPoolId as string,
      question_id: questionId,
      answer_json: answer,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
    };

    // Unique key is bij jou (pool_id, question_id) — zo hoort het
    const { error } = await supabase
      .from("season_bonus_answers")
      .upsert(payload, { onConflict: "pool_id,question_id" });

    if (error) {
      console.log("[ADMIN_BONUS] save season answer error", error);
      setSeasonError(error.message);
      return;
    }

    setSeasonOfficialAnswers((prev) => ({ ...prev, [questionId]: answer }));
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const canUseWeekend = !!selectedPoolId && !!selectedEventId;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Bonus</h1>
          <div className="text-sm text-gray-600">Ingelogd als: {userEmail ?? "-"}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => router.push("/admin/results")}
          >
            Terug naar Admin Results
          </button>
          <button
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => router.push("/pools")}
          >
            Terug naar Pools
          </button>
          <button
            className="rounded-md bg-black px-3 py-2 text-sm text-white hover:opacity-90"
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* LEFT */}
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Selectie</h2>

          <label className="mb-2 block text-sm font-medium text-gray-700">Pool</label>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={selectedPoolId}
            onChange={(e) => setSelectedPoolId(e.target.value as any)}
          >
            <option value="">— Kies pool —</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <label className="mb-2 mt-4 block text-sm font-medium text-gray-700">Event (weekend)</label>
          <select
            className="w-full rounded-md border px-3 py-2 disabled:opacity-50"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value as any)}
            disabled={!selectedPoolId}
          >
            <option value="">— Kies event —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
                {ev.starts_at ? ` — ${new Date(ev.starts_at).toLocaleString()}` : ""}
              </option>
            ))}
          </select>

          <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
            <div className="font-medium">Tip</div>
            <div className="mt-1">
              Weekend answers zijn per <b>pool + event</b>. Season answers zijn per <b>pool</b>.
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="space-y-4">
          {/* WEEKEND */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Weekend bonus (official answers)</h2>
              <span className="text-xs text-gray-500">
                {canUseWeekend ? "Geselecteerd" : "Kies pool + event"}
              </span>
            </div>

            {weekendLoading && <div className="text-sm text-gray-600">Loading…</div>}
            {weekendError && <div className="text-sm text-red-600">{weekendError}</div>}

            {!weekendLoading && !weekendError && canUseWeekend && (
              <>
                {weekendQuestions.length === 0 && (
                  <div className="text-sm text-gray-600">Geen weekend vragen gevonden.</div>
                )}

                <div className="space-y-3">
                  {weekendQuestions.map((q, idx) => {
                    const value = weekendOfficialAnswers[q.id];
                    return (
                      <div key={q.id} className="rounded-lg border p-3">
                        <div className="text-sm font-semibold">
                          {idx + 1}. {q.prompt}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-4">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={`wq-${q.id}`}
                              checked={value === true}
                              onChange={() => saveWeekendOfficialAnswer(q.id, true)}
                            />
                            Ja
                          </label>

                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={`wq-${q.id}`}
                              checked={value === false}
                              onChange={() => saveWeekendOfficialAnswer(q.id, false)}
                            />
                            Nee
                          </label>

                          <span className="text-xs text-gray-500">
                            status: {value === null || value === undefined ? "open" : "ingevuld"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* SEASON */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Season bonus (official answers)</h2>
              <span className="text-xs text-gray-500">{selectedPoolId ? "Pool gekozen" : "Kies pool"}</span>
            </div>

            {seasonLoading && <div className="text-sm text-gray-600">Loading…</div>}
            {seasonError && <div className="text-sm text-red-600">{seasonError}</div>}

            {!seasonLoading && !seasonError && selectedPoolId && (
              <>
                {seasonQuestions.length === 0 && (
                  <div className="text-sm text-gray-600">Geen season vragen gevonden.</div>
                )}

                <div className="space-y-3">
                  {seasonQuestions.map((q, idx) => {
                    const value = seasonOfficialAnswers[q.id];
                    return (
                      <div key={q.id} className="rounded-lg border p-3">
                        <div className="text-sm font-semibold">
                          {idx + 1}. {q.prompt}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-4">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={`sq-${q.id}`}
                              checked={value === true}
                              onChange={() => saveSeasonOfficialAnswer(q.id, true)}
                            />
                            Ja
                          </label>

                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={`sq-${q.id}`}
                              checked={value === false}
                              onChange={() => saveSeasonOfficialAnswer(q.id, false)}
                            />
                            Nee
                          </label>

                          <span className="text-xs text-gray-500">
                            status: {value === null || value === undefined ? "open" : "ingevuld"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
