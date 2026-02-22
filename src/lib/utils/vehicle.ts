export function getEVConsumptionAtSpeed(speedKmh: number, baseRate: number): number {
  if (speedKmh < 1) return baseRate;
  const ref = 60;
  const v = Math.min(Math.max(speedKmh, 5), 180);
  const rolling = 0.4;
  const aero = 0.35 * (v * v) / (ref * ref);
  const aux = 0.25 * ref / v;
  return baseRate * (rolling + aero + aux);
}

export function getEVConsumptionForRoute(distanceMeters: number, durationSeconds: number, baseRate: number): number {
  if (!durationSeconds || durationSeconds <= 0) return baseRate;
  const avgSpeedKmh = (distanceMeters / 1000) / (durationSeconds / 3600);
  return getEVConsumptionAtSpeed(avgSpeedKmh, baseRate);
}

export function getPriorityGradient(p: number): { bg: string; glow: string } {
  const colorMap: Record<number, { bg: string; glow: string }> = {
    1: { bg: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%)', glow: '#ff6b6b' },
    2: { bg: 'linear-gradient(135deg, #ffa502 0%, #ff7f00 100%)', glow: '#ffa502' },
    3: { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', glow: '#667eea' },
    4: { bg: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)', glow: '#a855f7' },
    5: { bg: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)', glow: '#6b7280' }
  };
  return colorMap[p] || colorMap[3];
}

export function getPriorityLabel(p: number): string {
  const labels: Record<number, string> = {
    1: 'ด่วนมาก',
    2: 'ด่วน',
    3: 'ปกติ',
    4: 'ไม่เร่ง',
    5: 'ยืดหยุ่น'
  };
  return labels[p] || 'ปกติ';
}
