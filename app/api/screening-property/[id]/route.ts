import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * Serves property config for the public /chat page. The browser client cannot
 * rely on RLS for anonymous applicants, so this route uses the service client
 * and enforces: published listing for everyone, or draft only for the owner
 * when ?preview=1 and the request carries their session cookies.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const preview = url.searchParams.get("preview") === "1";

  const db = createServiceClient();
  const { data: row, error } = await db
    .from("properties")
    .select(
      "id, user_id, title, description, variables, fields, questions, rules, links, ai_instructions, published_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[screening-property]", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (row.published_at) {
    return NextResponse.json({ property: row });
  }

  if (preview) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id === row.user_id) {
      return NextResponse.json({ property: row });
    }
  }

  return NextResponse.json(
    {
      code: "unpublished" as const,
      property: {
        id: row.id,
        title: row.title,
        description: row.description,
        links: row.links,
        ai_instructions: row.ai_instructions,
      },
    },
    { status: 403 },
  );
}
