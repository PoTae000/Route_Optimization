import { GROQ_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const POST: RequestHandler = async ({ request }) => {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'gsk_YOUR_API_KEY_HERE') {
    return new Response(JSON.stringify({ error: 'AI ไม่พร้อมใช้งาน' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { messages, context } = await request.json();

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'ไม่มีข้อความ' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Limit to last 10 messages
    const trimmedMessages = messages.slice(-10);

    const contextInfo = context
      ? `\nข้อมูลปัจจุบัน:
- จุดแวะทั้งหมด: ${context.totalPoints ?? '?'} จุด
- ไปแล้ว: ${context.completedPoints ?? 0} จุด
- เหลือ: ${context.remainingPoints ?? '?'} จุด
- มีเส้นทาง: ${context.hasRoute ? 'ใช่' : 'ยังไม่ได้คำนวณ'}
- กำลังนำทาง: ${context.isNavigating ? 'ใช่' : 'ไม่'}
${context.routeDistance ? `- ระยะทางรวม: ${(context.routeDistance / 1000).toFixed(1)} กม.` : ''}
${context.routeDuration ? `- เวลาโดยประมาณ: ${Math.round(context.routeDuration / 60)} นาที` : ''}
${context.vehicleType ? `- ยานพาหนะ: ${context.vehicleType === 'ev' ? 'รถไฟฟ้า' : 'รถน้ำมัน'}` : ''}
${context.pointNames ? `- รายชื่อจุดแวะ: ${context.pointNames}` : ''}`
      : '';

    const systemPrompt = `คุณเป็นผู้ช่วย AI สำหรับระบบวางแผนเส้นทางและนำทางของไทย ชื่อ "ผู้ช่วยเส้นทาง"
ตอบเป็นภาษาไทยสั้นกระชับ ใช้ภาษาที่เป็นมิตร
ช่วยเรื่อง: วางแผนเส้นทาง, จัดลำดับจุดแวะ, แนะนำเส้นทาง, สรุปสถานะการเดินทาง, การขับขี่ประหยัดน้ำมัน, เส้นทางหลีกเลี่ยงค่าทางด่วน, สภาพการจราจร
ห้ามตอบคำถามที่ไม่เกี่ยวข้องกับการวางแผนเส้นทาง การนำทาง หรือการเดินทาง ถ้าถูกถามเรื่องอื่นให้ปฏิเสธสุภาพและบอกว่า "ขออภัย ฉันช่วยได้เฉพาะเรื่องการวางแผนเส้นทางและการนำทางเท่านั้น"
ถ้าไม่มีข้อมูลเพียงพอ ให้บอกตรงๆ ว่าไม่รู้${contextInfo}`;

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          ...trimmedMessages.map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
          }))
        ],
        temperature: 0.5,
        max_tokens: 500,
        stream: true
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Groq chat error:', res.status, errText);
      return new Response(JSON.stringify({ error: `AI error: ${res.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Pipe the SSE stream directly
    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
  } catch (err: any) {
    console.error('AI chat error:', err);
    return new Response(JSON.stringify({ error: err.message || 'AI error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// GET for availability check
export const GET: RequestHandler = async () => {
  const available = !!GROQ_API_KEY && GROQ_API_KEY !== 'gsk_YOUR_API_KEY_HERE';
  return new Response(JSON.stringify({ available }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
