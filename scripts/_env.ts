// Carga .env.local para scripts tsx (tsx no lo hace solo).
import { config } from "dotenv";
import { join } from "node:path";

config({ path: join(process.cwd(), ".env.local") });
