import { catalogs } from '../../lib/admin-catalog';
import { CatalogForm } from './catalog-forms';

export default function CatalogSection({ kind, records, providers }) {
  return <section className="admin-section" id={kind}>
    <h2>{catalogs[kind].title}</h2>
    {kind === 'providers' && <p className="meta">Cloudflare connections reuse the server credentials. Other providers can be kept in the catalogue; generation requires a supported connection.</p>}
    {kind === 'models' && <p className="meta">Add a Cloudflare model ID, its output format and supported parameters. FLUX uses {`{"steps":4}`}; SDXL uses {`{"num_steps":20}`}; themes use {`{"max_tokens":256}`}. Select active models in Generation settings.</p>}
    <details className="admin-card"><summary>Add {kind === 'emails' ? 'email address' : kind === 'domains' ? 'domain' : 'record'}</summary>
      <CatalogForm kind={kind} providers={providers} />
    </details>
    {!records.length && <p className="meta">No records yet.</p>}
    <div className="admin-cards">
      {records.map((record) => <details className="admin-card" key={record.id}>
        <summary>{record.name ?? record.title ?? record.domain ?? record.email}
          {record.capability && <span className="badge">{record.capability}</span>}
          {record.enabled === false && <span className="badge">disabled</span>}
        </summary>
        {record.model_key && <p className="meta"><code>{record.model_key}</code></p>}
        <CatalogForm kind={kind} record={record} providers={providers} />
      </details>)}
    </div>
  </section>;
}
