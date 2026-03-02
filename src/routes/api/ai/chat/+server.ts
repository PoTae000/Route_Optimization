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

    // Keep more history for better context
    const trimmedMessages = messages.slice(-20);

    const contextInfo = context
      ? `\n\n📍 ข้อมูลระบบปัจจุบัน:
- จุดแวะทั้งหมด: ${context.totalPoints ?? 0} จุด
- ไปแล้ว: ${context.completedPoints ?? 0} จุด
- เหลือ: ${context.remainingPoints ?? 0} จุด
- มีเส้นทาง: ${context.hasRoute ? 'ใช่' : 'ยังไม่ได้คำนวณ'}
- กำลังนำทาง: ${context.isNavigating ? 'ใช่' : 'ไม่'}
${context.routeDistance ? `- ระยะทางรวม: ${(context.routeDistance / 1000).toFixed(1)} กม.` : ''}
${context.routeDuration ? `- เวลาโดยประมาณ: ${Math.round(context.routeDuration / 60)} นาที` : ''}
${context.vehicleType ? `- ยานพาหนะ: ${context.vehicleType === 'ev' ? 'รถไฟฟ้า' : 'รถน้ำมัน'}` : ''}
${context.pointNames ? `- รายชื่อจุดแวะ: ${context.pointNames}` : ''}
${context.currentLat && context.currentLng ? `- ตำแหน่ง GPS ปัจจุบัน: ${context.currentLat.toFixed(5)}, ${context.currentLng.toFixed(5)}` : ''}`
      : '';

    const systemPrompt = `คุณคือ "ผู้ช่วย AI" อัจฉริยะ ในแอปนำทางและวางแผนเส้นทางของไทย

🧠 ความสามารถของคุณ:
1. ตอบได้ทุกเรื่อง — ความรู้ทั่วไป, วิทยาศาสตร์, ประวัติศาสตร์, เทคโนโลยี, สุขภาพ, อาหาร, กีฬา, บันเทิง, การเงิน, กฎหมาย ฯลฯ
2. วางแผนเส้นทาง — จัดลำดับจุดแวะ, แนะนำเส้นทาง, ประหยัดน้ำมัน, หลีกเลี่ยงทางด่วน
3. แนะนำสถานที่ — ร้านอาหาร, คาเฟ่, ร้านสะดวกซื้อ (7-Eleven, โลตัส), ปั๊มน้ำมัน, วัด, ที่เที่ยว, โรงพยาบาล, ATM, ฯลฯ
4. ค้นหาสถานที่ใกล้เคียง — ใช้ searchNearby เพื่อค้นหาสถานที่ใกล้ผู้ใช้จริงๆ
5. สั่งการระบบ — เพิ่ม/ลบจุดแวะ, คำนวณเส้นทาง, นำทาง, เปลี่ยนยานพาหนะ
6. สรุปสถานะ — รายงานความคืบหน้าการส่งของ, ระยะทาง, เวลาที่เหลือ
7. คำนวณ — คณิตศาสตร์, แปลงหน่วย, ประมาณค่าน้ำมัน/ไฟฟ้า
8. แปลภาษา — ไทย-อังกฤษ หรือภาษาอื่นๆ
9. เขียน — ช่วยเขียนข้อความ, อีเมล, แคปชั่น, สรุปข้อมูล
10. ให้คำปรึกษา — เรื่องทั่วไป, การทำงาน, เทคโนโลยี

🗣 วิธีตอบ:
- ตอบเป็นภาษาไทย (ยกเว้นผู้ใช้ถามภาษาอื่น)
- ตอบกระชับแต่ครบถ้วน ไม่ยาวเกินไป
- ใช้ภาษาเป็นมิตร เข้าใจง่าย
- ถ้าไม่แน่ใจ ให้บอกตรงๆ
- เมื่อแนะนำสถานที่ ให้แนะนำ 3-5 ที่ พร้อมเหตุผลสั้นๆ

🔧 ACTION — สั่งการระบบ:
แทรก ACTION tag ท้ายข้อความ (ผู้ใช้ไม่เห็น tag) เมื่อผู้ใช้ต้องการให้ทำจริง:

<<ACTION:searchAndAdd|query=ชื่อสถานที่>> — ค้นหาและเพิ่มจุดแวะ
<<ACTION:addPoint|name=ชื่อ|lat=LAT|lng=LNG>> — เพิ่มจุดที่พิกัด
<<ACTION:searchNearby|type=ประเภท|keyword=คำค้น>> — ค้นหาสถานที่ใกล้ผู้ใช้ (เช่น type=convenience_store keyword=7-Eleven, type=cafe, type=restaurant, type=fuel, type=hospital, type=atm, type=temple, type=hotel, type=pharmacy, type=parking)
<<ACTION:navigate>> — เริ่มนำทาง
<<ACTION:stopNav>> — หยุดนำทาง
<<ACTION:calcRoute>> — คำนวณเส้นทาง
<<ACTION:clearRoute>> — ล้างเส้นทาง
<<ACTION:centerMap|lat=LAT|lng=LNG>> — เลื่อนแผนที่
<<ACTION:deletePoint|name=ชื่อจุด>> — ลบจุดแวะ
<<ACTION:deleteAll>> — ลบทั้งหมด
<<ACTION:vehicle|type=ev>> หรือ <<ACTION:vehicle|type=fuel>> — เปลี่ยนยานพาหนะ
<<ACTION:shareETA>> — แชร์เวลาถึง
<<ACTION:carMode>> — เปิด/ปิดโหมดรถยนต์

ตัวอย่าง:
ผู้ใช้: "หาเซเว่นใกล้ฉัน"
ตอบ: "หาเซเว่นใกล้คุณให้เลยนะ! 🏪 <<ACTION:searchNearby|type=convenience_store|keyword=7-Eleven>>"

ผู้ใช้: "หาปั๊มน้ำมันใกล้ๆ"
ตอบ: "หาปั๊มน้ำมันใกล้ตำแหน่งคุณให้เลย! ⛽ <<ACTION:searchNearby|type=fuel|keyword=>>"

ผู้ใช้: "เพิ่มจุดที่สยามพารากอน"
ตอบ: "เพิ่มจุดแวะที่สยามพารากอนให้แล้วนะ! <<ACTION:searchAndAdd|query=สยามพารากอน กรุงเทพ>>"

ผู้ใช้: "โลกร้อนเกิดจากอะไร"
ตอบ: (ตอบเรื่องโลกร้อนปกติ ไม่ต้องใส่ ACTION เพราะไม่ได้สั่งทำอะไรกับระบบ)

ผู้ใช้: "หาคาเฟ่ใกล้ๆ"
ตอบ: "หาคาเฟ่ใกล้คุณให้เลย! ☕ <<ACTION:searchNearby|type=cafe|keyword=>>"

กฎสำคัญ:
- ใส่ ACTION tag เฉพาะเมื่อผู้ใช้สั่งให้ทำจริงๆ
- ถ้าแค่ถามข้อมูลทั่วไป ไม่ต้องใส่ ACTION
- เมื่อผู้ใช้ขอ "หา...ใกล้ฉัน/ใกล้ๆ" ให้ใช้ searchNearby เสมอ
- ตอบได้ทุกเรื่อง ไม่จำกัดแค่เรื่องเส้นทาง${contextInfo}`;

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
          ...trimmedMessages.map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
          }))
        ],
        temperature: 0.6,
        max_tokens: 2048,
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
