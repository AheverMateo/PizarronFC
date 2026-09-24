// Fase 1 — Sincroniza partidos + resultados de football-data.org a Supabase.
// Idempotente (upserts). ~1 request por corrida.
// Uso: npx tsx scripts/sync-matches.ts
import "../scripts/_env.js";
import { LEAGUE } from "../lib/config.js";
import { apiNameToCanon } from "../lib/teams.js";

type FdMatch = {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
  score: { fullTime: { home: number | null; away: number | null } };
};

function mapStatus(s: string): "scheduled" | "live" | "finished" {
  if (s === "FINISHED" || s === "AWARDED") return "finished";
  if (s === "IN_PLAY" || s === "PAUSED") return "live";
  return "scheduled"; // TIMED, SCHEDULED, POSTPONED, SUSPENDED, CANCELED
}

function seasonOf(iso: string): number {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() + 1 >= 8 ? y : y - 1;
}

async function main() {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw new Error("Falta FOOTBALL_DATA_KEY en .env.local");

  const res = await fetch(`https://api.football-data.org/v4/competitions/${LEAGUE.footballDataCode}/matches`, {
    headers: { "X-Auth-Token": key },
  });
  if (!res.ok) throw new Error(`football-data.org HTTP ${res.status}`);
  const json = (await res.json()) as { matches: FdMatch[] };
  console.log(`API: ${json.matches.length} partidos temporada en curso`);

  const { createServerClient } = await import("../lib/supabase/server.js");
  const supabase = createServerClient();

  // liga
  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("id")
    .eq("name", LEAGUE.name)
    .maybeSingle();
  let leagueId: number;
  if (leagueRow) leagueId = (leagueRow as { id: number }).id;
  else {
    const { data, error } = await supabase
      .from("leagues")
      .insert({
        name: LEAGUE.name,
        country: LEAGUE.country,
        external_ids: { footballDataCode: LEAGUE.footballDataCode },
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`leagues: ${error?.message}`);
    leagueId = (data as { id: number }).id;
  }

  // equipos (canónicos) + alias de la API
  const canonNames = new Set<string>();
  const aliasPairs: Array<[string, string]> = []; // [apiName, canon]
  for (const m of json.matches) {
    for (const side of [m.homeTeam.name, m.awayTeam.name]) {
      const c = apiNameToCanon(side);
      canonNames.add(c);
      if (side !== c) aliasPairs.push([side, c]);
    }
  }
  const names = [...canonNames];
  const { data: existing } = await supabase.from("teams").select("id,name").in("name", names);
  const teamId = new Map(((existing ?? []) as Array<{ id: number; name: string }>).map((t) => [t.name, t.id]));
  const missing = names.filter((n) => !teamId.has(n));
  if (missing.length > 0) {
    const { data: ins, error } = await supabase
      .from("teams")
      .insert(missing.map((name) => ({ name })))
      .select("id,name");
    if (error) throw new Error(`teams: ${error.message}`);
    for (const t of (ins ?? []) as Array<{ id: number; name: string }>) teamId.set(t.name, t.id);
  }
  // alias de la API (lote único, deduplicado)
  const aliasSeen = new Set<string>();
  const aliasRows: Array<{ alias: string; team_id: number }> = [];
  for (const [alias, c] of aliasPairs) {
    if (aliasSeen.has(alias)) continue;
    aliasSeen.add(alias);
    const id = teamId.get(c);
    if (id) aliasRows.push({ alias, team_id: id });
  }
  if (aliasRows.length > 0) {
    const { error } = await supabase.from("team_aliases").upsert(aliasRows, { onConflict: "alias" });
    if (error) throw new Error(`team_aliases: ${error.message}`);
  }
  console.log(`Alias API sincronizados: ${aliasRows.length}`);

  // partidos
  const rows = json.matches.map((m) => ({
    league_id: leagueId,
    season: seasonOf(m.utcDate),
    kickoff: m.utcDate,
    home_team_id: teamId.get(apiNameToCanon(m.homeTeam.name))!,
    away_team_id: teamId.get(apiNameToCanon(m.awayTeam.name))!,
    status: mapStatus(m.status),
    home_goals: m.score.fullTime.home,
    away_goals: m.score.fullTime.away,
    external_ids: { fdId: m.id, fdStatus: m.status },
  }));
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("matches")
      .upsert(rows.slice(i, i + 200), {
        onConflict: "league_id,season,kickoff,home_team_id,away_team_id",
        ignoreDuplicates: false,
      });
    if (error) throw new Error(`matches lote ${i / 200 + 1}: ${error.message}`);
    upserted += Math.min(200, rows.length - i);
  }

  const counts = { scheduled: 0, live: 0, finished: 0 };
  for (const r of rows) counts[r.status]++;

  // api_usage
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await supabase
    .from("api_usage")
    .select("requests")
    .eq("provider", "football-data.org")
    .eq("day", day)
    .maybeSingle();
  const total = (((usage as { requests: number } | null)?.requests) ?? 0) + 1;
  await supabase.from("api_usage").upsert({ provider: "football-data.org", day, requests: total }, { onConflict: "provider,day" });

  console.log(`Equipos nuevos: ${missing.join(", ") || "-"}`);
  console.log(`Matches: ${upserted} upserted (scheduled=${counts.scheduled} live=${counts.live} finished=${counts.finished})`);
}

void main();
