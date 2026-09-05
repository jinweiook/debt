import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** 浏览器端 Supabase 客户端（仅在需要客户端订阅/实时能力时使用） */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseKey);
}
