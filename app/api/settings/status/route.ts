import { auth0Enabled } from "@/auth";
import { users } from "@/db/schema";
import { requireIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const [localUser] = await db.select({ id: users.id }).from(users).limit(1);
  const imageProvider = (process.env.IMAGE_EDIT_PROVIDER ?? "openai").toLowerCase();
  return Response.json({
    storage: {
      provider: getStorageProvider(),
      configured:
        getStorageProvider() === "local"
          ? true
          : Boolean(process.env.OPENINARY_BASE_URL && process.env.OPENINARY_API_KEY),
    },
    ai: {
      analysis: Boolean(process.env.OPENAI_API_KEY),
      imageGeneration:
        imageProvider === "google"
          ? Boolean(process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY)
          : Boolean(process.env.OPENAI_API_KEY),
      imageProvider,
    },
    auth: {
      password: Boolean(
        localUser ||
          process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH ||
          process.env.BOOTSTRAP_ADMIN_PASSWORD ||
          process.env.SIMPLE_AUTH_PASSWORD_HASH ||
          process.env.SIMPLE_AUTH_PASSWORD,
      ),
      auth0: auth0Enabled,
    },
    user: {
      role: authorization.identity.role,
    },
  });
}
