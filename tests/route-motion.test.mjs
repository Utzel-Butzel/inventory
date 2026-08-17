import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("authenticated pages do not replay entrance motion after navigation", async () => {
  const pages = await Promise.all(
    [
      "components/dashboard-client.tsx",
      "components/stock-overview.tsx",
      "components/stock-workflow-builder.tsx",
    ].map(async (path) => [path, await source(path)]),
  );

  for (const [path, contents] of pages) {
    assert.doesNotMatch(contents, /\banimate-fade-up\b/, path);
    assert.doesNotMatch(contents, /\banimation-delay-[12]\b/, path);
  }
});

test("loading feedback and the separate login intro remain animated", async () => {
  const [dashboard, stock, workflows, login] = await Promise.all([
    source("components/dashboard-client.tsx"),
    source("components/stock-overview.tsx"),
    source("components/stock-workflow-builder.tsx"),
    source("app/login/page.tsx"),
  ]);

  assert.match(dashboard, /loading \? <DashboardLoading \/>/);
  assert.match(stock, /loading \? <StockLoading \/>/);
  assert.match(workflows, /<Skeleton\b/);
  assert.match(login, /\banimate-fade-up\b/);
});
