import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCatalogRecord } from '../lib/admin-catalog.js';

const form = (values) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const model = { name: 'Llama', provider_id: '11111111-1111-1111-1111-111111111111', model_key: '@cf/meta/llama', capability: 'theme', output_format: 'json', parameters: '{"max_tokens":256}', enabled: 'on' };

test('only recognized catalogues can be modified', () => {
  for (const kind of ['profiles', 'admins', '__proto__', 'constructor']) assert.ok(readCatalogRecord(kind, form({})).error);
});
test('signup domains and email addresses are normalized and validated', () => {
  assert.equal(readCatalogRecord('domains', form({ domain: ' Example.EDU ' })).values.domain, 'example.edu');
  assert.equal(readCatalogRecord('emails', form({ email: ' Member@Example.EDU ' })).values.email, 'member@example.edu');
  for (const domain of ['https://example.edu', '@example.edu', 'a..edu', '-a.edu', 'a-.edu', '*.example.edu']) assert.ok(readCatalogRecord('domains', form({ domain })).error);
  for (const email of ['a', 'a@@example.edu', 'a b@example.edu', 'a@example']) assert.ok(readCatalogRecord('emails', form({ email })).error);
});
test('models require a valid provider and compatible output format', () => {
  assert.equal(readCatalogRecord('models', form(model)).values.parameters.max_tokens, 256);
  assert.ok(readCatalogRecord('models', form({ ...model, provider_id: 'invalid' })).error);
  assert.ok(readCatalogRecord('models', form({ ...model, capability: 'image' })).error);
  assert.ok(readCatalogRecord('models', form({ ...model, model_key: '@cf/model?key=bad' })).error);
  assert.ok(readCatalogRecord('models', form({ ...model, model_key: '@cf/../../other-endpoint' })).error);
});
test('model parameters cannot replace prompts, headers or transport configuration', () => {
  for (const parameters of ['null', '[]', '"string"', '{', '{"prompt":"replace"}', '{"messages":[]}', '{"Authorization":"secret"}', '{"stream":true}', '{"max_tokens":100000}', '{"max_tokens":1.5}', '{"steps":4}']) {
    assert.ok(readCatalogRecord('models', form({ ...model, parameters })).error, parameters);
  }
  assert.equal(readCatalogRecord('models', form({ ...model, capability: 'image', output_format: 'image-base64', parameters: '{"steps":4}' })).values.parameters.steps, 4);
});
test('examples validate optional media references and text limits', () => {
  assert.equal(readCatalogRecord('examples', form({ title: 'Example', prompt: 'A moonlit garden', notes: '', post_id: '' })).values.post_id, null);
  assert.ok(readCatalogRecord('examples', form({ title: 'Example', prompt: 'A garden', post_id: 'bad' })).error);
  assert.ok(readCatalogRecord('examples', form({ title: 'Example', prompt: 'x'.repeat(501) })).error);
});
