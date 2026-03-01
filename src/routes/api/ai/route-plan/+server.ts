import { json } from '@sveltejs/kit';
import { GROQ_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const POST: RequestHandler = async ({ request }) => {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'gsk_YOUR_API_KEY_HERE') {
    return json({ error: 'AI ไม่พร้อมใช้งาน (ไม่มี API key)' }, { status: 503 });
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

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1500,
        stream: false
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Groq API error:', res.status, errText);
      return json({ error: `AI error: ${res.status}` }, { status: 502 });
    }

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
  } catch (err: any) {
    console.error('AI route plan error:', err);
    return json({ error: err.message || 'AI error' }, { status: 500 });
  }
};

// GET for availability check
export const GET: RequestHandler = async () => {
  const available = !!GROQ_API_KEY && GROQ_API_KEY !== 'gsk_YOUR_API_KEY_HERE';
  return json({ available });
};
