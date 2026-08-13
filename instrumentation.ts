export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTranslationWorker } = await import(
    "@/lib/translation-worker-runtime"
  );
  const { startNotificationWorker } = await import(
    "@/lib/notification-worker-runtime"
  );
  const { startWebhookWorker } = await import(
    "@/lib/webhook-worker-runtime"
  );
  startTranslationWorker();
  startNotificationWorker();
  startWebhookWorker();
}
