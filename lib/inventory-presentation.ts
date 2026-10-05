/** Keep full source data; only condense its presentation in the inventory list. */
export function inventoryTagSummary(tags: readonly string[], limit = 3) {
  const seen = new Set<string>();
  const unique = tags.map((tag) => tag.trim()).filter((tag) => {
    const key = tag.normalize("NFKC").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { visible: unique.slice(0, limit), hidden: unique.slice(limit) };
}
