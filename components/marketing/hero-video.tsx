"use client";

import Image from "next/image";
import { Pause, Play, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(reducedMotionQuery);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return window.matchMedia(reducedMotionQuery).matches;
}

function getReducedMotionServerSnapshot() {
  return true;
}

export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const [userRequestedPlayback, setUserRequestedPlayback] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const showVideo = !prefersReducedMotion || userRequestedPlayback;

  useEffect(() => {
    if (!showVideo) return;
    void videoRef.current?.play().catch(() => setIsPlaying(false));
  }, [showVideo]);

  function togglePlayback() {
    if (!showVideo) {
      setUserRequestedPlayback(true);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }

  const playbackActive = showVideo && isPlaying;

  return (
    <section
      className="border-b border-white/10 bg-[#101217] text-white"
      aria-label="Open Inventory Produktvideo"
    >
      <div className="mx-auto max-w-[1320px] sm:px-5 sm:py-5">
        <div className="overflow-hidden border-y border-white/10 bg-[#0d0f14] shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:rounded-[28px] sm:border">
          <div
            className="relative aspect-video w-full overflow-hidden bg-[#101217]"
            aria-describedby="hero-video-description"
          >
            {showVideo ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster="/marketing/open-inventory-hero-poster.png"
                className="block size-full object-contain"
                aria-label="Open Inventory: vom Foto zum strukturierten Inventar in Web und iOS"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              >
                <source
                  src="/marketing/open-inventory-hero.mp4"
                  type="video/mp4"
                />
                Ihr Browser kann dieses Produktvideo nicht abspielen.
              </video>
            ) : (
              <Image
                src="/marketing/open-inventory-hero-poster.png"
                alt="Open Inventory mit konkreten Mockdaten in der Weboberfläche und auf dem iPhone"
                fill
                priority
                sizes="(min-width: 1320px) 1280px, 100vw"
                className="object-contain"
              />
            )}
          </div>

          <div className="flex min-h-14 items-center justify-between gap-3 border-t border-white/10 px-4 py-2.5 sm:px-5">
            <p
              id="hero-video-description"
              className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55 sm:text-xs"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-[#8ff0cc]" />
              <span className="truncate">Produktvideo · 15 Sek.</span>
              <span className="hidden items-center gap-1.5 sm:inline-flex">
                <VolumeX className="size-3.5" aria-hidden="true" />
                ohne Ton
              </span>
            </p>

            <button
              type="button"
              onClick={togglePlayback}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3.5 text-xs font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ff0cc]"
              aria-label={playbackActive ? "Produktvideo pausieren" : "Produktvideo abspielen"}
            >
              {playbackActive ? (
                <Pause className="size-3.5" fill="currentColor" aria-hidden="true" />
              ) : (
                <Play className="size-3.5" fill="currentColor" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {playbackActive ? "Pausieren" : "Abspielen"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
