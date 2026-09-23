// Paso 2 — Carga histórico CSV football-data.co.uk (E0 = Premier)
// Uso: npx tsx scripts/load-csv.ts [--write]
// Sin flags: dry-run (no toca Supabase). Con --write: upsert real.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import "./_env.js";

const RAW_DIR = join(process.cwd(), "data", "raw");

// Cortos del CSV -> canónico (el que usan las APIs). Lo no listado pasa tal cual y se reporta.
export const TEAM_CANONICAL: Record<string, string> = {
  "Man United": "Manchester United",
  "Man City": "Manchester City",
  "Nott'm Forest": "Nottingham Forest",
  Tottenham: "Tottenham Hotspur",
  Newcastle: "Newcastle United",
  Wolves: "Wolverhampton Wanderers",
  "West Ham": "West Ham United",
  Leeds: "Leeds United",
  "West Brom": "West Bromwich Albion",
  Sheffield: "Sheffield United",
  "Sheffield Utd": "Sheffield United",
  Leicester: "Leicester City",
  Norwich: "Norwich City",
  Ipswich: "Ipswich Town",
};

export function canon(name: string): string {
  const t = name.trim();
  return TEAM_CANONICAL[t] ?? t;
}

function seasonFromFile(file: string): number {
  const m = file.match(/E0_(\d\d)(\d\d)\.csv$/);
  if (!m) throw new Error(`Nombre inesperado: ${file} (esperaba E0_XXXX.csv)`);
  return 2000 + Number(m[1]); // 2122 -> 2021
}

function toInt(v: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// "15/08/2025" + "20:00" -> ISO UTC (MVP: se asume hora local UK ~= UTC; refinar en Fase 1 con timezone)
function kickoffISO(date: string, time: string): string {
  const [d, mo, y] = date.split("/").map(Number);
  const [h, mi] = (time || "15:00").split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi)).toISOString();
}

type Row = {
  file: string;
  season: number;
  date: string;
  time: string;
  kickoff: string;
  home: string;
  away: string;
  homeGoals: number | null;
  awayGoals: number | null;
  result: string;
  hs: number | null;
  as: number | null;
  hst: number | null;
  ast: number | null;
  hc: number | null;
  ac: number | null;
};

function loadFile(file: string): Row[] {
  const csv = readFileSync(join(RAW_DIR, file), "utf-8");
  const recs = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const season = seasonFromFile(file);
  return recs.map((r) => ({
    file,
    season,
    date: r.Date,
    time: r.Time,
    kickoff: kickoffISO(r.Date, r.Time),
    home: canon(r.HomeTeam),
    away: canon(r.AwayTeam),
    homeGoals: toInt(r.FTHG),
    awayGoals: toInt(r.FTAG),
    result: r.FTR,
    hs: toInt(r.HS),
    as: toInt(r.AS),
    hst: toInt(r.HST),
    ast: toInt(r.AST),
    hc: toInt(r.HC),
    ac: toInt(r.AC),
  }));
}

async function dryRun(all: Row[], files: string[]) {
  console.log("== DRY-RUN load-csv (no se escribe nada) ==");
  const teams = new Set<string>();
  all.forEach((r) => {
    teams.add(r.home);
    teams.add(r.away);
  });
  for (const f of files) {
    const rows = all.filter((r) => r.file === f);
    const bad = rows.filter((r) => r.homeGoals === null || r.awayGoals === null);
    console.log(`${f}: ${rows.length} filas | temporada=${rows[0]?.season} | sin resultado=${bad.length}`);
  }
  console.log(`Total: ${all.length} partidos | equipos únicos: ${teams.size}`);
  console.log("Equipos:", [...teams].sort().join(" | "));

  // duplicados por clave única
  const seen = new Set<string>();
  let dups = 0;
  for (const r of all) {
    const k = `${r.season}|${r.kickoff}|${r.home}|${r.away}`;
    if (seen.has(k)) dups++;
    seen.add(k);
  }
  console.log(`Duplicados por (season,kickoff,home,away): ${dups}`);

  // alias aplicados
  console.log("Alias aplicados:", Object.keys(TEAM_CANONICAL).join(", "));
  console.log("Muestra:");
  all.slice(0, 3).forEach((r) =>
    console.log(`  ${r.kickoff} ${r.home} ${r.homeGoals}-${r.awayGoals} ${r.away}`)
  );
  console.log("\nPara escribir a Supabase: npx tsx scripts/load-csv.ts --write");
}

async function write(all: Row[]) {
  const { createServerClient } = await import("../lib/supabase/server.js");
  const supabase = createServerClient();

  // liga (select-then-insert: no exige unique en name)
  const { data: existingLeague } = await supabase
    .from("leagues")
    .select("id")
    .eq("name", "Premier League")
    .maybeSingle();
  let leagueId: number;
  if (existingLeague) {
    leagueId = (existingLeague as { id: number }).id;
  } else {
    const { data, error } = await supabase
      .from("leagues")
      .insert({ name: "Premier League", country: "England", external_ids: { csv: "E0" } })
      .select("id")
      .single();
    if (error || !data) throw new Error(`leagues insert: ${error?.message}`);
    leagueId = (data as { id: number }).id;
  }
  console.log(`League Premier id=${leagueId}`);

  // equipos (select-then-insert en lote)
  const teams = [...new Set(all.flatMap((r) => [r.home, r.away]))].sort();
  const { data: existingTeams } = await supabase.from("teams").select("id,name").in("name", teams);
  const teamId = new Map(
    ((existingTeams ?? []) as Array<{ id: number; name: string }>).map((t) => [t.name, t.id])
  );
  const missing = teams.filter((n) => !teamId.has(n));
  if (missing.length > 0) {
    const { data: inserted, error } = await supabase
      .from("teams")
      .insert(missing.map((name) => ({ name })))
      .select("id,name");
    if (error) throw new Error(`teams insert: ${error.message}`);
    for (const t of (inserted ?? []) as Array<{ id: number; name: string }>) teamId.set(t.name, t.id);
  }
  console.log(`Equipos: ${teams.length} (${missing.length} nuevos)`);

  // alias: forma corta CSV -> canónico
  for (const [alias, canonical] of Object.entries(TEAM_CANONICAL)) {
    const id = teamId.get(canonical);
    if (!id) continue;
    await supabase.from("team_aliases").upsert({ alias, team_id: id }, { onConflict: "alias" });
  }

  // partidos (upsert en lotes de 200; duplicados ignorados -> re-ejecutable)
  const rows = all.map((r) => ({
    league_id: leagueId,
    season: r.season,
    kickoff: r.kickoff,
    home_team_id: teamId.get(r.home)!,
    away_team_id: teamId.get(r.away)!,
    status: "finished",
    home_goals: r.homeGoals,
    away_goals: r.awayGoals,
    home_shots: r.hs,
    away_shots: r.as,
    home_shots_on_target: r.hst,
    away_shots_on_target: r.ast,
    home_corners: r.hc,
    away_corners: r.ac,
    external_ids: { csv: r.file },
  }));
  let ok = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase
      .from("matches")
      .upsert(chunk, {
        onConflict: "league_id,season,kickoff,home_team_id,away_team_id",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`matches lote ${i / 200 + 1}: ${error.message}`);
    ok += chunk.length;
    console.log(`  lote ${i / 200 + 1}/${Math.ceil(rows.length / 200)} OK`);
  }
  console.log(`OK: ${ok}/${all.length} partidos procesados (upsert, duplicados ignorados)`);
}

async function main() {
  const files = readdirSync(RAW_DIR)
    .filter((f) => /^E0_\d{4}\.csv$/.test(f))
    .sort();
  if (files.length === 0) {
    console.error("No hay CSVs en data/raw (esperaba E0_*.csv)");
    process.exit(1);
  }
  const all = files.flatMap(loadFile);

  if (process.argv.includes("--write")) await write(all);
  else await dryRun(all, files);
}

void main();
