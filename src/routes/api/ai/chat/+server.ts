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
${context.pointNames ? `- รายชื่อจุดแวะ: ${context.pointNames}` : ''}
${context.currentLat && context.currentLng ? `- ตำแหน่งปัจจุบัน: ${context.currentLat.toFixed(4)}, ${context.currentLng.toFixed(4)}` : ''}`
      : '';

    const systemPrompt = `คุณเป็นผู้ช่วย AI สำหรับระบบวางแผนเส้นทางและนำทางของไทย ชื่อ "ผู้ช่วยเส้นทาง"
ตอบเป็นภาษาไทยสั้นกระชับ ใช้ภาษาที่เป็นมิตร
ช่วยเรื่อง: วางแผนเส้นทาง, จัดลำดับจุดแวะ, แนะนำเส้นทาง, สรุปสถานะ, ประหยัดน้ำมัน, หลีกเลี่ยงทางด่วน, สภาพจราจร, แนะนำสถานที่ท่องเที่ยว คาเฟ่ วัด ร้านอาหาร
เมื่อแนะนำสถานที่ให้แนะนำ 5 ที่ พร้อมเหตุผลสั้นๆ และบอกพิกัดโดยประมาณถ้าทำได้
ถ้าไม่มีข้อมูลเพียงพอ ให้บอกตรงๆ ว่าไม่รู้

คุณสามารถสั่งการระบบได้ โดยแทรก ACTION tag ไว้ท้ายข้อความ (ผู้ใช้จะไม่เห็น tag) เมื่อผู้ใช้ต้องการให้ทำจริงๆ:
- <<ACTION:searchAndAdd|query=ชื่อสถานที่>> — ค้นหาและเพิ่มจุดแวะ
- <<ACTION:addPoint|name=ชื่อ|lat=ละติจูด|lng=ลองจิจูด>> — เพิ่มจุดที่พิกัดที่ทราบ
- <<ACTION:navigate>> — เริ่มนำทาง
- <<ACTION:stopNav>> — หยุดนำทาง
- <<ACTION:calcRoute>> — คำนวณเส้นทาง
- <<ACTION:clearRoute>> — ล้างเส้นทาง
- <<ACTION:centerMap|lat=ละติจูด|lng=ลองจิจูด>> — เลื่อนแผนที่ไปพิกัด
- <<ACTION:deletePoint|name=ชื่อจุด>> — ลบจุดแวะตามชื่อ
- <<ACTION:deleteAll>> — ลบจุดแวะทั้งหมด
- <<ACTION:vehicle|type=ev>> หรือ <<ACTION:vehicle|type=fuel>> — เปลี่ยนยานพาหนะ
- <<ACTION:shareETA>> — แชร์เวลาถึง
- <<ACTION:carMode>> — เปิด/ปิดโหมดรถยนต์

ตัวอย่าง:
ผู้ใช้: "เพิ่มจุดแวะที่สยามพารากอน"
ตอบ: "เพิ่มจุดแวะที่สยามพารากอนให้แล้วนะ! <<ACTION:searchAndAdd|query=สยามพารากอน กรุงเทพ>>"

ผู้ใช้: "คำนวณเส้นทางให้หน่อย"
ตอบ: "คำนวณเส้นทางให้เลย! <<ACTION:calcRoute>>"

ผู้ใช้: "ลบจุดสยามออก"
ตอบ: "ลบจุดสยามให้แล้ว <<ACTION:deletePoint|name=สยาม>>"

ผู้ใช้: "เปลี่ยนเป็นรถไฟฟ้า"
ตอบ: "เปลี่ยนเป็นรถไฟฟ้าให้แล้ว! <<ACTION:vehicle|type=ev>>"

กฎ: ใส่ ACTION tag เฉพาะเมื่อผู้ใช้ต้องการให้ทำจริงๆ เท่านั้น ถ้าแค่ถามข้อมูลหรือแนะนำ ไม่ต้องใส่ tag${contextInfo}`;

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
        max_tokens: 1000,
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
