import Form from 'next/form';
import Link from 'next/link';
import LocalTime from '../local-time';

function responseOutput(request) {
  const response = Array.isArray(request.responses) ? request.responses[0] : request.responses;
  return response?.output ?? null;
}

export default function GenerationHistory({ requests, kind, status, shown, query }) {
  return <section className="admin-section" id="history">
    <h2>Generation requests &amp; LLM responses</h2>
    <p className="meta">Image and theme requests show the original prompt, effective instructions, model, duration, outcome and response. Image responses store metadata rather than image bytes. Earlier generations appear in Media; detailed history begins with this update.</p>
    <Form action="/admin" scroll={false} className="controls">
      <label>Type<select name="kind" defaultValue={kind}><option value="">All types</option><option value="image">Images</option><option value="theme">Themes</option></select></label>
      <label>Status<select name="status" defaultValue={status}><option value="">All statuses</option><option value="pending">Pending</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option></select></label>
      <button className="secondary">Filter history</button>
    </Form>
    {!requests.length && <p>No generation requests match these filters.</p>}
    <div className="admin-cards">
      {requests.slice(0, shown).map((request) => <article className="admin-card" key={request.id}>
        <p><strong>{request.kind === 'image' ? 'Image' : 'Theme'} generation</strong> <span className={`badge ${request.status === 'failed' ? 'error' : ''}`}>{request.status}</span></p>
        <p className="meta"><LocalTime value={request.created_at} /> · {request.provider} · <code>{request.model}</code> · {request.duration_ms == null ? 'In progress' : `${(request.duration_ms / 1000).toFixed(1)}s`}</p>
        <p className="meta">By {request.user ? `${request.user.first_name ?? ''} ${request.user.last_name ?? ''}`.trim() || 'Unnamed member' : 'Automatic theme creation'} · ID: <code>{request.id}</code></p>
        <p className="admin-prompt">{request.prompt}</p>
        {request.error_message && <p className="error">{request.error_message}</p>}
        {request.theme_id && <Link href={`/tournaments/${request.theme_id}`}>View theme / bracket</Link>}
        {request.post_id && <p className="meta">Media post: <code>{request.post_id}</code></p>}
        <details><summary>Request and response details</summary>
          <h3>Effective configuration</h3><pre>{JSON.stringify(request.input, null, 2)}</pre>
          <h3>LLM / AI response</h3><pre>{JSON.stringify(responseOutput(request), null, 2)}</pre>
        </details>
      </article>)}
    </div>
    {requests.length > shown && (shown < 200
      ? <p><Link scroll={false} href={`/admin?${new URLSearchParams({ ...query, history: String(shown + 25) })}#history`}>Show more requests</Link></p>
      : <p className="meta">Showing the latest 200 matching requests. Use the filters to narrow this view.</p>)}
  </section>;
}
