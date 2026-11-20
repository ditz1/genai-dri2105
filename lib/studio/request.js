// Shared request handling for the studio's API routes: who is asking, what they sent, and how failures are reported.
import { createClient } from '../supabase/server';
import { QuotaError } from './cloudflare';
import { isUuid } from './sheet';

// Returns { supabase, user, body }, or { response } when the request can't go ahead. The proxy leaves /api alone,
// so signed-out requests are turned away here with a status the studio can explain.
export async function readStudioRequest(request, limit) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: Response.json({ error: 'Your session has ended. Log in again to keep going.', code: 'auth' }, { status: 401 }) };
  try {
    const text = await request.text();
    if (text.length > limit) return { response: Response.json({ error: 'That request is too large.' }, { status: 413 }) };
    return { supabase, user, body: JSON.parse(text) ?? {} };
  } catch {
    return { response: Response.json({ error: 'The request could not be read.' }, { status: 400 }) };
  }
}

// The member's own sheet, or null. Generation is only ever done for a sheet that exists and belongs to the caller.
export async function ownSheet(supabase, user, sheetId) {
  if (!isUuid(sheetId)) return null;
  const { data, error } = await supabase.from('design_sheets').select('id, theme_id, source:data->source').eq('id', sheetId).eq('user_id', user.id).maybeSingle();
  if (error) console.error('Failed to load design sheet:', error.message);
  return data ?? null;
}

export const notFound = () => Response.json({ error: 'That design sheet could not be found.' }, { status: 404 });

export function failure(error) {
  if (error instanceof QuotaError) return Response.json({ error: error.message, code: 'quota' }, { status: 429 });
  console.error('Design sheet generation failed:', error.message);
  return Response.json({ error: error.message || 'Generation failed.' }, { status: 502 });
}
