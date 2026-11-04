/** Keep the originating item/device when entering or leaving the editor. */
export function labelWorkspaceHref(search: string) {
  const input = new URLSearchParams(search);
  const query = new URLSearchParams();
  for (const key of ["resourceId", "unitId"]) {
    const value = input.get(key);
    if (value) query.set(key, value);
  }
  return `/labels${query.size ? `?${query}` : ""}`;
}

export function labelEditorHref(setupId: string, search: string, copyFrom?: string) {
  const query = new URLSearchParams(labelWorkspaceHref(search).split("?")[1]);
  if (copyFrom) query.set("copyFrom", copyFrom);
  return `/labels/editor/${encodeURIComponent(setupId)}${query.size ? `?${query}` : ""}`;
}
