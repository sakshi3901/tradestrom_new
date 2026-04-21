import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

const REVIEW_PROMPT = `
You are a strict content reviewer.
Analyze the following two images and their caption text (in English, Hindi, or Hindi written in English).
Return a one-word answer only: "yes" or "no".

Respond with "no" if any of the following is present in the image or caption:
- Negative thoughts, hate, or toxicity
- Promotions of third-party platforms (e.g., Telegram, YouTube, Instagram, websites, logos, handles)
- Contact information (phone numbers, emails, usernames, social media handles)
- Text or drawings containing such promotions or contact info
- Any form of question (e.g., how, why, what, or symbols like ?, ❓), drawed or asked and any accusations passed, ignore spelling mistakes
- Any foul language
- If the caption is an empty string, ignore it

Respond with "yes" if:
- None of the above disallowed elements are found
- The content contains positive reviews or appreciation of TradeStrom or its services:
  - Range Charts
  - stock data, stock informations
  - Delivery trend
  - Market statistics
  - OI change distribution
- Image or caption promotes only TradeStrom or TradeStrom.in strategies (allowed)

Return strict JSON in exactly this shape:
{"answer":"yes","reason":"one short line"}
`.trim();

function makeError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeImages(rawImages) {
  if (!Array.isArray(rawImages)) {
    return [];
  }
  return rawImages
    .map((value) => String(value || "").trim())
    .filter((value) => value.startsWith("data:image/") || value.startsWith("http://") || value.startsWith("https://"))
    .slice(0, 2);
}

function parseReviewerOutput(rawOutput) {
  const output = String(rawOutput || "").trim();
  if (!output) {
    throw makeError("AI returned an empty response", 502);
  }

  const lowered = output.toLowerCase();
  if (lowered === "yes" || lowered === "no") {
    return {
      answer: lowered,
      reason: lowered === "yes" ? "Allowed content as per policy." : "Blocked by policy checks."
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(output);
  } catch (_) {
    const match = output.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (_) {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw makeError("AI response was not valid JSON", 502);
  }

  const answerCandidate = String(parsed.answer || "").trim().toLowerCase();
  const answer = answerCandidate === "no" ? "no" : "yes";
  const reason = String(parsed.reason || "").trim() || (answer === "yes"
    ? "Allowed content as per policy."
    : "Blocked by policy checks.");

  return { answer, reason };
}

async function requestAiReview({ title, description, images }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw makeError("AI reviewer is not configured", 503);
  }

  const model = String(process.env.OPENAI_COMMUNITY_REVIEW_MODEL || "gpt-4o-mini").trim();
  const caption = [title, description].map((value) => String(value || "").trim()).filter(Boolean).join("\n\n");

  const content = [
    {
      type: "text",
      text: `Caption text:\n${caption || ""}`
    }
  ];

  images.forEach((src) => {
    content.push({
      type: "image_url",
      image_url: { url: src }
    });
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 140,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: REVIEW_PROMPT
          },
          {
            role: "user",
            content
          }
        ]
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (String(error?.name || "").toLowerCase() === "aborterror") {
      throw makeError("AI reviewer timed out", 504);
    }
    throw makeError("Failed to call AI reviewer", 502);
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || "AI reviewer request failed";
    throw makeError(String(message), response.status || 502);
  }

  const messageContent = payload?.choices?.[0]?.message?.content;
  return parseReviewerOutput(messageContent);
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await checkAccess(session.user.email).catch(() => ({ allowed: false, role: "client" }));
  if (!access.allowed || access.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch (_) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = String(body?.title || "").trim();
  const description = String(body?.description || "").trim();
  const images = normalizeImages(body?.images);
  if (images.length === 0) {
    return NextResponse.json({ error: "At least one image is required" }, { status: 400 });
  }

  try {
    const result = await requestAiReview({ title, description, images });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const code = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error?.message || "Failed to generate AI suggestion" },
      { status: code }
    );
  }
}
