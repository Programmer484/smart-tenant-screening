import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | null = null;

/**
 * Service-role client — bypasses RLS entirely.
 * Only import in API Route Handlers (never in client components or Server Components
 * that render user-visible pages).
 */
export function createServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;
  
  serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      }
    }
  );
  
  return serviceClient;
}
