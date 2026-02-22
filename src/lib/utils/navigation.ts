import type { TurnInstruction } from '$lib/types';

export function getTurnIcon(type: string, modifier?: string): string {
  const modIcons: Record<string, string> = {
    'uturn': '🔃', 'sharp right': '↪️', 'right': '➡️', 'slight right': '↗️',
    'straight': '⬆️', 'slight left': '↖️', 'left': '⬅️', 'sharp left': '↩️'
  };
  const typeIcons: Record<string, string> = {
    'depart': '🚗', 'arrive': '🏁',
    'roundabout': '🔄', 'rotary': '🔄', 'roundabout turn': '🔄',
    'exit roundabout': '🔄', 'exit rotary': '🔄',
    'on ramp': '🛣️', 'off ramp': '🚗',
    'merge': '↘️', 'fork': '↗️',
    'new name': '⬆️', 'end of road': '⬆️',
    'turn': '➡️', 'continue': '⬆️', 'notification': '⚠️'
  };
  if (modifier && modIcons[modifier]) return modIcons[modifier];
  return typeIcons[type] || '⬆️';
}

export function getTurnText(type: string, modifier?: string, name?: string): string {
  const road = name && name !== 'ถนนไม่ทราบชื่อ' && name !== '' ? ` ${name}` : '';
  const modTexts: Record<string, string> = {
    'uturn': 'กลับรถ', 'sharp right': 'เลี้ยวขวาแหลม', 'right': 'เลี้ยวขวา',
    'slight right': 'เบี่ยงขวาเล็กน้อย', 'straight': 'ตรงไป',
    'slight left': 'เบี่ยงซ้ายเล็กน้อย', 'left': 'เลี้ยวซ้าย', 'sharp left': 'เลี้ยวซ้ายแหลม'
  };
  if (type === 'depart') return `ออกเดินทาง${road}`;
  if (type === 'arrive') return 'ถึงจุดหมาย';
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return `เข้าวงเวียน${road}`;
  if (type === 'exit roundabout' || type === 'exit rotary') return `ออกวงเวียน${road}`;
  if (type === 'on ramp') return `ขึ้นทางด่วน${road}`;
  if (type === 'off ramp') return `ลงทางด่วน${road}`;
  if (type === 'merge') return `รวมเลน${modifier === 'left' ? 'ซ้าย' : modifier === 'right' ? 'ขวา' : ''}${road}`;
  if (type === 'fork') return `${modifier === 'left' ? 'แยกซ้าย' : modifier === 'right' ? 'แยกขวา' : 'ทางแยก'}${road}`;
  if (type === 'new name') return `ตรงไปต่อ${road}`;
  if (type === 'end of road') return `${modifier && modTexts[modifier] ? modTexts[modifier] : 'สิ้นสุดถนน'}${road}`;
  if (type === 'notification') return `หมายเหตุ${road}`;
  if (type === 'continue') {
    if (modifier === 'straight' || !modifier) return `ตรงไป${road}`;
    return `ตรงไป${modifier && modTexts[modifier] ? ' ' + modTexts[modifier] : ''}${road}`;
  }
  if (modifier && modTexts[modifier]) return `${modTexts[modifier]}${road}`;
  return `ไปต่อ${road}`;
}

export function extractTurnInstructions(route: any): TurnInstruction[] {
  const instructions: TurnInstruction[] = [];
  if (!route?.legs) return instructions;
  for (const leg of route.legs) {
    if (!leg?.steps) continue;
    for (const step of leg.steps) {
      if (step?.maneuver) {
        instructions.push({
          type: step.maneuver.type || '',
          modifier: step.maneuver.modifier || '',
          name: step.name || '',
          distance: step.distance || 0,
          duration: step.duration || 0,
          location: step.maneuver.location || [0, 0]
        });
      }
    }
  }
  return instructions;
}

export function detectTollRoad(route: any): boolean {
  if (!route.legs) return false;
  for (const leg of route.legs) {
    if (!leg.steps) continue;
    for (const step of leg.steps) {
      const name = (step.name || '').toLowerCase();
      const ref = (step.ref || '').toLowerCase();
      if (name.includes('motorway') || name.includes('expressway') || name.includes('ทางด่วน') ||
          name.includes('toll') || ref.includes('motorway')) {
        return true;
      }
    }
  }
  return false;
}

export function estimateTollCost(route: any): number {
  const distKm = route.distance / 1000;
  if (!detectTollRoad(route)) return 0;
  return Math.round(distKm * 2.5 + 25);
}
