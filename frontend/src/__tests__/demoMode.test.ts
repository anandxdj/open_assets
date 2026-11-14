import assert from "node:assert/strict";
import { test } from "node:test";
import { getAiStatus } from "../app/api/studio/_lib/aiStatus";
import { demoModeMessage } from "../lib/demo-mode";

test("the server reports demo mode only for OPENROUTER_MOCK=1", () => {
  assert.equal(getAiStatus({ OPENROUTER_MOCK: "1" }).mock, true);
  assert.equal(getAiStatus({ OPENROUTER_MOCK: "0" }).mock, false);
  assert.equal(getAiStatus({ OPENROUTER_MOCK: "true" }).mock, false);
  assert.equal(getAiStatus({}).mock, false);
});

test("a provider counts as configured with an OpenRouter or Open Quota key, and blank keys do not count", () => {
  assert.equal(getAiStatus({}).providerConfigured, false);
  assert.equal(getAiStatus({ OPENROUTER_API_KEY: "  ", OPENQUOTA_API_KEY: "" }).providerConfigured, false);
  assert.equal(getAiStatus({ OPENROUTER_API_KEY: "k" }).providerConfigured, true);
  assert.equal(getAiStatus({ OPENQUOTA_API_KEY: "k" }).providerConfigured, true);
});

test("the status never carries a key value", () => {
  const status = getAiStatus({ OPENROUTER_MOCK: "1", OPENROUTER_API_KEY: "sk-secret", OPENQUOTA_API_KEY: "oq-secret" });
  assert.deepEqual(Object.keys(status).sort(), ["mock", "providerConfigured"]);
  assert.doesNotMatch(JSON.stringify(status), /secret/);
});

test("the notice shows only in demo mode, and says what to add when no provider is set", () => {
  assert.equal(demoModeMessage(null), null);
  assert.equal(demoModeMessage({ mock: false, providerConfigured: false }), null);
  assert.equal(demoModeMessage({ mock: false, providerConfigured: true }), null);
  assert.match(demoModeMessage({ mock: true, providerConfigured: false }) ?? "", /No AI provider is configured.*placeholders.*OpenRouter or Open Quota key/);
  assert.match(demoModeMessage({ mock: true, providerConfigured: true }) ?? "", /placeholders/);
  assert.doesNotMatch(demoModeMessage({ mock: true, providerConfigured: true }) ?? "", /No AI provider/);
});
