// Config central del proyecto — Paso 1
// Una sola liga inicial: Premier League

export const LEAGUE = {
  name: "Premier League",
  country: "England",
  // football-data.org: competition code
  footballDataCode: "PL",
  // API-Football: league id (verificar con plan gratis)
  apiFootballId: 39,
  // The Odds API: sport key
  oddsApiSportKey: "soccer_epl",
} as const;

// Límites vistos en septiembre 2026 — verificar con tu propia key
export const API_LIMITS = {
  footballDataOrg: { perMinute: 10, competitions: 12 },
  apiFootball: { perDay: 100, perMinute: 10 },
  oddsApi: { creditsPerMonth: 500 },
} as const;

// Temporadas para el histórico CSV (football-data.co.uk, código E0)
export const HISTORIC_SEASONS = ["2122", "2223", "2324", "2425", "2526"] as const;

export const CSV_BASE_URL = "https://www.football-data.co.uk/mmz4281";
