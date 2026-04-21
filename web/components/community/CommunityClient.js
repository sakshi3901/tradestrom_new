"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import AppTopHeaderClient from "@/components/AppTopHeaderClient";

const FILTER_CATEGORY_OPTIONS = [
  "All",
  "PnL",
  "Trading Setup",
  "Trading Goals",
  "Memes",
  "Chart Analysis"
];

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
const POSTS_PAGE_LIMIT = 30;

function formatTimestamp(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }

  const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;

  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(millis));
  } catch (_) {
    return "-";
  }
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || "";
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

function getCategoryPillClass(category) {
  switch (category) {
    case "PnL":
      return "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30";
    case "Trading Setup":
      return "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/30";
    case "Trading Goals":
      return "bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30";
    case "Memes":
      return "bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/30";
    case "Chart Analysis":
      return "bg-violet-500/15 text-violet-100 ring-1 ring-violet-400/30";
    default:
      return "bg-slate-500/20 text-slate-100 ring-1 ring-slate-400/30";
  }
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

function normalizeCommunityPost(raw) {
  const createdRaw = Number(raw?.created_at ?? raw?.createdAt ?? Date.now());
  const updatedRaw = Number(raw?.updated_at ?? raw?.updatedAt ?? createdRaw);

  return {
    id: String(raw?.id || ""),
    authorEmail: String(raw?.author_email || raw?.authorEmail || ""),
    category: String(raw?.category || ""),
    title: String(raw?.title || ""),
    description: String(raw?.description || ""),
    images: Array.isArray(raw?.images)
      ? raw.images
          .map((image, index) => ({
            id: String(image?.id || `${raw?.id || "post"}-${index}`),
            src: String(image?.src || ""),
            name: String(image?.name || "")
          }))
          .filter((image) => image.src)
      : [],
    likes: Number(raw?.likes ?? raw?.likes_count ?? 0) || 0,
    liked: Boolean(raw?.liked),
    createdAt: createdRaw < 1_000_000_000_000 ? createdRaw * 1000 : createdRaw,
    updatedAt: updatedRaw < 1_000_000_000_000 ? updatedRaw * 1000 : updatedRaw
  };
}

function EmptyFeedState({ title = "No posts found", subtitle = "Create a post to start the community feed." }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center">
      <p className="text-sm font-semibold text-[#d3e1f7]">{title}</p>
      <p className="mt-1 text-xs text-[#8fa6c8]">{subtitle}</p>
    </div>
  );
}

function ZoomablePostImage({ image, isModalView, onClick }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(1);
  }, [image.id]);

  return (
    <button
      type="button"
      onClick={onClick}
      onWheel={(event) => {
        if (!isModalView) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const delta = event.deltaY > 0 ? -0.1 : 0.1;
        setScale((previous) => {
          const next = Math.min(4, Math.max(1, previous + delta));
          return Number(next.toFixed(2));
        });
      }}
      className="group relative block w-full overflow-hidden rounded-xl"
      title={isModalView ? "Scroll to zoom" : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.name || "Uploaded image"}
        className={`w-full object-cover transition-transform duration-300 ${isModalView ? "max-h-[520px]" : "max-h-[280px] group-hover:scale-[1.02]"}`}
        style={isModalView ? { transform: `scale(${scale})`, transformOrigin: "center center" } : undefined}
      />
      {isModalView ? (
        <span className="absolute right-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[10px] font-semibold text-white">
          {Math.round(scale * 100)}%
        </span>
      ) : null}
    </button>
  );
}

function ImageGrid({ images, isModalView = false, onImageClick }) {
  if (!Array.isArray(images) || images.length === 0) {
    return null;
  }

  if (images.length === 1) {
    return (
      <div className="mt-3">
        <ZoomablePostImage
          image={images[0]}
          isModalView={isModalView}
          onClick={(event) => {
            event.stopPropagation();
            onImageClick?.();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {images.map((image) => (
        <ZoomablePostImage
          key={image.id}
          image={image}
          isModalView={isModalView}
          onClick={(event) => {
            event.stopPropagation();
            onImageClick?.();
          }}
        />
      ))}
    </div>
  );
}

export default function CommunityClient({
  userName = "",
  userEmail = "",
  userImage = "",
  isAdmin = false
}) {
  const [feedScope, setFeedScope] = useState("all");
  const [activeCategory, setActiveCategory] = useState("All");
  const [posts, setPosts] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({
    totalPosts: 0,
    totalPages: 1,
    currentPage: 1
  });
  const [isLoadingPosts, setIsLoadingPosts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);

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

  const primaryInputRef = useRef(null);
  const secondaryInputRef = useRef(null);
  const previewUrlsRef = useRef(new Set());

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) || null,
    [posts, selectedPostId]
  );
  const pageNumbers = useMemo(
    () => Array.from({ length: pagination.totalPages }, (_, index) => index + 1),
    [pagination.totalPages]
  );

  const loadPosts = useCallback(async (scopeValue, categoryValue, pageValue = 1) => {
    setIsLoadingPosts(true);
    try {
      const query = new URLSearchParams({
        scope: scopeValue,
        category: categoryValue,
        limit: String(POSTS_PAGE_LIMIT),
        page: String(pageValue)
      });

      const response = await fetch(`/api/community/posts?${query.toString()}`, {
        method: "GET",
        cache: "no-store"
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load posts");
      }

      const normalized = Array.isArray(payload?.posts)
        ? payload.posts.map(normalizeCommunityPost)
        : [];

      setPosts(normalized);
      const nextTotalPosts = Number(payload?.totalPosts ?? payload?.total ?? 0) || 0;
      const nextTotalPages = Math.max(1, Number(payload?.totalPages ?? Math.ceil(nextTotalPosts / POSTS_PAGE_LIMIT)) || 1);
      const nextPage = Math.min(nextTotalPages, Math.max(1, Number(payload?.currentPage ?? pageValue) || 1));

      setPagination({
        totalPosts: nextTotalPosts,
        totalPages: nextTotalPages,
        currentPage: nextPage
      });
      setCurrentPage(nextPage);
    } catch (error) {
      toast.error(error?.message || "Failed to load posts");
      setPosts([]);
      setPagination({
        totalPosts: 0,
        totalPages: 1,
        currentPage: 1
      });
      setCurrentPage(1);
    } finally {
      setIsLoadingPosts(false);
    }
  }, []);

  useEffect(() => {
    if (isComposerOpen) {
      return;
    }
    void loadPosts(feedScope, activeCategory, currentPage);
  }, [activeCategory, currentPage, feedScope, isComposerOpen, loadPosts]);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!selectedPost) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedPost]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && selectedPostId) {
        setSelectedPostId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedPostId]);

  const clearPreviewUrl = (url) => {
    if (!url) {
      return;
    }
    if (previewUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      previewUrlsRef.current.delete(url);
    }
  };

  const clearForm = () => {
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
      setFormErrors((previous) => ({
        ...previous,
        [errorField]: validationError
      }));
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

    setFormErrors((previous) => ({
      ...previous,
      [errorField]: ""
    }));

    setFormState((previous) => ({
      ...previous,
      [field]: file,
      [previewField]: previewUrl
    }));
  };

  const validateForm = () => {
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const { isValid, cleanTitle, cleanDescription } = validateForm();
    if (!isValid) {
      return;
    }

    setIsSubmitting(true);

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

      setFeedScope("all");
      setActiveCategory("All");
      setCurrentPage(1);
      clearForm();
      setIsComposerOpen(false);
      toast.success("Post submitted for admin approval");
      await loadPosts("all", "All", 1);
    } catch (error) {
      toast.error(error?.message || "Failed to create post");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleLike = async (postId) => {
    try {
      const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/like`, {
        method: "POST"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to like post");
      }

      const nextLikes = Number(payload?.likes || 0);
      const nextLiked = Boolean(payload?.liked);

      setPosts((previous) =>
        previous.map((post) =>
          post.id === String(postId)
            ? {
                ...post,
                likes: nextLikes,
                liked: nextLiked
              }
            : post
        )
      );
    } catch (error) {
      toast.error(error?.message || "Failed to like post");
    }
  };

  const handleDeletePost = async (postId) => {
    try {
      const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}`, {
        method: "DELETE"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete post");
      }

      const shouldMoveToPreviousPage = posts.length <= 1 && currentPage > 1;
      const targetPage = shouldMoveToPreviousPage ? currentPage - 1 : currentPage;
      if (selectedPostId === String(postId)) {
        setSelectedPostId(null);
      }
      setCurrentPage(targetPage);
      await loadPosts(feedScope, activeCategory, targetPage);
      toast.success("Post deleted");
    } catch (error) {
      toast.error(error?.message || "Failed to delete post");
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_10%_-8%,rgba(62,133,255,0.24),transparent_35%),radial-gradient(circle_at_88%_6%,rgba(22,197,128,0.1),transparent_28%),linear-gradient(180deg,#040914_0%,#030812_100%)] text-white">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 2500,
          style: {
            background: "#0c1b30",
            color: "#dce9ff",
            border: "1px solid rgba(126,162,216,0.32)",
            boxShadow: "0 14px 32px rgba(0,0,0,0.35)"
          }
        }}
      />

      <div className="mx-auto w-full max-w-7xl px-4 pb-8 pt-0 sm:px-6 lg:px-10">
        <AppTopHeaderClient
          userName={userName}
          userEmail={userEmail}
          userImage={userImage}
          isAdmin={isAdmin}
        />

        <header className="mt-4 rounded-2xl border border-white/[0.1] bg-white/[0.03] px-5 py-5 shadow-[0_20px_50px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#90abd1]">Tradestrom</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#edf5ff] sm:text-[2rem]">Community</h1>
          <p className="mt-1.5 text-sm text-[#9db3d0]">
            Share PnL, setups, goals, memes, and chart analysis with your team in one live feed.
          </p>
        </header>

        <section className="mt-4 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.32)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFeedScope("all");
                  setCurrentPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] transition ${
                  feedScope === "all"
                    ? "bg-[#1a4d96] text-white shadow-[inset_0_0_0_1px_rgba(143,188,255,0.45)]"
                    : "bg-white/[0.04] text-[#a8bfdf] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-white/[0.08]"
                }`}
              >
                All Posts
              </button>
              <button
                type="button"
                onClick={() => {
                  setFeedScope("mine");
                  setCurrentPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] transition ${
                  feedScope === "mine"
                    ? "bg-[#1a4d96] text-white shadow-[inset_0_0_0_1px_rgba(143,188,255,0.45)]"
                    : "bg-white/[0.04] text-[#a8bfdf] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-white/[0.08]"
                }`}
              >
                My Posts
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsComposerOpen(true)}
              className="inline-flex items-center justify-center rounded-lg bg-[#1d5fbe] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white transition hover:bg-[#2a73de]"
            >
              Create Post
            </button>
          </div>

          {isComposerOpen ? (
            <form onSubmit={handleSubmit} className="mt-4 rounded-xl border border-white/[0.1] bg-[#0b1728]/60 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#9bb3d2]">Create Post</h2>

              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="text-xs font-semibold text-[#cddcf3]">Category *</span>
                  <select
                    value={formState.category}
                    onChange={(event) => setFormState((previous) => ({ ...previous, category: event.target.value }))}
                    className="mt-1.5 w-full rounded-lg border border-white/[0.12] bg-[#0b1728]/95 px-3 py-2 text-sm text-white outline-none focus:border-[#60a3ff]"
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
                    className="mt-1.5 w-full rounded-lg border border-white/[0.12] bg-[#0b1728]/95 px-3 py-2 text-sm text-white placeholder:text-[#6c85a7] outline-none focus:border-[#60a3ff]"
                  />
                  {formErrors.title ? <p className="mt-1 text-xs text-rose-300">{formErrors.title}</p> : null}
                </label>

                <label className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#cddcf3]">Description / Content *</span>
                    <span className="text-[11px] text-[#87a2c6]">{formState.description.length}/{MAX_DESCRIPTION_LENGTH}</span>
                  </div>
                  <textarea
                    maxLength={MAX_DESCRIPTION_LENGTH}
                    value={formState.description}
                    onChange={(event) => setFormState((previous) => ({ ...previous, description: event.target.value }))}
                    placeholder="Write your post content"
                    rows={6}
                    className="mt-1.5 w-full resize-none rounded-lg border border-white/[0.12] bg-[#0b1728]/95 px-3 py-2 text-sm text-white placeholder:text-[#6c85a7] outline-none focus:border-[#60a3ff]"
                  />
                  {formErrors.description ? <p className="mt-1 text-xs text-rose-300">{formErrors.description}</p> : null}
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-[#cddcf3]">Primary Image Upload *</span>
                  <input
                    ref={primaryInputRef}
                    type="file"
                    accept={IMAGE_ACCEPT}
                    onChange={handleFileInput("primaryFile")}
                    className="mt-1.5 block w-full rounded-lg border border-white/[0.12] bg-[#0b1728]/95 px-3 py-2 text-xs text-[#c8d9f0] file:mr-3 file:rounded-md file:border-0 file:bg-[#1a4d96] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                  />
                  <p className="mt-1 text-[11px] text-[#87a2c6]">Accepted: JPG, JPEG, PNG, WEBP (max 5MB)</p>
                  {formErrors.primaryFile ? <p className="mt-1 text-xs text-rose-300">{formErrors.primaryFile}</p> : null}
                  {formState.primaryPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={formState.primaryPreview} alt="Primary preview" className="mt-2 h-40 w-full rounded-lg object-cover" />
                  ) : null}
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-[#cddcf3]">Secondary Image Upload (Optional)</span>
                  <input
                    ref={secondaryInputRef}
                    type="file"
                    accept={IMAGE_ACCEPT}
                    onChange={handleFileInput("secondaryFile")}
                    className="mt-1.5 block w-full rounded-lg border border-white/[0.12] bg-[#0b1728]/95 px-3 py-2 text-xs text-[#c8d9f0] file:mr-3 file:rounded-md file:border-0 file:bg-[#2a6d4f] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                  />
                  {formErrors.secondaryFile ? <p className="mt-1 text-xs text-rose-300">{formErrors.secondaryFile}</p> : null}
                  {formState.secondaryPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={formState.secondaryPreview} alt="Secondary preview" className="mt-2 h-40 w-full rounded-lg object-cover" />
                  ) : null}
                </label>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center rounded-lg bg-[#1d5fbe] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white transition hover:bg-[#2a73de] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Submitting..." : "Submit"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearForm();
                    setIsComposerOpen(false);
                  }}
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center rounded-lg bg-white/[0.08] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#c6daf5] transition hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-4">
              <div className="mb-3 flex flex-wrap gap-2">
                {FILTER_CATEGORY_OPTIONS.map((category) => {
                  const isActive = activeCategory === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => {
                        setActiveCategory(category);
                        setCurrentPage(1);
                      }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] transition ${
                        isActive
                          ? "bg-[#1a4d96] text-white shadow-[inset_0_0_0_1px_rgba(143,188,255,0.45)]"
                          : "bg-white/[0.04] text-[#a8bfdf] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-white/[0.08]"
                      }`}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>

              {isLoadingPosts ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center text-sm text-[#a5bddb]">
                  Loading posts...
                </div>
              ) : posts.length === 0 ? (
                feedScope === "mine" ? (
                  <EmptyFeedState title="No posts in My Posts" subtitle="Create a post and it will appear here." />
                ) : (
                  <EmptyFeedState />
                )
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {posts.map((post) => (
                      <article
                        key={post.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPostId(post.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedPostId(post.id);
                          }
                        }}
                        className="cursor-pointer rounded-2xl border border-white/[0.1] bg-white/[0.03] p-4 shadow-[0_16px_45px_rgba(0,0,0,0.28)] transition hover:border-[#7ea8df]/45 hover:bg-white/[0.05]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getCategoryPillClass(post.category)}`}>
                            {post.category}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-[#88a3c5]">{formatTimestamp(post.createdAt)}</span>
                            {feedScope === "mine" ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDeletePost(post.id);
                                }}
                                className="rounded-md bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-200 ring-1 ring-rose-400/35 transition hover:bg-rose-500/30"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </div>

                        <h3 className="mt-2 text-lg font-semibold text-[#edf5ff]">{post.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-[#a9c0de]">{truncateText(post.description, 180)}</p>

                        <ImageGrid images={post.images} onImageClick={() => setSelectedPostId(post.id)} />

                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleLike(post.id);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                              post.liked
                                ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40"
                                : "bg-white/[0.07] text-[#c1d5f3] ring-1 ring-white/10 hover:bg-white/[0.12]"
                            }`}
                          >
                            <span>{post.liked ? "♥" : "♡"}</span>
                            <span>Like</span>
                            <span className="text-[11px]">{post.likes}</span>
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>

                  {pagination.totalPosts > POSTS_PAGE_LIMIT ? (
                    <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={currentPage === 1}
                          onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                          className="rounded-md bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-[#c9daf4] transition hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Prev
                        </button>

                        <div className="flex-1 overflow-x-auto">
                          <div className="flex min-w-max items-center justify-center gap-1.5 py-0.5">
                            {pageNumbers.map((pageNumber) => (
                              <button
                                key={`community-page-${pageNumber}`}
                                type="button"
                                onClick={() => setCurrentPage(pageNumber)}
                                className={`h-8 min-w-8 rounded-md px-2 text-xs font-semibold transition ${
                                  currentPage === pageNumber
                                    ? "bg-[#1a4d96] text-white shadow-[inset_0_0_0_1px_rgba(143,188,255,0.45)]"
                                    : "bg-white/[0.06] text-[#b4c9e8] hover:bg-white/[0.12]"
                                }`}
                              >
                                {pageNumber}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={currentPage >= pagination.totalPages}
                          onClick={() => setCurrentPage((previous) => Math.min(pagination.totalPages, previous + 1))}
                          className="rounded-md bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-[#c9daf4] transition hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {selectedPost ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedPostId(null);
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl border border-white/[0.14] bg-[#071427] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getCategoryPillClass(selectedPost.category)}`}>
                  {selectedPost.category}
                </span>
                <h3 className="mt-2 text-xl font-semibold text-[#f3f8ff]">{selectedPost.title}</h3>
                <p className="mt-1 text-xs text-[#86a1c5]">{formatTimestamp(selectedPost.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPostId(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.08] text-[#dceaff] transition hover:bg-white/[0.14]"
                aria-label="Close post details"
              >
                ×
              </button>
            </div>

            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#c0d3ee]">{selectedPost.description}</p>

            <ImageGrid images={selectedPost.images} isModalView onImageClick={() => {}} />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void toggleLike(selectedPost.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  selectedPost.liked
                    ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40"
                    : "bg-white/[0.07] text-[#c1d5f3] ring-1 ring-white/10 hover:bg-white/[0.12]"
                }`}
              >
                <span>{selectedPost.liked ? "♥" : "♡"}</span>
                <span>Like</span>
                <span className="text-[11px]">{selectedPost.likes}</span>
              </button>

              {feedScope === "mine" ? (
                <button
                  type="button"
                  onClick={() => void handleDeletePost(selectedPost.id)}
                  className="inline-flex items-center rounded-md bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 ring-1 ring-rose-400/35 transition hover:bg-rose-500/30"
                >
                  Delete Post
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
