import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// ═══ Multi-provider fallback system with cooldown ═══

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
  // Try to parse retry-after or wait time from error response
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
  const expiry = Date.now() + durationMs;
  providerCooldowns.set(providerName, expiry);
  const remainSec = Math.round(durationMs / 1000);
  console.log(`[AI] ${providerName} cooldown set (${remainSec}s)`);
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
      model: 'llama3.1-8b'
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
      console.log(`[AI] ${p.name} cooldown (${remainSec}s remaining), skipping`);
      return false;
    }
    // Clean up expired cooldowns
    if (expiry) providerCooldowns.delete(p.name);
    return true;
  });

  // If all providers are on cooldown, reset and try all
  if (available.length === 0 && all.length > 0) {
    console.log('[AI] All providers on cooldown — resetting and retrying all');
    providerCooldowns.clear();
    return all;
  }

  return available;
}

export const POST: RequestHandler = async ({ request }) => {
  const providers = getAvailableProviders();

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
${context.nearbyResults ? `- ผลลัพธ์ค้นหาล่าสุด: ${context.nearbyResults}` : ''}
${context.currentHour != null ? `- เวลาปัจจุบัน: ${context.currentHour}:00 น. (${context.currentHour >= 18 || context.currentHour < 6 ? 'กลางคืน' : 'กลางวัน'})` : ''}
${context.fuelType ? `- ชนิดน้ำมัน: ${context.fuelType}` : ''}
${context.currentFuelPrice ? `- ราคาน้ำมันปัจจุบัน: ${context.currentFuelPrice} บาท/ลิตร` : ''}
${context.routeHasTolls != null ? `- เส้นทางมีทางด่วน: ${context.routeHasTolls ? 'ใช่' : 'ไม่'}` : ''}
${context.tollEstimate ? `- ค่าทางด่วนโดยประมาณ: ${context.tollEstimate} บาท` : ''}`
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
11. วางแผนทริปท่องเที่ยว — จัดทริปรายวัน รวมที่เที่ยว ร้านอาหาร ที่พัก
12. แนะนำเพลง/เพลย์ลิสต์ — เหมาะกับการเดินทาง

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
<<ACTION:playlistSuggestion>> — แสดง playlist ที่แนะนำ (ใช้เมื่อแนะนำเพลง)
<<ACTION:fuelPrice>> — แสดงราคาน้ำมันปัจจุบันทุกปั๊ม
<<ACTION:scenicSearch>> — ค้นหาจุดชมวิว/ที่เที่ยวตลอดเส้นทาง
<<ACTION:tollCompare>> — เปรียบเทียบค่าทางด่วนของแต่ละเส้นทาง
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

ผู้ใช้: "ลบจุดวัดพระแก้ว"
ตอบ: "ลบจุดวัดพระแก้วให้แล้วนะ <<ACTION:deletePoint|name=วัดพระแก้ว>>"

ผู้ใช้: "ลบจุดสยามพารากอนออก"
ตอบ: "ลบจุดสยามพารากอนให้แล้วนะ <<ACTION:deletePoint|name=สยามพารากอน>>"

ผู้ใช้: "ลบจุดทั้งหมด" หรือ "เคลียร์จุดแวะ"
ตอบ: "ลบจุดแวะทั้งหมดให้แล้วนะ <<ACTION:deleteAll>>"

ผู้ใช้: "ไม่เอาจุดนี้" หรือ "เอาจุดนี้ออก" (หลังจากเพิ่มจุดไป)
ตอบ: "ลบจุดให้แล้วนะ <<ACTION:deletePoint|name=ชื่อจุดที่เพิ่งเพิ่ม>>"

=== วางแผนทริป (Trip Planner) ===
เมื่อผู้ใช้ขอวางแผนทริป/เที่ยว:
- ถ้าผู้ใช้ไม่ได้บอกจุดหมาย ให้ถามก่อนว่าอยากไปไหน กี่วัน
- ถ้าผู้ใช้บอกจุดหมายแล้ว ให้วางแผนเลย
- ใช้ ## วันที่ 1, ## วันที่ 2 เป็น heading
- แต่ละจุดแนะนำ ให้ใส่ <<ACTION:searchAndAdd|query=ชื่อจริงสถานที่>> เพื่อให้ user กดเพิ่มจุดแวะได้
- รวมที่เที่ยว ร้านอาหาร ที่พัก ในแต่ละวัน
- ใส่คำอธิบายสั้นๆ แต่ละจุด

ตัวอย่างวางแผนทริป:
ผู้ใช้: "ช่วยวางแผนทริปเที่ยวให้หน่อย"
ตอบ: "ไปเที่ยวไหนดี? บอกจุดหมายกับจำนวนวันมาได้เลย เช่น กระบี่ 3 วัน หรือ เขาใหญ่ 2 วัน"

ผู้ใช้: "ไปภูเก็ต 2 วัน"
ตอบ:
## วันที่ 1 — หาดและเมืองเก่า

**เช้า:** หาดป่าตอง — หาดยอดนิยมของภูเก็ต
<<ACTION:searchAndAdd|query=หาดป่าตอง ภูเก็ต>>

**กลางวัน:** ร้านอาหารริมทะเล — อาหารทะเลสด
<<ACTION:searchAndAdd|query=ร้านอาหารทะเล ป่าตอง ภูเก็ต>>

**บ่าย:** ย่านเมืองเก่าภูเก็ต — ถนนถลาง สถาปัตยกรรมชิโน-โปรตุกีส
<<ACTION:searchAndAdd|query=ถนนถลาง เมืองเก่าภูเก็ต>>

## วันที่ 2 — เกาะและธรรมชาติ
...

=== แนะนำเพลง (Road DJ) ===
เมื่อผู้ใช้ขอแนะนำเพลง/เพลย์ลิสต์สำหรับเดินทาง:
- พิจารณาระยะทาง เวลาเดินทาง เวลาของวัน
- แนะนำ 5-8 เพลง พร้อม YouTube search link
- ใช้รูปแบบ: **ชื่อเพลง** - ศิลปิน [ฟัง](https://www.youtube.com/results?search_query=ชื่อเพลง+ศิลปิน)
- ท้ายข้อความใส่ <<ACTION:playlistSuggestion>>

ตัวอย่าง:
ผู้ใช้: "แนะนำเพลง"
ตอบ:
เพลย์ลิสต์สำหรับทริปนี้:

1. **ขับรถเล่น** - Hugo [ฟัง](https://www.youtube.com/results?search_query=ขับรถเล่น+Hugo)
2. **ถนนสายไม่มีจุดหมาย** - เสือ ธนพล [ฟัง](https://www.youtube.com/results?search_query=ถนนสายไม่มีจุดหมาย+เสือธนพล)
...

<<ACTION:playlistSuggestion>>

=== C1: Voice Copilot ===
เมื่อผู้ใช้พูดด้วยเสียง (voice input) คำตอบควรสั้นกระชับเหมาะฟัง ไม่ต้องยาว เหมือนคุยกันปกติ

=== C2: ขับกลางคืน (Night Safety) ===
เมื่อเวลากลางคืน (18:00-06:00):
- แนะนำเปิดไฟหน้า ขับช้าลง ระวังถนนมืด
- ถ้าผู้ใช้ถามหาที่ ให้แนะนำที่เปิดกลางคืน (เช่น เซเว่น ปั๊มน้ำมัน)
- ถ้าขับนาน แนะนำที่พัก/โรงแรม
- ใช้ searchNearby หา hotel หรือ fuel ที่เปิด 24 ชม.

=== C3: เทียบราคาน้ำมัน (Fuel Price Tracker) ===
เมื่อผู้ใช้ถามเรื่องราคาน้ำมัน/เติมน้ำมัน:
- บอกราคาน้ำมันปัจจุบัน (จาก context)
- แนะนำหาปั๊มน้ำมันใกล้ๆ ด้วย searchNearby
- คำนวณค่าน้ำมันสำหรับระยะทางที่เหลือ
- ใช้ <<ACTION:fuelPrice>> เพื่อแสดงราคาน้ำมันทุกปั๊ม
- ใช้ <<ACTION:searchNearby|type=fuel|keyword=>> เพื่อหาปั๊มใกล้

=== C4: เส้นทางวิวสวย (Scenic Route) ===
เมื่อผู้ใช้ขอเส้นทางวิวสวย/ถ่ายรูป/เที่ยวระหว่างทาง/จุดชมวิว:
- ค้นหาจุดชมวิว สวนสาธารณะ แหล่งท่องเที่ยว ตลอดเส้นทาง
- แนะนำ 3-5 จุดแวะ พร้อมเหตุผล
- ใช้ <<ACTION:scenicSearch>> เพื่อค้นหาจุดชมวิว/ที่เที่ยวตลอดเส้นทาง
- ใช้ <<ACTION:searchNearby|type=attraction|keyword=>> หรือ searchAndAdd สำหรับจุดเฉพาะ

=== C5: ค่าทางด่วน (Toll Calculator) ===
เมื่อผู้ใช้ถามเรื่องค่าทางด่วน/ค่าผ่านทาง:
- บอกค่าทางด่วนโดยประมาณจาก context
- เปรียบเทียบ: ขึ้นด่วน (เสียเงิน แต่เร็ว) vs ทางล่าง (ฟรี แต่ช้า)
- ถ้ายังไม่มี route แนะนำคำนวณเส้นทางก่อน
- ใช้ <<ACTION:tollCompare>> เพื่อเปรียบเทียบค่าด่วนของแต่ละเส้นทาง

=== F8: ทางลัดที่เรียนรู้ (Smart Shortcut) ===
ระบบเรียนรู้ทางลัดจากการขับจริง — ถ้าผู้ใช้เคยขับเส้นทางเร็วกว่าที่คำนวณ ระบบจะจำไว้
เมื่อผู้ใช้ถามเรื่องทางลัด:
- บอกว่าระบบเรียนรู้ทางลัดจากประวัติขับจริง
- ถ้าเคยใช้ทางลัด จะแจ้งเตือนอัตโนมัติเมื่อคำนวณเส้นทาง

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

    // ═══ Try each provider with fallback + timeout ═══
    const errors: string[] = [];
    const nextProviders = getAvailableProviders();
    const providersToTry = nextProviders.length > 0 ? nextProviders : providers;

    for (const provider of providersToTry) {
      try {
        console.log(`[AI] Trying ${provider.name} (${provider.model})...`);

        // AbortController with 15s timeout per provider
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
              temperature: 0.6,
              max_tokens: 2048,
              stream: true
            }),
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (res.ok) {
            console.log(`[AI] ${provider.name} OK — streaming response`);
            return new Response(res.body, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-AI-Provider': provider.name
              }
            });
          }

          // Rate limit or error — set cooldown and try next
          const errText = await res.text();
          console.warn(`[AI] ${provider.name} failed (${res.status}):`, errText.slice(0, 300));

          if (res.status === 429) {
            const cooldownMs = parseCooldownFromError(errText);
            setCooldown(provider.name, cooldownMs);
            errors.push(`${provider.name}: rate-limited (429)`);
            continue;
          }

          errors.push(`${provider.name}: HTTP ${res.status} — ${errText.slice(0, 100)}`);
          continue;
        } catch (fetchErr: any) {
          clearTimeout(timeout);
          if (fetchErr.name === 'AbortError') {
            console.warn(`[AI] ${provider.name} timeout (15s)`);
            setCooldown(provider.name, 30000);
            errors.push(`${provider.name}: timeout 15s`);
            continue;
          }
          throw fetchErr;
        }
      } catch (err: any) {
        console.warn(`[AI] ${provider.name} fetch error:`, err.message);
        errors.push(`${provider.name}: ${err.message}`);
        continue;
      }
    }

    // All providers failed — show ALL errors
    const errorDetail = errors.join(' | ');
    console.error(`[AI] All providers failed: ${errorDetail}`);

    return new Response(JSON.stringify({
      error: `AI ทุกระบบไม่พร้อมชั่วคราว กรุณารอสักครู่แล้วลองใหม่`,
      details: errorDetail
    }), {
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

// GET for availability check + diagnostics
export const GET: RequestHandler = async ({ url }) => {
  const diagnose = url.searchParams.get('diagnose') === '1';
  const allProviders = getProviders();

  if (!diagnose) {
    return new Response(JSON.stringify({ available: allProviders.length > 0 }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Diagnostic mode: test each provider with a tiny request
  const results: { name: string; status: string; detail?: string }[] = [];

  for (const provider of allProviders) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${provider.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
          stream: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (res.ok) {
        results.push({ name: provider.name, status: 'ok' });
      } else {
        const errText = await res.text();
        results.push({
          name: provider.name,
          status: `error ${res.status}`,
          detail: errText.slice(0, 200)
        });
      }
    } catch (err: any) {
      results.push({
        name: provider.name,
        status: err.name === 'AbortError' ? 'timeout' : 'fetch_error',
        detail: err.message
      });
    }
  }

  // Also show cooldown state
  const cooldowns: Record<string, number> = {};
  const now = Date.now();
  for (const [name, expiry] of providerCooldowns) {
    if (expiry > now) cooldowns[name] = Math.round((expiry - now) / 1000);
  }

  return new Response(JSON.stringify({
    providers: results,
    cooldowns,
    total: allProviders.length
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
};
