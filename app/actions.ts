"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NAME_FIELD } from "@/lib/landlord-field";

export async function createNewProperty(formData: FormData) {
  const title = (formData.get("title") as string) || "New Property";
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("properties")
    .insert({ user_id: user.id, title, slug, status: "draft", fields: [NAME_FIELD] })
    .select("id")
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error("A property with this name already exists.");
    }
    throw new Error("Failed to create property");
  }
  if (!data) throw new Error("Failed to create property");
  
  return { id: data.id };
}

export async function deleteProperty(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("properties").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error("Failed to delete property");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
