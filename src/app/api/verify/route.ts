import OpenAI from "openai";
import { NextResponse } from "next/server";

import { parseApplicationFields, validateImage } from "@/lib/verification/input";
import { verifyLabel } from "@/lib/verification/verify";

export const runtime = "nodejs";
/** Extraction usually lands well under 5s; this is the hard ceiling. */
export const maxDuration = 60;

/**
 * POST /api/verify — multipart form:
 *   image: File (jpeg/png/webp/gif, ≤10MB)
 *   brandName, classType, alcoholPercent, netContents: strings
 *
 * Returns a VerificationResult. Batch mode is N parallel calls to this
 * endpoint from the client — each label is independent, so the server
 * stays stateless and per-label latency stays inside the 5s budget.
 */
export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Server is missing the OPENAI_API_KEY environment variable." },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data." },
      { status: 400 },
    );
  }

  const application = parseApplicationFields({
    brandName: form.get("brandName"),
    classType: form.get("classType"),
    alcoholPercent: form.get("alcoholPercent"),
    netContents: form.get("netContents"),
    bottlerNameAddress: form.get("bottlerNameAddress"),
    countryOfOrigin: form.get("countryOfOrigin"),
    imported: form.get("imported"),
  });
  if (!application.ok) {
    return NextResponse.json({ error: application.error }, { status: 400 });
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json(
      { error: "A label image file is required." },
      { status: 400 },
    );
  }
  const imageCheck = validateImage(image.type, image.size);
  if (!imageCheck.ok) {
    return NextResponse.json({ error: imageCheck.error }, { status: 400 });
  }

  const imageBase64 = Buffer.from(await image.arrayBuffer()).toString("base64");

  try {
    const result = await verifyLabel(application.data, {
      imageBase64,
      mediaType: imageCheck.mediaType,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) {
      return NextResponse.json(
        { error: "The configured OpenAI API key was rejected." },
        { status: 500 },
      );
    }
    if (error instanceof OpenAI.RateLimitError) {
      return NextResponse.json(
        { error: "The AI service is rate limited — try again in a moment.", retryable: true },
        { status: 429 },
      );
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return NextResponse.json(
        { error: "Could not reach the AI service — check the network and retry.", retryable: true },
        { status: 502 },
      );
    }
    if (error instanceof OpenAI.APIError) {
      return NextResponse.json(
        { error: `AI service error (${error.status}). Please retry.`, retryable: true },
        { status: 502 },
      );
    }
    console.error("verify: unexpected error", error);
    return NextResponse.json(
      { error: "Unexpected server error while verifying the label." },
      { status: 500 },
    );
  }
}
