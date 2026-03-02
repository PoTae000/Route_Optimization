import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// Vision uses Gemini only (supports multimodal)
export const POST: RequestHandler = async ({ request }) => {
  if (!env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'Vision ไม่พร้อมใช้งาน — ไม่มี Gemini API key' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { message, image, context } = await request.json();

    if (!image?.base64 || !image?.mimeType) {
      return new Response(JSON.stringify({ error: 'ไม่มีรูปภาพ' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate image size (base64 ~4/3 of original, so 4MB original ≈ 5.3MB base64)
    if (image.base64.length > 6_000_000) {
      return new Response(JSON.stringify({ error: 'รูปภาพใหญ่เกินไป (สูงสุด 4MB)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contextInfo = context
      ? `\nข้อมูลการเดินทาง: จุดแวะ ${context.totalPoints ?? 0} จุด, ${context.isNavigating ? 'กำลังนำทาง' : 'ยังไม่นำทาง'}`
      : '';

    const systemPrompt = `คุณคือผู้ช่วย AI ในแอปนำทาง วิเคราะห์รูปภาพที่ผู้ใช้ส่งมาและตอบเป็นภาษาไทย
ตอบกระชับ ชัดเจน ห้ามใช้ emoji
ถ้าเป็นรูปเส้นทาง/แผนที่ — วิเคราะห์เส้นทางและแนะนำ
ถ้าเป็นรูปสถานที่ — บอกชื่อ/ประเภทถ้าเดาได้
ถ้าเป็นรูปป้าย/ข้อความ — อ่านและแปลให้
ถ้าเป็นรูปอาหาร — บอกชื่อและแนะนำ
ถ้าเป็นรูปอื่น — อธิบายสิ่งที่เห็นและตอบคำถามผู้ใช้${contextInfo}`;

    const userContent: any[] = [
      { type: 'text', text: message || 'ดูรูปนี้ให้หน่อย' }
    ];

    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`
      }
    });

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s for vision

    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GEMINI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gemini-2.0-flash',
          messages: apiMessages,
          temperature: 0.5,
          max_tokens: 1024,
          stream: true
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        console.error('[AI Vision] Gemini failed:', res.status, errText.slice(0, 300));
        return new Response(JSON.stringify({ error: `Vision AI ไม่สามารถวิเคราะห์ได้ (${res.status})` }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(res.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-AI-Provider': 'Gemini-Vision'
        }
      });
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return new Response(JSON.stringify({ error: 'Vision AI หมดเวลา กรุณาลองใหม่' }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw fetchErr;
    }
  } catch (err: any) {
    console.error('AI vision error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Vision AI error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
