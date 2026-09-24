// Fase 2 — Backtest: entrena con 21/22+23/24+24/25, evalúa en 25/26
// Compara el Poisson contra cuotas de cierre (AvgH/AvgD/AvgA) sin margen.
// Uso: npx tsx scripts/backtest.ts
import "../scripts/_env.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { train, fitRho, fitShrinkage, withShrinkage, predict, type MatchInput } from "../lib/model/poisson.js";
import { canon } from "../lib/teams.js";

type TestRow = MatchInput & { avgH: number; avgD: number; avgA: number };

function loadAll(): { trainRows: MatchInput[]; testRows: TestRow[] } {
  const dir = join(process.cwd(), "data", "raw");
  const files = readdirSync(dir)
    .filter((f) => /^E0_\d{4}\.csv$/.test(f))
    .sort();
  const trainRows: MatchInput[] = [];
  const testRows: TestRow[] = [];
  for (const f of files) {
    const season = 2000 + Number(f.slice(3, 5));
    const recs = parse(readFileSync(join(dir, f), "utf-8"), {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];
    for (const r of recs) {
      const row: MatchInput = {
        home: canon(r.HomeTeam),
        away: canon(r.AwayTeam),
        hg: Number(r.FTHG),
        ag: Number(r.FTAG),
      };
      if (!Number.isFinite(row.hg) || !Number.isFinite(row.ag)) continue;
      if (season === 2025) {
        const avgH = Number(r.AvgH);
        const avgD = Number(r.AvgD);
        const avgA = Number(r.AvgA);
        if ([avgH, avgD, avgA].every((x) => Number.isFinite(x) && x > 1)) {
          testRows.push({ ...row, avgH, avgD, avgA });
        }
      } else {
        trainRows.push(row);
      }
    }
  }
  return { trainRows, testRows };
}

// Cuotas sin margen: p_justa = (1/cuota) / suma(1/cuota)
function fairProbs(avgH: number, avgD: number, avgA: number): [number, number, number] {
  const inv = [1 / avgH, 1 / avgD, 1 / avgA];
  const s = inv[0] + inv[1] + inv[2];
  return [inv[0] / s, inv[1] / s, inv[2] / s];
}

async function main() {
  const { trainRows, testRows } = loadAll();
  console.log(`Train: ${trainRows.length} partidos | Test (25/26): ${testRows.length}`);
  const base = train(trainRows);
  const shrinkage = fitShrinkage(trainRows, base);
  const shrunk = withShrinkage(base, shrinkage);
  shrunk.rho = fitRho(trainRows, shrunk);
  const model = shrunk;
  console.log(`shrinkage (estimado en train) = ${shrinkage}`);
  console.log(`rho Dixon-Coles (estimado en train) = ${model.rho}`);
  console.log(
    `Promedios liga train: local=${model.leagueHomeAvg.toFixed(3)} visita=${model.leagueAwayAvg.toFixed(3)}`
  );

  const eps = 1e-9;
  let brierModel = 0;
  let brierMarket = 0;
  let llModel = 0;
  let llMarket = 0;
  const brierByOutcome = { H: 0, D: 0, A: 0 };
  const nByOutcome = { H: 0, D: 0, A: 0 };
  let accModel = 0;
  let accMarket = 0;
  const bins: Array<{ sum: number; hit: number; n: number }> = Array.from({ length: 10 }, () => ({
    sum: 0,
    hit: 0,
    n: 0,
  }));

  for (const t of testRows) {
    const p = predict(t.home, t.away, model);
    const [fH, fD, fA] = fairProbs(t.avgH, t.avgD, t.avgA);
    const actual = t.hg > t.ag ? "H" : t.hg === t.ag ? "D" : "A";
    const pm = [p.pHome, p.pDraw, p.pAway];
    const pf = [fH, fD, fA];
    const o = [actual === "H" ? 1 : 0, actual === "D" ? 1 : 0, actual === "A" ? 1 : 0];

    brierModel += (pm[0] - o[0]) ** 2 + (pm[1] - o[1]) ** 2 + (pm[2] - o[2]) ** 2;
    brierMarket += (pf[0] - o[0]) ** 2 + (pf[1] - o[1]) ** 2 + (pf[2] - o[2]) ** 2;
    const idx = actual === "H" ? 0 : actual === "D" ? 1 : 2;
    llModel += -Math.log(Math.max(pm[idx], eps));
    llMarket += -Math.log(Math.max(pf[idx], eps));

    const key = actual as "H" | "D" | "A";
    brierByOutcome[key] += (pm[idx] - 1) ** 2;
    nByOutcome[key]++;

    const argM = pm.indexOf(Math.max(...pm));
    const argF = pf.indexOf(Math.max(...pf));
    if (argM === idx) accModel++;
    if (argF === idx) accMarket++;

    const bin = Math.min(9, Math.floor(p.pHome * 10));
    bins[bin].sum += p.pHome;
    bins[bin].hit += actual === "H" ? 1 : 0;
    bins[bin].n++;
  }

  const n = testRows.length;
  console.log("\n== 1X2: modelo vs mercado (cuota sin margen) ==");
  console.log(`Brier modelo=${(brierModel / n).toFixed(4)}  mercado=${(brierMarket / n).toFixed(4)} (menor es mejor)`);
  console.log(`LogLoss modelo=${(llModel / n).toFixed(4)}  mercado=${(llMarket / n).toFixed(4)}`);
  console.log(`Accuracy modelo=${(accModel / n).toFixed(3)}  mercado=${(accMarket / n).toFixed(3)}`);
  console.log(
    `Brier|H=${(brierByOutcome.H / nByOutcome.H).toFixed(4)} (n=${nByOutcome.H})  ` +
      `Brier|D=${(brierByOutcome.D / nByOutcome.D).toFixed(4)} (n=${nByOutcome.D})  ` +
      `Brier|A=${(brierByOutcome.A / nByOutcome.A).toFixed(4)} (n=${nByOutcome.A})`
  );

  console.log("\n== Calibración p(Home) por decil: predicho vs real ==");
  bins.forEach((b, i) => {
    if (!b.n) return;
    console.log(
      `  [${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}] n=${b.n} pred=${(b.sum / b.n).toFixed(3)} real=${(b.hit / b.n).toFixed(3)}`
    );
  });

  // Ejemplo concreto
  const ex = testRows[0];
  const pe = predict(ex.home, ex.away, model);
  console.log(
    `\nEjemplo: ${ex.home} ${ex.hg}-${ex.ag} ${ex.away} -> ` +
      `λ=${pe.lambdaH.toFixed(2)}/${pe.lambdaA.toFixed(2)} ` +
      `1X2=${(pe.pHome * 100).toFixed(1)}/${(pe.pDraw * 100).toFixed(1)}/${(pe.pAway * 100).toFixed(1)} ` +
      `O2.5=${(pe.totals["2.5"].over * 100).toFixed(1)} BTTS=${(pe.bttsYes * 100).toFixed(1)}`
  );
}

void main();
