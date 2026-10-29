export const catalogs = {
  providers: { table: 'llm_providers', title: 'LLM providers', fields: [
    { name: 'name', label: 'Name', maxLength: 80 },
    { name: 'adapter', label: 'Connection', choices: [['cloudflare', 'Cloudflare Workers AI'], ['catalogue', 'Catalogue only']], defaultValue: 'catalogue' },
    { name: 'enabled', label: 'Enabled', type: 'checkbox', defaultValue: true },
  ] },
  models: { table: 'llm_models', title: 'LLM / image models', fields: [
    { name: 'name', label: 'Name', maxLength: 80 },
    { name: 'provider_id', label: 'Provider', source: 'providers' },
    { name: 'model_key', label: 'Cloudflare model ID', maxLength: 200, placeholder: '@cf/author/model-name' },
    { name: 'capability', label: 'Used for', choices: [['image', 'Image generation'], ['theme', 'Theme generation']] },
    { name: 'output_format', label: 'Response format', choices: [['image-base64', 'Base64 image (FLUX)'], ['image-binary', 'Image file (SDXL)'], ['json', 'JSON (themes)']] },
    { name: 'parameters', label: 'Model parameters (JSON)', type: 'textarea', defaultValue: '{}', maxLength: 2000 },
    { name: 'enabled', label: 'Enabled', type: 'checkbox', defaultValue: true },
  ] },
  examples: { table: 'ai_generation_examples', title: 'AI generation examples', fields: [
    { name: 'title', label: 'Title', maxLength: 80 },
    { name: 'prompt', label: 'Example prompt', type: 'textarea', maxLength: 500 },
    { name: 'notes', label: 'Notes', type: 'textarea', maxLength: 1000, optional: true },
    { name: 'post_id', label: 'Media post ID (optional)', optional: true, maxLength: 36 },
  ] },
  domains: { table: 'allowed_signup_domains', title: 'Allowed signup domains', fields: [
    { name: 'domain', label: 'Domain', placeholder: 'example.edu', maxLength: 253 },
  ] },
  emails: { table: 'whitelisted_emails', title: 'Whitelisted email addresses', fields: [
    { name: 'email', label: 'Email address', type: 'email', maxLength: 254 },
  ] },
};

export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function readCatalogRecord(kind, formData) {
  const catalog = Object.hasOwn(catalogs, kind) ? catalogs[kind] : null;
  if (!catalog) return { error: 'Unknown record type.' };
  const values = {};
  for (const field of catalog.fields) {
    if (field.type === 'checkbox') { values[field.name] = formData.get(field.name) === 'on'; continue; }
    let value = String(formData.get(field.name) ?? '').trim();
    if ((!field.optional && !value) || (field.maxLength && value.length > field.maxLength)) return { error: `Enter a valid ${field.label.toLowerCase()}.` };
    if (field.choices && !field.choices.some(([choice]) => choice === value)) return { error: `Choose a valid ${field.label.toLowerCase()}.` };
    if (field.source && !isUuid(value)) return { error: 'Choose a provider.' };
    if (field.name === 'post_id' && value && !isUuid(value)) return { error: 'Enter a valid media post ID.' };
    if (field.name === 'domain') {
      value = value.toLowerCase();
      if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(value)) return { error: 'Enter a domain such as example.edu, without @ or a URL.' };
    }
    if (field.name === 'email') {
      value = value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: 'Enter a valid email address.' };
    }
    values[field.name] = field.name === 'post_id' && !value ? null : value;
  }
  if (kind === 'models') {
    if (!/^[@a-zA-Z0-9/_.-]+$/.test(values.model_key) || values.model_key.split('/').some((part) => part === '.' || part === '..')) return { error: 'Enter a model ID without spaces, relative paths or URL parameters.' };
    if ((values.capability === 'theme') !== (values.output_format === 'json')) return { error: 'Theme models need JSON output; image models need an image output format.' };
    try { values.parameters = JSON.parse(values.parameters); } catch { return { error: 'Model parameters must be valid JSON.' }; }
    const limits = { steps: [1, 50], num_steps: [1, 50], max_tokens: [32, 1024], width: [256, 2048], height: [256, 2048], seed: [0, 2147483647], guidance: [0, 20] };
    if (!values.parameters || Array.isArray(values.parameters) || typeof values.parameters !== 'object') return { error: 'Model parameters must be a JSON object.' };
    for (const [key, value] of Object.entries(values.parameters)) {
      if (!Object.hasOwn(limits, key) || !Number.isFinite(value) || value < limits[key][0] || value > limits[key][1]
        || (key !== 'guidance' && !Number.isInteger(value))
        || (values.capability === 'theme' ? key !== 'max_tokens' : key === 'max_tokens')) return { error: `Unsupported model parameter: ${key}. Use parameters appropriate to the selected model.` };
    }
  }
  return { catalog, values };
}
