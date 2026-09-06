import { chainRequest } from "@/lib/action-chain-http";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => chainRequest(request, true);
