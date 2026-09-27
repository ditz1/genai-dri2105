import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Null when the project isn't configured, so the page can still render the scene.
export const supabase = url && key ? createClient(url, key) : null;
