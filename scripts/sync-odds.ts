// Fase 1 — Sincroniza cuotas de The Odds API a Supabase (tabla odds).
// Guarda mejor precio por mercado/selección con su bookmaker. Dedupe por día.
// Costo: mercados(2) x regiones(2) = 4 créditos por corrida.
// Nota: btts no lo acepta el endpoint /odds de soccer_epl -> solo h2h + totals.
// Uso: npx tsx scripts/sync-odds.ts
import "../scripts/_env.js";
import { LEAGUE } from "../lib/config.js";
import { apiNameToCanon } from "../lib/teams.js";

type OddsEvent = {
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    title: string;
    markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point?: number }> }>;
  }>;
};

function eventKey(home: string, away: string, iso: string): string {
  return `${apiNameToCanon(home)}|${apiNameToCanon(away)}|${iso.slice(0, 10)}`;
}

async function main() {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("Falta ODDS_API_KEY en .env.local");

  const res = await fetch(
    `https://api.the-odds-api.com/v4/sports/${LEAGUE.oddsApiSportKey}/odds/` +
      `?apiKey=${key}&regions=uk,eu&markets=h2h,totals&oddsFormat=decimal`
  );
  if (!res.ok) throw new Error(`the-odds-api HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const events = (await res.json()) as OddsEvent[];
  console.log(`Eventos con cuotas: ${events.length}`);

  const { createServerClient } = await import("../lib/supabase/server.js");
  const supabase = createServerClient();

  // mapa de partidos de la temporada en curso: "home|away|YYYY-MM-DD" -> match_id
  const now = new Date();
  const season = now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const { data: matches } = await supabase
    .from("matches")
    .select("id,kickoff,home:home_team_id(name),away:away_team_id(name)")
    .eq("season", season);
  const matchByKey = new Map<string, number>();
  const asName = (v: unknown): string | null => {
    if (!v) return null;
    if (Array.isArray(v)) return (v[0] as { name: string } | undefined)?.name ?? null;
    return (v as { name: string }).name ?? null;
  };
  for (const m of (matches ?? []) as Array<{ id: number; kickoff: string; home: unknown; away: unknown }>) {
    const hn = asName(m.home);
    const an = asName(m.away);
    if (!hn || !an) continue;
    matchByKey.set(`${hn}|${an}|${(m.kickoff as string).slice(0, 10)}`, m.id as number);
  }

  type Row = {
    match_id: number;
    bookmaker: string;
    market: string;
    selection: string;
    line: number | null;
    price: number;
  };
  // mejor precio por (match, market, selection, line)
  const best = new Map<string, Row>();
  let matched = 0;
  const unmatched: string[] = [];
  for (const e of events) {
    const id = matchByKey.get(eventKey(e.home_team, e.away_team, e.commence_time));
    if (!id) {
      unmatched.push(`${e.home_team} vs ${e.away_team}`);
      continue;
    }
    matched++;
    for (const b of e.bookmakers) {
      for (const mk of b.markets) {
        const market = mk.key === "h2h" ? "1x2" : mk.key; // h2h | totals | btts
        for (const o of mk.outcomes) {
          let selection = o.name;
          if (market === "1x2") {
            selection =
              o.name === e.home_team ? "home" : o.name === e.away_team ? "away" : "draw";
          } else if (market === "btts") {
            selection = o.name === "Yes" ? "yes" : "no";
          } else {
            selection = o.name === "Over" ? "over" : "under";
          }
          const line = o.point ?? null;
          const k = `${id}|${market}|${selection}|${line}`;
          const cur = best.get(k);
          if (!cur || o.price > cur.price) {
            best.set(k, { match_id: id, bookmaker: b.title, market, selection, line, price: o.price });
          }
        }
      }
    }
  }

  const rows = [...best.values()];
  const ids = [...new Set(rows.map((r) => r.match_id))];
  const today = new Date().toISOString().slice(0, 10);
  if (ids.length > 0) {
    const { error: delErr } = await supabase
      .from("odds")
      .delete()
      .in("match_id", ids)
      .gte("fetched_at", `${today}T00:00:00Z`);
    if (delErr) throw new Error(`odds delete: ${delErr.message}`);
    const { error: insErr } = await supabase.from("odds").insert(rows);
    if (insErr) throw new Error(`odds insert: ${insErr.message}`);
  }

  // api_usage (1 request; ~6 créditos)
  const { data: usage } = await supabase
    .from("api_usage")
    .select("requests")
    .eq("provider", "the-odds-api")
    .eq("day", today)
    .maybeSingle();
  const total = (((usage as { requests: number } | null)?.requests) ?? 0) + 1;
  await supabase.from("api_usage").upsert({ provider: "the-odds-api", day: today, requests: total }, { onConflict: "provider,day" });

  console.log(`Eventos matcheados: ${matched}/${events.length} | filas odds: ${rows.length}`);
  if (unmatched.length > 0) console.log(`Sin match: ${unmatched.join("; ")}`);
}

void main();
