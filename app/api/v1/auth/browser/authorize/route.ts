import { authorizeNativeBrowserLogin, nativeBrowserRoute } from "@/lib/native-browser-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return nativeBrowserRoute(() => authorizeNativeBrowserLogin(request));
}
