import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";

function cookieName(propertyId: string) {
  return `st_session_${propertyId}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  const jar = await cookies();
  const sid = jar.get(cookieName(propertyId))?.value ?? null;
  if (!sid) {
    return NextResponse.json({ error: "No session cookie" }, { status: 404 });
  }

  const db = createServiceClient();
  const sesRes = await db
    .from("sessions")
    .select("id, status, answers, property_id")
    .eq("id", sid)
    .eq("property_id", propertyId)
    .maybeSingle();

  if (sesRes.error) {
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }
  if (!sesRes.data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const msgRes = await db
    .from("messages")
    .select("id, role, content, created_at")
    .eq("session_id", sid)
    .order("created_at", { ascending: true });

  if (msgRes.error) {
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }

  return NextResponse.json({
    status: sesRes.data.status,
    answers: (sesRes.data.answers as Record<string, string> | null) ?? {},
    messages: (msgRes.data ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
      created_at: m.created_at as string,
    })),
  });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const db = createServiceClient();
  await db.from("sessions").delete().eq("id", sessionId);

  return NextResponse.json({ ok: true });
}

