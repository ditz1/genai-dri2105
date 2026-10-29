import { notFound, redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (isAdmin !== true) notFound();
  return { supabase, user };
}
