import { createClient } from "@supabase/supabase-js";

// Solo uso en servidor (rutas API, scripts, crons). Nunca exponer la service key al cliente.
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}
