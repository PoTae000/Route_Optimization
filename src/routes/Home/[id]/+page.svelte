<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  let currentUser: any = null;
  let customerOrders: any[] = [];
  let customerMarkers: any[] = [];
  let showCustomerOrders = true;
  let includeCustomersInRoute = true;

  function logout() {
    localStorage.removeItem('user');
    goto('/');
  }

  let map: any;
  let L: any;
  let deliveryPoints: any[] = [];
  let optimizedRoute: any = null;
  let routeLayer: any = null;
  let glowLayer: any = null;
  let markers: any[] = [];
  const API_URL = 'http://localhost:3000/api';

  let newPoint = { name: '', address: '', lat: 13.7563, lng: 100.5018, priority: 3 };
  let isOptimizing = false;
  let showAddForm = false;
  let clickMarker: any = null;

  let notification = { show: false, message: '', type: 'success' as 'success' | 'error' | 'warning' };
  let activeTab: 'points' | 'customers' | 'route' = 'points';
  let activePointId: number | null = null;
  let isNavigating = false;

  // ขั้นตอนที่ 1: แก้ type currentLocation
  let currentLocation: { lat: number; lng: number; heading?: number | null; speed?: number | null } | null = null;
  let currentLocationMarker: any = null;
  let watchId: number | null = null;
  let currentTargetIndex = 0;
  let remainingDistance = 0;
  let remainingTime = 0;
  let distanceToNextPoint = 0;
  let traveledPath: [number, number][] = [];
  let traveledLayer: any = null;
  let remainingRouteLayer: any = null;
  let remainingGlowLayer: any = null;
  let navigationInterval: any = null;
  let arrivedPoints: number[] = [];
  let accuracy = 0;

  let currentRouteId: number | null = null;
  let isProcessingDelivery = false;

  // Statistics
  let totalDeliveriesToday = 0;
  let completedDeliveries = 0;
  let averageDeliveryTime = 0;

  // Speed tracking
  let currentSpeed = 0;
  let maxSpeed = 0;
  let speedHistory: number[] = [];
  let lastPosition: { lat: number; lng: number; time: number } | null = null;

  // ETA & Time
  let estimatedArrivalTime: Date | null = null;
  let navigationStartTime: Date | null = null;
  let elapsedTime = 0;

  // Weather (mock)
  let weather = { temp: 32, condition: 'sunny', humidity: 65 };

  // Traffic status
  let trafficStatus: 'smooth' | 'moderate' | 'heavy' = 'smooth';

  // Fuel estimation
  let fuelConsumption = 0;
  let fuelCostEstimate = 0;
  const FUEL_PRICE_PER_LITER = 42;
  const KM_PER_LITER = 15;
  type VehicleType = 'fuel' | 'ev';
  let vehicleType: VehicleType = 'fuel';
  const ELECTRICITY_PRICE_PER_KWH = 4.5;
  const KWH_PER_100KM = 15;
  let evBatteryCapacity = 60;
  let evCurrentCharge = 80;
  let evRangePerCharge = 400;
  let evEnergyConsumption = 0;
  let evCostEstimate = 0;
  let evRemainingRange = 0;
  let evBatteryAfterTrip = 0;

  // Voice navigation
  let voiceEnabled = true;

  // Settings panel
  let showSettings = false;

  // Multi-select
  let selectedPoints: number[] = [];
  let isMultiSelectMode = false;

  interface ChargingStation {
    id: number;
    name: string;
    address: string;
    lat: number;
    lng: number;
    distance?: number;
    operator?: string;
    connectionTypes?: string[];
    powerKW?: number;
    numberOfPoints?: number;
    status?: string;
    usageCost?: string;
    isOperational?: boolean;
    stopNumber?: number;
    estimatedChargingTime?: number;
  }

  interface DeliveryRecord {
    id: number;
    pointId: number | string;
    pointName: string;
    address: string;
    status: 'success' | 'skipped';
    timestamp: Date;
    lat: number;
    lng: number;
    isCustomerOrder?: boolean;
  }
  let deliveryHistory: DeliveryRecord[] = [];
  let showHistory = false;

  let batteryLevel = 100;
  let isCharging = false;
  let chargingStations: ChargingStation[] = [];
  let chargingStationMarkers: any[] = [];
  let showChargingStations = true;
  let isLoadingStations = false;
  let selectedChargingStation: ChargingStation | null = null;
  let routeChargingStops: ChargingStation[] = [];

  $: driverInfo = currentUser ? {
    name: currentUser.name || 'ไม่ระบุชื่อ',
    id: `DRV-${currentUser.id}`,
    vehicle: currentUser.vehicle || 'ไม่ระบุ',
    plateNumber: currentUser.plateNumber || '-',
    phone: currentUser.phone || '-',
    avatar: currentUser.avatar || '👤',
    role: currentUser.role || 'driver'
  } : { name: 'กำลังโหลด...', id: '-', vehicle: '-', plateNumber: '-', phone: '-', avatar: '👤', role: 'driver' };

  let isOnBreak = false;
  let breakStartTime: Date | null = null;
  let totalBreakTime = 0;

  $: filteredPoints = deliveryPoints;
  $: {
    const distanceKm = remainingDistance / 1000;
    if (vehicleType === 'fuel') {
      fuelConsumption = distanceKm / KM_PER_LITER;
      fuelCostEstimate = fuelConsumption * FUEL_PRICE_PER_LITER;
    } else {
      evEnergyConsumption = (distanceKm / 100) * KWH_PER_100KM;
      evCostEstimate = evEnergyConsumption * ELECTRICITY_PRICE_PER_KWH;
      evRemainingRange = (evCurrentCharge / 100) * evRangePerCharge;
      const energyUsedPercent = (evEnergyConsumption / evBatteryCapacity) * 100;
      evBatteryAfterTrip = Math.max(0, evCurrentCharge - energyUsedPercent);
    }
  }

  $: allDeliveryPoints = [
    ...deliveryPoints.map(p => ({ ...p, isCustomerOrder: false })),
    ...(includeCustomersInRoute ? customerOrders.filter(o => o.status === 'accepted').map(o => ({
      id: `customer-${o.id}`, name: `🛒 ${o.customer_name}`, address: o.address, lat: o.lat, lng: o.lng, priority: 1,
      isCustomerOrder: true, orderId: o.id, customer_name: o.customer_name, customer_phone: o.customer_phone,
      customer_avatar: o.customer_avatar, notes: o.notes, total_amount: o.total_amount || 50,
      payment_method: o.payment_method || 'cash', payment_status: o.payment_status || 'pending'
    })) : [])
  ];

  let alerts: { id: number; type: string; message: string; time: Date }[] = [];
  let showAlerts = false;
  let lastGPSWarningTime = 0;
  let gpsStatus: 'excellent' | 'good' | 'weak' | 'poor' = 'good';

  // ==================== ขั้นตอนที่ 2: REAL-TIME NAVIGATION VARIABLES ====================
  interface TurnInstruction {
    type: string;
    modifier?: string;
    instruction: string;
    distance: number;
    duration: number;
    location: [number, number];
    streetName?: string;
    voiceInstruction?: string;
  }
  let routeInstructions: TurnInstruction[] = [];
  let currentInstructionIndex = 0;
  let currentInstruction: TurnInstruction | null = null;
  let nextInstruction: TurnInstruction | null = null;
  let distanceToNextTurn = 0;
  let lastVoiceDistance = 999;
  let voiceQueue: string[] = [];
  let isSpeaking = false;
  let mapRotationEnabled = false;
  let currentHeading = 0;
  let headingHistory: number[] = [];
  let isOffRoute = false;
  let offRouteDistance = 0;
  let isRerouting = false;
  let lastRerouteTime = 0;
  const REROUTE_THRESHOLD = 50;
  const REROUTE_COOLDOWN = 10000;
  let gpsAccuracyHistory: number[] = [];
  let lastGPSUpdate = 0;
  let gpsUpdateCount = 0;
  const ARRIVAL_THRESHOLD = 30;
  let isApproachingDestination = false;
  let hasAnnouncedApproaching = false;

  // ==================== HELPER FUNCTIONS ====================
  function getAcceptedCustomerOrdersCount(): number {
    return customerOrders.filter(o => o.status === 'accepted').length;
  }
 
  function getPendingCustomerOrdersCount(): number {
    return customerOrders.filter(o => o.status === 'pending').length;
  }

  function getPaymentMethodText(method: string): string {
    const m: Record<string, string> = {
      'cash': '💵 เงินสด',
      'promptpay': '📱 พร้อมเพย์',
      'transfer': '🏦 โอนเงิน',
      'credit_card': '💳 บัตรเครดิต'
    };
    return m[method] || method;
  }

  function getPaymentStatusText(status: string): string {
    const s: Record<string, string> = {
      'pending': '⏳ รอชำระ',
      'paid': '✅ ชำระแล้ว',
      'verified': '✓ ยืนยันแล้ว',
      'failed': '❌ ไม่สำเร็จ'
    };
    return s[status] || status;
  }

  function getPaymentStatusColor(status: string): string {
    const c: Record<string, string> = {
      'pending': '#ffc107',
      'paid': '#00ff88',
      'verified': '#3b82f6',
      'failed': '#ef4444'
    };
    return c[status] || '#71717a';
  }

  async function confirmCashPayment(orderId: number) {
    try {
      const res = await fetch(`${API_URL}/driver/confirm-cash/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: currentUser.id })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showNotification('ยืนยันรับเงินสดสำเร็จ! 💵', 'success');
      speak('รับเงินสดเรียบร้อย');
      await loadCustomerOrders();
    } catch (err: any) {
      showNotification(err.message || 'ยืนยันไม่สำเร็จ', 'error');
    }
  }

  async function loadCustomerOrders() {
    if (!currentUser?.id) return;
    try {
      const res = await fetch(`${API_URL}/driver/customer-orders?driver_id=${currentUser.id}`);
      const data = await res.json();
      if (!data.error && Array.isArray(data)) {
        customerOrders = data;
        displayCustomerMarkers();
      }
    } catch (err) {
      console.error('Error loading customer orders:', err);
    }
  }

  function displayCustomerMarkers() {
    if (!L || !map) return;
    customerMarkers.forEach(m => {
      try { map.removeLayer(m); } catch(e) {}
    });
    customerMarkers = [];
    if (!showCustomerOrders || isNavigating) return;

    customerOrders.filter(o => o.status !== 'completed').forEach((order) => {
      const marker = L.marker([order.lat, order.lng], {
        icon: L.divIcon({
          className: 'customer-order-marker',
          html: `<div class="customer-pin ${order.status === 'accepted' ? 'accepted' : 'pending'}"><span>🛒</span><div class="customer-info"><div class="customer-name">${order.customer_name}</div><div class="order-status">${order.status === 'accepted' ? '✅ รับแล้ว' : '⏳ รอรับงาน'}</div></div></div>`,
          iconSize: [120, 60], iconAnchor: [60, 30]
        })
      }).addTo(map);
      marker.bindPopup(`<div class="customer-popup"><div class="popup-header customer-header"><span class="popup-icon">${order.customer_avatar || '👤'}</span><span class="popup-status">${order.status === 'accepted' ? 'รับงานแล้ว' : 'รอรับงาน'}</span></div><div class="popup-content"><h4>${order.customer_name}</h4><p class="popup-phone">📞 ${order.customer_phone || '-'}</p><p class="popup-address">📍 ${order.address}</p>${order.notes ? `<p class="popup-notes">📝 ${order.notes}</p>` : ''}</div></div>`, { className: 'dark-popup customer-dark-popup' });
      customerMarkers.push(marker);
    });
  }

  async function acceptCustomerOrder(orderId: number) {
    try {
      const res = await fetch(`${API_URL}/driver/accept-order/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: currentUser.id })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showNotification('รับงานสำเร็จ!', 'success');
      await loadCustomerOrders();
    } catch (err: any) {
      showNotification(err.message || 'รับงานไม่สำเร็จ', 'error');
    }
  }

  async function completeCustomerOrder(orderId: number, orderName?: string) {
    try {
      const res = await fetch(`${API_URL}/driver/complete-order/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: currentUser.id })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const order = customerOrders.find(o => o.id === orderId);
      if (order) {
        const record: DeliveryRecord = {
          id: data.id || Date.now(),
          pointId: `customer-${orderId}`,
          pointName: `🛒 ${order.customer_name}`,
          address: order.address || '',
          status: 'success',
          timestamp: new Date(),
          lat: order.lat,
          lng: order.lng,
          isCustomerOrder: true
        };
        deliveryHistory = [...deliveryHistory, record];
        completedDeliveries++;
      }
      showNotification('เสร็จงานสำเร็จ!', 'success');
      speak(`ส่ง ${orderName || order?.customer_name || 'ลูกค้า'} สำเร็จ`);
      await loadCustomerOrders();
    } catch (err: any) {
      showNotification(err.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  }

  async function loadTodayStats() {
    try {
      const params = new URLSearchParams();
      if (currentUser?.id) params.append('driver_id', String(currentUser.id));
      if (currentUser?.role) params.append('role', currentUser.role);
      const res = await fetch(`${API_URL}/deliveries/stats/today?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.error) return;
      completedDeliveries = data.completed || 0;
      totalDeliveriesToday = (data.completed || 0) + (data.pending || 0);
    } catch (err) {
      console.error('Load stats error:', err);
    }
  }

  async function loadDeliveryHistory() {
    try {
      const params = new URLSearchParams();
      params.append('limit', '50');
      if (currentUser?.id) params.append('driver_id', String(currentUser.id));
      if (currentUser?.role) params.append('role', currentUser.role);
      const res = await fetch(`${API_URL}/deliveries/history?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.error || !Array.isArray(data)) return;
      deliveryHistory = data.map((d: any) => ({
        id: d.id,
        pointId: d.point_id,
        pointName: d.point_name,
        address: d.address || '',
        status: d.status === 'completed' ? 'success' : 'skipped',
        timestamp: new Date(d.delivered_at),
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lng)
      }));
    } catch (err) {
      console.error('Load history error:', err);
    }
  }

  async function loadDeliveryPoints() {
    try {
      const params = new URLSearchParams();
      if (currentUser?.id) params.append('driver_id', String(currentUser.id));
      if (currentUser?.role) params.append('role', currentUser.role);
      const res = await fetch(`${API_URL}/points?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      deliveryPoints = Array.isArray(data) ? data.map((p: any) => ({
        id: Number(p.id),
        name: p.name || 'ไม่มีชื่อ',
        address: p.address || 'ไม่มีที่อยู่',
        lat: Number(p.lat),
        lng: Number(p.lng),
        priority: Number(p.priority || 3),
        driver_id: p.driver_id ? Number(p.driver_id) : null,
        driver_name: p.driver_name || null
      })) : [];
      displayPoints();
    } catch (err) {
      console.error(err);
      showNotification('โหลดข้อมูลไม่สำเร็จ', 'error');
    }
  }

  function displayPoints() {
    if (!L || !map) return;
    markers.forEach(m => m.remove());
    markers = [];
    deliveryPoints.forEach((point, i) => {
      const colors = getPriorityGradient(point.priority);
      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: 'custom-marker',
          html: `<div class="marker-pin" style="background: ${colors.bg}; box-shadow: 0 0 20px ${colors.glow};"><span>${i + 1}</span></div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        })
      }).addTo(map);
      marker.bindPopup(`<div class="custom-popup"><div class="popup-header" style="background: ${colors.bg}"><span class="popup-number">${i + 1}</span><span class="popup-priority">P${point.priority}</span></div><div class="popup-content"><h4>${point.name}</h4><p>${point.address}</p></div></div>`, { className: 'dark-popup' });
      markers.push(marker);
    });
  }

  async function addDeliveryPoint() {
    if (!newPoint.name.trim() || !newPoint.address.trim()) {
      showNotification('กรุณากรอกข้อมูลให้ครบ', 'error');
      return;
    }
    try {
      const payload = { ...newPoint, driver_id: currentUser?.id || null };
      const res = await fetch(`${API_URL}/points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error || !res.ok) throw new Error(data.error || 'เพิ่มไม่สำเร็จ');
      await loadDeliveryPoints();
      if (data.id) {
        activePointId = data.id;
        setTimeout(() => {
          const element = document.getElementById(`point-${data.id}`);
          if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
      showAddForm = false;
      if (clickMarker) clickMarker.remove();
      newPoint = { name: '', address: '', lat: 13.7563, lng: 100.5018, priority: 3 };
      showNotification('เพิ่มจุดส่งสำเร็จ', 'success');
    } catch (err) {
      showNotification('เพิ่มไม่สำเร็จ', 'error');
    }
  }

  async function deletePoint(id: number, name: string) {
    if (!confirm(`ลบ "${name}" ใช่หรือไม่?`)) return;
    try {
      const params = new URLSearchParams();
      if (currentUser?.id) params.append('driver_id', String(currentUser.id));
      if (currentUser?.role) params.append('role', currentUser.role);
      const res = await fetch(`${API_URL}/points/${id}?${params.toString()}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error || !res.ok) throw new Error(data.error || 'ลบไม่สำเร็จ');
      await loadDeliveryPoints();
      if (optimizedRoute) clearRoute();
      showNotification('ลบสำเร็จ', 'success');
    } catch (err) {
      showNotification('ลบไม่สำเร็จ', 'error');
    }
  }

  // ==================== TURN-BY-TURN FUNCTIONS ====================
  function getModifierInThai(modifier: string | undefined): string {
    const modifiers: Record<string, string> = {
      'uturn': 'กลับรถ',
      'sharp right': 'เลี้ยวขวาหักศอก',
      'right': 'เลี้ยวขวา',
      'slight right': 'ชิดขวา',
      'straight': 'ตรงไป',
      'slight left': 'ชิดซ้าย',
      'left': 'เลี้ยวซ้าย',
      'sharp left': 'เลี้ยวซ้ายหักศอก'
    };
    return modifiers[modifier || 'straight'] || 'ตรงไป';
  }

  function getInstructionIcon(modifier: string | undefined): string {
    const icons: Record<string, string> = {
      'uturn': '↩️',
      'sharp right': '↱',
      'right': '➡️',
      'slight right': '↗️',
      'straight': '⬆️',
      'slight left': '↖️',
      'left': '⬅️',
      'sharp left': '↰'
    };
    return icons[modifier || 'straight'] || '⬆️';
  }

  function parseRouteInstructions(routeData: any): TurnInstruction[] {
    if (!routeData?.legs) return [];
    const instructions: TurnInstruction[] = [];

    for (const leg of routeData.legs) {
      if (!leg.steps) continue;

      for (const step of leg.steps) {
        const maneuver = step.maneuver || {};
        let voiceInstruction = '';
        const distanceText = formatDistanceForVoice(step.distance);
        const modifier = maneuver.modifier || 'straight';
        const modifierThai = getModifierInThai(modifier);

        if (maneuver.type === 'depart') {
          voiceInstruction = `เริ่มต้นเส้นทาง ${step.name ? `บน ${step.name}` : ''}`;
        } else if (maneuver.type === 'arrive') {
          voiceInstruction = 'ถึงจุดหมายแล้ว';
        } else if (maneuver.type === 'turn') {
          voiceInstruction = `${distanceText} ${modifierThai}`;
          if (step.name) voiceInstruction += ` เข้าสู่ ${step.name}`;
        } else if (maneuver.type === 'roundabout' || maneuver.type === 'rotary') {
          voiceInstruction = `${distanceText} เข้าวงเวียน ออกทางออกที่ ${maneuver.exit || 1}`;
        } else {
          voiceInstruction = `${distanceText} ${modifierThai}`;
        }

        instructions.push({
          type: maneuver.type || 'turn',
          modifier,
          instruction: voiceInstruction,
          distance: step.distance || 0,
          duration: step.duration || 0,
          location: maneuver.location || [0, 0],
          streetName: step.name,
          voiceInstruction
        });
      }
    }
    return instructions;
  }

  function formatDistanceForVoice(meters: number): string {
    if (meters < 100) return `อีก ${Math.round(meters / 10) * 10} เมตร`;
    if (meters < 1000) return `อีก ${Math.round(meters / 50) * 50} เมตร`;
    return `อีก ${(meters / 1000).toFixed(1)} กิโลเมตร`;
  }

  function updateCurrentInstruction() {
    if (!currentLocation || routeInstructions.length === 0) return;

    let closestIndex = currentInstructionIndex;
    let minDistance = Infinity;

    for (let i = currentInstructionIndex; i < routeInstructions.length; i++) {
      const inst = routeInstructions[i];
      const dist = getDistance(currentLocation.lat, currentLocation.lng, inst.location[1], inst.location[0]);
      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = i;
      }
      if (dist > minDistance + 50) break;
    }

    if (minDistance < 30 && closestIndex < routeInstructions.length - 1) {
      closestIndex++;
    }

    currentInstructionIndex = closestIndex;
    currentInstruction = routeInstructions[closestIndex] || null;
    nextInstruction = routeInstructions[closestIndex + 1] || null;

    if (currentInstruction) {
      distanceToNextTurn = getDistance(
        currentLocation.lat,
        currentLocation.lng,
        currentInstruction.location[1],
        currentInstruction.location[0]
      );
      announceInstruction();
    }
  }

  function announceInstruction() {
    if (!voiceEnabled || !currentInstruction) return;

    const dist = distanceToNextTurn;

    if (dist <= 200 && dist > 150 && lastVoiceDistance > 200) {
      speak(currentInstruction.voiceInstruction || currentInstruction.instruction, 'normal');
      lastVoiceDistance = dist;
    } else if (dist <= 100 && dist > 60 && lastVoiceDistance > 100) {
      speak(`อีก 100 เมตร ${getModifierInThai(currentInstruction.modifier)}`, 'normal');
      lastVoiceDistance = dist;
    } else if (dist <= 50 && dist > 20 && lastVoiceDistance > 50) {
      speak(`${getModifierInThai(currentInstruction.modifier)} เลย`, 'high');
      lastVoiceDistance = dist;
    } else if (dist > 200) {
      lastVoiceDistance = 999;
    }
  }

  // ==================== AUTO REROUTE ====================
  function checkOffRoute() {
    if (!currentLocation || !optimizedRoute?.route?.geometry) return;

    const routeCoords: [number, number][] = optimizedRoute.route.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    let minDist = Infinity;

    for (const coord of routeCoords) {
      const dist = getDistance(currentLocation.lat, currentLocation.lng, coord[0], coord[1]);
      if (dist < minDist) minDist = dist;
    }

    offRouteDistance = minDist;

    if (minDist > REROUTE_THRESHOLD) {
      if (!isOffRoute) {
        isOffRoute = true;
        showNotification('⚠️ คุณออกนอกเส้นทาง', 'warning');
        speak('คุณออกนอกเส้นทาง กำลังคำนวณเส้นทางใหม่', 'high');
      }
      attemptReroute();
    } else {
      isOffRoute = false;
    }
  }

  async function attemptReroute() {
    const now = Date.now();
    if (isRerouting || now - lastRerouteTime < REROUTE_COOLDOWN) return;

    isRerouting = true;
    lastRerouteTime = now;
    showNotification('🔄 กำลังคำนวณเส้นทางใหม่...', 'warning');

    try {
      await recalculateRouteFromCurrentPosition();
      isOffRoute = false;
      speak('คำนวณเส้นทางใหม่เรียบร้อย', 'normal');
      showNotification('✅ คำนวณเส้นทางใหม่สำเร็จ', 'success');
    } catch (error) {
      console.error('Reroute failed:', error);
      showNotification('❌ ไม่สามารถคำนวณเส้นทางใหม่ได้', 'error');
    } finally {
      isRerouting = false;
    }
  }

  // ==================== ENHANCED GPS TRACKING ====================
  function handleGPSUpdate(position: GeolocationPosition) {
    const { latitude, longitude, accuracy: acc, heading, speed } = position.coords;
    const now = Date.now();

    gpsAccuracyHistory.push(acc);
    if (gpsAccuracyHistory.length > 10) gpsAccuracyHistory.shift();

    const avgAccuracy = gpsAccuracyHistory.reduce((a, b) => a + b, 0) / gpsAccuracyHistory.length;
    if (avgAccuracy < 10) gpsStatus = 'excellent';
    else if (avgAccuracy < 30) gpsStatus = 'good';
    else if (avgAccuracy < 50) gpsStatus = 'weak';
    else gpsStatus = 'poor';

    accuracy = acc;
    lastGPSUpdate = now;
    gpsUpdateCount++;

    if (currentLocation) {
      const jumpDistance = getDistance(currentLocation.lat, currentLocation.lng, latitude, longitude);
      const timeDiff = (now - (lastPosition?.time || now)) / 1000;
      if (jumpDistance > 100 && timeDiff < 2) {
        console.warn('GPS jump detected, ignoring');
        return;
      }
    }

    currentLocation = { lat: latitude, lng: longitude, heading, speed };

    if (lastPosition) {
      const distance = getDistance(lastPosition.lat, lastPosition.lng, latitude, longitude);
      const timeDiff = (now - lastPosition.time) / 1000;
      if (timeDiff > 0) {
        const calculatedSpeed = (distance / timeDiff) * 3.6;
        currentSpeed = speed !== null ? speed * 3.6 : currentSpeed * 0.7 + calculatedSpeed * 0.3;
        if (currentSpeed > maxSpeed) maxSpeed = currentSpeed;
        speedHistory.push(currentSpeed);
        if (speedHistory.length > 30) speedHistory.shift();
      }
    }
    lastPosition = { lat: latitude, lng: longitude, time: now };

    if (heading !== null && !isNaN(heading)) {
      headingHistory.push(heading);
      if (headingHistory.length > 5) headingHistory.shift();
      currentHeading = headingHistory.reduce((a, b) => a + b, 0) / headingHistory.length;
    }

    if (isNavigating) {
      updateNavigationState();
    }
  }

  function updateNavigationState() {
    if (!currentLocation || !optimizedRoute) return;

    updateCurrentLocationMarker();
    checkOffRoute();
    updateCurrentInstruction();
    updateRouteDisplayForNavigation();
    checkArrivalAtDestination();
    updateNavigationMarkers();
    updateETA();

    if (mapRotationEnabled && currentHeading) {
      rotateMarker();
    }

    map.panTo([currentLocation.lat, currentLocation.lng], { animate: true, duration: 0.5 });
  }

  function checkArrivalAtDestination() {
    if (!currentLocation || !optimizedRoute) return;

    const target = optimizedRoute.optimized_order[currentTargetIndex];
    if (!target || target.id === -1) return;

    const dist = getDistance(currentLocation.lat, currentLocation.lng, target.lat, target.lng);
    distanceToNextPoint = dist;

    if (dist < 100 && !hasAnnouncedApproaching) {
      hasAnnouncedApproaching = true;
      isApproachingDestination = true;
      speak(`ใกล้ถึง ${target.name} แล้ว`, 'normal');
      showNotification(`📍 ใกล้ถึง ${target.name}`, 'success');
    }

    if (dist < ARRIVAL_THRESHOLD) {
      speak(`ถึง ${target.name} แล้ว`, 'high');
      showNotification(`🎉 ถึง ${target.name} แล้ว!`, 'success');
    }

    if (dist > 150) {
      hasAnnouncedApproaching = false;
      isApproachingDestination = false;
    }
  }

  function rotateMarker() {
    if (!currentLocationMarker) return;
    const el = currentLocationMarker.getElement?.();
    if (el) {
      const arrow = el.querySelector('.heading-arrow') as HTMLElement;
      if (arrow) {
        arrow.style.transform = `rotate(${currentHeading}deg)`;
      }
    }
  }

  function toggleMapRotation() {
    mapRotationEnabled = !mapRotationEnabled;
    showNotification(mapRotationEnabled ? '🧭 เปิดหมุนตามทิศทาง' : '🔒 ล็อคทิศเหนือ', 'success');
  }

  // ==================== ENHANCED VOICE NAVIGATION ====================
  let thaiVoice: SpeechSynthesisVoice | null = null;

  function initVoiceNavigation() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      thaiVoice = voices.find(v => v.lang === 'th-TH') ||
                  voices.find(v => v.lang.startsWith('th')) ||
                  voices.find(v => v.name.toLowerCase().includes('thai')) ||
                  null;
    };

    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  function speak(text: string, priority: 'low' | 'normal' | 'high' = 'normal') {
    if (!voiceEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    if (priority === 'high') {
      speechSynthesis.cancel();
    }

    if (voiceQueue.length > 3) {
      voiceQueue = voiceQueue.slice(-2);
    }

    voiceQueue.push(text);
    processVoiceQueue();
  }

  function processVoiceQueue() {
    if (isSpeaking || voiceQueue.length === 0) return;

    isSpeaking = true;
    const text = voiceQueue.shift()!;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'th-TH';
    utterance.rate = 1.0;
    utterance.pitch = 1;
    utterance.volume = 1;

    if (thaiVoice) {
      utterance.voice = thaiVoice;
    }

    utterance.onend = () => {
      isSpeaking = false;
      setTimeout(processVoiceQueue, 300);
    };

    utterance.onerror = () => {
      isSpeaking = false;
      processVoiceQueue();
    };

    speechSynthesis.speak(utterance);
  }

  async function callOSRMProxy(waypoints: string, steps: boolean = false): Promise<any> {
    const res = await fetch(`${API_URL}/route/osrm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints, steps })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('ไม่สามารถคำนวณเส้นทางได้');
    return data;
  }

  async function optimizeRoute() {
    if (allDeliveryPoints.length < 1) {
      showNotification('ต้องมีอย่างน้อย 1 จุดส่ง', 'error');
      return;
    }
    isOptimizing = true;
    try {
      const startPoint = await getCurrentLocationAsStart();
      const sortedPoints = sortByNearestNeighbor(startPoint, [...allDeliveryPoints]);
      const waypoints = [`${startPoint.lng},${startPoint.lat}`, ...sortedPoints.map((p: any) => `${p.lng},${p.lat}`)].join(';');

      const data = await callOSRMProxy(waypoints, true);

      optimizedRoute = {
        route: { geometry: data.routes[0].geometry },
        total_distance: data.routes[0].distance,
        total_time: data.routes[0].duration,
        optimized_order: [{ ...startPoint, name: 'ตำแหน่งปัจจุบัน', address: 'จุดเริ่มต้นของคุณ', id: -1 }, ...sortedPoints],
        routeData: data.routes[0]
      };
      remainingDistance = data.routes[0].distance;
      remainingTime = data.routes[0].duration;

      routeInstructions = parseRouteInstructions(data.routes[0]);

      displayOptimizedRoute();
      activeTab = 'route';
      showNotification('คำนวณเส้นทางสำเร็จ', 'success');
    } catch (err: any) {
      showNotification(err.message || 'คำนวณไม่สำเร็จ', 'error');
    } finally {
      isOptimizing = false;
    }
  }

  function sortByNearestNeighbor(start: { lat: number; lng: number }, points: any[]): any[] {
    const sorted: any[] = [];
    const remaining = [...points];
    let currentPos = start;
    while (remaining.length > 0) {
      let nearestIndex = 0;
      let nearestScore = Infinity;
      remaining.forEach((point, index) => {
        const dist = getDistance(currentPos.lat, currentPos.lng, point.lat, point.lng);
        const priorityBonus = point.isCustomerOrder ? 500 : (point.priority ? (6 - point.priority) * 100 : 0);
        const score = dist - priorityBonus;
        if (score < nearestScore) {
          nearestScore = score;
          nearestIndex = index;
        }
      });
      const nearest = remaining.splice(nearestIndex, 1)[0];
      sorted.push(nearest);
      currentPos = { lat: nearest.lat, lng: nearest.lng };
    }
    return sorted;
  }

  function getCurrentLocationAsStart(): Promise<{ lat: number; lng: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('เบราว์เซอร์ไม่รองรับ GPS'));
        return;
      }

      if (currentLocation) {
        resolve({ lat: currentLocation.lat, lng: currentLocation.lng });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              resolve({
                lat: position.coords.latitude,
                lng: position.coords.longitude
              });
            },
            (err) => {
              let msg = 'ไม่สามารถระบุตำแหน่งได้';
              if (err.code === 1) msg = 'กรุณาอนุญาตการเข้าถึง GPS';
              if (err.code === 2) msg = 'GPS ไม่พร้อมใช้งาน - ลองเปิด Location ในเครื่อง';
              if (err.code === 3) msg = 'หมดเวลา - ลองอีกครั้ง';
              reject(new Error(msg));
            },
            {
              enableHighAccuracy: false,
              timeout: 30000,
              maximumAge: 60000
            }
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 30000
        }
      );
    });
  }

  function displayOptimizedRoute() {
    if (!L || !map || !optimizedRoute?.route?.geometry) return;
    if (routeLayer) routeLayer.remove();
    if (glowLayer) glowLayer.remove();
    const coords = optimizedRoute.route.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    glowLayer = L.polyline(coords, { color: '#00ff88', weight: 12, opacity: 0.3, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    routeLayer = L.polyline(coords, { color: '#00ff88', weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [80, 80] });
    markers.forEach(m => m.remove());
    markers = [];
    customerMarkers.forEach(m => { try { map.removeLayer(m); } catch(e) {} });
    customerMarkers = [];
    optimizedRoute.optimized_order.forEach((point: any, i: number) => {
      const isStart = i === 0;
      const isCurrentLocation = isStart && point.id === -1;
      const isCustomer = point.isCustomerOrder;

      let gradient, glow;
      if (isCurrentLocation) { gradient = 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'; glow = '#3b82f6'; }
      else if (isCustomer) { gradient = 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)'; glow = '#8b5cf6'; }
      else { gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; glow = '#667eea'; }

      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: 'route-marker',
          html: `<div class="marker-pin route-pin ${isCurrentLocation ? 'current-loc' : ''} ${isCustomer ? 'customer-route' : ''}" style="background: ${gradient}; box-shadow: 0 0 25px ${glow};"><span>${isCurrentLocation ? '📍' : isCustomer ? '🛒' : i}</span>${isCurrentLocation ? '<div class="marker-label">คุณอยู่ที่นี่</div>' : ''}</div>`,
          iconSize: [52, 52],
          iconAnchor: [26, 26]
        })
      }).addTo(map);
      marker.bindPopup(`<div class="custom-popup"><div class="popup-header" style="background: ${gradient}"><span class="popup-number">${isCurrentLocation ? '📍' : isCustomer ? '🛒' : i}</span><span class="popup-priority">${isCurrentLocation ? 'จุดเริ่มต้น' : isCustomer ? 'ลูกค้า' : 'จุดส่ง'}</span></div><div class="popup-content"><h4>${point.name}</h4><p>${point.address}</p>${point.customer_phone ? `<p>📞 ${point.customer_phone}</p>` : ''}</div></div>`, { className: 'dark-popup' });
      markers.push(marker);
    });
  }

  function clearRoute() {
    if (routeLayer) { try { map.removeLayer(routeLayer); } catch (e) {} routeLayer = null; }
    if (glowLayer) { try { map.removeLayer(glowLayer); } catch (e) {} glowLayer = null; }
    if (markers && markers.length > 0) {
      for (let i = 0; i < markers.length; i++) {
        try { if (markers[i]) map.removeLayer(markers[i]); } catch (e) {}
      }
      markers = [];
    }
    if (clickMarker) { try { map.removeLayer(clickMarker); } catch (e) {} clickMarker = null; }
    optimizedRoute = null;
    arrivedPoints = [];
    currentTargetIndex = 0;
    displayPoints();
    displayCustomerMarkers();
  }

  function startNavigation() {
    if (!optimizedRoute) return;
    if (!navigator.geolocation) {
      showNotification('เบราว์เซอร์ไม่รองรับ GPS', 'error');
      return;
    }
    isNavigating = true;
    currentTargetIndex = 1;
    arrivedPoints = [0];
    traveledPath = [];
    remainingDistance = optimizedRoute.total_distance;
    remainingTime = optimizedRoute.total_time;
    navigationStartTime = new Date();
    elapsedTime = 0;
    speedHistory = [];
    maxSpeed = 0;
    customerMarkers.forEach(m => { try { map.removeLayer(m); } catch(e) {} });
    customerMarkers = [];

    currentInstructionIndex = 0;
    lastVoiceDistance = 999;
    hasAnnouncedApproaching = false;
    isApproachingDestination = false;
    isOffRoute = false;
    isRerouting = false;

    if (optimizedRoute.routeData && routeInstructions.length === 0) {
      routeInstructions = parseRouteInstructions(optimizedRoute.routeData);
    }

    watchId = navigator.geolocation.watchPosition(
      handleGPSUpdate,
      handleGeoError,
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 5000
      }
    );

    navigationInterval = setInterval(() => {
      updateNavigationInfo();
      updateETA();
      updateFuelEstimate();
      updateStatistics();
    }, 1000);

    speak('เริ่มนำทาง');
    addAlert('navigation', 'เริ่มการนำทาง');
    showNotification('เริ่มนำทางแล้ว', 'success');
    updateNavigationMarkers();

    const firstTarget = optimizedRoute.optimized_order[currentTargetIndex];
    if (firstTarget) {
      map.setView([firstTarget.lat, firstTarget.lng], 17);
      speak(`มุ่งหน้าไปยัง ${firstTarget.name}`, 'normal');
    }

    setTimeout(() => { map.invalidateSize(); }, 100);
  }

  function stopNavigation() {
    isNavigating = false;
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (navigationInterval) {
      clearInterval(navigationInterval);
      navigationInterval = null;
    }
    if (currentLocationMarker) {
      currentLocationMarker.remove();
      currentLocationMarker = null;
    }
    if (traveledLayer) {
      traveledLayer.remove();
      traveledLayer = null;
    }
    if (remainingRouteLayer) {
      remainingRouteLayer.remove();
      remainingRouteLayer = null;
    }
    if (remainingGlowLayer) {
      remainingGlowLayer.remove();
      remainingGlowLayer = null;
    }
    currentLocation = null;
    currentTargetIndex = 0;
    arrivedPoints = [];
    traveledPath = [];
    routeInstructions = [];
    currentInstructionIndex = 0;
    isOffRoute = false;
    isRerouting = false;
    if (optimizedRoute) {
      displayOptimizedRoute();
    }
    displayCustomerMarkers();
    showNotification('หยุดนำทางแล้ว', 'success');
  }

  function updateCurrentLocationMarker() {
    if (!L || !map || !currentLocation) return;
    const accuracySize = Math.min(accuracy * 2, 100);

    if (currentLocationMarker) {
      currentLocationMarker.setLatLng([currentLocation.lat, currentLocation.lng]);
      const el = currentLocationMarker.getElement?.();
      if (el) {
        const accEl = el.querySelector('.location-accuracy') as HTMLElement;
        if (accEl) {
          accEl.style.width = `${accuracySize}px`;
          accEl.style.height = `${accuracySize}px`;
        }
      }
    } else {
      currentLocationMarker = L.marker([currentLocation.lat, currentLocation.lng], {
        icon: L.divIcon({
          className: 'current-location-marker',
          html: `
            <div class="location-wrapper">
              <div class="location-accuracy" style="width: ${accuracySize}px; height: ${accuracySize}px;"></div>
              <div class="location-dot">
                <div class="heading-arrow">▲</div>
                <div class="location-dot-inner"></div>
              </div>
              <div class="location-pulse"></div>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        }),
        zIndexOffset: 1000
      }).addTo(map);
    }
  }

  function updateNavigationMarkers() {
    if (!L || !map || !optimizedRoute) return;
    if (markers && markers.length > 0) {
      markers.forEach((m) => {
        try { if (m && map) map.removeLayer(m); } catch(e) {}
      });
    }
    markers = [];
    optimizedRoute.optimized_order.forEach((point: any, i: number) => {
      const isArrived = arrivedPoints.includes(i);
      const isCurrent = i === currentTargetIndex;
      const isStart = point.id === -1;
      const isCustomer = point.isCustomerOrder;
      let gradient, glow;
      if (isArrived) { gradient = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'; glow = '#6b7280'; }
      else if (isCurrent) { gradient = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'; glow = '#f59e0b'; }
      else if (isStart) { gradient = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)'; glow = '#00ff88'; }
      else if (isCustomer) { gradient = 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)'; glow = '#8b5cf6'; }
      else { gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; glow = '#667eea'; }
      const displayNumber = isStart ? '📍' : (isArrived ? '✓' : (isCustomer ? '🛒' : i));
      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: 'route-marker',
          html: `<div class="marker-pin route-pin ${isArrived ? 'arrived' : ''} ${isCurrent ? 'current-target' : ''}" style="background: ${gradient}; box-shadow: 0 0 25px ${glow};"><span>${displayNumber}</span>${isCurrent ? '<div class="marker-label target-label">เป้าหมาย</div>' : ''}</div>`,
          iconSize: [52, 52],
          iconAnchor: [26, 26]
        })
      }).addTo(map);
      markers.push(marker);
    });
  }

  function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

// ==================== MULTI-SELECT FUNCTIONS ====================

function toggleMultiSelect() {
  isMultiSelectMode = !isMultiSelectMode;
  if (!isMultiSelectMode) {
    selectedPoints = [];
  }
}

// ==================== BREAK TIME FUNCTIONS ====================

function startBreak() {
  isOnBreak = true;
  breakStartTime = new Date();
  showNotification('เริ่มพักเบรค', 'success');
  addAlert('break', 'คนขับเริ่มพักเบรค');
}
  function addAlert(type: string, message: string) {
    const alert = { id: Date.now(), type, message, time: new Date() };
    alerts = [alert, ...alerts].slice(0, 50);
  }

  function clearAlerts() {
    alerts = [];
  }

  function dismissAlert(id: number) {
    alerts = alerts.filter(a => a.id !== id);
  }

function endBreak() {
  if (breakStartTime) {
    const breakDuration = Date.now() - breakStartTime.getTime();
    totalBreakTime += breakDuration;
  }
  isOnBreak = false;
  breakStartTime = null;
  showNotification('สิ้นสุดพักเบรค', 'success');
  addAlert('break', 'คนขับกลับมาทำงาน');
}

function formatBreakTime(): string {
  let totalMs = totalBreakTime;
  if (isOnBreak && breakStartTime) {
    totalMs += Date.now() - breakStartTime.getTime();
  }
  const mins = Math.floor(totalMs / 60000);
  return `${mins} นาที`;
}

function togglePointSelection(id: number) {
  if (selectedPoints.includes(id)) {
    selectedPoints = selectedPoints.filter(p => p !== id);
  } else {
    selectedPoints = [...selectedPoints, id];
  }
}

function selectAllPoints() {
  selectedPoints = deliveryPoints.map(p => p.id);
}

function deselectAllPoints() {
  selectedPoints = [];
}

async function deleteSelectedPoints() {
  if (selectedPoints.length === 0) return;
  if (!confirm(`ลบ ${selectedPoints.length} จุดที่เลือก?`)) return;
  
  for (const id of selectedPoints) {
    try {
      await fetch(`${API_URL}/points/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Delete error:', err);
    }
  }
  
  await loadDeliveryPoints();
  selectedPoints = [];
  isMultiSelectMode = false;
  showNotification(`ลบจุดสำเร็จ`, 'success');
}
  function formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)} ม.`;
    }
    return `${(meters / 1000).toFixed(1)} กม.`;
  }

  function formatTime(seconds: number): string {
    const mins = Math.round(seconds / 60);
    if (mins < 60) {
      return `${mins} นาที`;
    }
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours} ชม. ${remainMins} นาที`;
  }

  function centerOnCurrentLocation() {
    if (currentLocation && map) {
      map.setView([currentLocation.lat, currentLocation.lng], 17, { animate: true });
    }
  }

  async function recalculateRouteFromCurrentPosition() {
    if (!currentLocation || !optimizedRoute) return;
    try {
      const remainingPoints = optimizedRoute.optimized_order.filter((p: any) => p.id !== -1);
      if (remainingPoints.length === 0) {
        showNotification('ส่งครบทุกจุดแล้ว!', 'success');
        stopNavigation();
        clearAllMarkersAndLayers();
        return;
      }
      const sortedPoints = sortByNearestNeighbor(currentLocation, remainingPoints);
      const waypoints = [`${currentLocation.lng},${currentLocation.lat}`, ...sortedPoints.map((p: any) => `${p.lng},${p.lat}`)].join(';');

      const data = await callOSRMProxy(waypoints, true);

      optimizedRoute = {
        route: { geometry: data.routes[0].geometry },
        total_distance: data.routes[0].distance,
        total_time: data.routes[0].duration,
        optimized_order: [{ ...currentLocation, name: 'ตำแหน่งปัจจุบัน', address: 'ตำแหน่งของคุณ', id: -1 }, ...sortedPoints],
        routeData: data.routes[0]
      };
      remainingDistance = data.routes[0].distance;
      remainingTime = data.routes[0].duration;
      currentTargetIndex = 1;
      arrivedPoints = [0];

      routeInstructions = parseRouteInstructions(data.routes[0]);
      currentInstructionIndex = 0;
      lastVoiceDistance = 999;

      clearAllRouteLayers();
      updateRouteDisplayForNavigation();
      updateNavigationMarkers();
      const nextTarget = optimizedRoute.optimized_order[currentTargetIndex];
      if (nextTarget) {
        map.setView([nextTarget.lat, nextTarget.lng], 15, { animate: true });
      }
    } catch (err) {
      console.error('Error recalculating route:', err);
      currentTargetIndex = 1;
      arrivedPoints = [0];
      clearAllRouteLayers();
      updateRouteDisplayForNavigation();
      updateNavigationMarkers();
    }
  }

  async function markDeliverySuccess() {
    if (isProcessingDelivery) {
      showNotification('กำลังประมวลผล...', 'warning');
      return;
    }
    if (!optimizedRoute?.optimized_order) {
      showNotification('ไม่มีเส้นทาง', 'error');
      return;
    }
    const deliveredPoint = optimizedRoute.optimized_order[currentTargetIndex];
    if (!deliveredPoint) {
      showNotification('ไม่พบจุดส่ง', 'error');
      return;
    }
    isProcessingDelivery = true;
    try {
      if (deliveredPoint.isCustomerOrder) {
        await completeCustomerOrder(deliveredPoint.orderId, deliveredPoint.name);
        const pointIdToRemove = deliveredPoint.id;
        optimizedRoute.optimized_order = optimizedRoute.optimized_order.filter((p: any) => p.id !== pointIdToRemove);
        const remainingDeliveryPoints = optimizedRoute.optimized_order.filter((p: any) => p.id !== -1);
        if (remainingDeliveryPoints.length === 0) {
          showNotification('🎉 ส่งครบทุกจุดแล้ว!', 'success');
          speak('ส่งครบทุกจุดแล้ว');
          stopNavigation();
          clearAllMarkersAndLayers();
          optimizedRoute = null;
          await loadDeliveryPoints();
          await loadCustomerOrders();
          await loadTodayStats();
        } else {
          addAlert('delivery', `ส่งสำเร็จ: ${deliveredPoint.name}`);
          currentTargetIndex = 1;
          arrivedPoints = [0];
          hasAnnouncedApproaching = false;
          if (currentLocation) {
            await recalculateRouteFromCurrentPosition();
          } else {
            updateNavigationMarkers();
          }
        }
        isProcessingDelivery = false;
        return;
      }

      const payload: any = {
        point_id: Number(deliveredPoint.id),
        point_name: String(deliveredPoint.name),
        address: deliveredPoint.address || '',
        lat: Number(deliveredPoint.lat),
        lng: Number(deliveredPoint.lng),
        notes: `ส่งสำเร็จ - ${new Date().toLocaleString('th-TH')}`
      };
      if (currentRouteId) payload.route_id = Number(currentRouteId);
      if (currentUser?.id) payload.driver_id = Number(currentUser.id);
      if (currentUser?.name) payload.driver_name = String(currentUser.name);

      const res = await fetch(`${API_URL}/deliveries/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const record: DeliveryRecord = {
        id: data.history_id || Date.now(),
        pointId: deliveredPoint.id,
        pointName: deliveredPoint.name,
        address: deliveredPoint.address || '',
        status: 'success',
        timestamp: new Date(),
        lat: deliveredPoint.lat,
        lng: deliveredPoint.lng
      };
      deliveryHistory = [...deliveryHistory, record];
      completedDeliveries++;

      const pointIdToRemove = deliveredPoint.id;
      optimizedRoute.optimized_order = optimizedRoute.optimized_order.filter((p: any) => p.id !== pointIdToRemove);
      deliveryPoints = deliveryPoints.filter((p: any) => p.id !== pointIdToRemove);

      const remainingDeliveryPoints = optimizedRoute.optimized_order.filter((p: any) => p.id !== -1);
      if (remainingDeliveryPoints.length === 0) {
        showNotification('🎉 ส่งครบทุกจุดแล้ว!', 'success');
        speak('ส่งครบทุกจุดแล้ว');
        stopNavigation();
        clearAllMarkersAndLayers();
        optimizedRoute = null;
        await loadDeliveryPoints();
        await loadCustomerOrders();
        await loadTodayStats();
      } else {
        showNotification(`✅ ส่ง ${deliveredPoint.name} สำเร็จ`, 'success');
        speak(`ส่ง ${deliveredPoint.name} สำเร็จ`);
        addAlert('delivery', `ส่งสำเร็จ: ${deliveredPoint.name}`);
        currentTargetIndex = 1;
        arrivedPoints = [0];
        hasAnnouncedApproaching = false;
        if (currentLocation) {
          await recalculateRouteFromCurrentPosition();
        } else {
          updateNavigationMarkers();
        }
      }
    } catch (err: any) {
      showNotification(`บันทึกไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
      isProcessingDelivery = false;
    }
  }

  async function skipToNextPoint() {
    if (isProcessingDelivery) {
      showNotification('กำลังประมวลผล...', 'warning');
      return;
    }
    if (!optimizedRoute?.optimized_order) {
      showNotification('ไม่มีเส้นทาง', 'error');
      return;
    }
    const skippedPoint = optimizedRoute.optimized_order[currentTargetIndex];
    if (!skippedPoint) {
      showNotification('ไม่พบจุดที่จะข้าม', 'error');
      return;
    }
    if (skippedPoint.isCustomerOrder) {
      showNotification('ไม่สามารถข้ามงานลูกค้าได้ - กรุณาส่งให้เสร็จ', 'error');
      return;
    }
    isProcessingDelivery = true;
    try {
      const payload: any = {
        point_id: Number(skippedPoint.id),
        point_name: String(skippedPoint.name),
        address: skippedPoint.address || '',
        lat: Number(skippedPoint.lat),
        lng: Number(skippedPoint.lng),
        notes: `ข้ามจุดส่ง - ${new Date().toLocaleString('th-TH')}`
      };
      if (currentRouteId) payload.route_id = Number(currentRouteId);
      if (currentUser?.id) payload.driver_id = Number(currentUser.id);
      if (currentUser?.name) payload.driver_name = String(currentUser.name);

      const res = await fetch(`${API_URL}/deliveries/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const record: DeliveryRecord = {
        id: data.history_id || Date.now(),
        pointId: skippedPoint.id,
        pointName: skippedPoint.name,
        address: skippedPoint.address || '',
        status: 'skipped',
        timestamp: new Date(),
        lat: skippedPoint.lat,
        lng: skippedPoint.lng
      };
      deliveryHistory = [...deliveryHistory, record];

      const pointIdToRemove = skippedPoint.id;
      optimizedRoute.optimized_order = optimizedRoute.optimized_order.filter((p: any) => p.id !== pointIdToRemove);
      deliveryPoints = deliveryPoints.filter((p: any) => p.id !== pointIdToRemove);

      const remainingDeliveryPoints = optimizedRoute.optimized_order.filter((p: any) => p.id !== -1);
      if (remainingDeliveryPoints.length === 0) {
        showNotification('🎉 ครบทุกจุดแล้ว!', 'success');
        speak('ครบทุกจุดแล้ว');
        stopNavigation();
        clearAllMarkersAndLayers();
        optimizedRoute = null;
        await loadDeliveryPoints();
        await loadCustomerOrders();
        await loadTodayStats();
      } else {
        showNotification(`⏭️ ข้าม ${skippedPoint.name}`, 'warning');
        addAlert('navigation', `ข้ามจุด: ${skippedPoint.name}`);
        currentTargetIndex = 1;
        arrivedPoints = [0];
        hasAnnouncedApproaching = false;
        if (currentLocation) {
          await recalculateRouteFromCurrentPosition();
        } else {
          updateNavigationMarkers();
        }
      }
    } catch (err: any) {
      showNotification(`ข้ามไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
      isProcessingDelivery = false;
    }
  }

  function updateRouteDisplayForNavigation() {
    if (!L || !map || !optimizedRoute?.route?.geometry) return;
    const fullRouteCoords: [number, number][] = optimizedRoute.route.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    let startIndex = 0;
    if (currentLocation) {
      let minStartDist = Infinity;
      fullRouteCoords.forEach((coord, idx) => {
        const dist = getDistance(currentLocation.lat, currentLocation.lng, coord[0], coord[1]);
        if (dist < minStartDist) {
          minStartDist = dist;
          startIndex = idx;
        }
      });
    }
    clearAllRouteLayers();
    if (traveledLayer) { traveledLayer.remove(); traveledLayer = null; }
    if (startIndex > 0) {
      const traveledCoords = fullRouteCoords.slice(0, startIndex + 1);
      traveledLayer = L.polyline(traveledCoords, { color: '#6b7280', weight: 5, opacity: 0.6, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    }
    const remainingCoords = fullRouteCoords.slice(startIndex);
    if (remainingCoords.length > 1) {
      remainingGlowLayer = L.polyline(remainingCoords, { color: '#00ff88', weight: 12, opacity: 0.3, lineCap: 'round', lineJoin: 'round' }).addTo(map);
      remainingRouteLayer = L.polyline(remainingCoords, { color: '#00ff88', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    }
  }

  function clearAllRouteLayers() {
    if (remainingRouteLayer && map.hasLayer(remainingRouteLayer)) { map.removeLayer(remainingRouteLayer); } remainingRouteLayer = null;
    if (remainingGlowLayer && map.hasLayer(remainingGlowLayer)) { map.removeLayer(remainingGlowLayer); } remainingGlowLayer = null;
    if (routeLayer && map.hasLayer(routeLayer)) { map.removeLayer(routeLayer); } routeLayer = null;
    if (glowLayer && map.hasLayer(glowLayer)) { map.removeLayer(glowLayer); } glowLayer = null;
  }

  function updateETA() {
    if (remainingDistance > 0 && currentSpeed > 5) {
      const hoursRemaining = (remainingDistance / 1000) / currentSpeed;
      const msRemaining = hoursRemaining * 3600 * 1000;
      estimatedArrivalTime = new Date(Date.now() + msRemaining);
    } else if (remainingDistance > 0) {
      const hoursRemaining = (remainingDistance / 1000) / 30;
      const msRemaining = hoursRemaining * 3600 * 1000;
      estimatedArrivalTime = new Date(Date.now() + msRemaining);
    }
  }

  function formatETA(date: Date | null): string {
    if (!date) return '--:--';
    return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  function updateFuelEstimate() {
    const distanceKm = remainingDistance / 1000;
    fuelConsumption = distanceKm / KM_PER_LITER;
    fuelCostEstimate = fuelConsumption * FUEL_PRICE_PER_LITER;
  }

  function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    showNotification(voiceEnabled ? 'เปิดเสียงนำทาง' : 'ปิดเสียงนำทาง', 'success');
  }

  function getGPSStatusColor(): string {
    switch (gpsStatus) {
      case 'excellent': return '#00ff88';
      case 'good': return '#ffd93d';
      case 'weak': return '#ffa502';
      case 'poor': return '#ff6b6b';
      default: return '#71717a';
    }
  }

  function getGPSStatusText(): string {
    switch (gpsStatus) {
      case 'excellent': return `GPS แม่นยำมาก (${Math.round(accuracy)}m)`;
      case 'good': return `GPS ปกติ (${Math.round(accuracy)}m)`;
      case 'weak': return `GPS อ่อน (${Math.round(accuracy)}m)`;
      case 'poor': return `GPS แย่มาก (${Math.round(accuracy)}m)`;
      default: return 'กำลังค้นหา GPS...';
    }
  }

  function getGPSIcon(): string {
    switch (gpsStatus) {
      case 'excellent': return '📡';
      case 'good': return '📶';
      case 'weak': return '📉';
      case 'poor': return '⚠️';
      default: return '🔍';
    }
  }

  function handleGeoError(error: GeolocationPositionError) {
    console.error('GPS Error:', error);
    let msg = 'ไม่สามารถระบุตำแหน่งได้';
    if (error.code === 1) msg = 'กรุณาอนุญาตการเข้าถึง GPS';
    if (error.code === 2) msg = 'ไม่สามารถระบุตำแหน่งได้';
    if (error.code === 3) msg = 'หมดเวลาการระบุตำแหน่ง';
    showNotification(msg, 'error');
  }

  function updateNavigationInfo() {
    if (!currentLocation || !optimizedRoute) return;
    const routeCoords: [number, number][] = optimizedRoute.route.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    const nearestIndex = findNearestPointIndex(routeCoords, currentLocation);
    let totalRemaining = 0;
    for (let i = nearestIndex; i < routeCoords.length - 1; i++) {
      totalRemaining += getDistance(routeCoords[i][0], routeCoords[i][1], routeCoords[i + 1][0], routeCoords[i + 1][1]);
    }
    remainingDistance = totalRemaining;
    remainingTime = (totalRemaining / 1000) / 30 * 3600;
    if (currentTargetIndex < optimizedRoute.optimized_order.length) {
      const target = optimizedRoute.optimized_order[currentTargetIndex];
      distanceToNextPoint = getDistance(currentLocation.lat, currentLocation.lng, target.lat, target.lng);
    }
  }

  function findNearestPointIndex(coords: [number, number][], location: { lat: number; lng: number }): number {
    let minDist = Infinity;
    let nearestIndex = 0;
    coords.forEach((coord, index) => {
      const dist = getDistance(location.lat, location.lng, coord[0], coord[1]);
      if (dist < minDist) {
        minDist = dist;
        nearestIndex = index;
      }
    });
    return nearestIndex;
  }

  function clearAllMarkersAndLayers() {
    if (markers && markers.length > 0) {
      markers.forEach((m) => {
        try { if (m && map) map.removeLayer(m); } catch(e) {}
      });
      markers = [];
    }
    if (routeLayer && map) { try { map.removeLayer(routeLayer); } catch(e) {} routeLayer = null; }
    if (glowLayer && map) { try { map.removeLayer(glowLayer); } catch(e) {} glowLayer = null; }
    if (remainingRouteLayer && map) { try { map.removeLayer(remainingRouteLayer); } catch(e) {} remainingRouteLayer = null; }
    if (remainingGlowLayer && map) { try { map.removeLayer(remainingGlowLayer); } catch(e) {} remainingGlowLayer = null; }
    if (traveledLayer && map) { try { map.removeLayer(traveledLayer); } catch(e) {} traveledLayer = null; }
    if (clickMarker && map) { try { map.removeLayer(clickMarker); } catch(e) {} clickMarker = null; }
    if (map && L) {
      map.eachLayer((layer: any) => {
        if (layer instanceof L.Marker && layer !== currentLocationMarker) {
          try { map.removeLayer(layer); } catch(e) {}
        }
      });
    }
  }

  function getCostEstimate(): number {
    return vehicleType === 'fuel' ? fuelCostEstimate : evCostEstimate;
  }

  function getCostLabel(): string {
    return vehicleType === 'fuel' ? 'ค่าน้ำมัน' : 'ค่าไฟฟ้า';
  }

  function getCostIcon(): string {
    return vehicleType === 'fuel' ? '⛽' : '🔋';
  }

  function getVehicleIcon(): string {
    return vehicleType === 'fuel' ? '🚗' : '🚙';
  }

  function clearChargingStations() {
    chargingStations = [];
    chargingStationMarkers.forEach(m => {
      try { map.removeLayer(m); } catch(e) {}
    });
    chargingStationMarkers = [];
    routeChargingStops = [];
    showNotification('ล้างสถานีชาร์จแล้ว', 'success');
  }

  function toggleVehicleType() {
    vehicleType = vehicleType === 'fuel' ? 'ev' : 'fuel';
    localStorage.setItem('vehicleType', vehicleType);
    showNotification(`เปลี่ยนเป็น${vehicleType === 'fuel' ? 'รถน้ำมัน' : 'รถไฟฟ้า'}`, 'success');
  }

  async function loadNearbyChargingStations() {
    let searchLat: number;
    let searchLng: number;

    if (currentLocation) {
      searchLat = currentLocation.lat;
      searchLng = currentLocation.lng;
    } else if (map) {
      const center = map.getCenter();
      searchLat = center.lat;
      searchLng = center.lng;
      showNotification('ค้นหาสถานีชาร์จบริเวณแผนที่', 'success');
    } else {
      searchLat = 13.7563;
      searchLng = 100.5018;
      showNotification('ค้นหาสถานีชาร์จในกรุงเทพฯ', 'success');
    }
    isLoadingStations = true;
    try {
      const res = await fetch(
        `${API_URL}/ev-stations/nearby?lat=${searchLat}&lng=${searchLng}&radius=100&limit=20`
      );
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      chargingStations = data;
      displayChargingStationMarkers();
      showNotification(`พบ ${chargingStations.length} สถานีชาร์จ`, 'success');
    } catch (err: any) {
      console.error('Error loading charging stations:', err);
      showNotification('ไม่สามารถโหลดสถานีชาร์จได้', 'error');
    } finally {
      isLoadingStations = false;
    }
  }

  function displayChargingStationMarkers() {
    if (!L || !map) return;

    chargingStationMarkers.forEach(m => {
      try { map.removeLayer(m); } catch(e) {}
    });
    chargingStationMarkers = [];
    if (!showChargingStations) return;
    chargingStations.forEach((station) => {
      const isRouteStop = routeChargingStops.some(s => s.id === station.id);
      const powerText = station.powerKW ? `${station.powerKW}kW` : '';

      const marker = L.marker([station.lat, station.lng], {
        icon: L.divIcon({
          className: 'ev-station-marker',
          html: `
            <div class="ev-pin ${isRouteStop ? 'route-stop' : ''} ${station.isOperational ? 'operational' : 'offline'}">
              <span class="ev-icon">⚡</span>
              ${isRouteStop ? `<span class="stop-number">${station.stopNumber}</span>` : ''}
              ${powerText ? `<span class="power-badge">${powerText}</span>` : ''}
            </div>
          `,
          iconSize: [48, 48],
          iconAnchor: [24, 48]
        })
      }).addTo(map);
      marker.bindPopup(`
        <div class="ev-popup">
          <div class="ev-popup-header">
            <span class="ev-icon-large">⚡</span>
            <div class="ev-status ${station.isOperational ? 'online' : 'offline'}">
              ${station.isOperational ? '🟢 เปิดให้บริการ' : '🔴 ปิดให้บริการ'}
            </div>
          </div>
          <div class="ev-popup-content">
            <h4>${station.name}</h4>
            <p class="ev-address">📍 ${station.address}</p>
            ${station.operator ? `<p class="ev-operator">🏢 ${station.operator}</p>` : ''}
            ${station.powerKW ? `<p class="ev-power">⚡ กำลังไฟ: ${station.powerKW} kW</p>` : ''}
            ${station.numberOfPoints ? `<p class="ev-points">🔌 หัวชาร์จ: ${station.numberOfPoints} จุด</p>` : ''}
            ${station.connectionTypes?.length ? `<p class="ev-connectors">🔗 ${station.connectionTypes.join(', ')}</p>` : ''}
            ${station.usageCost ? `<p class="ev-cost">💰 ${station.usageCost}</p>` : ''}
            ${station.distance ? `<p class="ev-distance">📏 ระยะทาง: ${(station.distance).toFixed(1)} km</p>` : ''}
          </div>
          ${isRouteStop ? `
            <div class="ev-route-stop-info">
              <span class="stop-badge">🛑 จุดพักชาร์จที่ ${station.stopNumber}</span>
              <span class="charging-time">⏱️ ~${station.estimatedChargingTime || 30} นาที</span>
            </div>
          ` : ''}
        </div>
      `, { className: 'dark-popup ev-dark-popup', maxWidth: 300 });
      chargingStationMarkers.push(marker);
    });
  }

  async function optimizeEVRoute() {
    if (allDeliveryPoints.length < 1) {
      showNotification('ต้องมีอย่างน้อย 1 จุดส่ง', 'error');
      return;
    }
    isOptimizing = true;
    try {
      const startPoint = await getCurrentLocationAsStart();
      const sortedPoints = sortByNearestNeighbor(startPoint, [...allDeliveryPoints]);

      const waypoints = [
        { lat: startPoint.lat, lng: startPoint.lng },
        ...sortedPoints.map((p: any) => ({ lat: p.lat, lng: p.lng }))
      ];

      const res = await fetch(`${API_URL}/route/ev-optimized`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waypoints,
          currentCharge: evCurrentCharge,
          batteryCapacity: evBatteryCapacity,
          rangePerCharge: evRangePerCharge,
          minChargeAtArrival: 15
        })
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }

      optimizedRoute = {
        route: { geometry: data.route.geometry },
        total_distance: data.route.distance,
        total_time: data.route.duration,
        optimized_order: [
          { ...startPoint, name: 'ตำแหน่งปัจจุบัน', address: 'จุดเริ่มต้นของคุณ', id: -1 },
          ...sortedPoints
        ]
      };
      remainingDistance = data.route.distance;
      remainingTime = data.route.duration;

      evBatteryAfterTrip = data.battery.estimatedChargeAtArrival;

      routeChargingStops = data.chargingStops || [];

      if (routeChargingStops.length > 0) {
        const existingIds = new Set(chargingStations.map(s => s.id));
        for (const stop of routeChargingStops) {
          if (!existingIds.has(stop.id)) {
            chargingStations = [...chargingStations, stop];
          }
        }
      }
      displayOptimizedRoute();
      displayChargingStationMarkers();

      if (data.battery.needsCharging && routeChargingStops.length > 0) {
        showNotification(
          `⚡ ต้องแวะชาร์จ ${routeChargingStops.length} จุด! แบตจะเหลือ ${data.battery.estimatedChargeAtArrival.toFixed(0)}%`,
          'warning'
        );
        speak(`ต้องแวะชาร์จ ${routeChargingStops.length} จุดระหว่างทาง`);
      } else if (data.battery.warningLevel === 'warning') {
        showNotification(
          `⚠️ แบตจะเหลือ ${data.battery.estimatedChargeAtArrival.toFixed(0)}% - ควรพิจารณาชาร์จ`,
          'warning'
        );
      } else {
        showNotification('คำนวณเส้นทาง EV สำเร็จ', 'success');
      }
      activeTab = 'route';
    } catch (err: any) {
      console.error('EV Route error:', err);
      showNotification(err.message || 'คำนวณเส้นทางไม่สำเร็จ', 'error');

      await optimizeRoute();
    } finally {
      isOptimizing = false;
    }
  }

  function toggleChargingStations() {
    showChargingStations = !showChargingStations;
    displayChargingStationMarkers();
  }

  function navigateToChargingStation(station: ChargingStation) {
    if (map) {
      map.flyTo([station.lat, station.lng], 16, { duration: 0.8 });
    }
    selectedChargingStation = station;
  }

  async function smartOptimizeRoute() {
    if (vehicleType === 'ev') {
      await optimizeEVRoute();
    } else {
      await optimizeRoute();
    }
  }

  function getEVBatteryColor(): string {
    if (evCurrentCharge > 50) return '#00ff88';
    if (evCurrentCharge > 20) return '#ffa502';
    return '#ff6b6b';
  }

  function isEVRangeSufficient(): boolean {
    return evRemainingRange >= (remainingDistance / 1000);
  }

  function saveVehicleSettings() {
    localStorage.setItem('vehicleType', vehicleType);
    localStorage.setItem('evCurrentCharge', String(evCurrentCharge));
    showNotification('บันทึกการตั้งค่ารถสำเร็จ', 'success');
  }

  function getTrafficColor(): string {
    switch (trafficStatus) {
      case 'heavy': return '#ff6b6b';
      case 'moderate': return '#ffa502';
      default: return '#00ff88';
    }
  }

  function getTrafficLabel(): string {
    switch (trafficStatus) {
      case 'heavy': return 'รถติดมาก';
      case 'moderate': return 'รถปานกลาง';
      default: return 'รถไม่ติด';
    }
  }

  function updateTrafficStatus() {
    const hour = new Date().getHours();
    if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19)) {
      trafficStatus = 'heavy';
    } else if ((hour >= 11 && hour <= 13)) {
      trafficStatus = 'moderate';
    } else {
      trafficStatus = 'smooth';
    }
  }

  function getWeatherIcon(): string {
    switch (weather.condition) {
      case 'sunny': return '☀️';
      case 'cloudy': return '☁️';
      case 'rainy': return '🌧️';
      default: return '🌤️';
    }
  }

  function getBatteryColor(): string {
    if (batteryLevel > 50) return '#00ff88';
    if (batteryLevel > 20) return '#ffa502';
    return '#ff6b6b';
  }

  function getPriorityGradient(p: number) {
    const colorMap: Record<number, { bg: string; glow: string }> = {
      1: { bg: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%)', glow: '#ff6b6b' },
      2: { bg: 'linear-gradient(135deg, #ffa502 0%, #ff7f00 100%)', glow: '#ffa502' },
      3: { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', glow: '#667eea' },
      4: { bg: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)', glow: '#a855f7' },
      5: { bg: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)', glow: '#6b7280' }
    };
    return colorMap[p] || colorMap[3];
  }

  function getPriorityLabel(p: number) {
    const labels: Record<number, string> = {
      1: 'ด่วนมาก',
      2: 'ด่วน',
      3: 'ปกติ',
      4: 'ไม่เร่ง',
      5: 'ยืดหยุ่น'
    };
    return labels[p] || 'ปกติ';
  }

  function showNotification(msg: string, type: 'success' | 'error' | 'warning') {
    notification = { show: true, message: msg, type };
    setTimeout(() => notification.show = false, 3500);
  }

  function focusOnPoint(lat: number, lng: number) {
    if (map) {
      map.flyTo([lat, lng], 16, { duration: 0.8 });
    }
  }


  function updateStatistics() {
    totalDeliveriesToday = deliveryPoints.length + getSuccessCount();
    if (navigationStartTime) {
      elapsedTime = Date.now() - navigationStartTime.getTime();
    }
    if (completedDeliveries > 0) {
      averageDeliveryTime = elapsedTime / completedDeliveries;
    }
  }

  async function updateBatteryStatus() {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      try {
        const battery: any = await (navigator as any).getBattery();
        batteryLevel = Math.round(battery.level * 100);
        isCharging = battery.charging;
      } catch (e) {}
    }
  }

  function exportRouteData() {
    const data = {
      driver: driverInfo,
      route: optimizedRoute,
      points: deliveryPoints,
      statistics: {
        totalPoints: totalDeliveriesToday,
        completed: completedDeliveries,
        totalDistance: optimizedRoute?.total_distance,
        totalTime: optimizedRoute?.total_time
      },
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `route-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('ส่งออกข้อมูลสำเร็จ', 'success');
  }

  function emergencyStop() {
    if (confirm('ต้องการหยุดฉุกเฉินใช่หรือไม่?')) {
      stopNavigation();
      addAlert('emergency', 'หยุดฉุกเฉิน!');
      speak('หยุดฉุกเฉิน');
      showNotification('หยุดฉุกเฉินแล้ว', 'error');
    }
  }

  function initExtraFeatures() {
    updateTrafficStatus();
    updateBatteryStatus();
    setInterval(() => {
      updateTrafficStatus();
      updateStatistics();
      updateETA();
      updateFuelEstimate();
    }, 60000);
    setInterval(updateBatteryStatus, 300000);
  }

  function cancelAddForm() {
    showAddForm = false;
    if (clickMarker) clickMarker.remove();
    newPoint = { name: '', address: '', lat: 13.7563, lng: 100.5018, priority: 3 };
  }

  function getSuccessCount(): number {
    return deliveryHistory.filter(d => d.status === 'success').length;
  }

  function getSkippedCount(): number {
    return deliveryHistory.filter(d => d.status === 'skipped').length;
  }

  function getRemainingPointsCount(): number {
    if (!optimizedRoute) return allDeliveryPoints.length;
    return optimizedRoute.optimized_order.filter((p: any) => p.id !== -1).length;
  }

  function formatHistoryTime(date: Date): string {
    return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  onMount(async () => {
    const userStr = localStorage.getItem('user');
    if (!userStr) { goto('/'); return; }
    currentUser = JSON.parse(userStr);
    const savedVehicleType = localStorage.getItem('vehicleType');
    if (savedVehicleType === 'ev' || savedVehicleType === 'fuel') {
      vehicleType = savedVehicleType;
    }
    const savedEVCharge = localStorage.getItem('evCurrentCharge');
    if (savedEVCharge) evCurrentCharge = parseFloat(savedEVCharge);
    const urlId = $page.params.id;
    if (Number(urlId) !== currentUser.id) { goto(`/Home/${currentUser.id}`); return; }

    try {
      L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      map = L.map('map', { zoomControl: false }).setView([13.7465, 100.5348], 12);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      const tileLayer = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB © OSM', maxZoom: 19,
        errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      }).addTo(map);
      tileLayer.on('tileerror', (error: any) => { setTimeout(() => { error.tile.src = error.tile.src; }, 1000); });
      setTimeout(() => map.invalidateSize(), 100);
      setTimeout(() => map.invalidateSize(), 500);
      setTimeout(() => map.invalidateSize(), 1000);

      window.addEventListener('resize', () => { setTimeout(() => map.invalidateSize(), 100); });
      map.on('click', (e: any) => {
        if (isNavigating) return;
        if (clickMarker) clickMarker.remove();
        newPoint.lat = parseFloat(e.latlng.lat.toFixed(6));
        newPoint.lng = parseFloat(e.latlng.lng.toFixed(6));
        clickMarker = L.marker([e.latlng.lat, e.latlng.lng], {
          icon: L.divIcon({ className: 'click-marker', html: `<div class="pulse-marker"></div>`, iconSize: [48, 48], iconAnchor: [24, 24] })
        }).addTo(map);
        showAddForm = true;
      });
      await loadDeliveryPoints();
      await loadCustomerOrders();
      await loadTodayStats();
      await loadDeliveryHistory();
      initExtraFeatures();
      initVoiceNavigation();
      setInterval(() => { loadCustomerOrders(); }, 30000);
    } catch (error) {
      console.error('Map init error:', error);
      showNotification('ไม่สามารถโหลดแผนที่ได้', 'error');
    }
  });

  onDestroy(() => { stopNavigation(); });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <title>คนขับรถ | Route Optimization</title>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</svelte:head>

<div class="app-container">
  <!-- Settings Panel -->
 {#if showSettings}
    <div class="settings-overlay" on:click={() => showSettings = false} on:keypress={() => {}} role="button" tabindex="-1">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div class="settings-panel glass-card" on:click|stopPropagation role="dialog">
        <div class="settings-header">
          <h3>⚙️ ตั้งค่า</h3>
          <button class="close-btn" on:click={() => showSettings = false}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        
        <div class="settings-content">
          <!-- Two Column Layout -->
          <div class="settings-grid">
            <!-- Left Column -->
            <div class="settings-column">
              <div class="settings-section">
                <h4>🚗 ข้อมูลคนขับ</h4>
                <div class="driver-card">
                  <div class="driver-avatar">{driverInfo.avatar}</div>
                  <div class="driver-details">
                    <div class="driver-name">{driverInfo.name}</div>
                    <div class="driver-id">{driverInfo.id} • {driverInfo.role === 'admin' ? '👑 Admin' : '🚗 Driver'}</div>
                    <div class="driver-vehicle">{driverInfo.vehicle} • {driverInfo.plateNumber}</div>
                    <div class="driver-phone">📞 {driverInfo.phone}</div>
                  </div>
                </div>
              </div>

              <div class="settings-section">
                <h4>{getVehicleIcon()} ประเภทรถ</h4>
                <div class="vehicle-type-selector">
                  <button 
                    class="vehicle-type-btn" 
                    class:active={vehicleType === 'fuel'}
                    on:click={() => { vehicleType = 'fuel'; saveVehicleSettings(); }}
                  >
                    <span class="vehicle-icon">🚗</span>
                    <span class="vehicle-label">รถน้ำมัน</span>
                  </button>
                  <button 
                    class="vehicle-type-btn" 
                    class:active={vehicleType === 'ev'}
                    on:click={() => { vehicleType = 'ev'; saveVehicleSettings(); }}
                  >
                    <span class="vehicle-icon">🚙</span>
                    <span class="vehicle-label">รถไฟฟ้า (EV)</span>
                  </button>
                </div>
                
                {#if vehicleType === 'fuel'}
                  <div class="vehicle-info-card fuel">
                    <div class="info-row">
                      <span class="info-icon">⛽</span>
                      <span class="info-text">ราคาน้ำมัน: {FUEL_PRICE_PER_LITER} ฿/ลิตร</span>
                    </div>
                    <div class="info-row">
                      <span class="info-icon">📊</span>
                      <span class="info-text">อัตราสิ้นเปลือง: {KM_PER_LITER} กม./ลิตร</span>
                    </div>
                  </div>
                {:else}
                  <div class="vehicle-info-card ev">
                    <div class="info-row">
                      <span class="info-icon">🔌</span>
                      <span class="info-text">ค่าไฟ: {ELECTRICITY_PRICE_PER_KWH} ฿/kWh</span>
                    </div>
                    <div class="info-row">
                      <span class="info-icon">📊</span>
                      <span class="info-text">กินไฟ: {KWH_PER_100KM} kWh/100กม.</span>
                    </div>
                    <div class="ev-battery-setting">
                      <label>🔋 แบตเตอรี่ปัจจุบัน: {evCurrentCharge}%</label>
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        bind:value={evCurrentCharge}
                        on:change={saveVehicleSettings}
                        class="ev-slider"
                      />
                      <div class="ev-range-info">
                        <span>ระยะทางเหลือ: <strong style="color: {getEVBatteryColor()}">{evRemainingRange.toFixed(0)} กม.</strong></span>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <!-- Right Column -->
            <div class="settings-column">
              <div class="settings-section">
                <h4>🔊 เสียง</h4>
                <label class="toggle-setting">
                  <span>เสียงนำทาง</span>
                  <button class="toggle-btn" class:active={voiceEnabled} on:click={toggleVoice}><div class="toggle-knob"></div></button>
                </label>
              </div>

              <div class="settings-section">
                <h4>🛒 งานลูกค้า</h4>
                <label class="toggle-setting">
                  <span>แสดงหมุดลูกค้าบนแผนที่</span>
                  <button class="toggle-btn" class:active={showCustomerOrders} on:click={() => { showCustomerOrders = !showCustomerOrders; displayCustomerMarkers(); }}><div class="toggle-knob"></div></button>
                </label>
                <label class="toggle-setting">
                  <span>รวมลูกค้าในเส้นทาง</span>
                  <button class="toggle-btn" class:active={includeCustomersInRoute} on:click={() => includeCustomersInRoute = !includeCustomersInRoute}><div class="toggle-knob"></div></button>
                </label>
              </div>
                <div class="settings-section">
                  <h4>⚡ สถานีชาร์จ EV</h4>
                  <label class="toggle-setting">
                    <span>แสดงสถานีชาร์จบนแผนที่</span>
                    <button class="toggle-btn" class:active={showChargingStations} on:click={toggleChargingStations}>
                      <div class="toggle-knob"></div>
                    </button>
                  </label>
                  <div class="ev-buttons">
                <button class="btn btn-ev-search" on:click={loadNearbyChargingStations} disabled={isLoadingStations}>
                  {#if isLoadingStations}
                    <div class="spinner-small"></div>
                    <span>กำลังค้นหา...</span>
                  {:else}
                    <span>🔍</span>
                    <span>ค้นหาสถานีชาร์จ (100กม.)</span>
                  {/if}
                </button>
                
                {#if chargingStations.length > 0}
                  <button class="btn btn-ev-clear" on:click={clearChargingStations}>
                    <span>🗑️</span>
                    <span>ล้าง ({chargingStations.length})</span>
                  </button>
                {/if}
              </div>
                </div>
            </div>
          </div>

          <!-- Full Width Actions -->
          <div class="settings-actions">
            <button class="btn btn-secondary" on:click={exportRouteData}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              ส่งออกข้อมูล
            </button>
            <button class="btn btn-danger" on:click={logout}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              ออกจากระบบ
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Alerts Panel -->
  {#if showAlerts}
    <div class="alerts-panel glass-card">
      <div class="alerts-header">
        <h3>🔔 การแจ้งเตือน</h3>
        <div class="alerts-actions">
          <button class="text-btn" on:click={clearAlerts}>ล้างทั้งหมด</button>
          <button class="close-btn" on:click={() => showAlerts = false}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="alerts-list">
        {#if alerts.length === 0}
          <div class="empty-alerts">ไม่มีการแจ้งเตือน</div>
        {:else}
          {#each alerts as alert}
            <div class="alert-item" class:alert-emergency={alert.type === 'emergency'}>
              <div class="alert-icon">
                {#if alert.type === 'delivery'}📦{:else if alert.type === 'navigation'}🧭{:else if alert.type === 'break'}☕{:else if alert.type === 'emergency'}🚨{:else}📢{/if}
              </div>
              <div class="alert-content">
                <div class="alert-message">{alert.message}</div>
                <div class="alert-time">{alert.time.toLocaleTimeString('th-TH')}</div>
              </div>
              <button class="dismiss-btn" on:click={() => dismissAlert(alert.id)}>×</button>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- Notification Toast -->
  {#if notification.show}
    <div class="toast" class:toast-success={notification.type === 'success'} class:toast-error={notification.type === 'error'} class:toast-warning={notification.type === 'warning'}>
      <div class="toast-icon">
        {#if notification.type === 'success'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
        {/if}
      </div>
      <span>{notification.message}</span>
    </div>
  {/if}

  <!-- Navigation Overlay -->
  {#if isNavigating}
    <div class="nav-overlay">
      <div class="nav-status-bar">
        <div class="status-item"><span class="status-icon">{getWeatherIcon()}</span><span>{weather.temp}°C</span></div>
        <div class="status-item" style="color: {getTrafficColor()}"><span class="status-icon">🚦</span><span>{getTrafficLabel()}</span></div>
        <div class="status-item" style="color: {getBatteryColor()}"><span class="status-icon">{isCharging ? '⚡' : '🔋'}</span><span>{batteryLevel}%</span></div>
        <div class="status-item" style="color: {getGPSStatusColor()}"><span class="status-icon">{getGPSIcon()}</span><span>{getGPSStatusText()}</span></div>
      </div>

      <div class="nav-top-bar glass-card">
        <div class="nav-target-info">
          <div class="nav-target-label">เป้าหมายถัดไป</div>
          <div class="nav-target-name">
            {#if currentTargetIndex < optimizedRoute?.optimized_order?.length}{optimizedRoute.optimized_order[currentTargetIndex].name}{:else}ถึงจุดหมายแล้ว{/if}
          </div>
          <div class="nav-eta">ถึงเวลา: <strong>{formatETA(estimatedArrivalTime)}</strong></div>
        </div>
        <div class="nav-distance-badge"><span class="nav-distance-value">{formatDistance(distanceToNextPoint)}</span></div>
      </div>

      <div class="speed-display glass-card">
        <div class="speed-value">{Math.round(currentSpeed)}</div>
        <div class="speed-unit">km/h</div>
        <div class="speed-max">สูงสุด: {Math.round(maxSpeed)} km/h</div>
      </div>

      {#if vehicleType === 'ev'}
          <div class="ev-status-display glass-card">
            <div class="ev-battery-visual">
              <div class="ev-battery-fill" style="width: {evBatteryAfterTrip}%; background: {getEVBatteryColor()}"></div>
            </div>
            <div class="ev-info">
              <span class="ev-percent" style="color: {getEVBatteryColor()}">{evBatteryAfterTrip.toFixed(0)}%</span>
              <span class="ev-label">หลังจบเส้นทาง</span>
            </div>
            {#if !isEVRangeSufficient()}
              <div class="ev-warning">⚠️ แบตอาจไม่พอ!</div>
            {/if}
          </div>
        {/if}

      <div class="today-stats glass-card">
        <div class="today-stat"><span class="stat-icon">✅</span><span class="stat-value">{getSuccessCount()}</span><span class="stat-label">ส่งแล้ว</span></div>
        <div class="today-stat"><span class="stat-icon">📦</span><span class="stat-value">{getRemainingPointsCount()}</span><span class="stat-label">รอส่ง</span></div>
      </div>

      <div class="nav-bottom-panel glass-card" class:hide-on-history={showHistory}>
        <div class="nav-stats">
          <div class="nav-stat">
            <div class="nav-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg></div>
            <div class="nav-stat-content"><div class="nav-stat-value">{formatDistance(remainingDistance)}</div><div class="nav-stat-label">ระยะทางเหลือ</div></div>
          </div>
          <div class="nav-stat">
            <div class="nav-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
            <div class="nav-stat-content"><div class="nav-stat-value">{formatTime(remainingTime)}</div><div class="nav-stat-label">เวลาเหลือ</div></div>
          </div>
          <div class="nav-stat">
            <div class="nav-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
            <div class="nav-stat-content"><div class="nav-stat-value">{getSuccessCount()}/{getSuccessCount() + getRemainingPointsCount()}</div><div class="nav-stat-label">เสร็จแล้ว</div></div>
          </div>
          <div class="nav-stat" class:ev-stat={vehicleType === 'ev'}>
              <div class="nav-stat-icon">{getCostIcon()}</div>
              <div class="nav-stat-content">
                <div class="nav-stat-value">฿{Math.round(getCostEstimate())}</div>
                <div class="nav-stat-label">{getCostLabel()}</div>
              </div>
            </div>
        </div>

        <div class="nav-progress">
          <div class="nav-progress-bar">
            <div class="nav-progress-fill" style="width: {(getSuccessCount() + getRemainingPointsCount()) > 0 ? (getSuccessCount() / (getSuccessCount() + getRemainingPointsCount())) * 100 : 0}%"></div>
          </div>
        </div>

        <div class="nav-actions">
          <button class="nav-btn nav-btn-success" on:click={markDeliverySuccess} disabled={isProcessingDelivery || getRemainingPointsCount() === 0}>
            {#if isProcessingDelivery}<div class="spinner-small"></div>{:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>{/if}
            ส่งสำเร็จ
          </button>
          <button class="nav-btn nav-btn-skip" on:click={skipToNextPoint} disabled={isProcessingDelivery || getRemainingPointsCount() === 0}>
            {#if isProcessingDelivery}<div class="spinner-small"></div>{:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>{/if}
            ข้าม
          </button>
          <button class="nav-btn nav-btn-history" on:click={() => showHistory = !showHistory}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            {#if deliveryHistory.length > 0}<span class="history-badge">{deliveryHistory.length}</span>{/if}
          </button>
          <button class="nav-btn nav-btn-voice" class:active={voiceEnabled} on:click={toggleVoice}>
            {#if voiceEnabled}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>{:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>{/if}
          </button>
          <button class="nav-btn nav-btn-center" on:click={centerOnCurrentLocation}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4m10-10h-4M6 12H2"/></svg>
          </button>
          <button class="nav-btn nav-btn-stop" on:click={stopNavigation}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            หยุด
          </button>
        </div>

        {#if isOnBreak}<div class="break-indicator">☕ กำลังพักเบรค ({formatBreakTime()})</div>{/if}
      </div>

      {#if showHistory}
        <div class="history-panel glass-card">
          <div class="history-header">
            <h4>📋 ประวัติการส่ง</h4>
            <div class="history-stats"><span class="history-stat success">✅ {getSuccessCount()}</span><span class="history-stat skipped">⏭️ {getSkippedCount()}</span></div>
            <button class="close-btn" on:click={() => showHistory = false}>×</button>
          </div>
          <div class="history-list">
            {#if deliveryHistory.length === 0}<div class="history-empty">ยังไม่มีประวัติการส่ง</div>
            {:else}
              {#each [...deliveryHistory].reverse() as record}
                <div class="history-item" class:success={record.status === 'success'} class:skipped={record.status === 'skipped'}>
                  <div class="history-icon">{record.status === 'success' ? '✅' : '⏭️'}</div>
                  <div class="history-info"><div class="history-name">{record.pointName}</div><div class="history-address">{record.address}</div></div>
                  <div class="history-time">{formatHistoryTime(record.timestamp)}</div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}

      <button class="emergency-btn" on:click={emergencyStop}>🚨 ฉุกเฉิน</button>
    </div>
  {/if}

  <!-- Sidebar -->
  {#if !isNavigating}
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg></div>
          <div class="logo-text"><h1>Route Optimization</h1><span>ระบบคำนวณระยะทางสุดเจ๋ง</span></div>
        </div>
        <div class="header-actions">
          <button class="icon-btn" on:click={() => showAlerts = !showAlerts} title="การแจ้งเตือน">🔔{#if alerts.length > 0}<span class="badge">{alerts.length}</span>{/if}</button>
          <button class="icon-btn" on:click={() => showSettings = true} title="ตั้งค่า">⚙️</button>
        </div>
      </div>
      {#if isMultiSelectMode}
        <div class="multi-select-toolbar">
          <span>{selectedPoints.length} รายการที่เลือก</span>
          <div class="multi-select-actions">
            <button class="text-btn" on:click={selectAllPoints}>เลือกทั้งหมด</button>
            <button class="text-btn" on:click={deselectAllPoints}>ยกเลิกทั้งหมด</button>
            <button class="text-btn danger" on:click={deleteSelectedPoints}>ลบที่เลือก</button>
          </div>
        </div>
      {/if}

      <div class="action-buttons">
        <button class="btn btn-primary" on:click={optimizeRoute} disabled={isOptimizing || allDeliveryPoints.length < 1}>
          {#if isOptimizing}<div class="spinner"></div><span>กำลังคำนวณ...</span>
          {:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg><span>คำนวณเส้นทาง ({allDeliveryPoints.length} จุด)</span>{/if}
        </button>
        {#if optimizedRoute}
          <button class="btn btn-navigate" on:click={startNavigation}><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg><span>เริ่มนำทาง</span></button>
          <button class="btn btn-ghost" on:click={clearRoute}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg><span>ล้างเส้นทาง</span></button>
        {/if}
        {#if !optimizedRoute}
          <button class="btn btn-secondary" on:click={() => showAddForm = !showAddForm}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg><span>เพิ่มจุดส่ง</span></button>
          <button class="btn btn-ghost" on:click={toggleMultiSelect}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg><span>{isMultiSelectMode ? 'ยกเลิกเลือก' : 'เลือกหลายรายการ'}</span></button>
        {/if}
      </div>

      {#if showAddForm && !optimizedRoute}
        <div class="add-form-overlay">
          <div class="add-form glass-card">
            <div class="form-header"><h3>เพิ่มจุดส่งใหม่</h3><button class="close-btn" on:click={cancelAddForm}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg></button></div>
            <p class="form-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"/></svg>คลิกบนแผนที่เพื่อเลือกตำแหน่ง</p>
            <form on:submit|preventDefault={addDeliveryPoint}>
              <div class="form-group"><label>ชื่อสถานที่</label><input type="text" bind:value={newPoint.name} placeholder="เช่น บ้านลูกค้า A" required /></div>
              <div class="form-group"><label>ที่อยู่</label><textarea bind:value={newPoint.address} placeholder="รายละเอียดที่อยู่..." rows="2" required></textarea></div>
              <div class="form-group coords-group">
                <div class="coord-input"><label>Latitude</label><input type="text" value={newPoint.lat} readonly /></div>
                <div class="coord-input"><label>Longitude</label><input type="text" value={newPoint.lng} readonly /></div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>บันทึก</button>
                <button type="button" class="btn btn-ghost" on:click={cancelAddForm}>ยกเลิก</button>
              </div>
            </form>
          </div>
        </div>
      {/if}
        <div class="vehicle-quick-toggle">
            <button 
              class="vehicle-toggle-btn" 
              class:fuel={vehicleType === 'fuel'}
              class:ev={vehicleType === 'ev'}
              on:click={toggleVehicleType}
            >
              <span class="toggle-icon">{getVehicleIcon()}</span>
              <span class="toggle-text">{vehicleType === 'fuel' ? 'รถน้ำมัน' : 'รถไฟฟ้า'}</span>
              {#if vehicleType === 'ev'}
                <span class="ev-charge-badge" style="background: {getEVBatteryColor()}">{evCurrentCharge}%</span>
              {/if}
            </button>
          </div>
      <div class="tabs">
        <button class="tab" class:active={activeTab === 'points'} on:click={() => activeTab = 'points'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>จุดส่ง ({deliveryPoints.length})</button>
        <button class="tab" class:active={activeTab === 'customers'} on:click={() => activeTab = 'customers'}>🛒 ลูกค้า ({customerOrders.length})</button>
        <button class="tab" class:active={activeTab === 'route'} on:click={() => activeTab = 'route'} disabled={!optimizedRoute}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>เส้นทาง</button>
      </div>

      <div class="content-area">
        {#if activeTab === 'points'}
          <div class="points-list">
            {#if filteredPoints.length === 0}
              <div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg></div><h4>ยังไม่มีจุดส่ง</h4><p>คลิกบนแผนที่หรือกดปุ่ม "เพิ่มจุดส่ง"</p></div>
            {:else}
              {#each filteredPoints as point, i}
                {@const colors = getPriorityGradient(point.priority)}
                <div id="point-{point.id}" class="point-card" class:active={activePointId === point.id} class:selected={selectedPoints.includes(point.id)} on:click={() => { if (isMultiSelectMode) { togglePointSelection(point.id); } else { activePointId = point.id; focusOnPoint(point.lat, point.lng); } }} on:keypress={(e) => e.key === 'Enter' && focusOnPoint(point.lat, point.lng)} role="button" tabindex="0">
                  {#if isMultiSelectMode}<div class="checkbox" class:checked={selectedPoints.includes(point.id)}>{#if selectedPoints.includes(point.id)}✓{/if}</div>{/if}
                  <div class="point-number" style="background: {colors.bg}; box-shadow: 0 0 15px {colors.glow}40;">{i + 1}</div>
                  <div class="point-info">
                    <h4 class="point-name">{point.name}</h4>
                    <p class="point-address">{point.address}</p>
                    <div class="point-meta">
                      <span class="priority-tag" style="background: {colors.bg}">P{point.priority} · {getPriorityLabel(point.priority)}</span>
                      {#if currentLocation}<span class="distance-tag">📍 {formatDistance(getDistance(currentLocation.lat, currentLocation.lng, point.lat, point.lng))}</span>{/if}
                    </div>
                  </div>
                  <button class="delete-btn" on:click|stopPropagation={() => deletePoint(point.id, point.name)} title="ลบจุดนี้"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                </div>
              {/each}
            {/if}
          </div>
        {:else if activeTab === 'customers'}
          <div class="customer-orders-section">
            <div class="section-header">
              <h3>🛒 งานจากลูกค้า ({customerOrders.length})</h3>
              <button class="toggle-btn-small" on:click={() => { showCustomerOrders = !showCustomerOrders; displayCustomerMarkers(); }}>{showCustomerOrders ? '👁️' : '🙈'}</button>
            </div>
            {#if customerOrders.length === 0}
              <div class="empty-state"><div class="empty-icon">🛒</div><h4>ยังไม่มีงานจากลูกค้า</h4><p>รอลูกค้าส่งคำสั่งซื้อ</p></div>
            {:else}
              <div class="customer-orders-list">
                {#each customerOrders as order}
                  <div class="customer-order-card" class:accepted={order.status === 'accepted'}>
                    <div class="order-customer">
                      <span class="avatar">{order.customer_avatar || '👤'}</span>
                      <div class="info"><div class="name">{order.customer_name}</div><div class="phone">📞 {order.customer_phone || '-'}</div></div>
                      <span class="order-status-badge" class:pending={order.status === 'pending'} class:accepted={order.status === 'accepted'}>{order.status === 'pending' ? '⏳ รอรับ' : order.status === 'accepted' ? '✅ รับแล้ว' : '🎉 เสร็จ'}</span>
                    </div>
                    <div class="order-address">{order.address}</div>
                    {#if order.notes}<div class="order-notes">📝 {order.notes}</div>{/if}
                    <div class="order-payment">
                      <div class="payment-amount"><span class="amount-label">ยอดเงิน</span><span class="amount-value">฿{(order.total_amount || 50).toLocaleString()}</span></div>
                      <div class="payment-details">
                        <span class="payment-method">{getPaymentMethodText(order.payment_method || 'cash')}</span>
                        <span class="payment-status" style="color: {getPaymentStatusColor(order.payment_status || 'pending')}">{getPaymentStatusText(order.payment_status || 'pending')}</span>
                      </div>
                    </div>
                    <div class="order-actions">
                      {#if order.status === 'pending'}<button class="btn-accept" on:click={() => acceptCustomerOrder(order.id)}>✅ รับงาน</button>
                      {:else if order.status === 'accepted'}
                        {#if order.payment_method === 'cash' && (order.payment_status === 'pending' || !order.payment_status)}<button class="btn-cash" on:click={() => confirmCashPayment(order.id)}>💵 รับเงินแล้ว</button>{/if}
                        <button class="btn-complete" on:click={() => completeCustomerOrder(order.id)}>🎉 เสร็จงาน</button>
                      {:else}<span class="completed-text">✅ เสร็จแล้ว</span>{/if}
                      <button class="btn-locate" on:click={() => focusOnPoint(order.lat, order.lng)}>📍 ดูบนแผนที่</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            {#if getAcceptedCustomerOrdersCount() > 0}
              <div class="customer-route-toggle">
                <label class="toggle-setting"><span>รวมลูกค้า ({getAcceptedCustomerOrdersCount()}) ในเส้นทาง</span>
                  <button class="toggle-btn" class:active={includeCustomersInRoute} on:click={() => includeCustomersInRoute = !includeCustomersInRoute}><div class="toggle-knob"></div></button>
                </label>
              </div>
            {/if}
          </div>
        {:else if activeTab === 'route' && optimizedRoute}
          <div class="route-summary">
              <div class="summary-header">
                <h3>สรุปเส้นทาง</h3>
                <span class="route-badge" class:ev-badge={vehicleType === 'ev'}>
                  {vehicleType === 'ev' ? '⚡ เส้นทาง EV' : '⛽ เส้นทางที่ดีที่สุด'}
                </span>
              </div>
              
              <div class="summary-stats">
                <!-- ระยะทาง -->
                <div class="stat-card">
                  <div class="stat-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
                    </svg>
                  </div>
                  <div class="stat-value">{(optimizedRoute.total_distance / 1000).toFixed(1)}</div>
                  <div class="stat-label">กิโลเมตร</div>
                </div>
                
                <!-- เวลา -->
                <div class="stat-card">
                  <div class="stat-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                    </svg>
                  </div>
                  <div class="stat-value">{Math.round(optimizedRoute.total_time / 60)}</div>
                  <div class="stat-label">นาที</div>
                </div>
                
                <!-- จุดส่ง -->
                <div class="stat-card">
                  <div class="stat-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                      <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                  </div>
                  <div class="stat-value">{optimizedRoute.optimized_order.filter((p: any) => p.id !== -1).length}</div>
                  <div class="stat-label">จุดส่ง</div>
                </div>
                
                <!-- ค่าใช้จ่าย - แสดงตามประเภทรถ -->
                {#if vehicleType === 'fuel'}
                  <div class="stat-card fuel">
                    <div class="stat-icon">⛽</div>
                    <div class="stat-value">฿{Math.round((optimizedRoute.total_distance / 1000) / KM_PER_LITER * FUEL_PRICE_PER_LITER)}</div>
                    <div class="stat-label">ค่าน้ำมัน</div>
                  </div>
                {:else}
                  <div class="stat-card ev">
                    <div class="stat-icon">⚡</div>
                    <div class="stat-value">฿{Math.round(evCostEstimate)}</div>
                    <div class="stat-label">ค่าไฟฟ้า</div>
                  </div>
                {/if}
              </div>

              <!-- ข้อมูลเพิ่มเติมตามประเภทรถ -->
              {#if vehicleType === 'fuel'}
                <div class="fuel-route-info">
                  <div class="fuel-info-row">
                    <span>⛽ ใช้น้ำมัน:</span>
                    <strong>{((optimizedRoute.total_distance / 1000) / KM_PER_LITER).toFixed(1)} ลิตร</strong>
                  </div>
                  <div class="fuel-info-row">
                    <span>💰 ราคาน้ำมัน:</span>
                    <strong>{FUEL_PRICE_PER_LITER} ฿/ลิตร</strong>
                  </div>
                  <div class="fuel-info-row">
                    <span>📊 อัตราสิ้นเปลือง:</span>
                    <strong>{KM_PER_LITER} กม./ลิตร</strong>
                  </div>
                </div>
              {:else}
                <div class="ev-route-info" class:warning={!isEVRangeSufficient()}>
                  <div class="ev-info-row">
                    <span>🔋 แบตปัจจุบัน:</span>
                    <strong style="color: {getEVBatteryColor()}">{evCurrentCharge}%</strong>
                  </div>
                  <div class="ev-info-row">
                    <span>📍 ระยะวิ่งได้:</span>
                    <strong>{evRemainingRange.toFixed(0)} กม.</strong>
                  </div>
                  <div class="ev-info-row">
                    <span>⚡ ใช้พลังงาน:</span>
                    <strong>{evEnergyConsumption.toFixed(1)} kWh</strong>
                  </div>
                  <div class="ev-info-row">
                    <span>🔋 แบตหลังจบ:</span>
                    <strong style="color: {evBatteryAfterTrip > 20 ? '#00ff88' : '#ff6b6b'}">{evBatteryAfterTrip.toFixed(0)}%</strong>
                  </div>
                  {#if !isEVRangeSufficient()}
                    <div class="ev-warning-banner">
                      ⚠️ ระยะทางมากกว่าแบตเตอรี่ที่เหลือ! อาจต้องชาร์จระหว่างทาง
                    </div>
                  {/if}
                </div>
              {/if}
              
            <div class="route-timeline">
              <h4>ลำดับการเดินทาง</h4>
              {#each optimizedRoute.optimized_order as point, i}
                {@const isStart = point.id === -1}
                {@const isCustomer = point.isCustomerOrder}
                <div class="timeline-item" class:start={isStart} class:customer={isCustomer} on:click={() => focusOnPoint(point.lat, point.lng)} on:keypress={(e) => e.key === 'Enter' && focusOnPoint(point.lat, point.lng)} role="button" tabindex="0">
                  <div class="timeline-marker"><span>{isStart ? '📍' : isCustomer ? '🛒' : i}</span></div>
                  <div class="timeline-content"><div class="timeline-label">{isStart ? 'ตำแหน่งของคุณ' : isCustomer ? 'ลูกค้า' : `จุดที่ ${i}`}</div><div class="timeline-name">{point.name}</div></div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="sidebar-footer"><span>RouteFlow v2.0</span><span>GPS Navigation</span></div>
    </aside>
  {/if}

  <div class="map-container" class:fullscreen={isNavigating}>
    <div id="map"></div>
    {#if !isNavigating}
      <div class="map-stats glass-card">
        <div class="map-stat"><span class="map-stat-value">{deliveryPoints.length}</span><span class="map-stat-label">จุดส่ง</span></div>
        <div class="map-stat"><span class="map-stat-value">{getAcceptedCustomerOrdersCount()}</span><span class="map-stat-label">ลูกค้า</span></div>
        <div class="map-stat"><span class="map-stat-value">{getSuccessCount()}</span><span class="map-stat-label">เสร็จแล้ว</span></div>
        <div class="map-stat weather"><span class="map-stat-value">{getWeatherIcon()} {weather.temp}°</span><span class="map-stat-label">อากาศ</span></div>
      </div>
    {/if}
    {#if !isNavigating && !optimizedRoute}
      <div class="map-info glass-card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>คลิกที่แผนที่เพื่อเพิ่มจุดส่ง</span></div>
    {/if}
  </div>
</div>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { font-family: 'Kanit', sans-serif; background: #0a0a0f; color: #e4e4e7; overflow: hidden; }

  .app-container { display: flex; height: 100vh; width: 100vw; background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%); }

  .sidebar { width: 500px; background: rgba(15, 15, 25, 0.95); backdrop-filter: blur(20px); border-right: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; z-index: 10; }
  .sidebar-header { padding: 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); display: flex; justify-content: space-between; align-items: center; }

  .logo { display: flex; align-items: center; gap: 14px; }
  .logo-icon { width: 48px; height: 48px; background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); border-radius: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 30px rgba(0, 255, 136, 0.3); }
  .logo-icon svg { width: 26px; height: 26px; color: #0a0a0f; }
  .logo-text h1 { font-size: 22px; font-weight: 700; background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .logo-text span { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 2px; }

  .stats-badge { display: flex; flex-direction: column; align-items: center; background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.2); border-radius: 12px; padding: 10px 18px; }
  .stats-number { font-size: 24px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .stats-label { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 1px; }

  .action-buttons { padding: 20px 24px; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }

  .btn { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 14px 20px; border-radius: 12px; font-family: 'Kanit', sans-serif; font-size: 15px; font-weight: 500; cursor: pointer; transition: all 0.3s ease; border: none; outline: none; }
  .btn svg { width: 20px; height: 20px; }
  .btn-primary { background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); color: #0a0a0f; box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3); }
  .btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 30px rgba(0, 255, 136, 0.4); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .btn-navigate { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; box-shadow: 0 4px 20px rgba(59, 130, 246, 0.3); }
  .btn-navigate:hover { transform: translateY(-2px); box-shadow: 0 6px 30px rgba(59, 130, 246, 0.4); }
  .btn-secondary { background: rgba(102, 126, 234, 0.15); color: #818cf8; border: 1px solid rgba(102, 126, 234, 0.3); }
  .btn-secondary:hover { background: rgba(102, 126, 234, 0.25); border-color: rgba(102, 126, 234, 0.5); }
  .btn-ghost { background: rgba(255, 255, 255, 0.05); color: #a1a1aa; border: 1px solid rgba(255, 255, 255, 0.1); }
  .btn-ghost:hover { background: rgba(255, 255, 255, 0.1); color: #e4e4e7; }

  .spinner { width: 20px; height: 20px; border: 2px solid rgba(10, 10, 15, 0.3); border-top-color: #0a0a0f; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

    .glass-card { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; }
    .ev-buttons {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .ev-buttons .btn {
      flex: 1;
    }

    .btn-ev-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 12px;
      background: rgba(255, 107, 107, 0.15);
      border: 1px solid rgba(255, 107, 107, 0.3);
      border-radius: 10px;
      color: #ff6b6b;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-ev-clear:hover {
      background: rgba(255, 107, 107, 0.25);
    }
  .add-form { margin: 0 16px 300px; padding: 16px; animation: slideIn 0.3s ease; }
  .add-form-overlay { display: contents; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
  .form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .form-header h3 { font-size: 16px; font-weight: 600; color: #e4e4e7; }
  .close-btn { width: 32px; height: 32px; border-radius: 8px; background: rgba(255, 255, 255, 0.05); border: none; color: #71717a; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
  .close-btn:hover { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }
  .close-btn svg { width: 16px; height: 16px; }
  .form-hint { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #71717a; margin-bottom: 20px; }
  .form-hint svg { width: 16px; height: 16px; color: #00ff88; }
  .form-group { margin-bottom: 16px; }
  .form-group label { display: block; font-size: 12px; font-weight: 500; color: #a1a1aa; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .form-group input, .form-group textarea { width: 100%; padding: 12px 16px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 14px; transition: all 0.2s; resize: none; }
  .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #00ff88; box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1); }
  .form-group input::placeholder, .form-group textarea::placeholder { color: #52525b; }
  .coords-group { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .coord-input input { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 13px; background: rgba(0, 0, 0, 0.5); color: #71717a; }
  .priority-selector { display: flex; flex-wrap: wrap; gap: 8px; }
  .priority-btn { flex: 1 1 auto; min-width: 50px; max-width: 70px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 4px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); border: 2px solid transparent; cursor: pointer; transition: all 0.2s; }
  .priority-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .priority-btn.active { background: var(--btn-bg); border-color: rgba(255, 255, 255, 0.3); box-shadow: 0 0 20px color-mix(in srgb, var(--btn-glow) 40%, transparent); }
  .priority-num { font-size: 18px; font-weight: 700; color: #e4e4e7; }
  .priority-btn.active .priority-num { color: white; }
  .priority-label { font-size: 9px; color: #71717a; margin-top: 2px; }
  .priority-btn.active .priority-label { color: rgba(255, 255, 255, 0.8); }
  .form-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }

  .tabs { display: flex; padding: 0 24px; gap: 8px; margin-bottom: 16px; }
  .tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); color: #71717a; font-family: 'Kanit', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
  .tab svg { width: 18px; height: 18px; }
  .tab:hover:not(:disabled) { background: rgba(255, 255, 255, 0.05); color: #a1a1aa; }
  .tab.active { background: rgba(0, 255, 136, 0.1); border-color: rgba(0, 255, 136, 0.3); color: #00ff88; }
  .tab:disabled { opacity: 0.4; cursor: not-allowed; }

  .content-area { flex: 1; overflow-y: auto; padding: 0 24px; }
  .content-area::-webkit-scrollbar { width: 6px; }
  .content-area::-webkit-scrollbar-track { background: transparent; }
  .content-area::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }

  .empty-state { text-align: center; padding: 60px 20px; }
  .empty-icon { width: 80px; height: 80px; margin: 0 auto 20px; background: rgba(255, 255, 255, 0.03); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .empty-icon svg { width: 40px; height: 40px; color: #3f3f46; }
  .empty-state h4 { font-size: 16px; color: #71717a; margin-bottom: 8px; }
  .empty-state p { font-size: 13px; color: #52525b; }

  .points-list { display: flex; flex-direction: column; gap: 10px; padding-bottom: 20px; }
  .point-card { display: flex; align-items: flex-start; gap: 14px; padding: 16px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 14px; cursor: pointer; transition: all 0.2s; }
  .point-card:hover { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); transform: translateX(4px); }
  .point-card.active { background: rgba(0, 255, 136, 0.08); border-color: rgba(0, 255, 136, 0.3); box-shadow: 0 0 20px rgba(0, 255, 136, 0.1); }
  .point-number { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; color: white; flex-shrink: 0; }
  .point-info { flex: 1; min-width: 0; }
  .point-info h4 { font-size: 14px; font-weight: 600; color: #e4e4e7; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .point-info p { font-size: 12px; color: #71717a; margin-bottom: 10px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .point-meta { display: flex; align-items: center; gap: 8px; }
  .priority-tag { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; color: white; }
  .delete-btn { width: 36px; height: 36px; border-radius: 10px; background: transparent; border: none; color: #52525b; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0; transition: all 0.2s; flex-shrink: 0; }
  .point-card:hover .delete-btn { opacity: 1; }
  .delete-btn:hover { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
  .delete-btn svg { width: 18px; height: 18px; }

  .route-summary { padding-bottom: 20px; }
  .summary-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .summary-header h3 { font-size: 16px; font-weight: 600; }
  .route-badge { padding: 6px 12px; background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.3); border-radius: 20px; font-size: 11px; font-weight: 500; color: #00ff88; }
  .summary-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 14px; padding: 16px; text-align: center; }
  .stat-icon { width: 40px; height: 40px; margin: 0 auto 10px; background: rgba(0, 255, 136, 0.1); border-radius: 10px; display: flex; align-items: center; justify-content: center; }
  .stat-icon svg { width: 20px; height: 20px; color: #00ff88; }
  .stat-value { font-size: 28px; font-weight: 700; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; line-height: 1; margin-bottom: 4px; }
  .stat-label { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; }
  .route-timeline h4 { font-size: 13px; font-weight: 600; color: #a1a1aa; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
  .timeline-item { display: flex; align-items: flex-start; gap: 14px; padding: 14px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; }
  .timeline-item:hover { background: rgba(255, 255, 255, 0.05); transform: translateX(4px); }
  .timeline-item.start .timeline-marker { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); box-shadow: 0 0 20px rgba(59, 130, 246, 0.4); }
  .timeline-item.end .timeline-marker { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%); box-shadow: 0 0 20px rgba(255, 107, 107, 0.4); }
  .timeline-marker { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: white; flex-shrink: 0; }
  .timeline-content { flex: 1; }
  .timeline-label { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .timeline-name { font-size: 14px; font-weight: 500; color: #e4e4e7; }

  .sidebar-footer { padding: 16px 24px; border-top: 1px solid rgba(255, 255, 255, 0.05); display: flex; justify-content: space-between; font-size: 11px; color: #52525b; }

  /* ==================== NEW FEATURES CSS ==================== */

  /* Header Actions */
  .header-actions { display: flex; gap: 8px; }
  .icon-btn { width: 40px; height: 40px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); border: none; font-size: 18px; cursor: pointer; position: relative; transition: all 0.2s; }
  .icon-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .icon-btn .badge { position: absolute; top: -4px; right: -4px; background: #ff6b6b; color: white; font-size: 10px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }

  /* Quick Stats */
  .quick-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 12px 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
  .quick-stat { text-align: center; padding: 8px; background: rgba(255, 255, 255, 0.03); border-radius: 8px; }
  .quick-stat-value { display: block; font-size: 16px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .quick-stat-label { font-size: 9px; color: #71717a; text-transform: uppercase; }
  .weather-stat .quick-stat-value { font-size: 14px; }

  /* Search Box */
  .search-box { position: relative; padding: 12px 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
  .search-box svg { position: absolute; left: 36px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; color: #52525b; }
  .search-box input { width: 100%; padding: 12px 40px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 14px; }
  .search-box input:focus { outline: none; border-color: #00ff88; }
  .clear-search { position: absolute; right: 36px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #71717a; font-size: 20px; cursor: pointer; }
  .search-results { position: absolute; top: 100%; left: 24px; right: 24px; background: rgba(15, 15, 25, 0.98); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; max-height: 200px; overflow-y: auto; z-index: 100; }
  .search-result-item { display: block; width: 100%; padding: 12px 16px; text-align: left; background: none; border: none; border-bottom: 1px solid rgba(255, 255, 255, 0.05); cursor: pointer; color: #e4e4e7; }
  .search-result-item:hover { background: rgba(255, 255, 255, 0.05); }
  .result-name { display: block; font-weight: 500; }
  .result-address { display: block; font-size: 12px; color: #71717a; }
    /* Vehicle Quick Toggle */
  .vehicle-quick-toggle { padding: 12px 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
  .vehicle-toggle-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 16px; border-radius: 12px; border: none; cursor: pointer; font-family: 'Kanit', sans-serif; font-size: 14px; font-weight: 500; transition: all 0.3s ease; }
  .vehicle-toggle-btn.fuel { background: linear-gradient(135deg, rgba(0, 255, 136, 0.15) 0%, rgba(0, 204, 106, 0.15) 100%); border: 1px solid rgba(0, 255, 136, 0.3); color: #00ff88; }
  .vehicle-toggle-btn.ev { background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(29, 78, 216, 0.15) 100%); border: 1px solid rgba(59, 130, 246, 0.3); color: #3b82f6; }
  .vehicle-toggle-btn:hover { transform: translateY(-2px); }
  .toggle-icon { font-size: 20px; }
  .ev-charge-badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; color: #000; }

  /* Vehicle Type Settings */
  .vehicle-type-selector { display: flex; gap: 12px; margin-bottom: 16px; }
  .vehicle-type-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 2px solid transparent; cursor: pointer; transition: all 0.3s; }
  .vehicle-type-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .vehicle-type-btn.active { border-color: #00ff88; background: rgba(0, 255, 136, 0.1); }
  .vehicle-type-btn.active:last-child { border-color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
  .vehicle-icon { font-size: 32px; }
  .vehicle-label { font-size: 14px; font-weight: 500; color: #e4e4e7; }

  .vehicle-info-card { padding: 16px; border-radius: 12px; margin-top: 12px; }
  .vehicle-info-card.fuel { background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.2); }
  .vehicle-info-card.ev { background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); }
  .info-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
  .info-icon { font-size: 18px; }
  .info-text { font-size: 14px; color: #a1a1aa; }

  .ev-battery-setting { margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
  .ev-battery-setting label { display: block; font-size: 13px; color: #a1a1aa; margin-bottom: 10px; }
  .ev-slider { width: 100%; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); appearance: none; cursor: pointer; }
  .ev-slider::-webkit-slider-thumb { appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #3b82f6; cursor: pointer; box-shadow: 0 0 10px rgba(59, 130, 246, 0.5); }
  .ev-range-info { margin-top: 12px; text-align: center; font-size: 14px; color: #71717a; }
  .ev-range-info strong { font-size: 16px; }

  /* EV Status Display during Navigation */
  .ev-status-display { position: absolute; right: 20px; top: 50%; transform: translateY(-50%); padding: 16px; width: 140px; pointer-events: none; }
  .ev-battery-visual { height: 12px; background: rgba(255, 255, 255, 0.1); border-radius: 6px; overflow: hidden; margin-bottom: 10px; }
  .ev-battery-fill { height: 100%; border-radius: 6px; transition: width 0.5s ease; }
  .ev-info { text-align: center; }
  .ev-percent { font-size: 28px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
  .ev-label { display: block; font-size: 11px; color: #71717a; margin-top: 4px; }
  .ev-warning { margin-top: 10px; padding: 6px; background: rgba(255, 107, 107, 0.2); border-radius: 6px; text-align: center; font-size: 11px; color: #ff6b6b; font-weight: 600; animation: pulse 1s infinite; }

  /* EV Route Info */
  .ev-route-info { padding: 16px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; margin-bottom: 20px; }
  .ev-route-info.warning { border-color: rgba(255, 107, 107, 0.5); background: rgba(255, 107, 107, 0.1); }
  .ev-info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
  .ev-info-row:last-child { border-bottom: none; }
  .ev-warning-banner { margin-top: 12px; padding: 10px; background: rgba(255, 107, 107, 0.2); border-radius: 8px; text-align: center; color: #ff6b6b; font-size: 13px; font-weight: 500; }

  .nav-stat.ev-stat { border-color: rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.1); }
  .nav-stat.ev-stat .nav-stat-icon { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }

  /* Map Vehicle Type Indicator */
  .map-stat.vehicle-type { border-left: 2px solid #00ff88; }
  .map-stat.vehicle-type.ev { border-left-color: #3b82f6; }

  /* Route Badge */
  .route-badge.ev-badge { background: rgba(59, 130, 246, 0.1); border-color: rgba(59, 130, 246, 0.3); color: #3b82f6; }

  /* EV Primary Button */
  .btn-primary.btn-ev { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; box-shadow: 0 4px 20px rgba(59, 130, 246, 0.3); }

  /* Stat Card EV */
  .stat-card.ev { border-color: rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.1); }

  /* Responsive */
  @media (max-width: 768px) {
    .ev-status-display { top: auto; bottom: 250px; right: 10px; transform: none; width: 120px; padding: 10px; }
    .ev-percent { font-size: 20px; }
  }

  @media (max-width: 480px) {
    .vehicle-type-selector { flex-direction: column; gap: 8px; }
    .vehicle-type-btn { flex-direction: row; justify-content: center; padding: 12px; }
    .vehicle-icon { font-size: 24px; }
    .ev-status-display { display: none; }
  }

  /* Filter & Sort */
  .filter-sort-bar { padding: 12px 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
  .sort-dropdown select { width: 100%; padding: 10px 12px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 13px; margin-bottom: 10px; }
  .filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .filter-chip { padding: 6px 12px; border-radius: 20px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #a1a1aa; font-size: 11px; cursor: pointer; transition: all 0.2s; }
  .filter-chip:hover { background: rgba(255, 255, 255, 0.1); }
  .filter-chip.active { background: rgba(0, 255, 136, 0.2); border-color: #00ff88; color: #00ff88; }
  .filter-chip.priority-1.active { background: rgba(255, 107, 107, 0.2); border-color: #ff6b6b; color: #ff6b6b; }
  .filter-chip.priority-2.active { background: rgba(255, 165, 2, 0.2); border-color: #ffa502; color: #ffa502; }

  /* Multi-select */
  .multi-select-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; background: rgba(102, 126, 234, 0.1); border-bottom: 1px solid rgba(102, 126, 234, 0.3); }
  .multi-select-actions { display: flex; gap: 12px; }
  .text-btn { background: none; border: none; color: #818cf8; font-size: 12px; cursor: pointer; }
  .text-btn:hover { text-decoration: underline; }
  .text-btn.danger { color: #ff6b6b; }
  .checkbox { width: 24px; height: 24px; border-radius: 6px; background: rgba(255, 255, 255, 0.1); border: 2px solid rgba(255, 255, 255, 0.2); display: flex; align-items: center; justify-content: center; font-size: 14px; color: white; flex-shrink: 0; }
  .checkbox.checked { background: #00ff88; border-color: #00ff88; }
  .point-card.selected { background: rgba(0, 255, 136, 0.1); border-color: rgba(0, 255, 136, 0.3); }
  .distance-tag { font-size: 11px; color: #71717a; margin-left: 8px; }

  /* Modal Overlay */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 20px; }
  
  /* Add Form Modal */
  .add-form-modal { width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; padding: 24px; background: rgba(15, 15, 25, 0.95); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; }
  .add-form-modal .form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .add-form-modal .form-header h3 { font-size: 20px; font-weight: 600; color: #e4e4e7; }
  .add-form-modal .form-hint { display: flex; align-items: center; gap: 8px; padding: 12px; background: rgba(0, 255, 136, 0.1); border-radius: 10px; color: #00ff88; font-size: 13px; margin-bottom: 20px; }
  .add-form-modal .form-hint svg { width: 18px; height: 18px; flex-shrink: 0; }
  .add-form-modal .form-group { margin-bottom: 16px; }
  .add-form-modal .form-group label { display: block; font-size: 13px; color: #a1a1aa; margin-bottom: 6px; }
  .add-form-modal .form-group label .required { color: #ff6b6b; }
  .add-form-modal .form-group input, .add-form-modal .form-group textarea { width: 100%; padding: 12px 14px; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 14px; transition: all 0.2s; }
  .add-form-modal .form-group input:focus, .add-form-modal .form-group textarea:focus { outline: none; border-color: #00ff88; background: rgba(0, 255, 136, 0.05); }
  .add-form-modal .form-group textarea { resize: vertical; min-height: 60px; }
  .add-form-modal .coords-group { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .add-form-modal .priority-selector { display: flex; gap: 8px; flex-wrap: wrap; }
  .add-form-modal .priority-btn { flex: 1; min-width: 60px; padding: 10px 8px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .add-form-modal .priority-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .add-form-modal .priority-btn.active { background: var(--btn-bg); border-color: var(--btn-glow); box-shadow: 0 0 15px var(--btn-glow); }
  .add-form-modal .priority-num { font-size: 18px; font-weight: 700; color: #e4e4e7; }
  .add-form-modal .priority-label { font-size: 10px; color: #a1a1aa; }
  .add-form-modal .priority-btn.active .priority-num, .add-form-modal .priority-btn.active .priority-label { color: white; }
  .add-form-modal .form-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.1); }

  /* Settings Panel */
  .settings-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); z-index: 2000; display: flex; align-items: center; justify-content: center; }
  .settings-panel { 
    width: 100%; 
    max-width: 1000px;  /* เพิ่มความกว้าง */
    max-height: 100vh; 
    overflow-y: auto; 
    padding: 24px; 
  }
  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  .settings-column {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* Responsive - มือถือแสดงเป็น 1 column */
  @media (max-width: 768px) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
    
    .settings-panel {
      max-width: 95%;
      padding: 16px;
    }
  }
  .settings-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .settings-header h3 { font-size: 20px; font-weight: 600; }
  .settings-content { display: flex; flex-direction: column; gap: 24px; }
  .settings-section h4 { font-size: 13px; color: #71717a; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
  .driver-card { display: flex; gap: 16px; padding: 16px; background: rgba(0, 0, 0, 0.3); border-radius: 12px; }
  .driver-avatar { width: 50px; height: 50px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; }
  .driver-name { font-weight: 600; font-size: 16px; }
  .driver-id { font-size: 12px; color: #71717a; }
  .driver-vehicle { font-size: 12px; color: #a1a1aa; margin-top: 4px; }
  .toggle-setting { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; }
  .toggle-btn { width: 50px; height: 28px; border-radius: 14px; background: rgba(255, 255, 255, 0.1); border: none; cursor: pointer; position: relative; transition: all 0.3s; }
  .toggle-btn.active { background: #00ff88; }
  .toggle-knob { width: 22px; height: 22px; border-radius: 50%; background: white; position: absolute; top: 3px; left: 3px; transition: all 0.3s; }
  .toggle-btn.active .toggle-knob { left: 25px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .info-item { padding: 12px; background: rgba(0, 0, 0, 0.3); border-radius: 8px; }
  .info-label { display: block; font-size: 11px; color: #71717a; margin-bottom: 4px; }
  .info-value { font-weight: 600; color: #e4e4e7; }
  .settings-actions { padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.1); }

  /* Alerts Panel */
  .alerts-panel { position: fixed; top: 36px; right: 24px; width: 350px; max-height: 400px; z-index: 1500; overflow: hidden; display: flex; flex-direction: column; }
  .alerts-header { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
  .alerts-header h3 { font-size: 16px; }
  .alerts-actions { display: flex; gap: 12px; align-items: center; }
  .alerts-list { flex: 1; overflow-y: auto; padding: 8px; }
  .empty-alerts { text-align: center; padding: 24px; color: #71717a; }
  .alert-item { display: flex; gap: 12px; padding: 12px; background: rgba(0, 0, 0, 0.3); border-radius: 10px; margin-bottom: 8px; align-items: flex-start; }
  .alert-item.alert-emergency { background: rgba(255, 107, 107, 0.2); border: 1px solid rgba(255, 107, 107, 0.3); }
  .alert-icon { font-size: 20px; }
  .alert-content { flex: 1; }
  .alert-message { font-size: 13px; }
  .alert-time { font-size: 11px; color: #71717a; margin-top: 4px; }
  .dismiss-btn { background: none; border: none; color: #71717a; font-size: 18px; cursor: pointer; padding: 0 4px; }

  /* Navigation Status Bar */
  .nav-status-bar { position: absolute; top: 0; left: 0; right: 0; display: flex; justify-content: center; gap: 20px; padding: 8px 16px; background: rgba(0, 0, 0, 0.6); pointer-events: none; }
  .status-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #a1a1aa; }
  .status-icon { font-size: 14px; }

  /* Speed Display */
  .speed-display { position: absolute; left: 20px; top: 50%; transform: translateY(-50%); width: 100px; height: 100px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
  .speed-value { font-size: 36px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; line-height: 1; }
  .speed-unit { font-size: 12px; color: #71717a; }
  .speed-max { font-size: 10px; color: #52525b; margin-top: 4px; }

  /* Nav ETA */
  .nav-eta { font-size: 12px; color: #a1a1aa; margin-top: 4px; }
  .nav-eta strong { color: #00ff88; }

  /* Additional Nav Buttons */
  .nav-btn-voice { background: rgba(255, 255, 255, 0.1); color: #a1a1aa; flex: 0 0 auto; width: 50px; }
  .nav-btn-voice.active { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
  .nav-btn-share { background: rgba(59, 130, 246, 0.2); color: #60a5fa; flex: 0 0 auto; width: 50px; }
  .nav-btn-break { background: rgba(255, 165, 2, 0.2); color: #ffa502; flex: 0 0 auto; width: 50px; font-size: 18px; }
  .nav-btn-break.active { background: rgba(255, 165, 2, 0.4); animation: pulse-break 1s infinite; }
  @keyframes pulse-break { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

  /* Break Indicator */
  .break-indicator { text-align: center; padding: 8px; background: rgba(255, 165, 2, 0.2); border-radius: 8px; margin-top: 12px; color: #ffa502; font-size: 13px; }

  /* Emergency Button */
  .emergency-btn { position: absolute; bottom: 200px; right: 20px; padding: 12px 20px; background: linear-gradient(135deg, #ff6b6b, #ee5a5a); border: none; border-radius: 12px; color: white; font-weight: 600; font-size: 14px; cursor: pointer; pointer-events: auto; box-shadow: 0 4px 20px rgba(255, 107, 107, 0.4); animation: pulse-emergency 2s infinite; }
  @keyframes pulse-emergency { 0%, 100% { box-shadow: 0 4px 20px rgba(255, 107, 107, 0.4); } 50% { box-shadow: 0 4px 30px rgba(255, 107, 107, 0.6); } }

  .map-container { flex: 1; position: relative; overflow: hidden; }
  .map-container.fullscreen { width: 100vw; }
  
  /* Map Stats - Top Left (next to sidebar) */
  .map-stats { position: absolute; top: 16px; left: 16px; z-index: 1000; display: flex; gap: 12px; padding: 12px 16px; }
  .map-stat { text-align: center; padding: 4px 8px; }
  .map-stat-value { display: block; font-size: 18px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .map-stat-label { font-size: 10px; color: #71717a; text-transform: uppercase; }
  .map-stat.weather .map-stat-value { font-size: 16px; }
  .customer-orders-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.customer-orders-section .section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.customer-orders-section h3 {
  font-size: 14px;
  font-weight: 600;
  color: #8b5cf6;
}

.customer-orders-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.customer-order-card {
  background: rgba(139, 92, 246, 0.1);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 12px;
  padding: 14px;
}

.customer-order-card.accepted {
  background: rgba(0, 255, 136, 0.1);
  border-color: rgba(0, 255, 136, 0.3);
}

.order-customer {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.order-customer .avatar {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.order-customer .name {
  font-weight: 600;
  color: #e4e4e7;
}

.order-customer .phone {
  font-size: 12px;
  color: #71717a;
}

.order-address {
  font-size: 13px;
  color: #a1a1aa;
  margin-bottom: 8px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.order-notes {
  font-size: 12px;
  color: #71717a;
  font-style: italic;
  margin-bottom: 10px;
}

.order-actions {
  display: flex;
  gap: 8px;
}

.order-actions button {
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-accept {
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  color: white;
}

.btn-accept:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4);
}

.btn-complete {
  background: linear-gradient(135deg, #00ff88, #00cc6a);
  color: #000;
}

.btn-complete:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 255, 136, 0.4);
}

.btn-navigate {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.btn-navigate:hover {
  background: rgba(59, 130, 246, 0.3);
}

/* Leaflet Customer Marker Styles */
:global(.customer-pin) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0px;
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  border-radius: 12px;
  border: 3px solid white;
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.5);
  animation: pulse-customer 2s ease-in-out infinite;
}

:global(.customer-pin.accepted) {
  background: linear-gradient(135deg, #00ff88, #00cc6a);
  box-shadow: 0 4px 20px rgba(0, 255, 136, 0.5);
}

:global(.customer-pin span) {
  font-size: 20px;
}

:global(.customer-info) {
  display: flex;
  flex-direction: column;
}

:global(.customer-name) {
  font-size: 12px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
}

:global(.order-status) {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.8);
}

@keyframes pulse-customer {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

:global(.customer-dark-popup .leaflet-popup-content-wrapper) {
  background: rgba(139, 92, 246, 0.95);
}

:global(.customer-header) {
  background: linear-gradient(135deg, #8b5cf6, #6d28d9) !important;
}

:global(.popup-phone), :global(.popup-notes) {
  font-size: 12px;
  color: #a1a1aa;
  margin-top: 4px;
}
  /* Map Filters - Below Stats */
  .map-filters { position: absolute; top: 120px; left: 16px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; }
  .map-filters select { padding: 8px 12px; background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 12px; cursor: pointer; }
  .map-filters select:focus { outline: none; border-color: #00ff88; }
  .map-filters .filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  #map { width: 100%; height: 100%; }
  .map-info { position: absolute; bottom: 24px; left: 24px; display: flex; align-items: center; gap: 10px; padding: 12px 18px; font-size: 13px; color: #a1a1aa; z-index: 1000; }
  .map-info svg { width: 18px; height: 18px; color: #00ff88; }

  .nav-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 1000; }
  .nav-top-bar { position: absolute; top: 50px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 20px; padding: 16px 24px; pointer-events: auto; min-width: 350px; }
  .nav-target-info { flex: 1; }
  .nav-target-label { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .nav-target-name { font-size: 18px; font-weight: 600; color: #e4e4e7; }
  .nav-distance-badge { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 10px 20px; border-radius: 12px; }
  .nav-distance-value { font-size: 20px; font-weight: 700; color: white; font-family: 'JetBrains Mono', monospace; }

  .nav-bottom-panel { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); width: calc(100% - 40px); max-width: 1200px; padding: 20px; pointer-events: auto; }
  .nav-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
  .nav-stat { display: flex; align-items: center; gap: 12px; padding: 14px; background: rgba(255, 255, 255, 0.03); border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.06); }
  .nav-stat-icon { width: 50px; height: 50px; background: rgba(0, 255, 136, 0.1); border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .nav-stat-icon svg { width: 26px; height: 26px; color: #00ff88; }
  .nav-stat-content { flex: 1; }
  .nav-stat-value { font-size: 20px; font-weight: 700; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; }
  .nav-stat-label { font-size: 12px; color: #71717a; margin-top: 2px; }
  .nav-progress { margin-bottom: 16px; }
  .nav-progress-bar { height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 3px; overflow: hidden; }
  .nav-progress-fill { height: 100%; background: linear-gradient(90deg, #00ff88, #00cc6a); border-radius: 3px; transition: width 0.5s ease; }
  .nav-actions { display: flex; gap: 12px; }
  .nav-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px; border-radius: 12px; font-family: 'Kanit', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }
  .nav-btn svg { width: 20px; height: 20px; }
  .nav-btn-secondary { background: rgba(255, 255, 255, 0.1); color: #a1a1aa; }
  .nav-btn-secondary:hover:not(:disabled) { background: rgba(255, 255, 255, 0.15); color: #e4e4e7; }
  .nav-btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
  
  /* Success Button */
  .nav-btn-success { background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); color: #000; font-weight: 600; }
  .nav-btn-success:hover:not(:disabled) { background: linear-gradient(135deg, #00ff99 0%, #00dd7a 100%); transform: scale(1.05); }
  .nav-btn-success:disabled { opacity: 0.4; cursor: not-allowed; }
  
  /* Skip Button */
  .nav-btn-skip { background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
  .nav-btn-skip:hover:not(:disabled) { background: rgba(245, 158, 11, 0.3); }
  .nav-btn-skip:disabled { opacity: 0.4; cursor: not-allowed; }
  
  /* History Button */
  .nav-btn-history { background: rgba(139, 92, 246, 0.2); color: #a78bfa; position: relative; }
  .nav-btn-history:hover { background: rgba(139, 92, 246, 0.3); }
  .history-badge { position: absolute; top: -5px; right: -5px; background: #8b5cf6; color: white; font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: 600; }
  
  /* History Panel - Right side, outside card */
  .history-panel { position: fixed; top: 50%; right: 20px; transform: translateY(-50%); width: 320px; max-height: 450px; z-index: 1100; pointer-events: auto; display: flex; flex-direction: column; }
  .history-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .history-header h4 { margin: 0; font-size: 14px; color: #e4e4e7; flex: 1; }
  .history-stats { display: flex; gap: 12px; }
  .history-stat { font-size: 12px; padding: 4px 8px; border-radius: 12px; }
  .history-stat.success { background: rgba(0, 255, 136, 0.15); color: #00ff88; }
  .history-stat.skipped { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
  .history-list { flex: 1; overflow-y: auto; padding: 8px; }
  .history-empty { text-align: center; color: #71717a; padding: 24px; font-size: 13px; }
  .history-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px; margin-bottom: 6px; background: rgba(255,255,255,0.03); }
  .history-item.success { border-left: 3px solid #00ff88; }
  .history-item.skipped { border-left: 3px solid #f59e0b; }
  .history-icon { font-size: 18px; }
  .history-info { flex: 1; min-width: 0; }
  .history-name { font-size: 13px; font-weight: 500; color: #e4e4e7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .history-address { font-size: 11px; color: #71717a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .history-time { font-size: 11px; color: #a1a1aa; font-family: 'JetBrains Mono', monospace; }
  .nav-btn-center { background: rgba(59, 130, 246, 0.2); color: #60a5fa; flex: 0 0 auto; width: 56px; }
  .nav-btn-center:hover { background: rgba(59, 130, 246, 0.3); }
  .nav-btn-stop { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }
  .nav-btn-stop:hover { background: rgba(255, 107, 107, 0.3); }

  .toast { position: fixed; top: 50px; right: 24px; display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-radius: 14px; font-size: 14px; font-weight: 500; z-index: 9999; animation: toastIn 0.4s ease; backdrop-filter: blur(20px); }
  @keyframes toastIn { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
  .toast-success { background: rgba(0, 255, 136, 0.15); border: 1px solid rgba(0, 255, 136, 0.3); color: #00ff88; }
  .toast-error { background: rgba(255, 107, 107, 0.15); border: 1px solid rgba(255, 107, 107, 0.3); color: #ff6b6b; }
  .toast-warning { background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; }
  .toast-icon { width: 24px; height: 24px; }
  .toast-icon svg { width: 100%; height: 100%; }

  :global(.leaflet-container) { height: 100% !important; width: 100% !important; background: #0a0a0f; }
  :global(.leaflet-control-zoom) { border: none !important; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3) !important; }
  :global(.leaflet-control-zoom a) { background: rgba(15, 15, 25, 0.95) !important; color: #a1a1aa !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; backdrop-filter: blur(10px); }
  :global(.leaflet-control-zoom a:hover) { background: rgba(25, 25, 40, 0.95) !important; color: #e4e4e7 !important; }
  :global(.leaflet-control-zoom-in) { border-radius: 10px 10px 0 0 !important; }
  :global(.leaflet-control-zoom-out) { border-radius: 0 0 10px 10px !important; }

  :global(.marker-pin) { width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; color: white; font-family: 'Kanit', sans-serif; border: 3px solid rgba(255, 255, 255, 0.3); position: relative; }
  :global(.route-pin) { width: 52px; height: 52px; font-size: 18px; }
  :global(.marker-label) { position: absolute; bottom: -24px; left: 50%; transform: translateX(-50%); background: rgba(0, 0, 0, 0.8); padding: 2px 8px; border-radius: 4px; font-size: 10px; white-space: nowrap; }
  :global(.target-label) { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important; animation: pulse-label 1.5s ease-in-out infinite; }
  @keyframes pulse-label { 0%, 100% { transform: translateX(-50%) scale(1); } 50% { transform: translateX(-50%) scale(1.1); } }
  :global(.current-target) { animation: pulse-target 1.5s ease-in-out infinite; }
  :global(.current-loc) { animation: pulse-loc 2s ease-in-out infinite; }
  @keyframes pulse-loc { 0%, 100% { box-shadow: 0 0 25px rgba(59, 130, 246, 0.6); } 50% { box-shadow: 0 0 40px rgba(59, 130, 246, 0.9); } }
  @keyframes pulse-target { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
  :global(.arrived) { opacity: 0.6; }
  :global(.pulse-marker) { width: 48px; height: 48px; background: radial-gradient(circle, rgba(0, 255, 136, 0.6) 0%, rgba(0, 255, 136, 0) 70%); border-radius: 50%; animation: pulse 1.5s ease-out infinite; position: relative; }
  :global(.pulse-marker::after) { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; background: #00ff88; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 20px rgba(0, 255, 136, 0.6); }
  @keyframes pulse { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(2); opacity: 0; } }

  :global(.current-location-marker) { position: relative; }
  :global(.location-accuracy) { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 50%; }
  :global(.location-dot) { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 24px; height: 24px; background: #3b82f6; border-radius: 50%; border: 4px solid white; box-shadow: 0 0 20px rgba(59, 130, 246, 0.6), 0 2px 10px rgba(0, 0, 0, 0.3); }
  :global(.location-dot-inner) { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 8px; height: 8px; background: white; border-radius: 50%; }

  :global(.dark-popup .leaflet-popup-content-wrapper) { background: rgba(15, 15, 25, 0.95); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); padding: 0; overflow: hidden; }
  :global(.dark-popup .leaflet-popup-tip) { background: rgba(15, 15, 25, 0.95); border: 1px solid rgba(255, 255, 255, 0.1); }
  :global(.dark-popup .leaflet-popup-content) { margin: 0; }
  :global(.custom-popup) { min-width: 200px; }
  :global(.popup-header) { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; color: white; }
  :global(.popup-number) { font-size: 18px; font-weight: 700; font-family: 'Kanit', sans-serif; }
  :global(.popup-priority) { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.9; }
  :global(.popup-content) { padding: 14px 16px; }
  :global(.popup-content h4) { font-size: 15px; font-weight: 600; color: #e4e4e7; margin-bottom: 6px; font-family: 'Kanit', sans-serif; }
  :global(.popup-content p) { font-size: 12px; color: #71717a; line-height: 1.5; font-family: 'Kanit', sans-serif; }
  :global(.leaflet-popup-close-button) { color: rgba(255, 255, 255, 0.5) !important; top: 8px !important; right: 8px !important; width: 24px !important; height: 24px !important; font-size: 18px !important; }
  :global(.leaflet-popup-close-button:hover) { color: white !important; }

  /* ==================== RESPONSIVE ==================== */
  
  /* Tablet */
  @media (max-width: 1024px) {
    .app-container { flex-direction: column; }
    .sidebar { width: 100%; height: auto; max-height: 40vh; min-height: 200px; border-right: none; border-bottom: 1px solid rgba(255,255,255,0.1); overflow-y: auto; }
    .map-container { flex: 1; height: 60vh; min-height: 300px; position: relative; overflow: hidden; }
    #map { position: absolute; inset: 0; width: 100%; height: 100%; }
    .sidebar-content { padding: 12px; }
    .point-card { padding: 12px; }
    .nav-bottom-panel { max-width: 95%; padding: 16px; }
    .nav-stats { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .nav-stat { padding: 10px; }
    .nav-stat-value { font-size: 16px; }
    .nav-stat-icon { width: 40px; height: 40px; }
    .history-panel { width: 280px; }
    .map-stats { flex-wrap: wrap; gap: 8px; padding: 10px; }
    .map-filters { flex-direction: column; gap: 8px; }
  }
  
  /* Mobile */
  @media (max-width: 768px) {
    .app-container { flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden; }
    .sidebar { width: 100%; height: auto; max-height: 35vh; min-height: 150px; border-right: none; border-bottom: 1px solid rgba(255,255,255,0.1); overflow-y: auto; flex-shrink: 0; }
    .map-container { flex: 1; width: 100%; position: relative; overflow: hidden; min-height: 0; }
    #map { position: absolute; inset: 0; width: 100% !important; height: 100% !important; }
    
    .sidebar-header { padding: 12px 16px; }
    .sidebar-header .logo h1 { font-size: 18px; }
    .sidebar-header .logo span { font-size: 10px; }
    .logo-icon { width: 36px; height: 36px; }
    .action-buttons { flex-direction: column; gap: 8px; padding: 12px 16px; }
    .action-buttons .btn { width: 100%; justify-content: center; }
    .tabs { gap: 4px; }
    .tab { padding: 10px 12px; font-size: 12px; }
    .point-card { padding: 10px; }
    .point-name { font-size: 14px; }
    .point-address { font-size: 11px; }
    .summary-stats { grid-template-columns: repeat(2, 1fr); }
    .stat-card { padding: 14px; }
    .stat-value { font-size: 22px; }
    
    /* Add Form Mobile - Keep in sidebar */
    .add-form-overlay { display: contents; }
    .add-form { margin: 0 10px 12px; padding: 12px; }
    .add-form .form-header { margin-bottom: 10px; }
    .add-form .form-header h3 { font-size: 15px; }
    .add-form .close-btn { width: 30px; height: 30px; }
    .add-form .form-hint { font-size: 11px; padding: 8px; margin-bottom: 10px; }
    .add-form .form-hint svg { width: 14px; height: 14px; }
    .add-form .form-group { margin-bottom: 10px; }
    .add-form .form-group label { font-size: 11px; margin-bottom: 4px; }
    .add-form .form-group input, .add-form .form-group textarea { padding: 8px 10px; font-size: 13px; }
    .add-form .form-group textarea { min-height: 40px; }
    .add-form .coords-group { grid-template-columns: 1fr 1fr; gap: 8px; }
    .add-form .priority-selector { gap: 4px; justify-content: center; }
    .add-form .priority-btn { min-width: 50px; max-width: 60px; padding: 6px 2px; }
    .add-form .priority-num { font-size: 14px; }
    .add-form .priority-label { font-size: 7px; }
    .add-form .form-actions { flex-direction: row; gap: 8px; margin-top: 10px; }
    .add-form .form-actions .btn { flex: 1; padding: 10px; font-size: 12px; }
    .add-form .form-actions .btn svg { width: 14px; height: 14px; }
    
    /* Filter Sort Mobile - moved down 30px */
    .map-filters { position: absolute; top: 100px; left: 10px; right: auto; width: auto; max-width: calc(100% - 20px); padding: 10px; z-index: 1000; }
    .map-filters select { width: auto; min-width: 120px; padding: 8px 10px; font-size: 12px; }
    .map-filters .filter-chips { flex-wrap: wrap; justify-content: flex-start; gap: 4px; }
    .filter-chip { padding: 6px 10px; font-size: 11px; }
    
    /* Map Stats Mobile */
    .map-stats { position: absolute; top: 10px; left: 10px; right: auto; width: auto; max-width: calc(100% - 20px); flex-wrap: wrap; gap: 6px; padding: 8px 10px; z-index: 1000; }
    .map-stat { padding: 2px 6px; }
    .map-stat-value { font-size: 14px; }
    .map-stat-label { font-size: 8px; }
    
    /* Map Info Mobile */
    .map-info { position: absolute; bottom: 10px; left: 10px; right: auto; width: auto; max-width: calc(100% - 20px); padding: 8px 12px; font-size: 11px; z-index: 1000; }
    
    /* Navigation Mode Mobile */
    .nav-overlay { position: fixed; inset: 0; z-index: 1500; }
    .nav-top-panel { position: absolute; top: 10px; left: 10px; right: 10px; width: auto; transform: none; padding: 12px; }
    .nav-target-name { font-size: 14px; }
    .nav-distance-value { font-size: 16px; }
    .nav-distance-badge { padding: 8px 14px; }
    .nav-bottom-panel { position: absolute; padding: 12px; left: 10px; right: 10px; width: auto; transform: none; max-width: none; bottom: 10px; }
    .nav-bottom-panel.hide-on-history { display: none; }
    .nav-stats { grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .nav-stat { padding: 8px; gap: 8px; }
    .nav-stat-icon { width: 36px; height: 36px; }
    .nav-stat-icon svg { width: 18px; height: 18px; }
    .nav-stat-value { font-size: 14px; }
    .nav-stat-label { font-size: 10px; }
    .nav-actions { flex-wrap: wrap; gap: 8px; }
    .nav-btn { padding: 10px; font-size: 11px; flex: 1 1 auto; min-width: 60px; }
    .nav-btn svg { width: 16px; height: 16px; }
    .nav-btn-success, .nav-btn-skip { flex: 1 1 45%; }
    .nav-btn-history, .nav-btn-voice, .nav-btn-center, .nav-btn-stop { flex: 0 0 auto; min-width: 50px; }
    
    /* Emergency Button Mobile */
    .emergency-btn { position: fixed; bottom: auto; top: 170px; right: 10px; left: auto; padding: 8px 12px; font-size: 11px; z-index: 1600; }
    
    /* History Panel Mobile */
    .history-panel { position: fixed; width: calc(100% - 20px); right: 10px; left: 10px; top: auto; bottom: 220px; transform: none; max-height: 200px; z-index: 1550; }
    .history-header { padding: 10px 12px; }
    .history-header h4 { font-size: 13px; }
    .history-stats { gap: 8px; }
    .history-stat { font-size: 11px; padding: 3px 6px; }
    .history-list { padding: 6px; }
    .history-item { padding: 8px 10px; gap: 8px; }
    .history-icon { font-size: 14px; }
    .history-name { font-size: 12px; }
    .history-address { font-size: 10px; }
    .history-time { font-size: 10px; }
    
    /* Alerts Panel Mobile */
    .alerts-panel { position: fixed; width: calc(100% - 20px); right: 10px; left: 10px; top: 60px; max-height: 300px; z-index: 1100; }
    
    /* Settings Panel Mobile */
    .settings-panel { width: calc(100% - 40px); max-width: none; }
  }
  
  /* Small Mobile */
  @media (max-width: 480px) {
    .app-container { height: 100vh; height: 100dvh; }
    .sidebar { max-height: 30vh; min-height: 120px; }
    .map-container { flex: 1; min-height: 0; }
    .sidebar-header { padding: 10px 12px; }
    .logo-text h1 { font-size: 16px; }
    .header-actions { gap: 4px; }
    .icon-btn { width: 32px; height: 32px; font-size: 14px; }
    .tabs { padding: 0 8px; }
    .tab { padding: 8px 10px; font-size: 11px; gap: 4px; }
    .tab svg { width: 14px; height: 14px; }
    .point-card { margin-bottom: 8px; }
    
    /* Add Form Small Mobile */
    .add-form-overlay { padding: 12px; }
    .add-form { padding: 16px; max-height: 80vh; }
    .add-form .form-header h3 { font-size: 16px; }
    .add-form .form-hint { font-size: 11px; padding: 8px; }
    .add-form .form-group { margin-bottom: 12px; }
    .add-form .form-group label { font-size: 11px; }
    .add-form .form-group input, .add-form .form-group textarea { padding: 10px; font-size: 13px; }
    .add-form .coords-group { gap: 8px; }
    .add-form .priority-selector { gap: 4px; }
    .add-form .priority-btn { min-width: 48px; max-width: 58px; padding: 8px 2px; }
    .add-form .priority-num { font-size: 14px; }
    .add-form .priority-label { font-size: 7px; }
    .add-form .form-actions { gap: 8px; margin-top: 14px; }
    .add-form .form-actions .btn { padding: 12px; font-size: 13px; }
    
    /* Filter Sort Small Mobile - moved down 30px */
    .map-filters { top: 90px; padding: 8px; }
    .map-filters select { font-size: 11px; padding: 6px 8px; min-width: 100px; }
    .map-filters .filter-chips { gap: 3px; }
    .filter-chip { padding: 4px 6px; font-size: 9px; }
    
    /* Map Stats Small Mobile */
    .map-stats { padding: 6px 8px; gap: 4px; }
    .map-stat { padding: 2px 4px; }
    .map-stat-value { font-size: 12px; }
    .map-stat-label { font-size: 7px; }
    
    /* Navigation Small Mobile */
    .nav-stats { grid-template-columns: 1fr 1fr; }
    .nav-actions { gap: 6px; }
    .nav-btn { padding: 8px; font-size: 10px; min-width: 50px; }
    .nav-btn-success, .nav-btn-skip { flex: 1 1 48%; }
    
    /* Emergency Button Small Mobile */
    .emergency-btn { top: 160px; right: 8px; padding: 6px 10px; font-size: 10px; }
    
    /* History Panel Small Mobile */
    .history-panel { bottom: 200px; max-height: 180px; }
    .history-item { padding: 6px 8px; }
    .history-name { font-size: 11px; }
    .history-address { font-size: 9px; }
    
    .quick-stats { flex-direction: column; gap: 4px; }
    .quick-stat { flex-direction: row; justify-content: space-between; }
  }
  
  /* Landscape Mobile */
  @media (max-height: 500px) and (orientation: landscape) {
    .app-container { flex-direction: row; }
    .sidebar { width: 280px; height: 100vh; max-height: 100vh; border-right: 1px solid rgba(255,255,255,0.1); border-bottom: none; }
    .map-container { height: 100vh; flex: 1; }
    .nav-bottom-panel { bottom: 10px; padding: 10px; }
    .nav-stats { grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .nav-stat { padding: 6px; }
    .nav-stat-icon { width: 30px; height: 30px; }
    .nav-stat-value { font-size: 12px; }
    .nav-actions { gap: 6px; }
    .nav-btn { padding: 8px; }
    .history-panel { top: 10px; bottom: auto; max-height: 80vh; }
  }
  /* ==================== เพิ่มเติมสำหรับ Database Integration ==================== */

/* Today Stats Panel - แสดงสถิติวันนี้ */
.today-stats {
  position: absolute;
  top: 130px;
  left: 20px;
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  pointer-events: none;
  z-index: 900;
}

.today-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.today-stat .stat-icon {
  font-size: 16px;
}

.today-stat .stat-value {
  font-size: 20px;
  font-weight: 700;
  color: #00ff88;
  font-family: 'JetBrains Mono', monospace;
}
.settings-actions {
  display: flex;
  gap: 12px;
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.settings-actions .btn {
  flex: 1;
}

.btn-danger {
  background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
  color: white;
  box-shadow: 0 4px 20px rgba(255, 107, 107, 0.3);
}

.btn-danger:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 30px rgba(255, 107, 107, 0.4);
}
.today-stat .stat-label {
  font-size: 10px;
  color: #71717a;
  text-transform: uppercase;
}

/* Small Spinner สำหรับปุ่ม */
.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Processing state for buttons */
.nav-btn-success:disabled,
.nav-btn-skip:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

/* ==================== Responsive สำหรับ Today Stats ==================== */

@media (max-width: 768px) {
  .today-stats {
    top: 120px;
    left: 10px;
    padding: 8px 12px;
    gap: 12px;
  }
  
  .today-stat .stat-value {
    font-size: 16px;
  }
  
  .today-stat .stat-label {
    font-size: 9px;
  }
}

@media (max-width: 480px) {
  .today-stats {
    top: 110px;
    padding: 6px 10px;
    gap: 10px;
  }
  
  .today-stat .stat-icon {
    font-size: 14px;
  }
  
  .today-stat .stat-value {
    font-size: 14px;
  }
  
  .today-stat .stat-label {
    font-size: 8px;
  }
}
.driver-phone {
  font-size: 12px;
  color: #00ff88;
  margin-top: 4px;
}
.order-payment {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: rgba(0, 255, 136, 0.05);
  border: 1px solid rgba(0, 255, 136, 0.15);
  border-radius: 10px;
}

.payment-amount {
  display: flex;
  flex-direction: column;
}

.amount-label {
  font-size: 10px;
  color: #71717a;
  text-transform: uppercase;
}

.amount-value {
  font-size: 20px;
  font-weight: 700;
  color: #00ff88;
  font-family: 'JetBrains Mono', monospace;
}
:global(.ev-station-marker) {
    position: relative;
  }

  :global(.ev-pin) {
    width: 44px;
    height: 44px;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 3px solid white;
    box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
    position: relative;
  }

  :global(.ev-pin.route-stop) {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    box-shadow: 0 4px 20px rgba(245, 158, 11, 0.5);
    animation: pulse-ev 1.5s ease-in-out infinite;
  }

  :global(.ev-pin.offline) {
    background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
    opacity: 0.7;
  }

  :global(.ev-pin .ev-icon) {
    transform: rotate(45deg);
    font-size: 18px;
  }

  :global(.ev-pin .stop-number) {
    position: absolute;
    top: -8px;
    right: -8px;
    transform: rotate(45deg);
    background: #ef4444;
    color: white;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.ev-pin .power-badge) {
    position: absolute;
    bottom: -20px;
    left: 50%;
    transform: translateX(-50%) rotate(45deg);
    background: rgba(0, 0, 0, 0.8);
    color: #10b981;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 9px;
    font-weight: 600;
    white-space: nowrap;
  }

  @keyframes pulse-ev {
    0%, 100% { transform: rotate(-45deg) scale(1); }
    50% { transform: rotate(-45deg) scale(1.1); }
  }

  /* EV Popup Styles */
  :global(.ev-popup) {
    min-width: 250px;
  }

  :global(.ev-popup-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border-radius: 16px 16px 0 0;
  }

  :global(.ev-icon-large) {
    font-size: 28px;
  }

  :global(.ev-status) {
    font-size: 12px;
    font-weight: 600;
    color: white;
  }

  :global(.ev-popup-content) {
    padding: 14px 16px;
  }

  :global(.ev-popup-content h4) {
    font-size: 15px;
    font-weight: 600;
    color: #e4e4e7;
    margin-bottom: 10px;
  }

  :global(.ev-popup-content p) {
    font-size: 12px;
    color: #a1a1aa;
    margin-bottom: 6px;
  }

  :global(.ev-route-stop-info) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    background: rgba(245, 158, 11, 0.15);
    border-top: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 0 0 16px 16px;
  }

  :global(.stop-badge) {
    font-size: 11px;
    font-weight: 600;
    color: #f59e0b;
  }

  :global(.charging-time) {
    font-size: 11px;
    color: #a1a1aa;
  }

  /* Charging Stops Section */
  .charging-stops-section {
    margin-top: 20px;
    padding: 16px;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: 14px;
  }

  .charging-stops-section h4 {
    font-size: 14px;
    font-weight: 600;
    color: #10b981;
    margin-bottom: 12px;
  }

  .charging-stops-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .charging-stop-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .charging-stop-card:hover {
    background: rgba(16, 185, 129, 0.15);
    transform: translateX(4px);
  }

  .stop-number-badge {
    width: 40px;
    height: 40px;
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }

  .stop-info {
    flex: 1;
    min-width: 0;
  }

  .stop-name {
    font-size: 13px;
    font-weight: 600;
    color: #e4e4e7;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stop-details {
    display: flex;
    gap: 12px;
    margin-bottom: 4px;
  }

  .stop-details span {
    font-size: 11px;
    color: #10b981;
  }

  .stop-address {
    font-size: 11px;
    color: #71717a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stop-status {
    font-size: 14px;
  }

  .charging-summary {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    text-align: center;
    font-size: 13px;
    color: #a1a1aa;
  }

  /* EV Stations Badge */
  .ev-stations-badge {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
  }

  .badge-icon {
    font-size: 18px;
  }

  .badge-count {
    font-size: 18px;
    font-weight: 700;
    color: #10b981;
    font-family: 'JetBrains Mono', monospace;
  }

  .badge-label {
    font-size: 11px;
    color: #71717a;
  }

  .refresh-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    transition: all 0.2s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.2);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner-tiny {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #10b981;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* EV Search Button */
  .btn-ev-search {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 12px;
    margin-top: 12px;
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%);
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: 10px;
    color: #10b981;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-ev-search:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.3) 0%, rgba(5, 150, 105, 0.3) 100%);
  }

  .btn-ev-search:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .ev-stations-badge {
      top: auto;
      bottom: 140px;
      right: 10px;
      padding: 8px 12px;
    }

    .badge-count {
      font-size: 16px;
    }

    .badge-label {
      display: none;
    }

    .charging-stop-card {
      padding: 10px;
    }

    .stop-number-badge {
      width: 36px;
      height: 36px;
      font-size: 12px;
    }
  }

.payment-details {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.payment-method {
  font-size: 12px;
  color: #a1a1aa;
}

.payment-status {
  font-size: 11px;
  font-weight: 600;
}

/* 🆕 Cash Payment Button */
.btn-cash {
  background: linear-gradient(135deg, #ffc107, #ff9800);
  color: #000;
  padding: 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-cash:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(255, 193, 7, 0.4);
}

/* Responsive */
@media (max-width: 480px) {
  .order-payment {
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  
  .payment-details {
    align-items: flex-start;
  }
  
  .amount-value {
    font-size: 18px;
  }
}
.fuel-route-info {
  padding: 16px;
  background: rgba(0, 255, 136, 0.1);
  border: 1px solid rgba(0, 255, 136, 0.3);
  border-radius: 12px;
  margin-bottom: 20px;
}

.fuel-info-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.fuel-info-row:last-child {
  border-bottom: none;
}

.fuel-info-row span {
  color: #a1a1aa;
}

.fuel-info-row strong {
  color: #00ff88;
}

/* EV Badge */
.route-badge.ev-badge {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.3);
  color: #3b82f6;
}

/* Stat Card EV */
.stat-card.ev {
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(59, 130, 246, 0.1);
}

.stat-card.ev .stat-icon {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.stat-card.ev .stat-value {
  color: #3b82f6;
}
</style>