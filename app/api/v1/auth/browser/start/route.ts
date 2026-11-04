import { startNativeBrowserLogin, nativeBrowserRoute } from "@/lib/native-browser-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return nativeBrowserRoute(() => startNativeBrowserLogin(request));
}
