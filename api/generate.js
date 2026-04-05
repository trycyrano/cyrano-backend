import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// Edge Runtime — zero cold starts, global low latency
export const config = { runtime: "edge" };

function buildVoiceProfile(rawMessages) {
  const lines = rawMessages.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30);
  if (!lines.length) return null;
  const avgLen = Math.round(lines.reduce((s, l) => s + l.length, 0) / lines.length);
  const emojiCount = lines.filter((l) => /\p{Emoji}/u.test(l)).length;
  const emojiFreq = emojiCount === 0 ? "no emojis" : emojiCount < lines.length * 0.3 ? "rare emojis" : "frequent emojis";
  const punctuation = lines.filter((l) => /[.!?]$/.test(l)).length < lines.length * 0.3 ? "no trailing punctuation" : "uses punctuation";
  const lowercase = lines.filter((l) => l[0] === l[0]?.toLowerCase()).length > lines.length * 0.6 ? "lowercase" : "normal caps";
  const examples = lines.slice(0, 5).map((m, i) => `${i + 1}."${m}"`).join(" ");
  return `Voice: ~${avgLen} chars, ${emojiFreq}, ${punctuation}, ${lowercase}. Examples: ${examples}`;
}

// Trim OCR to last 20 lines — model only needs recent context
function trimOcr(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.slice(-20).join("\n");
}

export default async function handler(req) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: corsHeaders });

  const { userId, ocrText, mode } = await req.json();
  if (!userId || !ocrText) {
    return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: corsHeaders });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const today = new Date().toISOString().split("T")[0];

  const [{ data: profile }, { data: usage }] = await Promise.all([
    supabase.from("voice_profiles").select("messages").eq("user_id", userId).single(),
    supabase.from("usage").select("count").eq("user_id", userId).eq("date", today).single(),
  ]);

  const DEV_USERS = ['c94ec209-a100-4319-90c5-6e02ec6e28e7'];
  const dailyLimit = DEV_USERS.includes(userId) ? 50 : 5;
  if (usage?.count >= dailyLimit) {
    return new Response(JSON.stringify({ error: "daily_limit_reached" }), { status: 403, headers: corsHeaders });
  }

  const isAskOut = mode === "ask_out";
  const voiceSection = profile?.messages?.trim()
    ? buildVoiceProfile(profile.messages)
    : "No voice profile — natural modern texting style.";

  const now = new Date().toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  const systemPrompt = `You are Cyrano, a witty dating coach writing reply suggestions in the user's voice.
Current time: ${now}

Rules:
- [YOU] = user's messages (study for voice, never reply to)
- [THEM] = match's messages (reply to the LAST one only)
- Timestamps in OCR: hours ago→reply naturally, days→briefly acknowledge gap, weeks→re-open cold
- Return ONLY valid JSON, no markdown
- 1-2 sentences max per reply, each tone genuinely distinct
- Mirror user's voice exactly`;

  const trimmedOcr = trimOcr(ocrText);

  const userMessage = `${voiceSection}

Conversation:
${trimmedOcr}

${isAskOut
    ? `3 messages moving toward meeting IRL or exchanging numbers (Subtle→Direct).
Return ONLY:
[{"reply":"...","tip":"...","tone":"Subtle"},{"reply":"...","tip":"...","tone":"Balanced"},{"reply":"...","tip":"...","tone":"Direct"}]`
    : `3 replies — Flirty, Curious, Funny — genuinely different approaches, 1-2 sentences each.
Return ONLY:
[{"reply":"...","tip":"...","tone":"Flirty"},{"reply":"...","tip":"...","tone":"Curious"},{"reply":"...","tip":"...","tone":"Funny"}]`}`;

  const expectedTones = isAskOut ? ['Subtle', 'Balanced', 'Direct'] : ['Flirty', 'Curious', 'Funny'];

  let message;
  try {
    message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      temperature: 0.9,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "anthropic_error", detail: err.message }), { status: 500, headers: corsHeaders });
  }

  await supabase.from("usage").upsert(
    { user_id: userId, date: today, count: (usage?.count || 0) + 1 },
    { onConflict: "user_id,date" }
  );

  const text = message.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return new Response(JSON.stringify({ error: "parse_error" }), { status: 500, headers: corsHeaders });

  const suggestions = JSON.parse(jsonMatch[0]).slice(0, 3).map((s, i) => ({ ...s, tone: expectedTones[i] }));
  return new Response(JSON.stringify({ suggestions }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
