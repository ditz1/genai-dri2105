import AsciiScene from './scene';
import { supabase } from '../lib/supabase';

// Read from Supabase on every request so table edits show up without a rebuild.
export const dynamic = 'force-dynamic';

async function getStrings() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('strings').select('id, language, locale, text').order('id');
  if (error) {
    console.error('Failed to load strings from Supabase:', error.message);
    return [];
  }
  return data;
}

export default async function Home() {
  const strings = await getStrings();
  const lines = strings.length > 0 ? strings.map(({ text }) => text) : ['hello', 'world'];
  return (
    <AsciiScene lines={lines}>
      {strings.length > 0 && (
        <ul className="sr-only" aria-label="hello world in other languages">
          {strings.map(({ id, language, locale, text }) => (
            <li key={id} lang={locale}>{text} ({language})</li>
          ))}
        </ul>
      )}
    </AsciiScene>
  );
}
