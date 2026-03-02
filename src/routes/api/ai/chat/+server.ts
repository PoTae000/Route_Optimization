import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// ═══ Multi-provider fallback system ═══

interface AIProvider {
  name: string;
  url: string;
  key: string;
  model: string;
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

export const POST: RequestHandler = async ({ request }) => {
  const providers = getProviders();

  if (providers.length === 0) {
    return new Response(JSON.stringify({ error: 'AI ไม่พร้อมใช้งาน — ไม่มี API key ที่ใช้ได้' }), {
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

    const trimmedMessages = messages.slice(-20);

    const contextInfo = context
      ? `\n\nข้อมูลระบบปัจจุบัน:
- จุดแวะทั้งหมด: ${context.totalPoints ?? 0} จุด
- ไปแล้ว: ${context.completedPoints ?? 0} จุด
- เหลือ: ${context.remainingPoints ?? 0} จุด
- มีเส้นทาง: ${context.hasRoute ? 'ใช่' : 'ยังไม่ได้คำนวณ'}
- กำลังนำทาง: ${context.isNavigating ? 'ใช่' : 'ไม่'}
${context.routeDistance ? `- ระยะทางรวม: ${(context.routeDistance / 1000).toFixed(1)} กม.` : ''}
${context.routeDuration ? `- เวลาโดยประมาณ: ${Math.round(context.routeDuration / 60)} นาที` : ''}
${context.vehicleType ? `- ยานพาหนะ: ${context.vehicleType === 'ev' ? 'รถไฟฟ้า' : 'รถน้ำมัน'}` : ''}
${context.pointNames ? `- รายชื่อจุดแวะ: ${context.pointNames}` : ''}
${context.currentLat && context.currentLng ? `- ตำแหน่ง GPS ปัจจุบัน: ${context.currentLat.toFixed(5)}, ${context.currentLng.toFixed(5)}` : ''}
${context.mapCenterLat && context.mapCenterLng ? `- แผนที่กำลังดูบริเวณ: ${context.mapCenterLat.toFixed(5)}, ${context.mapCenterLng.toFixed(5)} (zoom ${context.mapZoom ?? '?'})` : ''}
${context.mapBoundsNorth ? `- ขอบแผนที่: เหนือ ${context.mapBoundsNorth.toFixed(5)}, ใต้ ${context.mapBoundsSouth.toFixed(5)}, ตะวันออก ${context.mapBoundsEast.toFixed(5)}, ตะวันตก ${context.mapBoundsWest.toFixed(5)}` : ''}
${context.nearbyResults ? `- ผลลัพธ์ค้นหาล่าสุด: ${context.nearbyResults}` : ''}`
      : '';

    const systemPrompt = `คุณคือ "ผู้ช่วย AI" อัจฉริยะ ในแอปนำทางและวางแผนเส้นทางของไทย

ความสามารถของคุณ:
1. ตอบได้ทุกเรื่อง — ความรู้ทั่วไป, วิทยาศาสตร์, ประวัติศาสตร์, เทคโนโลยี, สุขภาพ, อาหาร, กีฬา, บันเทิง, การเงิน, กฎหมาย ฯลฯ
2. วางแผนเส้นทาง — จัดลำดับจุดแวะ, แนะนำเส้นทาง, ประหยัดน้ำมัน
3. แนะนำสถานที่ — ร้านอาหาร, คาเฟ่, ร้านสะดวกซื้อ, ปั๊มน้ำมัน, วัด, ที่เที่ยว, โรงพยาบาล, ATM ฯลฯ
4. ค้นหาสถานที่ใกล้เคียง — ใช้ searchNearby เพื่อค้นหาสถานที่ใกล้ผู้ใช้จริงๆ
5. สั่งการระบบ — เพิ่ม/ลบจุดแวะ, คำนวณเส้นทาง, นำทาง, เปลี่ยนยานพาหนะ
6. สรุปสถานะ — รายงานความคืบหน้า, ระยะทาง, เวลาที่เหลือ
7. คำนวณ — คณิตศาสตร์, แปลงหน่วย, ประมาณค่าน้ำมัน/ไฟฟ้า
8. แปลภาษา — ไทย-อังกฤษ หรือภาษาอื่นๆ
9. เขียน — ช่วยเขียนข้อความ, อีเมล, แคปชั่น, สรุปข้อมูล
10. ให้คำปรึกษา — เรื่องทั่วไป, การทำงาน, เทคโนโลยี

วิธีตอบ:
- ตอบเป็นภาษาไทย (ยกเว้นผู้ใช้ถามภาษาอื่น)
- ตอบกระชับแต่ครบถ้วน ไม่ยาวเกินไป
- ใช้ภาษาเป็นมิตร เข้าใจง่าย
- ห้ามใช้ emoji ในคำตอบ
- ถ้าไม่แน่ใจ ให้บอกตรงๆ
- เมื่อแนะนำสถานที่ ให้แนะนำ 3-5 ที่ พร้อมเหตุผลสั้นๆ

ACTION — สั่งการระบบ:
แทรก ACTION tag ท้ายข้อความ (ผู้ใช้ไม่เห็น tag) เมื่อผู้ใช้ต้องการให้ทำจริง:

<<ACTION:searchAndAdd|query=ชื่อสถานที่>> — ค้นหาและเพิ่มจุดแวะ
<<ACTION:addPoint|name=ชื่อ|lat=LAT|lng=LNG>> — เพิ่มจุดที่พิกัด
<<ACTION:searchNearby|type=ประเภท|keyword=คำค้น>> — ค้นหาสถานที่ใกล้ผู้ใช้ (เช่น type=convenience_store keyword=7-Eleven, type=cafe, type=restaurant, type=fuel, type=hospital, type=atm, type=temple, type=hotel, type=pharmacy, type=parking)
<<ACTION:addNearbyPoint|index=N>> — เพิ่มจุดแวะจากผลลัพธ์ searchNearby ที่ลำดับ N (ใช้ได้เมื่อมีผลลัพธ์ nearby อยู่)
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
<<ACTION:clearNearby>> — ล้างผลลัพธ์ค้นหาใกล้เคียง (ลบ markers ค้นหาออกจากแผนที่)
<<ACTION:toggleTraffic>> — เปิด/ปิดแสดงการจราจรบนแผนที่
<<ACTION:toggleVoice>> — เปิด/ปิดเสียงนำทาง
<<ACTION:zoomIn>> — ซูมเข้า
<<ACTION:zoomOut>> — ซูมออก
<<ACTION:openGoogleMaps>> — เปิดเส้นทางใน Google Maps
<<ACTION:routePreference|pref=fastest>> — เปลี่ยนประเภทเส้นทาง (fastest=เร็วสุด, shortest=สั้นสุด, no_tolls=เลี่ยงด่วน, no_highways=เลี่ยงมอเตอร์เวย์)
<<ACTION:myLocation>> — กลับไปตำแหน่งปัจจุบันบนแผนที่

ตัวอย่าง:
ผู้ใช้: "หาเซเว่นใกล้ฉัน"
ตอบ: "หาเซเว่นใกล้คุณให้เลยนะ <<ACTION:searchNearby|type=convenience_store|keyword=7-Eleven>>"

ผู้ใช้: "หาปั๊มน้ำมันใกล้ๆ"
ตอบ: "หาปั๊มน้ำมันใกล้ตำแหน่งคุณให้เลย <<ACTION:searchNearby|type=fuel|keyword=>>"

ผู้ใช้: "เพิ่มจุดที่ 2" (เมื่อมีผลลัพธ์ nearby อยู่)
ตอบ: "เพิ่มจุดที่ 2 ให้แล้วนะ <<ACTION:addNearbyPoint|index=2>>"

ผู้ใช้: "เพิ่มจุดที่ 1 กับ 3" (เมื่อมีผลลัพธ์ nearby อยู่)
ตอบ: "เพิ่มจุดที่ 1 และ 3 ให้แล้วนะ <<ACTION:addNearbyPoint|index=1>> <<ACTION:addNearbyPoint|index=3>>"

ผู้ใช้: "เพิ่มจุดที่สยามพารากอน"
ตอบ: "เพิ่มจุดแวะที่สยามพารากอนให้แล้วนะ <<ACTION:searchAndAdd|query=สยามพารากอน กรุงเทพ>>"

ผู้ใช้: "โลกร้อนเกิดจากอะไร"
ตอบ: (ตอบเรื่องโลกร้อนปกติ ไม่ต้องใส่ ACTION เพราะไม่ได้สั่งทำอะไรกับระบบ)

ผู้ใช้: "หาคาเฟ่ใกล้ๆ"
ตอบ: "หาคาเฟ่ใกล้คุณให้เลย <<ACTION:searchNearby|type=cafe|keyword=>>"

ผู้ใช้: "ยกเลิกการค้นหา" หรือ "ลบผลค้นหา" หรือ "เคลียร์ค้นหา"
ตอบ: "ล้างผลค้นหาให้แล้วนะ <<ACTION:clearNearby>>"

ผู้ใช้: "เปิดจราจร" หรือ "ดูรถติด"
ตอบ: "เปิดแสดงจราจรให้แล้วนะ <<ACTION:toggleTraffic>>"

ผู้ใช้: "ปิดเสียง" หรือ "เปิดเสียง"
ตอบ: "เปลี่ยนเสียงนำทางให้แล้วนะ <<ACTION:toggleVoice>>"

ผู้ใช้: "ซูมเข้าหน่อย"
ตอบ: "ซูมเข้าให้แล้วนะ <<ACTION:zoomIn>>"

ผู้ใช้: "เปิด Google Maps"
ตอบ: "เปิด Google Maps ให้แล้วนะ <<ACTION:openGoogleMaps>>"

ผู้ใช้: "เปลี่ยนเส้นทางสั้นสุด"
ตอบ: "เปลี่ยนเป็นเส้นทางสั้นสุดให้แล้วนะ <<ACTION:routePreference|pref=shortest>>"

ผู้ใช้: "กลับตำแหน่งฉัน" หรือ "ไปตำแหน่งปัจจุบัน"
ตอบ: "กลับไปตำแหน่งปัจจุบันให้แล้วนะ <<ACTION:myLocation>>"

กฎสำคัญ:
- ห้ามใช้ emoji ในคำตอบทุกกรณี
- ใส่ ACTION tag เฉพาะเมื่อผู้ใช้สั่งให้ทำจริงๆ
- ถ้าแค่ถามข้อมูลทั่วไป ไม่ต้องใส่ ACTION
- เมื่อผู้ใช้ขอ "หา...ใกล้ฉัน/ใกล้ๆ" ให้ใช้ searchNearby เสมอ เพราะจะค้นหาจากแผนที่จริง
- เมื่อ searchNearby เจอผลลัพธ์ ระบบจะแสดงรายการให้ผู้ใช้เห็นอัตโนมัติ ไม่ต้องเพิ่มจุดเอง รอให้ผู้ใช้เลือกก่อน
- เมื่อผู้ใช้บอก "เพิ่มจุดที่ N" และมีผลลัพธ์ nearby อยู่ ให้ใช้ addNearbyPoint|index=N
- ถ้าผู้ใช้บอก "เพิ่มทั้งหมด" ให้ใช้ addNearbyPoint หลายตัว ตามจำนวนผลลัพธ์
- ห้ามใช้ addPoint กับพิกัดที่เดาเอง ถ้าไม่รู้พิกัดแน่ชัด ให้ใช้ searchAndAdd แทนเสมอ (ระบบจะค้นหาพิกัดจริงจาก Nominatim)
- ห้ามแต่งพิกัด lat/lng เอง เด็ดขาด ใช้ searchAndAdd หรือ searchNearby เท่านั้น
- ตอบได้ทุกเรื่อง ไม่จำกัดแค่เรื่องเส้นทาง
- ใช้ข้อมูล "แผนที่กำลังดูบริเวณ" และ "ขอบแผนที่" เพื่อเข้าใจว่าผู้ใช้กำลังดูแผนที่ตรงไหน${contextInfo}`;

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...trimmedMessages.map((m: any) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    ];

    // ═══ Try each provider with fallback ═══
    let lastError = '';

    for (const provider of providers) {
      try {
        console.log(`[AI] Trying ${provider.name} (${provider.model})...`);

        const res = await fetch(provider.url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: provider.model,
            messages: apiMessages,
            temperature: 0.6,
            max_tokens: 2048,
            stream: true
          })
        });

        if (res.ok) {
          console.log(`[AI] ${provider.name} OK — streaming response`);
          return new Response(res.body, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            }
          });
        }

        // Rate limit or error — try next provider
        const errText = await res.text();
        console.warn(`[AI] ${provider.name} failed (${res.status}):`, errText.slice(0, 200));

        if (res.status === 429) {
          lastError = `${provider.name} ถูกจำกัดการใช้งาน`;
          continue;
        }

        lastError = `${provider.name}: error ${res.status}`;
        continue;
      } catch (err: any) {
        console.warn(`[AI] ${provider.name} fetch error:`, err.message);
        lastError = `${provider.name}: ${err.message}`;
        continue;
      }
    }

    // All providers failed
    const errorMsg = providers.length > 1
      ? `AI ทุกระบบไม่พร้อมใช้งานชั่วคราว (${lastError}) กรุณารอสักครู่แล้วลองใหม่`
      : `AI ไม่พร้อมใช้งาน: ${lastError}`;

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
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
  const available = getProviders().length > 0;
  return new Response(JSON.stringify({ available }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
