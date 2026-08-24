import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { getSession } from "@/server/services/auth-service";

async function main() {
  const s = await getSession("invalid-session-id-xyz");
  console.log("session:", JSON.stringify(s));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
