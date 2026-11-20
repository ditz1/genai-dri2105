import { notFound, redirect } from 'next/navigation';
import { getSheet } from '../../../lib/studio/sheets';
import { getUserAndProfile, hasName } from '../../../lib/supabase/server';
import Studio from '../studio';
import '../studio.css';

export const metadata = { title: 'Design sheet' };

export default async function SheetPage({ params }) {
  const { id } = await params;
  const { supabase, user, profile } = await getUserAndProfile();
  if (!user) redirect('/login');
  if (!hasName(profile)) redirect('/onboarding');
  const sheet = await getSheet(supabase, user, id);
  if (!sheet) notFound();
  return <Studio sheetId={sheet.id} initial={sheet.data} />;
}
