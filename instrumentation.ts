export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTranslationWorker } = await import(
    "@/lib/translation-worker-runtime"
  );
  startTranslationWorker();
}
