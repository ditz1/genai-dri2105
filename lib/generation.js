export const defaultImageModel = '@cf/black-forest-labs/flux-1-schnell';
export const defaultThemeModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export async function getGenerationConfig(supabase, kind) {
  if (!supabase) return { model: kind === 'image' ? defaultImageModel : process.env.CLOUDFLARE_THEME_MODEL?.trim() || defaultThemeModel,
    outputFormat: kind === 'image' ? 'image-base64' : 'json', provider: 'Cloudflare Workers AI',
    parameters: kind === 'image' ? { steps: 4 } : { max_tokens: 256 }, instructions: '' };
  const { data: settings, error } = await supabase.from('app_settings')
    .select('image_model_id,theme_model_id,image_prompt_prefix,theme_instructions').single();
  if (error) throw new Error('Could not load generation settings. Apply the admin observability migration.');
  const { data: model, error: modelError } = await supabase.from('llm_models')
    .select('model_key,capability,output_format,parameters,enabled,provider:llm_providers(name,adapter,enabled)')
    .eq('id', settings[`${kind}_model_id`]).single();
  if (modelError || !model?.enabled || !model.provider?.enabled || model.provider.adapter !== 'cloudflare' || model.capability !== kind) {
    throw new Error(`Choose an enabled Cloudflare ${kind} model in the admin settings.`);
  }
  if (!/^@(cf|hf)\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i.test(model.model_key)) {
    throw new Error('Cloudflare model IDs must include @cf or @hf, an author, and a model name.');
  }
  return { model: model.model_key, outputFormat: model.output_format, provider: model.provider.name,
    parameters: model.parameters, instructions: kind === 'image' ? settings.image_prompt_prefix : settings.theme_instructions };
}

// The callback's audit output is deliberately small: image bytes and credentials never enter history.
export async function runGeneration({ supabase, kind, prompt, userId, themeId }, generate) {
  const config = await getGenerationConfig(supabase, kind);
  let requestId;
  const started = Date.now();
  if (supabase) {
    const { data, error } = await supabase.from('generation_requests').insert({
      ...(userId && { user_id: userId }), theme_id: themeId ?? null, kind, prompt,
      model: config.model, provider: config.provider,
      input: { instructions: config.instructions, parameters: config.parameters, output_format: config.outputFormat },
    }).select('id').single();
    if (error) throw new Error('Could not record the generation request.');
    requestId = data.id;
  }
  async function complete(succeeded, output, failure = null) {
    if (!requestId) return;
    const { error } = await supabase.rpc('complete_generation_request', {
      target_request: requestId, succeeded, response_output: output,
      elapsed_ms: Date.now() - started, failure,
    });
    if (error) throw new Error('Could not record the generation response.');
  }
  let result;
  try {
    result = await generate(config);
  } catch (error) {
    try { await complete(false, { error: error.message }, error.message); }
    catch (loggingError) { console.error(loggingError.message); }
    throw error;
  }
  await complete(true, result.audit ?? {});
  const { audit, ...value } = result;
  return { ...value, model: config.model, ...(requestId && { requestId }) };
}
