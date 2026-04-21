"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import AppTopHeaderClient from "@/components/AppTopHeaderClient";

const VIDEO_ITEMS = [
  {
    id: 1,
    title: "Option Chain Basics",
    hindi_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    english_url: "https://test-streams.mux.dev/test_001/stream.m3u8"
  },
  {
    id: 2,
    title: "Index Structure Overview",
    hindi_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    english_url: "https://test-streams.mux.dev/test_001/stream.m3u8"
  },
  {
    id: 3,
    title: "Risk Management Playbook",
    hindi_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    english_url: "https://test-streams.mux.dev/test_001/stream.m3u8"
  },
  {
    id: 4,
    title: "Intraday Setup Patterns",
    hindi_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    english_url: "https://test-streams.mux.dev/test_001/stream.m3u8"
  },
  {
    id: 5,
    title: "Volume and Delivery Signals",
    hindi_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    english_url: "https://test-streams.mux.dev/test_001/stream.m3u8"
  },
  {
    id: 6,
    title: "OI and PCR Interpretation",
    hindi_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    english_url: "https://test-streams.mux.dev/test_001/stream.m3u8"
  },
  {
    id: 7,
    title: "Trend Confirmation Workflow",
    hindi_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    english_url: "https://test-streams.mux.dev/test_001/stream.m3u8"
  },
  {
    id: 8,
    title: "Execution Discipline",
    hindi_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    english_url: "https://test-streams.mux.dev/test_001/stream.m3u8"
  }
];

const STATUS_IDLE = "idle";
const STATUS_LOADING = "loading";
const STATUS_BUFFERING = "buffering";
const STATUS_READY = "ready";
const STATUS_ERROR = "error";

function getLanguageLabel(language) {
  return language === "hindi" ? "Hindi" : "English";
}

function PlayIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 6.5v11l9-5.5-9-5.5z" />
    </svg>
  );
}

function GlobeIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3.5c2.4 2.3 3.8 5.3 3.8 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.8-5.3-3.8-8.5S9.6 5.8 12 3.5z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function FilmIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 5v14M16 5v14M4 9h4M16 9h4M4 15h4M16 15h4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function VideosClient({
  userName = "",
  userEmail = "",
  userImage = "",
  isAdmin = false
}) {
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(STATUS_IDLE);
  const [errorText, setErrorText] = useState("");

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const cleanupRef = useRef(null);

  const isModalOpen = Boolean(selected);

  const stopPlaybackAndCleanup = useCallback(() => {
    if (typeof cleanupRef.current === "function") {
      cleanupRef.current();
      cleanupRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    stopPlaybackAndCleanup();
    setSelected(null);
    setStatus(STATUS_IDLE);
    setErrorText("");
  }, [stopPlaybackAndCleanup]);

  const handleOpen = useCallback((video, language) => {
    const streamUrl = language === "hindi" ? video.hindi_url : video.english_url;
    setSelected({
      id: video.id,
      title: video.title,
      language,
      url: streamUrl
    });
    setStatus(STATUS_LOADING);
    setErrorText("");
  }, []);

  useEffect(() => {
    if (!isModalOpen) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleClose, isModalOpen]);

  useEffect(() => {
    if (!selected || !videoRef.current) {
      return undefined;
    }

    stopPlaybackAndCleanup();

    const videoElement = videoRef.current;
    const streamUrl = String(selected.url || "").trim();

    if (!streamUrl) {
      setStatus(STATUS_ERROR);
      setErrorText("Stream URL is missing.");
      return undefined;
    }

    videoElement.playsInline = true;
    videoElement.controls = true;
    videoElement.preload = "auto";

    const onLoadStart = () => setStatus(STATUS_LOADING);
    const onWaiting = () => setStatus(STATUS_BUFFERING);
    const onPlaying = () => setStatus(STATUS_READY);
    const onCanPlay = () => {
      setStatus((previous) => (previous === STATUS_ERROR ? previous : STATUS_READY));
    };
    const onError = () => {
      setStatus(STATUS_ERROR);
      setErrorText("Unable to load stream. Please try another video.");
    };
    const onStalled = () => {
      setStatus((previous) => (previous === STATUS_ERROR ? previous : STATUS_BUFFERING));
    };

    videoElement.addEventListener("loadstart", onLoadStart);
    videoElement.addEventListener("waiting", onWaiting);
    videoElement.addEventListener("playing", onPlaying);
    videoElement.addEventListener("canplay", onCanPlay);
    videoElement.addEventListener("error", onError);
    videoElement.addEventListener("stalled", onStalled);

    const attemptPlay = async () => {
      try {
        await videoElement.play();
      } catch (_) {
        // Autoplay can be blocked by browser policy; controls remain available.
      }
    };

    const detachSource = () => {
      try {
        videoElement.pause();
      } catch (_) {
        // Ignore.
      }
      videoElement.removeAttribute("src");
      try {
        videoElement.load();
      } catch (_) {
        // Ignore.
      }
    };

    const hls = Hls.isSupported() ? new Hls() : null;
    hlsRef.current = hls;

    if (hls) {
      const onHlsMediaAttached = () => {
        hls.loadSource(streamUrl);
      };
      const onHlsManifestParsed = () => {
        void attemptPlay();
      };
      const onHlsError = (_event, data) => {
        if (!data?.fatal) {
          return;
        }
        setStatus(STATUS_ERROR);
        setErrorText("Streaming error occurred. Please try again.");
      };

      hls.on(Hls.Events.MEDIA_ATTACHED, onHlsMediaAttached);
      hls.on(Hls.Events.MANIFEST_PARSED, onHlsManifestParsed);
      hls.on(Hls.Events.ERROR, onHlsError);
      hls.attachMedia(videoElement);

      cleanupRef.current = () => {
        videoElement.removeEventListener("loadstart", onLoadStart);
        videoElement.removeEventListener("waiting", onWaiting);
        videoElement.removeEventListener("playing", onPlaying);
        videoElement.removeEventListener("canplay", onCanPlay);
        videoElement.removeEventListener("error", onError);
        videoElement.removeEventListener("stalled", onStalled);

        hls.off(Hls.Events.MEDIA_ATTACHED, onHlsMediaAttached);
        hls.off(Hls.Events.MANIFEST_PARSED, onHlsManifestParsed);
        hls.off(Hls.Events.ERROR, onHlsError);
        hls.destroy();
        hlsRef.current = null;
        detachSource();
      };

      return () => {
        stopPlaybackAndCleanup();
      };
    }

    if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
      videoElement.src = streamUrl;
      videoElement.load();
      void attemptPlay();
    } else {
      setStatus(STATUS_ERROR);
      setErrorText("HLS playback is not supported on this browser.");
    }

    cleanupRef.current = () => {
      videoElement.removeEventListener("loadstart", onLoadStart);
      videoElement.removeEventListener("waiting", onWaiting);
      videoElement.removeEventListener("playing", onPlaying);
      videoElement.removeEventListener("canplay", onCanPlay);
      videoElement.removeEventListener("error", onError);
      videoElement.removeEventListener("stalled", onStalled);
      detachSource();
    };

    return () => {
      stopPlaybackAndCleanup();
    };
  }, [selected, stopPlaybackAndCleanup]);

  const modalStatusText = useMemo(() => {
    if (status === STATUS_LOADING) {
      return "Loading stream...";
    }
    if (status === STATUS_BUFFERING) {
      return "Buffering...";
    }
    if (status === STATUS_ERROR) {
      return errorText || "Failed to play stream.";
    }
    return "";
  }, [errorText, status]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_10%_-12%,rgba(76,145,255,0.24),transparent_36%),radial-gradient(circle_at_90%_8%,rgba(34,211,156,0.12),transparent_35%),linear-gradient(180deg,#040a14_0%,#030812_100%)] text-white">
      <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-[#2f71ff]/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-16 h-80 w-80 rounded-full bg-[#14b87a]/10 blur-3xl" />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-10 pt-0 sm:px-6 lg:px-8">
        <AppTopHeaderClient
          userName={userName}
          userEmail={userEmail}
          userImage={userImage}
          isAdmin={isAdmin}
        />

        <header className="mb-6 mt-4 rounded-3xl border border-white/[0.13] bg-[linear-gradient(140deg,rgba(17,38,66,0.68),rgba(8,22,42,0.52))] px-5 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:px-6">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a9c1df]">
            <FilmIcon className="h-3.5 w-3.5 text-[#86b1f3]" />
            <span>Video Library</span>
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-[#edf4ff] sm:text-[2rem]">Strategy Video</h1>
            <p className="inline-flex items-center rounded-full border border-white/[0.14] bg-white/[0.06] px-3 py-1 text-xs font-semibold uppercase tracking-[0.11em] text-[#d0e0f7]">
              {VIDEO_ITEMS.length} Modules
            </p>
          </div>
          <p className="mt-1.5 text-sm text-[#b5c9e2]">
            Pick language and start playback instantly.
          </p>
        </header>

        <section className="pt-1">
          <div className="mb-2 flex items-center justify-between px-2.5 pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#96b0d0]">Modules</p>
            <p className="text-[11px] text-[#89a5ca]">Hindi / English</p>
          </div>

          <ul className="space-y-2">
            {VIDEO_ITEMS.map((video) => (
              <li key={video.id}>
                <div className="group relative overflow-hidden rounded-2xl border border-white/[0.1] bg-[linear-gradient(120deg,rgba(18,41,70,0.36),rgba(11,26,46,0.26))] px-4 py-3.5 transition duration-200 hover:border-[#8db5ff]/45 hover:bg-[linear-gradient(120deg,rgba(28,58,99,0.42),rgba(14,30,52,0.34))]">
                  <div className="absolute inset-y-0 left-0 w-1.5 bg-[linear-gradient(180deg,rgba(92,155,255,0.7),rgba(92,155,255,0))] opacity-0 transition group-hover:opacity-100" />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex items-center gap-3">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.16] bg-white/[0.1] text-xs font-semibold text-[#d9e8ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
                      {String(video.id).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#ecf4ff] sm:text-base">{video.title}</p>
                        <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-[#90aace]">Video {video.id}</p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpen(video, "hindi")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#7fb0ff]/35 bg-[linear-gradient(180deg,rgba(51,128,255,0.36),rgba(20,72,153,0.45))] px-3 py-1.5 text-xs font-semibold text-[#ebf4ff] shadow-[0_8px_22px_rgba(36,106,214,0.24),inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:border-[#95beff]/60 hover:brightness-110"
                      >
                        <PlayIcon className="h-3.5 w-3.5" />
                        Hindi
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpen(video, "english")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#76dcb0]/35 bg-[linear-gradient(180deg,rgba(23,166,102,0.36),rgba(17,98,66,0.45))] px-3 py-1.5 text-xs font-semibold text-[#e8fff4] shadow-[0_8px_22px_rgba(15,115,72,0.22),inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:border-[#95e8c4]/55 hover:brightness-110"
                      >
                        <GlobeIcon className="h-3.5 w-3.5" />
                        English
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {isModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 px-4 py-6 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleClose();
            }
          }}
        >
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-white/[0.12] bg-[linear-gradient(145deg,rgba(11,26,47,0.92),rgba(7,20,37,0.88))] shadow-[0_28px_80px_rgba(0,0,0,0.62)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.1] px-4 py-3 sm:px-5">
              <div>
                <p className="text-lg font-semibold text-[#f4f8ff]">{selected?.title}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] text-[#8ea4c0]">
                  <GlobeIcon className="h-3.5 w-3.5 text-[#7ea2d2]" />
                  <span>{getLanguageLabel(selected?.language)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.12] bg-white/[0.07] text-[#d6e6ff] transition hover:bg-white/[0.14]"
                aria-label="Close video modal"
              >
                ×
              </button>
            </div>

            <div className="px-4 py-4 sm:px-5">
              <video
                ref={videoRef}
                className="w-full rounded-xl border border-white/[0.12] bg-black"
                controls
                autoPlay
              />

              {modalStatusText ? (
                <p className={`mt-3 text-sm ${status === STATUS_ERROR ? "text-[#ff8ea1]" : "text-[#9fb6d4]"}`}>
                  {modalStatusText}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
