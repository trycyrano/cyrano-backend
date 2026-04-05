import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function buildVoiceProfile(rawMessages) {
  const lines = rawMessages
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30);

  if (!lines.length) return null;

  const avgLen = Math.round(lines.reduce((s, l) => s + l.length, 0) / lines.length);
  const emojiCount = lines.filter((l) => /\p{Emoji}/u.test(l)).length;
  const emojiFreq = emojiCount === 0 ? "never uses emojis" : emojiCount < lines.length * 0.3 ? "rarely uses emojis" : "frequently uses emojis";
  const punctuation = lines.filter((l) => /[.!?]$/.test(l)).length < lines.length * 0.3 ? "rarely ends with punctuation" : "uses punctuation normally";
  const lowercase = lines.filter((l) => l[0] === l[0]?.toLowerCase()).length > lines.length * 0.6 ? "types mostly lowercase" : "uses normal capitalization";
  const examples = lines.slice(0, 6).map((m, i) => `  ${i + 1}. "${m}"`).join("\n");

  return `Voice profile (replicate this style exactly):
- Average message length: ~${avgLen} characters
- ${emojiFreq}
- ${punctuation}
- ${lowercase}
- Example messages they've sent:
${examples}`;
}

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

  // Load voice profile + check usage in parallel
  const [{ data: profile }, { data: usage }] = await Promise.all([
    supabase.from("voice_profiles").select("messages").eq("user_id", userId).single(),
    supabase.from("usage").select("count").eq("user_id", userId).eq("date", new Date().toISOString().split("T")[0]).single(),
  ]);

  const DEV_USERS = ['c94ec209-a100-4319-90c5-6e02ec6e28e7'];
  const dailyLimit = DEV_USERS.includes(userId) ? 50 : 5;
  if (usage?.count >= dailyLimit) {
    return res.status(403).json({ error: "daily_limit_reached" });
  }

  const today = new Date().toISOString().split("T")[0];
  const isAskOut = mode === "ask_out";

  const voiceSection = profile?.messages?.trim()
    ? buildVoiceProfile(profile.messages)
    : "No voice profile — write in a natural, modern texting style.";

  const now = new Date().toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  // System prompt — role, rules, permanent context
  const systemPrompt = `You are Cyrano, an expert dating coach who writes reply suggestions in the user's own voice. You are witty, emotionally intelligent, and deeply understand modern dating dynamics.

Your job:
- Read a dating app conversation (OCR text with [YOU] and [THEM] labels)
- Write replies FOR THE USER to send TO THEIR MATCH
- [YOU] = the user's sent messages — study these for voice, do NOT reply to them
- [THEM] = the match's messages — reply to the LAST [THEM] message only
- Never mix up who said what

Timing awareness — current time is ${now}:
- Look for timestamps in the OCR (e.g. "2h ago", "Yesterday", "Monday", "9:42 PM")
- Hours ago → reply naturally
- Yesterday / couple days ago → subtle acknowledgment before getting into it
- Several days → open with a casual acknowledgment ("sorry for the late reply", "been a crazy week") then re-engage
- Weeks → treat as re-opening a cold conversation entirely
- No timestamps visible → ignore timing, reply normally

Output rules:
- Return ONLY valid JSON, no markdown, no explanation
- Replies must be concise (1-2 sentences max)
- Each tone must be genuinely distinct — no repeating approaches
- Mirror the user's voice exactly from their voice profile`;

  const fewShotReply = isAskOut ? `[
  { "reply": "okay but real talk we should actually grab that drink instead of just talking about it lol", "tip": "Turns the abstract into concrete without being intense.", "tone": "Subtle" },
  { "reply": "alright I'm calling it — we're doing drinks this week, pick a night", "tip": "Takes the lead confidently, gives them choice of timing.", "tone": "Balanced" },
  { "reply": "give me your number, this convo is too good to stay on here", "tip": "Direct and flattering — frames the move as a compliment.", "tone": "Direct" }
]` : `[
  { "reply": "okay that's actually really attractive ngl 👀", "tip": "Short, punchy, leaves them wanting more.", "tone": "Flirty" },
  { "reply": "wait what made you get into that? I feel like there's a story there", "tip": "Shows genuine interest and opens them up.", "tone": "Curious" },
  { "reply": "okay so you're saying you're basically a professional chaos gremlin got it", "tip": "Playful reframe that shows you were paying attention.", "tone": "Funny" }
]`;

  const userMessage = `${voiceSection}

Conversation OCR text:
${ocrText}

${isAskOut
  ? `Generate exactly 3 messages that naturally move toward meeting IRL or exchanging numbers. Range from subtle to direct. Mirror the user's voice precisely.

Example of perfect output:
${fewShotReply}

Now generate for this conversation. Return ONLY a JSON array:
[
  { "reply": "...", "tip": "...", "tone": "Subtle" },
  { "reply": "...", "tip": "...", "tone": "Balanced" },
  { "reply": "...", "tip": "...", "tone": "Direct" }
]`
  : `Generate exactly 3 reply suggestions — Flirty, Curious, Funny — each with a genuinely different approach. Mirror the user's voice precisely. 1-2 sentences max per reply.

Example of perfect output:
${fewShotReply}

Now generate for this conversation. Return ONLY a JSON array:
[
  { "reply": "...", "tip": "...", "tone": "Flirty" },
  { "reply": "...", "tip": "...", "tone": "Curious" },
  { "reply": "...", "tip": "...", "tone": "Funny" }
]`}`;

  // Increment usage before streaming starts
  await supabase.from("usage").upsert(
    { user_id: userId, date: today, count: (usage?.count || 0) + 1 },
    { onConflict: "user_id,date" }
  );

  const expectedTones = isAskOut
    ? ['Subtle', 'Balanced', 'Direct']
    : ['Flirty', 'Curious', 'Funny'];

  // Stream SSE to client
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      temperature: 0.9,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    let fullText = "";

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        fullText += chunk.delta.text;
        res.write(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`);
      }
    }

    const jsonMatch = fullText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      res.write(`data: ${JSON.stringify({ error: "parse_error" })}\n\n`);
      return res.end();
    }

    const suggestions = JSON.parse(jsonMatch[0])
      .slice(0, 3)
      .map((s, i) => ({ ...s, tone: expectedTones[i] }));

    res.write(`data: ${JSON.stringify({ done: true, suggestions })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: "anthropic_error", detail: err.message })}\n\n`);
    res.end();
  }
}
