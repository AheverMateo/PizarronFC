// Paso 2 — Próximos 7 días + cuotas (solo lectura, ~2 requests)
// Uso: npx tsx scripts/fetch-next7d.ts
// Lee FOOTBALL_DATA_KEY y ODDS_API_KEY de .env.local. No guarda partidos (Fase 1).

import "./_env.js";
import { LEAGUE } from "../lib/config.js";

const fmt = (d: Date) => d.toISOString().slice(0, 10);

async function footballDataMatches(from: string, to: string) {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) {
    console.log("[football-data.org] sin FOOTBALL_DATA_KEY, se omite");
    return { matches: [], requests: 0 };
  }
  const url =
    `https://api.football-data.org/v4/competitions/${LEAGUE.footballDataCode}` +
    `/matches?dateFrom=${from}&dateTo=${to}`;
  const res = await fetch(url, { headers: { "X-Auth-Token": key } });
  if (!res.ok) {
    console.log(`[football-data.org] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { matches: [], requests: 1 };
  }
  const json = (await res.json()) as {
    matches?: Array<{
      utcDate: string;
      homeTeam: { name: string };
      awayTeam: { name: string };
      competition: { name: string };
    }>;
  };
  return { matches: json.matches ?? [], requests: 1 };
}

async function oddsApi() {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    console.log("[the-odds-api] sin ODDS_API_KEY, se omite");
    return { events: [], requests: 0 };
  }
  const url =
    `https://api.the-odds-api.com/v4/sports/${LEAGUE.oddsApiSportKey}/odds/` +
    `?apiKey=${key}&regions=uk,eu&markets=h2h,totals,btts&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`[the-odds-api] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { events: [], requests: 1 };
  }
  const json = (await res.json()) as Array<{
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Array<{
      title: string;
      markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point?: number }> }>;
    }>;
  }>;
  return { events: json, requests: 1 };
}

async function trackUsage(counts: Record<string, number>) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("(api_usage no registrado: falta Supabase en .env.local)");
    return;
  }
  const { createServerClient } = await import("../lib/supabase/server.js");
  const supabase = createServerClient();
  const day = new Date().toISOString().slice(0, 10);
  for (const [provider, n] of Object.entries(counts)) {
    if (!n) continue;
    const { data } = await supabase.from("api_usage").select("requests").eq("provider", provider).eq("day", day).maybeSingle();
    const total = ((data as { requests: number } | null)?.requests ?? 0) + n;
    await supabase.from("api_usage").upsert({ provider, day, requests: total }, { onConflict: "provider,day" });
    console.log(`api_usage: ${provider} ${day} = ${total}`);
  }
}

async function main() {
  const now = new Date();
  const from = fmt(now);
  const to = fmt(new Date(now.getTime() + 7 * 86400_000));
  console.log(`Ventana: ${from} -> ${to} (${LEAGUE.name})\n`);

  const fd = await footballDataMatches(from, to);
  console.log(`[football-data.org] ${fd.matches.length} partidos`);
  fd.matches.slice(0, 20).forEach((m) => {
    console.log(`  ${m.utcDate}  ${m.homeTeam.name} vs ${m.awayTeam.name}`);
  });

  const odds = await oddsApi();
  console.log(`\n[the-odds-api] ${odds.events.length} eventos con cuotas`);
  odds.events.slice(0, 20).forEach((e) => {
    const h2h = e.bookmakers[0]?.markets.find((mk) => mk.key === "h2h")?.outcomes
      .map((o) => `${o.name} ${o.price}`)
      .join(" | ");
    console.log(`  ${e.commence_time}  ${e.home_team} vs ${e.away_team}  [${e.bookmakers[0]?.title ?? "-"}: ${h2h ?? "s/c"}]`);
  });

  await trackUsage({ "football-data.org": fd.requests, "the-odds-api": odds.requests });
}

void main();
