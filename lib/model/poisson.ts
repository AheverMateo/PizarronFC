// Fase 2 — Modelo Poisson simple (MVP)
// Entrena fuerzas de ataque/defensa (local/visita) y predice vía matriz 0-8.
// Mejoras futuras: Dixon-Coles, recency weighting, xG.

export type MatchInput = { home: string; away: string; hg: number; ag: number };

export type Model = {
  version: string;
  leagueHomeAvg: number;
  leagueAwayAvg: number;
  attackH: Record<string, number>;
  defenseH: Record<string, number>;
  attackA: Record<string, number>;
  defenseA: Record<string, number>;
  rho: number; // Dixon-Coles (0 = Poisson independiente)
  shrinkage: number; // 1 = sin encoger, <1 = fuerzas hacia el promedio
};

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function train(matches: MatchInput[]): Model {
  let homeGoals = 0;
  let awayGoals = 0;
  const scoredH: Record<string, number> = {};
  const concededH: Record<string, number> = {};
  const gamesH: Record<string, number> = {};
  const scoredA: Record<string, number> = {};
  const concededA: Record<string, number> = {};
  const gamesA: Record<string, number> = {};

  for (const m of matches) {
    homeGoals += m.hg;
    awayGoals += m.ag;
    scoredH[m.home] = (scoredH[m.home] ?? 0) + m.hg;
    concededH[m.home] = (concededH[m.home] ?? 0) + m.ag;
    gamesH[m.home] = (gamesH[m.home] ?? 0) + 1;
    scoredA[m.away] = (scoredA[m.away] ?? 0) + m.ag;
    concededA[m.away] = (concededA[m.away] ?? 0) + m.hg;
    gamesA[m.away] = (gamesA[m.away] ?? 0) + 1;
  }

  const n = Math.max(matches.length, 1);
  const leagueHomeAvg = homeGoals / n;
  const leagueAwayAvg = awayGoals / n;

  const attackH: Record<string, number> = {};
  const defenseH: Record<string, number> = {};
  const attackA: Record<string, number> = {};
  const defenseA: Record<string, number> = {};
  const teams = new Set([...Object.keys(gamesH), ...Object.keys(gamesA)]);
  for (const t of teams) {
    // Sin historial (ascendidos) -> 1.0 = promedio de liga (prior neutro)
    attackH[t] = gamesH[t] ? scoredH[t] / gamesH[t] / leagueHomeAvg : 1;
    defenseH[t] = gamesH[t] ? concededH[t] / gamesH[t] / leagueHomeAvg : 1;
    attackA[t] = gamesA[t] ? scoredA[t] / gamesA[t] / leagueAwayAvg : 1;
    defenseA[t] = gamesA[t] ? concededA[t] / gamesA[t] / leagueAwayAvg : 1;
  }

  return { version: "poisson-dc-shrink-v1", leagueHomeAvg, leagueAwayAvg, attackH, defenseH, attackA, defenseA, rho: 0, shrinkage: 1 };
}

// Encoge fuerzas hacia 1 (promedio de liga): evita sobreconfianza en favoritos.
// alpha = 1 sin cambio; alpha = 0.7 mezcla 70% equipo + 30% promedio.
export function withShrinkage(model: Model, alpha: number): Model {
  const blend = (v: number) => 1 + alpha * (v - 1);
  const map = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, blend(v)]));
  return {
    ...model,
    attackH: map(model.attackH),
    defenseH: map(model.defenseH),
    attackA: map(model.attackA),
    defenseA: map(model.defenseA),
    shrinkage: alpha,
  };
}

function lambdas(home: string, away: string, model: Model): [number, number] {
  return [
    model.leagueHomeAvg * (model.attackH[home] ?? 1) * (model.defenseA[away] ?? 1),
    model.leagueAwayAvg * (model.attackA[away] ?? 1) * (model.defenseH[home] ?? 1),
  ];
}

// Log-likelihood de marcadores exactos (para ajustar hiperparámetros en train).
export function scorelineLL(matches: MatchInput[], model: Model): number {
  let ll = 0;
  for (const m of matches) {
    const [lh, la] = lambdas(m.home, m.away, model);
    const i = Math.min(m.hg, MAX_GOALS);
    const j = Math.min(m.ag, MAX_GOALS);
    ll += Math.log(
      Math.max(poissonPmf(i, lh) * poissonPmf(j, la) * dixonColesTau(i, j, lh, la, model.rho), 1e-12)
    );
  }
  return ll;
}

// Estima alpha (shrinkage) maximizando LL en el train.
export function fitShrinkage(matches: MatchInput[], model: Model): number {
  let best = 1;
  let bestLl = -Infinity;
  for (let a = 0.4; a <= 1.001; a += 0.05) {
    const ll = scorelineLL(matches, withShrinkage(model, a));
    if (ll > bestLl) {
      bestLl = ll;
      best = a;
    }
  }
  return Math.round(best * 100) / 100;
}

// Corrección Dixon-Coles: ajusta 0-0, 1-0, 0-1, 1-1 (el Poisson independiente
// subestima empates y marcadores bajos). rho se estima con los datos (ver fitRho).
export function dixonColesTau(i: number, j: number, lambdaH: number, lambdaA: number, rho: number): number {
  if (i === 0 && j === 0) return 1 - lambdaH * lambdaA * rho;
  if (i === 0 && j === 1) return 1 + lambdaH * rho;
  if (i === 1 && j === 0) return 1 + lambdaA * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

// Estima rho maximizando log-likelihood de marcadores exactos en el train.
export function fitRho(matches: MatchInput[], model: Model): number {
  let bestRho = 0;
  let bestLl = -Infinity;
  for (let rho = -0.15; rho <= 0.301; rho += 0.01) {
    const ll = scorelineLL(matches, { ...model, rho: Math.round(rho * 100) / 100 });
    if (ll > bestLl) {
      bestLl = ll;
      bestRho = rho;
    }
  }
  return Math.round(bestRho * 100) / 100;
}

export type TotalsLine = { over: number; under: number };

export type Prediction = {
  lambdaH: number;
  lambdaA: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  totals: Record<string, TotalsLine>; // "0.5".."3.5"
  bttsYes: number;
  bttsNo: number;
};

const MAX_GOALS = 8;

export function predict(home: string, away: string, model: Model): Prediction {
  const lambdaH = model.leagueHomeAvg * (model.attackH[home] ?? 1) * (model.defenseA[away] ?? 1);
  const lambdaA = model.leagueAwayAvg * (model.attackA[away] ?? 1) * (model.defenseH[home] ?? 1);

  const pmfH: number[] = [];
  const pmfA: number[] = [];
  for (let k = 0; k <= MAX_GOALS; k++) {
    pmfH.push(poissonPmf(k, lambdaH));
    pmfA.push(poissonPmf(k, lambdaA));
  }

  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let bttsYes = 0;
  let mass = 0;
  const totalDist: number[] = new Array(MAX_GOALS * 2 + 1).fill(0);

  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p =
        pmfH[i] *
        pmfA[j] *
        dixonColesTau(i, j, lambdaH, lambdaA, model.rho ?? 0);
      mass += p;
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
      if (i >= 1 && j >= 1) bttsYes += p;
      totalDist[i + j] += p;
    }
  }

  // Renormaliza (Dixon-Coles altera la masa total; el truncado 0-8 también)
  pHome /= mass;
  pDraw /= mass;
  pAway /= mass;
  bttsYes /= mass;
  for (let t = 0; t < totalDist.length; t++) totalDist[t] /= mass;

  const totals: Record<string, TotalsLine> = {};
  for (const line of [0.5, 1.5, 2.5, 3.5]) {
    let over = 0;
    for (let t = 0; t < totalDist.length; t++) {
      if (t > line) over += totalDist[t];
    }
    totals[String(line)] = { over, under: 1 - over };
  }

  return { lambdaH, lambdaA, pHome, pDraw, pAway, totals, bttsYes, bttsNo: 1 - bttsYes };
}
