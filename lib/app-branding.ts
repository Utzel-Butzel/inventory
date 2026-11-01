export type AppBranding = {
  name: string | null;
  logoUrl: string | null;
};

/** Read at request time so one container image supports different deployments. */
export function getAppBranding(env: NodeJS.ProcessEnv = process.env): AppBranding {
  const name = env.APP_NAME?.trim() || null;
  const candidate = env.APP_LOGO_URL?.trim();
  let logoUrl: string | null = null;
  if (candidate) {
    try {
      const url = new URL(candidate);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
        logoUrl = url.href;
      }
    } catch {
      // Invalid optional branding must not prevent signing in.
    }
  }
  return { name, logoUrl };
}
