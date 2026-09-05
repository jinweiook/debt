import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * service_role 客户端：绕过所有权限校验，只能在服务端使用。
 * 用于创建用户、重置密码等 Auth 管理操作。
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY 绝不能加 NEXT_PUBLIC_ 前缀，也不能进客户端 bundle。
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
