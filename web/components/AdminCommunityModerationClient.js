"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Toaster, toast } from "react-hot-toast";

const POST_CATEGORY_OPTIONS = [
  "PnL",
  "Trading Setup",
  "Trading Goals",
  "Memes",
  "Chart Analysis"
];

const MAX_TITLE_LENGTH = 75;
const MAX_DESCRIPTION_LENGTH = 1500;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";
const POSTS_PER_PAGE = 30;
const CATEGORY_FILTER_OPTIONS = ["all", ...POST_CATEGORY_OPTIONS];

function formatDate(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }
  const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function truncate(text, maxLength = 180) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}...`;
}

function validateImage(file, label) {
  if (!file) {
    return `${label} is required.`;
  }
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return `${label} must be .jpg, .jpeg, .png, or .webp`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${label} must be 5MB or smaller`;
  }
  return "";
}

function isSameFile(a, b) {
  if (!a || !b) {
    return false;
  }
  return (
    a.name === b.name &&
    a.size === b.size &&
    a.type === b.type &&
    a.lastModified === b.lastModified
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

function statusBadgeClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "approved") {
    return "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/35";
  }
  if (normalized === "rejected") {
    return "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/35";
  }
  return "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/35";
}

function buildModerationActions(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "approved") {
    return [
      { key: "rejected", label: "Disapprove", tone: "danger" },
      { key: "pending", label: "Pending", tone: "neutral" }
    ];
  }

  if (normalized === "rejected") {
    return [
      { key: "approved", label: "Approve", tone: "success" },
      { key: "pending", label: "Pending", tone: "neutral" }
    ];
  }

  return [
    { key: "approved", label: "Approve", tone: "success" },
    { key: "rejected", label: "Disapprove", tone: "danger" }
  ];
}

function moderationActionClass(tone) {
  if (tone === "success") {
    return "bg-[#1e8d61] hover:brightness-110";
  }
  if (tone === "danger") {
    return "bg-[#b33347] hover:brightness-110";
  }
  return "bg-[#7d5f1f] hover:brightness-110";
}

function postStatusPageButtonClass(status, isActive) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "approved") {
    return isActive
      ? "border-emerald-300/80 bg-emerald-600 text-white"
      : "border-emerald-700/70 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/70";
  }

  if (normalized === "rejected" || normalized === "disapproved") {
    return isActive
      ? "border-rose-300/80 bg-rose-600 text-white"
      : "border-rose-700/70 bg-rose-950/50 text-rose-200 hover:bg-rose-900/70";
  }

  return isActive
    ? "border-amber-300/80 bg-amber-500 text-[#2a1600]"
    : "border-amber-700/70 bg-amber-950/40 text-amber-200 hover:bg-amber-900/60";
}

function aiAnswerBadgeClass(answer) {
  const normalized = String(answer || "").toLowerCase();
  if (normalized === "pending") {
    return "bg-slate-500/15 text-slate-200 ring-1 ring-slate-400/35";
  }
  if (normalized === "yes") {
    return "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/35";
  }
  if (normalized === "no") {
    return "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/35";
  }
  return "bg-slate-500/15 text-slate-200 ring-1 ring-slate-400/35";
}

function aiAnswerToAction(answer) {
  return String(answer || "").toLowerCase() === "no" ? "Disapprove" : "Approved";
}

function resolveAiSuggestionData(post, aiSuggestion) {
  const localAnswer = String(aiSuggestion?.answer || "").trim().toLowerCase();
  const localReason = String(aiSuggestion?.reason || "").trim();

  if (localAnswer === "yes" || localAnswer === "no") {
    return {
      answer: localAnswer,
      label: aiAnswerToAction(localAnswer),
      reason: localReason
    };
  }

  const postAiApproveRaw = post?.aiApprove ?? post?.ai_approve ?? post?.aiApproved ?? post?.ai_approved;
  const postAiReason = String(
    post?.aiReason ??
    post?.ai_reason ??
    post?.ai_reason_text ??
    post?.aiSuggestionReason ??
    post?.ai_suggestion_reason ??
    ""
  ).trim();

  const normalizedApprove = String(postAiApproveRaw ?? "").trim().toLowerCase();

  if (
    postAiApproveRaw === true ||
    normalizedApprove === "true" ||
    normalizedApprove === "1" ||
    normalizedApprove === "yes" ||
    normalizedApprove === "approved" ||
    normalizedApprove === "approve"
  ) {
    return {
      answer: "yes",
      label: "Approved",
      reason: postAiReason
    };
  }

  if (
    postAiApproveRaw === false ||
    normalizedApprove === "false" ||
    normalizedApprove === "0" ||
    normalizedApprove === "no" ||
    normalizedApprove === "disapprove" ||
    normalizedApprove === "disapproved" ||
    normalizedApprove === "rejected"
  ) {
    return {
      answer: "no",
      label: "Disapprove",
      reason: postAiReason
    };
  }

  return {
    answer: "pending",
    label: "Pending",
    reason: ""
  };
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) {
    return null;
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="rounded-md border border-[#25456f] bg-[#0b182b] px-3 py-1 text-xs font-semibold text-[#d8e7ff] transition hover:bg-[#12305a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Prev
      </button>

      <div className="max-w-[70vw] overflow-x-auto">
        <div className="flex items-center gap-1.5 px-1 py-0.5">
          {pages.map((page) => {
            const isActive = page === currentPage;
            return (
              <button
                key={`page-${page}`}
                type="button"
                onClick={() => onPageChange(page)}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                  isActive
                    ? "border-[#3c6fb2] bg-[#1a4d96] text-white"
                    : "border-[#25456f] bg-[#0b182b] text-[#c9dbf7] hover:bg-[#12305a]"
                }`}
              >
                {page}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="rounded-md border border-[#25456f] bg-[#0b182b] px-3 py-1 text-xs font-semibold text-[#d8e7ff] transition hover:bg-[#12305a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}

function PendingPostCard({
  post,
  onSetStatus,
  onImageOpen,
  pending,
  canPrevPost = false,
  canNextPost = false,
  onPrevPost,
  onNextPost
}) {
  const isBusy = pending;
  const actions = buildModerationActions(post.status);
  const resolvedAi = resolveAiSuggestionData(post);
  return (
    <article className="max-h-[300px] overflow-hidden rounded-xl bg-[#061224]/95 shadow-[0_10px_28px_rgba(0,0,0,0.38)]">
      <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.9fr)]">
        <div className="flex h-[250px] min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${statusBadgeClass(post.status)}`}>
              {String(post.status || "pending")}
            </span>
            <span className="text-[11px] text-[#96b1d4]">{formatDate(post.created_at)}</span>
          </div>

          <div className="mt-2 min-w-0 space-y-1.5">
            <h3 className="text-[22px] font-semibold leading-tight text-[#edf5ff]">{truncate(post.title || "-", 56)}</h3>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8aa8cd]">{post.category}</p>
            <p className="whitespace-pre-wrap text-[13px] leading-5 text-[#bfd2ee]">{truncate(post.description || "-", 90)}</p>
            <p className="text-[11px] text-[#90a9ca]">
              Posted by: <span className="font-semibold text-[#d6e6ff]">{post.author_email || "-"}</span>
            </p>
            <div className="space-y-1 pt-0.5">
              <p className="text-[11px] text-[#90a9ca]">
                AI Suggest:{" "}
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${aiAnswerBadgeClass(resolvedAi.answer)}`}>
                  {resolvedAi.label}
                </span>
              </p>
              {resolvedAi.answer !== "pending" && resolvedAi.reason ? (
                <p className="text-[11px] leading-4 text-[#9fb8d9]">
                  AI Reason: {truncate(resolvedAi.reason, 100)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onPrevPost}
              disabled={!canPrevPost || isBusy}
              className="inline-flex items-center rounded-lg border border-[#2b4d77] bg-[#0b1b31] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#d8e7ff] transition hover:bg-[#12305a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prev Post
            </button>
            <button
              type="button"
              onClick={onNextPost}
              disabled={!canNextPost || isBusy}
              className="inline-flex items-center rounded-lg border border-[#2b4d77] bg-[#0b1b31] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#d8e7ff] transition hover:bg-[#12305a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next Post
            </button>

            {actions.map((action) => (
              <button
                key={`${post.id}-${action.key}`}
                type="button"
                disabled={isBusy}
                onClick={() => onSetStatus(post.id, action.key)}
                className={`inline-flex items-center rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${moderationActionClass(action.tone)}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {Array.isArray(post.images) && post.images.length > 0 ? (
          <div className="flex h-[250px] items-center justify-end">
            <div className={`grid gap-2 ${post.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {post.images.map((image) => (
                <button
                  key={image.id || image.src}
                  type="button"
                  onClick={() => onImageOpen(image)}
                  className="group h-[250px] w-full overflow-hidden rounded-md transition hover:opacity-95"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.src}
                    alt={image.name || "Post image"}
                    className="mx-auto h-[250px] w-auto max-w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-[250px] items-center justify-center rounded-md bg-[#041023]/60 text-[11px] text-[#7f9ec4]">
            No image
          </div>
        )}
      </div>
    </article>
  );
}

function PostDetailModal({
  post,
  pending,
  onClose,
  onSetStatus,
  onImageOpen
}) {
  if (!post) {
    return null;
  }
  const resolvedAi = resolveAiSuggestionData(post);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl bg-[#061224]/95 p-5 shadow-[0_30px_70px_rgba(0,0,0,0.62)] ring-1 ring-[#27486f]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${statusBadgeClass(post.status)}`}>
                {post.status || "pending"}
              </span>
              <span className="inline-flex rounded-full bg-[#132845] px-2.5 py-1 text-[11px] font-semibold text-[#a8c3e7] ring-1 ring-[#2e4d74]">
                {post.category}
              </span>
            </div>
            <h3 className="mt-2 text-xl font-semibold text-[#f2f7ff]">{post.title}</h3>
            <p className="mt-1 text-xs text-[#90a9ca]">
              Posted by <span className="font-semibold text-[#d6e6ff]">{post.author_email || "-"}</span> • {formatDate(post.created_at)}
            </p>
            <div className="mt-1.5 space-y-1">
              <p className="text-xs text-[#9fb8d9]">
                AI Suggest:{" "}
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${aiAnswerBadgeClass(resolvedAi.answer)}`}>
                  {resolvedAi.label}
                </span>
              </p>
              {resolvedAi.answer !== "pending" && resolvedAi.reason ? (
                <p className="text-xs text-[#9fb8d9]">AI Reason: {resolvedAi.reason}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.08] text-[#dceaff] transition hover:bg-white/[0.16]"
            aria-label="Close post details"
          >
            ×
          </button>
        </div>

        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[#bed2ef]">{post.description || "-"}</p>

        {Array.isArray(post.images) && post.images.length > 0 ? (
          <div className={`mt-3 grid gap-2 ${post.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {post.images.map((image) => (
              <button
                key={`modal-image-${post.id}-${image.id || image.src}`}
                type="button"
                onClick={() => onImageOpen(image)}
                className={`group overflow-hidden rounded-lg bg-[#020913] p-1 ring-1 ring-[#1c3557] transition hover:ring-[#2f5b8c] ${
                  post.images.length > 1 ? "aspect-[4/3]" : "aspect-[16/9]"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.src}
                  alt={image.name || "Post image"}
                  className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                />
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#1c324d] pt-4">
          {buildModerationActions(post.status).map((action) => (
            <button
              key={`modal-action-${post.id}-${action.key}`}
              type="button"
              disabled={pending}
              onClick={() => onSetStatus(post.id, action.key)}
              className={`inline-flex items-center rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${moderationActionClass(action.tone)}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ImageViewerModal({ image, zoom, onZoomChange, onClose }) {
  if (!image) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-6xl rounded-xl bg-[#050f1d]/95 p-4 shadow-[0_35px_80px_rgba(0,0,0,0.6)] ring-1 ring-[#26456b]">
        <div className="mb-3 flex items-center justify-between">
          <p className="truncate text-xs font-semibold text-[#a9c4e8]">{image.name || "Post image"}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onZoomChange((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}
              className="rounded-md border border-[#2b4d78] bg-[#0b1b31] px-2 py-1 text-xs text-[#d8e7ff]"
            >
              -
            </button>
            <span className="text-xs font-semibold text-[#d3e3fb]">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => onZoomChange((z) => Math.min(4, Number((z + 0.1).toFixed(2))))}
              className="rounded-md border border-[#2b4d78] bg-[#0b1b31] px-2 py-1 text-xs text-[#d8e7ff]"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(1)}
              className="rounded-md border border-[#2b4d78] bg-[#0b1b31] px-2 py-1 text-xs text-[#d8e7ff]"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#2b4d78] bg-[#0b1b31] px-2 py-1 text-xs text-[#d8e7ff]"
            >
              Close
            </button>
          </div>
        </div>

        <div
          className="flex max-h-[78vh] items-center justify-center overflow-auto rounded-lg bg-[#030a14] p-2 ring-1 ring-[#1d3451]"
          onWheel={(event) => {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -0.1 : 0.1;
            onZoomChange((prev) => {
              const next = Math.min(4, Math.max(0.5, prev + delta));
              return Number(next.toFixed(2));
            });
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            alt={image.name || "Zoomed image"}
            className="max-h-[72vh] max-w-full object-contain transition-transform duration-150"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
          />
        </div>
      </div>
    </div>
  );
}

export default function AdminCommunityModerationClient({ initialPosts = [] }) {
  const [pendingPosts, setPendingPosts] = useState(initialPosts);
  const [allPosts, setAllPosts] = useState([]);
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  const [isLoadingTable, setIsLoadingTable] = useState(false);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [tableStatusFilter, setTableStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalPosts, setTotalPosts] = useState(0);
  const [tableCurrentPage, setTableCurrentPage] = useState(1);
  const [tableTotalPages, setTableTotalPages] = useState(1);
  const [tableTotalPosts, setTableTotalPosts] = useState(0);
  const [visiblePostIndex, setVisiblePostIndex] = useState(0);
  const [pendingActionId, setPendingActionId] = useState("");
  const [selectedPost, setSelectedPost] = useState(null);
  const [zoomImage, setZoomImage] = useState(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [formState, setFormState] = useState({
    category: "PnL",
    title: "",
    description: "",
    primaryFile: null,
    secondaryFile: null,
    primaryPreview: "",
    secondaryPreview: ""
  });
  const [formErrors, setFormErrors] = useState({});
  const [isPending, startTransition] = useTransition();
  const primaryInputRef = useRef(null);
  const secondaryInputRef = useRef(null);
  const previewUrlsRef = useRef(new Set());

  const postsPerPage = POSTS_PER_PAGE;
  const featuredPostsPerPage = POSTS_PER_PAGE;

  const loadPendingPosts = useCallback(async ({ page = 1 } = {}) => {
    setIsLoadingPending(true);
    try {
      const response = await fetch(
        `/api/admin/community/posts?status=all&category=${encodeURIComponent(categoryFilter)}&limit=${featuredPostsPerPage}&page=${page}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load posts");
      }
      const nextPosts = Array.isArray(payload.posts) ? payload.posts : [];
      const nextCurrentPage = Number(payload.currentPage) > 0 ? Number(payload.currentPage) : page;
      const nextTotalPages = Number(payload.totalPages) > 0 ? Number(payload.totalPages) : 1;
      const nextTotalPosts = Number(payload.totalPosts) >= 0
        ? Number(payload.totalPosts)
        : (Number(payload.total) >= 0 ? Number(payload.total) : nextPosts.length);
      setPendingPosts(nextPosts);
      setCurrentPage(nextCurrentPage);
      setTotalPages(nextTotalPages);
      setTotalPosts(nextTotalPosts);
      setVisiblePostIndex(0);
    } catch (error) {
      toast.error(error.message || "Failed to load posts");
      setPendingPosts([]);
      setCurrentPage(1);
      setTotalPages(1);
      setTotalPosts(0);
      setVisiblePostIndex(0);
    } finally {
      setIsLoadingPending(false);
    }
  }, [categoryFilter, featuredPostsPerPage]);

  const loadAllPosts = useCallback(async ({ status = tableStatusFilter, page = 1 } = {}) => {
    setIsLoadingTable(true);
    try {
      const response = await fetch(
        `/api/admin/community/posts?status=${encodeURIComponent(status)}&category=${encodeURIComponent(categoryFilter)}&limit=${postsPerPage}&page=${page}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load posts table");
      }
      const nextPosts = Array.isArray(payload.posts) ? payload.posts : [];
      const nextCurrentPage = Number(payload.currentPage) > 0 ? Number(payload.currentPage) : page;
      const nextTotalPages = Number(payload.totalPages) > 0 ? Number(payload.totalPages) : 1;
      const nextTotalPosts = Number(payload.totalPosts) >= 0
        ? Number(payload.totalPosts)
        : (Number(payload.total) >= 0 ? Number(payload.total) : nextPosts.length);
      setAllPosts(nextPosts);
      setTableCurrentPage(nextCurrentPage);
      setTableTotalPages(nextTotalPages);
      setTableTotalPosts(nextTotalPosts);
    } catch (error) {
      toast.error(error.message || "Failed to load posts table");
      setAllPosts([]);
      setTableCurrentPage(1);
      setTableTotalPages(1);
      setTableTotalPosts(0);
    } finally {
      setIsLoadingTable(false);
    }
  }, [categoryFilter, postsPerPage, tableStatusFilter]);

  useEffect(() => {
    setCurrentPage(1);
    void loadPendingPosts({ page: 1 });
  }, [categoryFilter, loadPendingPosts]);

  useEffect(() => {
    setTableCurrentPage(1);
    void loadAllPosts({ status: tableStatusFilter, page: 1 });
  }, [categoryFilter, tableStatusFilter, loadAllPosts]);

  useEffect(() => {
    const isAnyModalOpen = Boolean(selectedPost || zoomImage);
    if (!isAnyModalOpen) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedPost, zoomImage]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      if (zoomImage) {
        setZoomImage(null);
        setImageZoom(1);
        return;
      }
      if (selectedPost) {
        setSelectedPost(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedPost, zoomImage]);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    };
  }, []);

  const openImageViewer = (image) => {
    setZoomImage(image);
    setImageZoom(1);
  };

  const clearPreviewUrl = (url) => {
    if (!url) {
      return;
    }
    if (previewUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      previewUrlsRef.current.delete(url);
    }
  };

  const clearCreatePostForm = () => {
    clearPreviewUrl(formState.primaryPreview);
    clearPreviewUrl(formState.secondaryPreview);
    setFormState({
      category: "PnL",
      title: "",
      description: "",
      primaryFile: null,
      secondaryFile: null,
      primaryPreview: "",
      secondaryPreview: ""
    });
    setFormErrors({});
    if (primaryInputRef.current) {
      primaryInputRef.current.value = "";
    }
    if (secondaryInputRef.current) {
      secondaryInputRef.current.value = "";
    }
  };

  const resetFieldInput = (field) => {
    if (field === "primaryFile" && primaryInputRef.current) {
      primaryInputRef.current.value = "";
    }
    if (field === "secondaryFile" && secondaryInputRef.current) {
      secondaryInputRef.current.value = "";
    }
  };

  const handleFileInput = (field) => (event) => {
    const file = event.target.files?.[0] || null;
    const previewField = field === "primaryFile" ? "primaryPreview" : "secondaryPreview";
    const errorField = field === "primaryFile" ? "primaryFile" : "secondaryFile";
    const label = field === "primaryFile" ? "Primary image" : "Secondary image";

    clearPreviewUrl(formState[previewField]);

    if (!file) {
      setFormState((previous) => ({
        ...previous,
        [field]: null,
        [previewField]: ""
      }));
      setFormErrors((previous) => ({ ...previous, [errorField]: "" }));
      return;
    }

    const validationError = validateImage(file, label);
    if (validationError) {
      setFormErrors((previous) => ({ ...previous, [errorField]: validationError }));
      setFormState((previous) => ({
        ...previous,
        [field]: null,
        [previewField]: ""
      }));
      resetFieldInput(field);
      return;
    }

    const otherFile = field === "primaryFile" ? formState.secondaryFile : formState.primaryFile;
    if (isSameFile(file, otherFile)) {
      setFormErrors((previous) => ({
        ...previous,
        [errorField]: "Image 1 and Image 2 cannot be the same file"
      }));
      setFormState((previous) => ({
        ...previous,
        [field]: null,
        [previewField]: ""
      }));
      resetFieldInput(field);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    previewUrlsRef.current.add(previewUrl);
    setFormErrors((previous) => ({ ...previous, [errorField]: "" }));
    setFormState((previous) => ({
      ...previous,
      [field]: file,
      [previewField]: previewUrl
    }));
  };

  const validateCreatePostForm = () => {
    const nextErrors = {};
    const title = formState.title.trim();
    const description = formState.description.trim();

    if (!formState.category) {
      nextErrors.category = "Category is required";
    }

    if (!title) {
      nextErrors.title = "Title is required";
    } else if (title.length > MAX_TITLE_LENGTH) {
      nextErrors.title = `Title must be ${MAX_TITLE_LENGTH} characters or fewer`;
    }

    if (!description) {
      nextErrors.description = "Description is required";
    } else if (description.length > MAX_DESCRIPTION_LENGTH) {
      nextErrors.description = `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`;
    }

    const primaryImageError = formState.primaryFile
      ? validateImage(formState.primaryFile, "Primary image")
      : "Primary image is required";
    if (primaryImageError) {
      nextErrors.primaryFile = primaryImageError;
    }

    if (formState.secondaryFile) {
      const secondaryError = validateImage(formState.secondaryFile, "Secondary image");
      if (secondaryError) {
        nextErrors.secondaryFile = secondaryError;
      }
    }

    if (
      formState.primaryFile &&
      formState.secondaryFile &&
      isSameFile(formState.primaryFile, formState.secondaryFile)
    ) {
      nextErrors.secondaryFile = "Image 1 and Image 2 cannot be the same file";
    }

    setFormErrors(nextErrors);
    return {
      isValid: Object.keys(nextErrors).length === 0,
      cleanTitle: title,
      cleanDescription: description
    };
  };

  const handleCreatePost = async (event) => {
    event.preventDefault();
    if (isSubmittingPost) {
      return;
    }

    const { isValid, cleanTitle, cleanDescription } = validateCreatePostForm();
    if (!isValid) {
      return;
    }

    setIsSubmittingPost(true);
    try {
      const primaryImageData = await fileToDataUrl(formState.primaryFile);
      const secondaryImageData = formState.secondaryFile
        ? await fileToDataUrl(formState.secondaryFile)
        : "";

      const response = await fetch("/api/community/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          category: formState.category,
          title: cleanTitle,
          description: cleanDescription,
          primary_image: primaryImageData,
          secondary_image: secondaryImageData
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create post");
      }

      clearCreatePostForm();
      toast.success("Post submitted for admin approval");
      await Promise.all([
        loadPendingPosts({ page: 1 }),
        loadAllPosts({ status: tableStatusFilter, page: 1 })
      ]);
    } catch (error) {
      toast.error(error?.message || "Failed to create post");
    } finally {
      setIsSubmittingPost(false);
    }
  };

  const moderatePost = (postId, status) => {
    startTransition(async () => {
      setPendingActionId(String(postId));
      try {
        const response = await fetch(`/api/admin/community/posts/${encodeURIComponent(postId)}/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Failed to update post status");
        }
        setPendingPosts((previous) =>
          previous.map((post) =>
            String(post.id) === String(postId)
              ? { ...post, status }
              : post
          )
        );
        setAllPosts((previous) =>
          previous.map((post) =>
            String(post.id) === String(postId)
              ? { ...post, status }
              : post
          )
        );
        setSelectedPost((previous) => {
          if (!previous || String(previous.id) !== String(postId)) {
            return previous;
          }
          return { ...previous, status };
        });
        void Promise.all([
          loadPendingPosts({ page: currentPage }),
          loadAllPosts({ status: tableStatusFilter, page: tableCurrentPage })
        ]);
        if (status === "approved") {
          toast.success("Post approved");
        } else if (status === "rejected") {
          toast.success("Post disapproved");
        } else {
          toast.success("Post moved to pending");
        }
      } catch (error) {
        toast.error(error.message || "Failed to update post status");
      } finally {
        setPendingActionId("");
      }
    });
  };

  return (
    <div className="space-y-5 text-[#e6f0ff]">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#0a1a2e",
            color: "#dce9ff",
            border: "1px solid rgba(126,162,216,0.32)",
            boxShadow: "0 14px 32px rgba(0,0,0,0.35)"
          }
        }}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9bb6d8]">
            Category
          </span>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-lg border border-[#2b4d77] bg-[#0b1b31] px-3 py-2 text-xs font-semibold text-[#d8e7ff] outline-none"
          >
            {CATEGORY_FILTER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All" : option}
              </option>
            ))}
          </select>
        </label>
        <span className="rounded-lg bg-[#10253f] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#d7e7ff] ring-1 ring-[#2f4f77]">
          Total {totalPosts}
        </span>
        <button
          type="button"
          onClick={() => void loadPendingPosts({ page: currentPage })}
          disabled={isLoadingPending || isPending}
          className="rounded-lg border border-[#2b4d77] bg-[#0b1b31] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#d8e7ff] transition hover:bg-[#12305a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {isLoadingPending ? (
        <section className="rounded-xl bg-[#061224]/95 p-8 text-center text-sm text-[#9db4d3] ring-1 ring-[#1f3858]">
          Loading posts...
        </section>
      ) : pendingPosts.length === 0 ? (
        <section className="rounded-xl bg-[#061224]/95 p-8 text-center ring-1 ring-[#1f3858]">
          <p className="text-sm font-semibold text-[#edf5ff]">No posts found</p>
          <p className="mt-1 text-xs text-[#94aecd]">Create posts from community or admin create form.</p>
        </section>
      ) : (
        <section>
          <div className="space-y-3">
            {pendingPosts.length > 0 ? (
              <PendingPostCard
                key={pendingPosts[Math.min(visiblePostIndex, pendingPosts.length - 1)]?.id}
                post={pendingPosts[Math.min(visiblePostIndex, pendingPosts.length - 1)]}
                pending={isPending && pendingActionId === String(pendingPosts[Math.min(visiblePostIndex, pendingPosts.length - 1)]?.id)}
                onSetStatus={(postId, nextStatus) => moderatePost(postId, nextStatus)}
                onImageOpen={openImageViewer}
                canPrevPost={visiblePostIndex > 0}
                canNextPost={visiblePostIndex < (pendingPosts.length - 1)}
                onPrevPost={() => setVisiblePostIndex((previous) => Math.max(0, previous - 1))}
                onNextPost={() => setVisiblePostIndex((previous) => Math.min(pendingPosts.length - 1, previous + 1))}
              />
            ) : null}

            {pendingPosts.length > 0 ? (
              <div className="overflow-x-auto">
                <div className="mx-auto flex w-max items-center gap-1.5 px-1 py-1">
                  {pendingPosts.map((post, index) => {
                    const isActive = index === visiblePostIndex;
                    const statusClass = postStatusPageButtonClass(post.status, isActive);
                    return (
                      <button
                        key={`featured-post-${post.id || index}`}
                        type="button"
                        onClick={() => setVisiblePostIndex(index)}
                        aria-label={`Show post ${index + 1}`}
                        className={`h-7 min-w-7 rounded-md border px-2 text-xs font-semibold transition ${statusClass}`}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={(page) => {
              if (page < 1 || page > totalPages) {
                return;
              }
              void loadPendingPosts({ page });
            }}
          />
        </section>
      )}

      <section className="overflow-hidden rounded-xl bg-[#061224]/95 shadow-[0_18px_40px_rgba(0,0,0,0.35)] ring-1 ring-[#214164]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f3858] px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-[#edf5ff]">All Posts Table</h3>
            <p className="text-xs text-[#92adcf]">Click a row to see complete post details.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.08em] text-[#9bb6d8]">
              Status
            </label>
            <select
              value={tableStatusFilter}
              onChange={(event) => setTableStatusFilter(event.target.value)}
              className="rounded-lg border border-[#2b4d77] bg-[#0b1b31] px-3 py-2 text-xs font-semibold text-[#d8e7ff] outline-none"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <span className="rounded-md border border-[#2f4f78] bg-[#0b1b31] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#caddf8]">
              Total {tableTotalPosts}
            </span>
          </div>
        </header>

        {isLoadingTable ? (
          <div className="px-4 py-8 text-center text-sm text-[#9db4d3]">Loading table data...</div>
        ) : allPosts.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[#9db4d3]">No posts found for selected status.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#0c1d33] text-[#9eb9db]">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">ID</th>
                    <th className="px-3 py-2.5 font-semibold">Title</th>
                    <th className="px-3 py-2.5 font-semibold">Category</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Description</th>
                    <th className="px-3 py-2.5 font-semibold">Images</th>
                    <th className="px-3 py-2.5 font-semibold">Posted By</th>
                    <th className="px-3 py-2.5 font-semibold">Created</th>
                    <th className="px-3 py-2.5 font-semibold">Likes</th>
                  </tr>
                </thead>
                <tbody>
                  {allPosts.map((post) => (
                    <tr
                      key={`row-${post.id}`}
                      className="cursor-pointer border-t border-[#1f3858] align-top transition hover:bg-[#0d213a]"
                      onClick={() => setSelectedPost(post)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedPost(post);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      <td className="px-3 py-2.5 text-xs text-[#93aece]">{post.id}</td>
                      <td className="px-3 py-2.5 text-sm font-semibold text-[#e6f0ff]">{post.title}</td>
                      <td className="px-3 py-2.5 text-xs text-[#b7cbea]">{post.category}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${statusBadgeClass(post.status)}`}>
                          {post.status || "pending"}
                        </span>
                      </td>
                      <td className="max-w-[260px] px-3 py-2.5 text-xs leading-5 text-[#b5cae9]">
                        {truncate(post.description, 180)}
                      </td>
                      <td className="px-3 py-2.5">
                        {Array.isArray(post.images) && post.images.length > 0 ? (
                          <div className="flex gap-1">
                            {post.images.slice(0, 2).map((image) => (
                              <button
                                key={`${post.id}-${image.id || image.src}`}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openImageViewer(image);
                                }}
                                className="h-10 w-10 overflow-hidden rounded bg-[#020913] ring-1 ring-[#27456d]"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={image.src}
                                  alt={image.name || "Post image"}
                                  className="h-full w-full object-contain"
                                />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-[#7892b2]">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[#b5cae9]">{post.author_email || "-"}</td>
                      <td className="px-3 py-2.5 text-xs text-[#b5cae9]">{formatDate(post.created_at)}</td>
                      <td className="px-3 py-2.5 text-xs text-[#b5cae9]">{post.likes || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="border-t border-[#1f3858] px-4 py-3">
              <Pagination
                currentPage={tableCurrentPage}
                totalPages={tableTotalPages}
                onPageChange={(page) => {
                  if (page < 1 || page > tableTotalPages) {
                    return;
                  }
                  void loadAllPosts({ status: tableStatusFilter, page });
                }}
              />
            </footer>
          </>
        )}
      </section>

      <section className="rounded-xl bg-[#061224]/95 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.35)] ring-1 ring-[#214164]">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-[#edf5ff]">Create Post</h3>
          <p className="text-xs text-[#92adcf]">Create a new community post directly from admin panel.</p>
        </div>

        <form onSubmit={handleCreatePost} className="rounded-xl bg-[#091a31]/60 p-4 ring-1 ring-[#1f3d61]">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-[#cddcf3]">Category *</span>
              <select
                value={formState.category}
                onChange={(event) => setFormState((previous) => ({ ...previous, category: event.target.value }))}
                className="mt-1.5 w-full rounded-lg border border-[#2b4d77] bg-[#0b1728]/95 px-3 py-2 text-sm text-white outline-none focus:border-[#60a3ff]"
              >
                {POST_CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              {formErrors.category ? <p className="mt-1 text-xs text-rose-300">{formErrors.category}</p> : null}
            </label>

            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#cddcf3]">Post Title *</span>
                <span className="text-[11px] text-[#87a2c6]">{formState.title.length}/{MAX_TITLE_LENGTH}</span>
              </div>
              <input
                type="text"
                maxLength={MAX_TITLE_LENGTH}
                value={formState.title}
                onChange={(event) => setFormState((previous) => ({ ...previous, title: event.target.value }))}
                placeholder="Enter title"
                className="mt-1.5 w-full rounded-lg border border-[#2b4d77] bg-[#0b1728]/95 px-3 py-2 text-sm text-white placeholder:text-[#6c85a7] outline-none focus:border-[#60a3ff]"
              />
              {formErrors.title ? <p className="mt-1 text-xs text-rose-300">{formErrors.title}</p> : null}
            </label>
          </div>

          <label className="mt-3 block">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#cddcf3]">Description / Content *</span>
              <span className="text-[11px] text-[#87a2c6]">{formState.description.length}/{MAX_DESCRIPTION_LENGTH}</span>
            </div>
            <textarea
              maxLength={MAX_DESCRIPTION_LENGTH}
              value={formState.description}
              onChange={(event) => setFormState((previous) => ({ ...previous, description: event.target.value }))}
              placeholder="Write your post content"
              rows={5}
              className="mt-1.5 w-full resize-none rounded-lg border border-[#2b4d77] bg-[#0b1728]/95 px-3 py-2 text-sm text-white placeholder:text-[#6c85a7] outline-none focus:border-[#60a3ff]"
            />
            {formErrors.description ? <p className="mt-1 text-xs text-rose-300">{formErrors.description}</p> : null}
          </label>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-[#cddcf3]">Primary Image Upload *</span>
              <input
                ref={primaryInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                onChange={handleFileInput("primaryFile")}
                className="mt-1.5 block w-full rounded-lg border border-[#2b4d77] bg-[#0b1728]/95 px-3 py-2 text-xs text-[#c8d9f0] file:mr-3 file:rounded-md file:border-0 file:bg-[#1a4d96] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
              />
              <p className="mt-1 text-[11px] text-[#87a2c6]">Accepted: JPG, JPEG, PNG, WEBP (max 5MB)</p>
              {formErrors.primaryFile ? <p className="mt-1 text-xs text-rose-300">{formErrors.primaryFile}</p> : null}
              {formState.primaryPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={formState.primaryPreview} alt="Primary preview" className="mt-2 h-36 w-full rounded-lg object-contain bg-[#030b17] p-1 ring-1 ring-[#1f3d61]" />
              ) : null}
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-[#cddcf3]">Secondary Image Upload (Optional)</span>
              <input
                ref={secondaryInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                onChange={handleFileInput("secondaryFile")}
                className="mt-1.5 block w-full rounded-lg border border-[#2b4d77] bg-[#0b1728]/95 px-3 py-2 text-xs text-[#c8d9f0] file:mr-3 file:rounded-md file:border-0 file:bg-[#2a6d4f] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
              />
              {formErrors.secondaryFile ? <p className="mt-1 text-xs text-rose-300">{formErrors.secondaryFile}</p> : null}
              {formState.secondaryPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={formState.secondaryPreview} alt="Secondary preview" className="mt-2 h-36 w-full rounded-lg object-contain bg-[#030b17] p-1 ring-1 ring-[#1f3d61]" />
              ) : null}
            </label>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              disabled={isSubmittingPost}
              className="inline-flex items-center justify-center rounded-lg bg-[#1d5fbe] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white transition hover:bg-[#2a73de] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingPost ? "Submitting..." : "Submit"}
            </button>
            <button
              type="button"
              onClick={clearCreatePostForm}
              disabled={isSubmittingPost}
              className="inline-flex items-center justify-center rounded-lg bg-white/[0.08] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#c6daf5] transition hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>

      <PostDetailModal
        post={selectedPost}
        pending={isPending && pendingActionId === String(selectedPost?.id || "")}
        onClose={() => setSelectedPost(null)}
        onSetStatus={(postId, nextStatus) => moderatePost(postId, nextStatus)}
        onImageOpen={openImageViewer}
      />

      <ImageViewerModal
        image={zoomImage}
        zoom={imageZoom}
        onZoomChange={(valueOrUpdater) => {
          if (typeof valueOrUpdater === "function") {
            setImageZoom((prev) => valueOrUpdater(prev));
            return;
          }
          setImageZoom(Number(valueOrUpdater) || 1);
        }}
        onClose={() => {
          setZoomImage(null);
          setImageZoom(1);
        }}
      />
    </div>
  );
}
