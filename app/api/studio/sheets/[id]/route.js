import { notFound, ownSheet, readStudioRequest } from '../../../../../lib/studio/request';
import { isSheetError, sanitizeSheet, summarize } from '../../../../../lib/studio/sheet';

// Saves a design sheet as it is edited. The browser sends the whole sheet; it is checked and cleaned here, and the
// winner it started from is kept as it was when the sheet was created.
export async function PATCH(request, { params }) {
  const { id } = await params;
  const { response, supabase, user, body } = await readStudioRequest(request, 420000);
  if (response) return response;
  const sheet = await ownSheet(supabase, user, id);
  if (!sheet) return notFound();
  let data;
  try {
    data = sanitizeSheet(body.data, { userId: user.id, sheetId: sheet.id, source: sheet.source ?? null });
  } catch (error) {
    if (!isSheetError(error)) throw error;
    return Response.json({ error: error.message }, { status: 400 });
  }
  const { error } = await supabase
    .from('design_sheets')
    .update({ title: data.title, data, summary: summarize(data), updated_at: new Date().toISOString() })
    .eq('id', sheet.id)
    .eq('user_id', user.id);
  if (error) {
    console.error('Failed to save design sheet:', error.message);
    return Response.json({ error: 'Could not save the sheet. Try again.' }, { status: 502 });
  }
  return Response.json({ ok: true });
}
