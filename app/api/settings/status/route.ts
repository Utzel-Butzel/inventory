import { auth0Enabled } from "@/auth";
import { users } from "@/db/schema";
import { getRequestIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  getConfiguredDefaultImageGenerationModel,
  getImageGenerationModelCatalog,
  resolveImageGenerationModel,
} from "@/lib/image-generation-models";
import { getStorageProvider } from "@/lib/storage";

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [localUser] = await db.select({ id: users.id }).from(users).limit(1);
  const imageCatalog = getImageGenerationModelCatalog();
  const defaultImageModel =
    resolveImageGenerationModel() ??
    getConfiguredDefaultImageGenerationModel();
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
      imageGeneration: imageCatalog.models.length > 0,
      imageProvider: defaultImageModel?.provider ?? "openai",
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
      role: identity.role,
      roleName: identity.roleName,
      permissions: identity.permissions,
    },
  });
}
