import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rec = body as Record<string, unknown>;
  const propertyId = typeof rec.propertyId === "string" ? rec.propertyId : null;
  const title      = typeof rec.title === "string" ? rec.title.trim() : "Untitled";
  const scenario   = typeof rec.scenario === "string" ? rec.scenario.trim() : "";
  const outcome    = typeof rec.outcome === "string" ? rec.outcome : "in_progress";
  const answers    = rec.answers && typeof rec.answers === "object" ? rec.answers as Record<string, string> : {};
  const messages   = Array.isArray(rec.messages) ? rec.messages as { role: string; content: string }[] : [];

  const dbStatus = outcome === "qualified" ? "qualified"
    : outcome === "rejected"  ? "rejected"
    : outcome === "review"    ? "review"
    : "in_progress";

  const db = createServiceClient();

  const sessionId = crypto.randomUUID();
  const { error: sessionErr } = await db.from("sessions").insert({
    id: sessionId,
    listing_title: `[Test] ${title}`,
    status: dbStatus,
    answers,
    message_count: messages.length,
    property_id: propertyId,
    is_test: true,
    test_scenario: scenario,
    updated_at: new Date().toISOString(),
  });

  if (sessionErr) {
    // is_test / test_scenario columns may not exist yet — fall back without them
    const { error: fallbackErr } = await db.from("sessions").insert({
      id: sessionId,
      listing_title: `[Test] ${title}`,
      status: dbStatus,
      answers,
      message_count: messages.length,
      property_id: propertyId,
      updated_at: new Date().toISOString(),
    });
    if (fallbackErr) return NextResponse.json({ error: fallbackErr.message }, { status: 500 });
  }

  if (messages.length > 0) {
    const rows = messages.map((m) => ({
      session_id: sessionId,
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content ?? ""),
    }));
    await db.from("messages").insert(rows);
  }

  return NextResponse.json({ sessionId });
}
