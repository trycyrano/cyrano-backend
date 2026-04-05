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

  const DEV_USERS = ['c94ec209-a100-4319-90c5-6e02ec6e28e7'];
  const dailyLimit = DEV_USERS.includes(userId) ? 50 : 5;
  if (usage?.count >= dailyLimit) {
    return res.status(403).json({ error: "daily_limit_reached" });
  }

  const rawMessages = profile?.messages || "";
  const voiceExamples = rawMessages.trim()
    ? rawMessages
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((m, i) => `${i + 1}. "${m}"`)
        .join("\n")
    : null;
  const isAskOut = mode === "ask_out";

  const voiceSection = voiceExamples
    ? `The user's actual sent messages from past conversations (study their vocabulary, sentence length, humor, punctuation, and emoji use — replicate it exactly):
${voiceExamples}`
    : `No voice profile set — write in a natural, modern texting style.`;

  const conversationContext = `IMPORTANT — reading a dating app conversation:
Each message is prefixed with who sent it:
- [YOU] = sent by the user (the person you're helping) — do NOT reply to these
- [THEM] = sent by their match — this is who you're writing a reply to
The last [THEM] message is what you must reply to. Ignore all [YOU] messages.`;

  const prompt = isAskOut
    ? `You are a dating coach helping someone move a conversation toward meeting in person.

${conversationContext}

${voiceSection}

Conversation OCR text:
${ocrText}

Generate exactly 3 messages that naturally transition toward meeting IRL or exchanging numbers. Range from subtle to direct. Mirror the user's voice precisely — same casualness, same length, same punctuation style.

Return ONLY a JSON array, no other text:
[
  { "reply": "...", "tip": "...", "tone": "Subtle" },
  { "reply": "...", "tip": "...", "tone": "Balanced" },
  { "reply": "...", "tip": "...", "tone": "Direct" }
]`
    : `You are a dating coach generating reply suggestions in the user's own voice.

${conversationContext}

${voiceSection}

Conversation OCR text:
${ocrText}

Generate exactly 3 reply suggestions — one Flirty, one Curious, one Funny. Each must use a distinctly different approach. Mirror the user's voice precisely — same casualness, sentence length, punctuation style, and emoji habits. Keep replies concise (1-2 sentences max). Add a one-line coach tip per reply.

IMPORTANT: The tone field must be exactly "Flirty" for reply 1, "Curious" for reply 2, "Funny" for reply 3. Do not repeat tones.

Return ONLY a JSON array, no other text:
[
  { "reply": "...", "tip": "...", "tone": "Flirty" },
  { "reply": "...", "tip": "...", "tone": "Curious" },
  { "reply": "...", "tip": "...", "tone": "Funny" }
]`;

  let message;
  try {
    message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    return res.status(500).json({ error: "anthropic_error", detail: err.message, status: err.status });
  }

  // Increment usage
  await supabase.from("usage").upsert(
    { user_id: userId, date: today, count: (usage?.count || 0) + 1 },
    { onConflict: "user_id,date" }
  );

  const text = message.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return res.status(500).json({ error: "parse_error" });

  const expectedTones = isAskOut
    ? ['Subtle', 'Balanced', 'Direct']
    : ['Flirty', 'Curious', 'Funny'];

  const suggestions = JSON.parse(jsonMatch[0])
    .slice(0, 3)
    .map((s, i) => ({ ...s, tone: expectedTones[i] }));

  res.json({ suggestions });
}
