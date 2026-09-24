// Nombres canónicos de equipos (los que usan las APIs).
// El CSV de football-data.co.uk usa formas cortas; se normalizan aquí.

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

// Nombres de football-data.org ("Arsenal FC", "AFC Bournemouth") -> canónico.
// Orden: quita prefijo AFC / sufijos FC-AFC, colapsa casos especiales, aplica canon().
const API_SPECIAL: Record<string, string> = {
  "Brighton & Hove Albion": "Brighton",
  "Brighton and Hove Albion": "Brighton",
  Wolverhampton: "Wolverhampton Wanderers",
  Bournemouth: "Bournemouth",
};

export function apiNameToCanon(apiName: string): string {
  let n = apiName.trim();
  n = n.replace(/^AFC\s+/i, "");
  n = n.replace(/\s+(AFC|FC)$/i, "");
  n = API_SPECIAL[n] ?? n;
  return canon(n);
}
