// Verifica conexión a Supabase y que el schema esté aplicado. Solo lectura.
import "./_env.js";

async function main() {
  const { createServerClient } = await import("../lib/supabase/server.js");
  const supabase = createServerClient();

  const tables = ["leagues", "teams", "team_aliases", "matches", "odds", "predictions", "api_usage"];
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
    if (error) console.log(`${t}: ERROR ${error.message}`);
    else console.log(`${t}: OK (${count} filas)`);
  }
}

void main();
