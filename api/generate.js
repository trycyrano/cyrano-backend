import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { userId, ocrText, mode } = req.body;
  if (!userId || !ocrText) {
    return res.status(400).json({ error: "missing_fields" });
  }

  // Load voice profile
  const { data: profile } = await supabase
    .from("voice_profiles")
    .select("messages")
    .eq("user_id", userId)
    .single();

  // Check usage (free tier = 5/day)
  const today = new Date().toISOString().split("T")[0];
  const { data: usage } = await supabase
    .from("usage")
    .select("count")
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  if (usage?.count >= 5) {
    return res.status(403).json({ error: "daily_limit_reached" });
  }

  const voiceExamples = profile?.messages || "No voice profile yet.";
  const isAskOut = mode === "ask_out";

  const prompt = isAskOut
    ? `You are a dating coach helping someone move a conversation toward meeting in person.

The user's natural texting style (match this voice exactly):
${voiceExamples}

Conversation from screenshot:
${ocrText}

Generate exactly 3 messages that naturally transition toward meeting IRL or exchanging numbers. Range from subtle to direct.

For each:
- Write the message in the user's voice
- Add a one-line coach tip on the approach
- Add a label: Subtle / Balanced / Direct

Return ONLY a JSON array, no other text:
[
  { "reply": "...", "tip": "...", "tone": "Subtle" },
  { "reply": "...", "tip": "...", "tone": "Balanced" },
  { "reply": "...", "tip": "...", "tone": "Direct" }
]`
    : `You are a dating coach generating reply suggestions in the user's own voice.

The user's natural texting style (match this voice exactly):
${voiceExamples}

Conversation from screenshot:
${ocrText}

Generate exactly 3 reply suggestions. For each:
- Write the reply matching the user's vocabulary, humor, and tone
- Add a one-line coach tip explaining why this reply works
- Add a tone tag: Flirty, Curious, or Funny

Return ONLY a JSON array, no other text:
[
  { "reply": "...", "tip": "...", "tone": "Flirty" },
  { "reply": "...", "tip": "...", "tone": "Curious" },
  { "reply": "...", "tip": "...", "tone": "Funny" }
]`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  // Increment usage
  await supabase.from("usage").upsert(
    { user_id: userId, date: today, count: (usage?.count || 0) + 1 },
    { onConflict: "user_id,date" }
  );

  const text = message.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return res.status(500).json({ error: "parse_error" });

  const suggestions = JSON.parse(jsonMatch[0]);
  res.json({ suggestions });
}
