import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

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

function trimOcr(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.slice(-20).join("\n");
}

const MODE_CONFIG = {
  reply: {
    tones: ['Flirty', 'Curious', 'Funny'],
    instruction: `Someone sent a message and you need to respond. Generate 3 replies — each must be genuinely distinct:
- Flirty: unmistakably flirty — zero doubt they're being flirted with. Bold, a little tension, a tease or compliment with an edge. Not vague.
- Curious: genuine observation or reaction first, then a question that naturally follows. Should feel like real interest, not fishing. Never ask just to ask.
- Funny: laugh-out-loud funny. Mine the whole conversation for material — a contradiction, something weird they said, an inside moment. Real punchline, sharp comeback, or playful roast that only makes sense in THIS conversation. Generic = failure.`,
  },
  ask_out: {
    tones: ['Subtle', 'Balanced', 'Funny'],
    instruction: `The conversation is warm enough to move off the app. Generate 3 messages that transition toward meeting IRL or exchanging numbers:
- Subtle: plant the seed without being obvious — a casual reference to doing something together that doesn't feel like a formal ask
- Balanced: clear intention, confident but not intense — makes it easy for them to say yes
- Funny: a lighthearted, funny way to pop the question that takes the pressure off — makes them laugh and say yes at the same time`,
  },
  break_ice: {
    tones: ['Bold', 'Playful', 'Funny'],
    instruction: `You matched but nobody has talked yet, or you want to send a strong opener. Use anything visible in the conversation or profile from the screenshot. Generate 3 openers:
- Bold: confident, direct, makes a strong first impression — not a compliment but a statement or observation that demands a response
- Playful: light and fun, easy to reply to, sets a good vibe from the start
- Funny: an opener that makes them actually laugh before anything else — use something specific from what you can see, not a generic line. This has to be genuinely funny.`,
  },
  re_engage: {
    tones: ['Callback', 'Fresh Start', 'Funny'],
    instruction: `The conversation went cold for days or weeks. Generate 3 messages that restart it naturally:
- Callback: reference something specific they said earlier in the conversation — makes it feel like you were thinking about them, not just randomly texting
- Fresh Start: don't acknowledge the gap at all — just start a new thread naturally, like picking up where things left off
- Funny: be self-aware about the silence in a way that completely disarms it — make them laugh about the fact that nobody texted for so long. Has to actually be funny, not just "lol sorry I disappeared".`,
  },
  rizz: {
    tones: ['Smooth', 'Daring', 'Funny'],
    instruction: `Full confidence mode. High charm, no filter. Generate 3 replies:
- Smooth: effortlessly cool and magnetic — says a lot without saying much, makes them feel like they're talking to someone different
- Daring: bold and unapologetic — the kind of reply most people would be too scared to send but secretly wish they could
- Funny: cocky humor that works because it's self-aware — not try-hard, just someone who doesn't take themselves too seriously while clearly knowing what they want`,
  },
  follow_up: {
    tones: ['Casual', 'Witty', 'Funny'],
    instruction: `You sent the first message and they never replied. You want one last shot without looking desperate or bitter. Generate 3 follow-ups:
- Casual: low pressure, no mention of being ignored — just a natural continuation that gives them an easy opening, like the non-reply never happened
- Witty: acknowledge the silence in a charming way — not passive-aggressive, not needy, just clever enough that they feel a little bad and a little intrigued
- Funny: make them actually feel guilty for not replying — but in a funny, charming way that makes them want to respond immediately. Has to land as funny, not salty.`,
  },
};

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

  const modeConfig = MODE_CONFIG[mode] || MODE_CONFIG.reply;

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
- Mirror user's voice exactly

Sound human, not AI:
- Write how real people text — casual, spontaneous, natural
- Avoid: "absolutely", "definitely", "certainly", "that's so interesting", "I'd love to"
- No compliment sandwiches or overly smooth transitions
- Replies should feel typed in 10 seconds, not crafted
- Always capitalize the first word and use proper punctuation — casual, not sloppy`;

  const toneList = modeConfig.tones.map(t => `{"reply":"...","tip":"...","tone":"${t}"}`).join(",");

  const userMessage = `${voiceSection}

Conversation:
${trimOcr(ocrText)}

${modeConfig.instruction}

Return ONLY a JSON array:
[${toneList}]`;

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

  const suggestions = JSON.parse(jsonMatch[0]).slice(0, 3).map((s, i) => ({ ...s, tone: modeConfig.tones[i] }));
  return new Response(JSON.stringify({ suggestions }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
