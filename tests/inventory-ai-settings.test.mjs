import assert from "node:assert/strict";
import test from "node:test";
import { defaultInventoryAiSettings, inventoryAiSettingsSchema, inventoryAiEnvironment } from "../lib/inventory-ai-settings.ts";
import { aiUsageEstimate } from "../lib/ai-billing.ts";
import { analyzeInventoryImages, researchInventoryDetails } from "../lib/ai.ts";

test("organization defaults preserve server configuration and research remains opt-in", () => {
  const defaults = defaultInventoryAiSettings({ OPENAI_VISION_MODEL: " vision ", OPENAI_RESEARCH_MODEL: " research ", AI_OUTPUT_LANGUAGE: " Deutsch " });
  assert.equal(defaults.analysisModel, "vision");
  assert.equal(defaults.researchModel, "research");
  assert.equal(defaults.language, "Deutsch");
  assert.equal(defaults.autoResearch, false);
  assert.equal(defaults.autoAnalyze, true);
  assert.equal(defaults.overwrite, true);
  for (const patch of [{ maximumImages: 0 }, { maximumImages: 4 }, { maximumImages: 1.5 }, { analysisModel: " " }, { language: " " }, { autoResearch: "true" }, { unknown: true }]) {
    assert.equal(inventoryAiSettingsSchema.safeParse({ ...defaults, ...patch }).success, false);
  }
});

test("paid calls use the saved models, language, image limit and correct budget model", async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-no-network";
  t.after(() => { if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; });
  const requests = [];
  const analysis = { title: "Bohrer", description: "Blauer Bohrer", type: "object", tags: ["bohrer"], altText: "Bohrer", confidence: 0.9 };
  const research = { title: "", additionalDescription: "", type: "object", tags: [], categories: [], sku: "", serialNumber: "", barcode: "", valueCents: null, currency: "", internalNotes: "", confidence: 0.1 };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return new Response(JSON.stringify({ id: "resp_test", object: "response", status: "completed", model: body.model, output: [{ type: "message", id: "msg_test", status: "completed", role: "assistant", content: [{ type: "output_text", annotations: [], text: JSON.stringify(body.tools ? research : analysis) }] }] }), { headers: { "Content-Type": "application/json" } });
  });
  const settings = { ...defaultInventoryAiSettings(), analysisModel: "custom-vision", researchModel: "custom-research", language: "German", maximumImages: 1 };
  const photos = ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="];
  const result = await analyzeInventoryImages(photos, undefined, settings);
  assert.equal(result.model, "custom-vision");
  assert.equal(result.result.title, "Bohrer");
  await researchInventoryDetails({ settings, resource: { name: "Bohrer" }, imageDataUrls: photos });
  for (const [i, body] of requests.entries()) {
    assert.equal(body.model, i === 0 ? "custom-vision" : "custom-research");
    assert.equal(body.input[0].content.filter(part => part.type === "input_image").length, 1);
    assert.match(body.input[0].content[0].text, /Write in German/);
  }
  assert.equal(requests[0].tools, undefined);
  assert.equal(requests[1].tools[0].type, "web_search");
  assert.equal(aiUsageEstimate({ action: "inventory_analysis", model: settings.analysisModel, environment: inventoryAiEnvironment(settings) }).model, "custom-vision");
  assert.equal(aiUsageEstimate({ action: "inventory_research", model: settings.researchModel, environment: inventoryAiEnvironment(settings) }).model, "custom-research");
});
