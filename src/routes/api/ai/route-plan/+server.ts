import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// ═══ Multi-provider fallback with cooldown ═══

interface AIProvider {
  name: string;
  url: string;
  key: string;
  model: string;
}

// In-memory cooldown tracker (provider name → expiry timestamp)
const providerCooldowns: Map<string, number> = new Map();
const DEFAULT_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

function parseCooldownFromError(errText: string): number {
  const match = errText.match(/(?:retry.after|wait|try again in)\D*(\d+(?:\.\d+)?)\s*(?:s|sec|second|minute|m)/i);
  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[0].toLowerCase();
    if (unit.includes('minute') || unit.includes(' m')) return val * 60 * 1000;
    return val * 1000;
  }
  return DEFAULT_COOLDOWN_MS;
}

function setCooldown(providerName: string, durationMs: number) {
  providerCooldowns.set(providerName, Date.now() + durationMs);
  console.log(`[AI Route] ${providerName} cooldown set (${Math.round(durationMs / 1000)}s)`);
}

function getProviders(): AIProvider[] {
  const providers: AIProvider[] = [];

  if (env.GROQ_API_KEY && env.GROQ_API_KEY !== 'gsk_YOUR_API_KEY_HERE') {
    providers.push({
      name: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: env.GROQ_API_KEY,
      model: 'llama-3.3-70b-versatile'
    });
  }

  if (env.CEREBRAS_API_KEY) {
    providers.push({
      name: 'Cerebras',
      url: 'https://api.cerebras.ai/v1/chat/completions',
      key: env.CEREBRAS_API_KEY,
      model: 'llama-3.3-70b'
    });
  }

  if (env.GEMINI_API_KEY) {
    providers.push({
      name: 'Gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      key: env.GEMINI_API_KEY,
      model: 'gemini-2.0-flash'
    });
  }

  return providers;
}

function getAvailableProviders(): AIProvider[] {
  const all = getProviders();
  const now = Date.now();
  const available = all.filter(p => {
    const expiry = providerCooldowns.get(p.name);
    if (expiry && expiry > now) {
      const remainSec = Math.round((expiry - now) / 1000);
      console.log(`[AI Route] ${p.name} cooldown (${remainSec}s remaining), skipping`);
      return false;
    }
    if (expiry) providerCooldowns.delete(p.name);
    return true;
  });

  if (available.length === 0 && all.length > 0) {
    console.log('[AI Route] All providers on cooldown — resetting and retrying all');
    providerCooldowns.clear();
    return all;
  }

  return available;
}

export const POST: RequestHandler = async ({ request }) => {
  const providers = getAvailableProviders();

  if (providers.length === 0) {
    return json({ error: 'AI ไม่พร้อมใช้งาน — ไม่มี API key ที่ใช้ได้' }, { status: 503 });
  }

  try {
    const { points, startLocation, currentTime, vehicleType } = await request.json();

    if (!points || points.length < 2) {
      return json({ error: 'ต้องมีอย่างน้อย 2 จุดส่ง' }, { status: 400 });
    }

    const pointsSummary = points.map((p: any, i: number) => {
      const priorityText = p.priority <= 2 ? 'สูง' : p.priority <= 3 ? 'ปานกลาง' : 'ต่ำ';
      return `${i + 1}. "${p.name}" (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}) - ความสำคัญ: ${priorityText}(${p.priority})${p.address ? ` - ${p.address}` : ''}`;
    }).join('\n');

    const systemPrompt = `คุณเป็นผู้เชี่ยวชาญวางแผนเส้นทางในประเทศไทย ตอบเป็นภาษาไทยเท่านั้น
ให้วิเคราะห์จุดแวะและแนะนำลำดับที่ดีที่สุด โดยพิจารณา:
- ความสำคัญ (priority ต่ำ = สำคัญมาก)
- ตำแหน่งทางภูมิศาสตร์ (จัดกลุ่มจุดใกล้กัน)
- ประสิทธิภาพเส้นทาง (ลดระยะทางรวม)

ตอบเป็น JSON เท่านั้น ในรูปแบบ:
{
  "suggestedOrder": [หมายเลขจุดตามลำดับแนะนำ เช่น 3,1,2,4],
  "reasoning": "เหตุผลสั้นๆ ภาษาไทย 2-3 ประโยค",
  "clusters": [{"name":"ชื่อกลุ่ม","points":[หมายเลข]}],
  "tips": ["เคล็ดลับ 1","เคล็ดลับ 2"]
}`;

    const userPrompt = `จุดเริ่มต้น: (${startLocation.lat.toFixed(4)}, ${startLocation.lng.toFixed(4)})
เวลาปัจจุบัน: ${currentTime}
ยานพาหนะ: ${vehicleType === 'ev' ? 'รถไฟฟ้า' : 'รถน้ำมัน'}

จุดส่งทั้งหมด:
${pointsSummary}

กรุณาวิเคราะห์และแนะนำลำดับการส่งที่ดีที่สุด`;

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // ═══ Try each provider with fallback + timeout ═══
    let lastError = '';

    for (const provider of providers) {
      try {
        console.log(`[AI Route] Trying ${provider.name}...`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
          const res = await fetch(provider.url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${provider.key}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: provider.model,
              messages: apiMessages,
              temperature: 0.3,
              max_tokens: 1500,
              stream: false
            }),
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (!res.ok) {
            const errText = await res.text();
            console.warn(`[AI Route] ${provider.name} failed (${res.status}):`, errText.slice(0, 200));
            if (res.status === 429) {
              const cooldownMs = parseCooldownFromError(errText);
              setCooldown(provider.name, cooldownMs);
            }
            lastError = `${provider.name}: ${res.status}`;
            continue;
          }

          console.log(`[AI Route] ${provider.name} OK`);
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || '';

          // Parse JSON from response (may be wrapped in markdown code block)
          let parsed;
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            } else {
              parsed = JSON.parse(content);
            }
          } catch {
            return json({
              suggestedOrder: points.map((_: any, i: number) => i + 1),
              reasoning: content,
              clusters: [],
              tips: []
            });
          }

          return json(parsed);
        } catch (fetchErr: any) {
          clearTimeout(timeout);
          if (fetchErr.name === 'AbortError') {
            console.warn(`[AI Route] ${provider.name} timeout (15s)`);
            setCooldown(provider.name, 30000);
            lastError = `${provider.name}: timeout`;
            continue;
          }
          throw fetchErr;
        }
      } catch (err: any) {
        console.warn(`[AI Route] ${provider.name} error:`, err.message);
        lastError = `${provider.name}: ${err.message}`;
        continue;
      }
    }

    // All providers failed
    return json({ error: `AI ทุกระบบไม่พร้อม: ${lastError}` }, { status: 502 });
  } catch (err: any) {
    console.error('AI route plan error:', err);
    return json({ error: err.message || 'AI error' }, { status: 500 });
  }
};

// GET for availability check
export const GET: RequestHandler = async () => {
  const available = getProviders().length > 0;
  return json({ available });
};
