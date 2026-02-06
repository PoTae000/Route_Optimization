<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';

  let currentUser: any = null;

  function logout() {
    // Stop navigation if running
    if (isNavigating) stopNavigation();
    // Stop all GPS watches
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (continuousWatchId !== null) {
      navigator.geolocation.clearWatch(continuousWatchId);
      continuousWatchId = null;
    }
    // Abort pending requests
    if (routeAbortController) { routeAbortController.abort(); routeAbortController = null; }
    // Clear all intervals
    if (extraFeaturesInterval) { clearInterval(extraFeaturesInterval); extraFeaturesInterval = null; }
    if (batteryInterval) { clearInterval(batteryInterval); batteryInterval = null; }
    if (oilPriceInterval) { clearInterval(oilPriceInterval); oilPriceInterval = null; }
    if (navigationInterval) { clearInterval(navigationInterval); navigationInterval = null; }
    // Remove event listeners
    if (browser) {
      window.removeEventListener('keydown', handleKeyboardShortcuts);
      if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
    }
    // Destroy map
    if (map) { try { map.off(); map.remove(); } catch(e) {} map = null; }
    // Clear all user-specific localStorage keys
    const userId = currentUser?.id || 'guest';
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.endsWith(`_${userId}`) || key === 'user')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    // Clear sessionStorage entirely
    sessionStorage.clear();
    // Navigate to login
    goto('/');
  }

  let map: any;
  let L: any;
  let deliveryPoints: any[] = [];
  let optimizedRoute: any = null;
  let routeLayer: any = null;
  let markers: any[] = [];
  const API_URL = 'http://localhost:3000/api';

  let newPoint = { name: '', address: '', lat: 13.7563, lng: 100.5018, priority: 3 };
  let isOptimizing = false;
  let showAddForm = false;
  let clickMarker: any = null;

  let notification = { show: false, message: '', type: 'success' as 'success' | 'error' | 'warning' };
  let activeTab: 'points' | 'route' = 'points';
  let activePointId: number | null = null;
  let isNavigating = false;
  let mobileSidebarOpen = true;
  let desktopSidebarCollapsed = false;
  let isDragMode = false;
  let lastDragUndo: { pointId: number; pointIndex: number; name: string; oldLat: number; oldLng: number; oldAddress?: string } | null = null;

  // Reorder mode (drag to reorder in sidebar)
  let isReorderMode = false;
  let manualOrder = false;
  let dragSourceIndex: number | null = null;
  let dragOverIndex: number | null = null;

  // ==================== GPS VARIABLES - COPIED FROM ORIGINAL ====================
  let currentLocation: { lat: number; lng: number; heading?: number | null; speed?: number | null } | null = null;
  let currentLocationMarker: any = null;
  let accuracyCircle: any = null;
  let headingMarkerElement: HTMLElement | null = null;
  let watchId: number | null = null;
  let continuousWatchId: number | null = null; // Always-on GPS tracking for marker
  let isMapFollowing = true; // auto-follow mode like Google Maps
  let currentHeading: number | null = null; // GPS heading in degrees
  let currentTargetIndex = 0;
  let remainingDistance = 0;
  let remainingTime = 0;
  let distanceToNextPoint = 0;
  let traveledLayer: any = null;
  let remainingRouteLayer: any = null;
  let navigationInterval: any = null;
  let extraFeaturesInterval: any = null;
  let batteryInterval: any = null;
  let oilPriceInterval: any = null;
  let resizeHandler: (() => void) | null = null;
  let routeAbortController: AbortController | null = null;
  let arrivedPoints: number[] = [];
  let accuracy = 0;

  let isProcessingDelivery = false;

  // Statistics
  let totalDeliveriesToday = 0;
  let completedDeliveries = 0;

  // Speed tracking (with low-pass filter for stability)
  let currentSpeed = 0;
  let maxSpeed = 0;
  let lastPosition: { lat: number; lng: number; time: number } | null = null;
  let avgSpeedSamples: number[] = []; // rolling average for ETA

  // Navigation stability: cached route + progressive index
  let cachedRouteCoords: [number, number][] = [];
  let lastRouteIndex = 0; // progressive search anchor
  let lastArrivalDist = Infinity; // hysteresis for arrival detection

  // ETA & Time
  let estimatedArrivalTime: Date | null = null;
  let navigationStartTime: Date | null = null;
  let elapsedTime = 0;

  // Weather (mock)
  let weather = { temp: 32, condition: 'sunny', humidity: 65 };


  // ==================== OIL PRICE API ====================
  interface OilPriceData {
    date: string;
    stations: {
      [key: string]: {
        [fuelType: string]: {
          name: string;
          price: string;
        };
      };
    };
  }
  let oilPriceData: OilPriceData | null = null;
  let isLoadingOilPrice = false;
  let oilPriceLastUpdated: Date | null = null;
  let selectedStation: string = 'ptt';
  let selectedFuelType: string = 'gasohol_95';
  let currentFuelPrice = 36; // fallback

  const stationOptions = [
    { value: 'ptt', label: 'ปตท.' },
    { value: 'bcp', label: 'บางจาก' },
    { value: 'shell', label: 'Shell' },
    { value: 'esso', label: 'Esso' },
    { value: 'caltex', label: 'Caltex' },
    { value: 'pt', label: 'PT' },
    { value: 'susco', label: 'Susco' },
    { value: 'pure', label: 'Pure' }
  ];

  const fuelTypeOptions = [
    { value: 'gasohol_95', label: 'แก๊สโซฮอล์ 95' },
    { value: 'gasohol_91', label: 'แก๊สโซฮอล์ 91' },
    { value: 'gasohol_e20', label: 'แก๊สโซฮอล์ E20' },
    { value: 'gasohol_e85', label: 'แก๊สโซฮอล์ E85' },
    { value: 'diesel_b7', label: 'ดีเซล B7' },
    { value: 'diesel', label: 'ดีเซล' },
    { value: 'premium_diesel', label: 'ดีเซลพรีเมียม' },
    { value: 'gasoline_95', label: 'เบนซิน 95' }
  ];

  async function fetchOilPrices() {
    isLoadingOilPrice = true;
    try {
      const res = await fetch('https://api.chnwt.dev/thai-oil-api/latest');
      const data = await res.json();

      if (data.status === 'success' && data.response) {
        oilPriceData = data.response;
        oilPriceLastUpdated = new Date();
        updateCurrentFuelPrice();
        showNotification(`อัปเดตราคาน้ำมันแล้ว (${data.response.date})`, 'success');
      } else {
        throw new Error('Invalid API response');
      }
    } catch (err) {
      console.error('Error fetching oil prices:', err);
      showNotification('ไม่สามารถดึงราคาน้ำมันได้ - ใช้ราคาเดิม', 'error');
      currentFuelPrice = 36;
    } finally {
      isLoadingOilPrice = false;
    }
  }

  function updateCurrentFuelPrice() {
    if (!oilPriceData?.stations) {
      currentFuelPrice = 36;
      return;
    }
    const station = oilPriceData.stations[selectedStation];
    if (station && station[selectedFuelType]) {
      currentFuelPrice = parseFloat(station[selectedFuelType].price) || 36;
    } else {
      for (const stationKey of Object.keys(oilPriceData.stations)) {
        const s = oilPriceData.stations[stationKey];
        if (s[selectedFuelType]) {
          currentFuelPrice = parseFloat(s[selectedFuelType].price) || 36;
          break;
        }
      }
    }

    localStorage.setItem(getUserKey('selectedStation'), selectedStation);
    localStorage.setItem(getUserKey('selectedFuelType'), selectedFuelType);
  }

  function getAvailableFuelTypes(): { value: string; label: string; price: string }[] {
    if (!oilPriceData?.stations || !oilPriceData.stations[selectedStation]) {
      return fuelTypeOptions.map(f => ({ ...f, price: '-' }));
    }
    const station = oilPriceData.stations[selectedStation];
    return fuelTypeOptions
      .filter(f => station[f.value])
      .map(f => ({
        ...f,
        price: station[f.value]?.price || '-'
      }));
  }

  function getAllStationPrices(): { station: string; label: string; price: string }[] {
    if (!oilPriceData?.stations) return [];

    return stationOptions
      .filter(s => oilPriceData!.stations[s.value]?.[selectedFuelType])
      .map(s => ({
        station: s.value,
        label: s.label,
        price: oilPriceData!.stations[s.value][selectedFuelType].price
      }))
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  }

  function getCheapestStation(): { label: string; price: string } | null {
    const prices = getAllStationPrices();
    return prices.length > 0 ? prices[0] : null;
  }

  function getSelectedFuelName(): string {
    const fuel = fuelTypeOptions.find(f => f.value === selectedFuelType);
    return fuel?.label || 'แก๊สโซฮอล์ 95';
  }

  function getSelectedStationName(): string {
    const station = stationOptions.find(s => s.value === selectedStation);
    return station?.label || 'ปตท.';
  }

  // Fuel estimation
  let fuelConsumption = 0;
  let fuelCostEstimate = 0;
  let KM_PER_LITER = 15;

  type VehicleType = 'fuel' | 'ev';
  let vehicleType: VehicleType = 'fuel';
  let ELECTRICITY_PRICE_PER_KWH = 4.5;
  let KWH_PER_100KM = 15;
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

  // Night mode (manual toggle, default dark)
  let nightMode = true;

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
  }
  let deliveryHistory: DeliveryRecord[] = [];

  let batteryLevel = 100;
  let isCharging = false;
  let chargingStations: ChargingStation[] = [];
  let chargingStationMarkers: any[] = [];
  let showChargingStations = true;
  let isLoadingStations = false;
  let selectedChargingStation: ChargingStation | null = null;
  let routeChargingStops: ChargingStation[] = [];

  // ==================== ALONG-ROUTE POI ====================
  interface RoutePOI {
    id: string;
    type: 'gas' | 'convenience' | 'restaurant' | 'cafe' | 'ev_charging' | 'viewpoint' | 'attraction' | 'temple' | 'park' | 'museum';
    name: string;
    lat: number;
    lng: number;
    routeIndex: number;
    distFromRoute: number;
    distAlongRoute: number;
    tags?: Record<string, string>;
  }
  let alongRoutePOIs: RoutePOI[] = [];
  let poiMarkers: any[] = [];
  let showPOIOverlay = false;
  let activePOITypes: Set<string> = new Set(['viewpoint', 'attraction']);
  let isLoadingPOIs = false;
  const POI_MAX_DIST = 500; // เพิ่มระยะค้นหาสำหรับสถานที่ท่องเที่ยว

  // 🔄 userInfo แทน driverInfo - เปลี่ยนจาก driver เป็น user
  $: userInfo = currentUser ? {
    name: currentUser.name || 'ไม่ระบุชื่อ',
    id: `USR-${currentUser.id}`,
    phone: currentUser.phone || '-',
    avatar: currentUser.avatar || '👤',
    role: currentUser.role || 'user'
  } : { name: 'กำลังโหลด...', id: '-', phone: '-', avatar: '👤', role: 'user' };


  $: filteredPoints = deliveryPoints;

  $: {
    const distanceKm = remainingDistance / 1000;
    if (vehicleType === 'fuel') {
      fuelConsumption = distanceKm / KM_PER_LITER;
      fuelCostEstimate = fuelConsumption * currentFuelPrice;
    } else {
      evEnergyConsumption = (distanceKm / 100) * KWH_PER_100KM;
      evCostEstimate = evEnergyConsumption * ELECTRICITY_PRICE_PER_KWH;
      evRemainingRange = (evCurrentCharge / 100) * evRangePerCharge;
      const energyUsedPercent = (evEnergyConsumption / evBatteryCapacity) * 100;
      evBatteryAfterTrip = Math.max(0, evCurrentCharge - energyUsedPercent);
    }
  }

  // 🔄 ลบ customer orders ออก - User page ไม่มี customer system
  $: allDeliveryPoints = deliveryPoints.map(p => ({ ...p, isCustomerOrder: false }));

  let alerts: { id: number; type: string; message: string; time: Date }[] = [];
  let showAlerts = false;
  let gpsStatus: 'excellent' | 'good' | 'weak' | 'poor' = 'good';

  // ==================== ADVANCED NAVIGATION FEATURES ====================

  // Route Alternatives
  let routeAlternatives: any[] = [];
  let selectedRouteIndex = 0;
  let showRouteSelector = false;
  let alternativeRouteLayers: any[] = [];
  const routeColors = ['#00ff88', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316', '#ec4899', '#6366f1', '#84cc16', '#06b6d4', '#e11d48'];
  const routeLabels = ['เส้นทางที่เร็วที่สุด', 'เส้นทางทางเลือก', 'เส้นทาง 3', 'เส้นทาง 4', 'เส้นทาง 5', 'เส้นทาง 6', 'เส้นทาง 7', 'เส้นทาง 8', 'เส้นทาง 9', 'เส้นทาง 10', 'เส้นทาง 11', 'เส้นทาง 12'];

  // Toll & Expressway Options
  let avoidTollRoads = false;
  let avoidExpressways = false;
  let routePreference: 'fastest' | 'shortest' | 'no_tolls' | 'no_highways' = 'fastest';
  let tollCostEstimate = 0;

  // Traffic
  let showTraffic = false;
  let trafficLayers: any[] = [];

  // Off-Route Detection & Auto-Rerouting
  let isOffRoute = false;
  let offRouteThreshold = 150; // meters
  let autoRerouteEnabled = true;
  let lastRerouteTime = 0;
  let rerouteCooldown = 15000; // 15 seconds
  let offRouteDistance = 0;
  let consecutiveOffRouteCount = 0;
  let offRouteRequiredCount = 3;
  let rerouteCount = 0;
  let lastVoiceTime = 0;
  let lastSpokenStepIndex = -1;
  let lastSpokenThreshold = '';

  // Turn-by-Turn Navigation
  interface TurnInstruction {
    type: string;
    modifier?: string;
    name: string;
    distance: number;
    duration: number;
    location: [number, number];
  }
  let turnInstructions: TurnInstruction[] = [];
  let currentStepIndex = 0;
  let nextTurnDistance = 0;
  let nextTurnInstruction = '';
  let nextTurnIcon = '';

  // Destination Search (Nominatim)
  let searchQuery = '';
  let searchResults: any[] = [];
  let isSearching = false;
  let searchDebounceTimer: any = null;
  let showSearchResults = false;
  let destinationMarker: any = null;

  // Recent Searches
  interface RecentSearch {
    name: string;
    address: string;
    lat: number;
    lng: number;
    timestamp: number;
  }
  let recentSearches: RecentSearch[] = [];
  const MAX_RECENT_SEARCHES = 8;

  // Direct A→B Navigation
  let directDestination: { lat: number; lng: number; name: string; address: string } | null = null;

  // Saved/Favorite Routes
  interface SavedRoute {
    id: string;
    name: string;
    from: { lat: number; lng: number; name: string };
    to: { lat: number; lng: number; name: string };
    distance: number;
    duration: number;
    avoidTolls: boolean;
    createdAt: string;
  }
  let savedRoutes: SavedRoute[] = [];
  let showSavedRoutes = false;

  // Speed Alert
  let speedAlertEnabled = true;
  let speedLimitWarning = false;
  let estimatedSpeedLimit = 90;

  // Route Comparison
  let showRouteComparison = false;

  // Share Route QR
  let showShareQR = false;
  let shareQRUrl = '';

  // ==================== TRAFFIC INCIDENTS ====================
  interface TrafficIncident {
    id: string;
    type: 'accident' | 'construction' | 'road_closed' | 'congestion' | 'hazard' | 'event';
    severity: 'minor' | 'moderate' | 'major' | 'critical';
    title: string;
    description: string;
    lat: number;
    lng: number;
    road: string;
    startTime: Date;
    endTime?: Date;
    delay?: number; // minutes
  }
  let trafficIncidents: TrafficIncident[] = [];
  let incidentMarkers: any[] = [];
  let showIncidentsPanel = false;
  let isLoadingIncidents = false;
  let lastIncidentFetch: Date | null = null;
  let incidentsOnRoute: TrafficIncident[] = [];
  let selectedIncidentFilter: 'all' | 'accident' | 'construction' | 'road_closed' | 'congestion' = 'all';

  // Cache for re-selection
  let _lastStartPoint: any = null;
  let _lastSortedPoints: any[] = [];

  // ==================== 2-OPT OPTIMIZATION ====================
  let isOptimizingOrder = false;
  let optimizationProgress = 0;
  let useRealDistances = false;
  let showOptimizationResult = false;
  let optimizationResult: { beforeDistance: number; afterDistance: number; improvement: number } | null = null;

  // Save/Restore route state across page refresh
  function saveRouteState() {
    if (!optimizedRoute || !routeAlternatives.length) return;
    try {
      // Strip heavy legs data — save extracted turnInstructions instead
      const lightAlts = routeAlternatives.map((r: any) => ({
        index: r.index, geometry: r.geometry,
        distance: r.distance, duration: r.duration,
        hasTolls: r.hasTolls, tollEstimate: r.tollEstimate,
        label: r.label, color: r.color, excludeUsed: r.excludeUsed,
        _turns: extractTurnInstructions(r)
      }));
      sessionStorage.setItem(getUserKey('routeState'), JSON.stringify({
        alts: lightAlts,
        idx: selectedRouteIndex,
        start: _lastStartPoint,
        pts: _lastSortedPoints
      }));
    } catch (e) { console.warn('Route state save failed:', e); }
  }

  function clearRouteState() {
    sessionStorage.removeItem(getUserKey('routeState'));
  }

  function restoreRouteState(): boolean {
    try {
      const saved = sessionStorage.getItem(getUserKey('routeState'));
      if (!saved) return false;
      const state = JSON.parse(saved);
      if (!state.alts?.length || !state.start) return false;
      routeAlternatives = state.alts;
      selectRoute(state.idx || 0, state.start, state.pts || [], true);
      return true;
    } catch (e) { console.warn('Route state restore failed:', e); return false; }
  }

  // Navigation alternative route layers (faded lines during navigation)
  let navAlternativeLayers: any[] = [];
  let altLabelMarkers: any[] = []; // track label markers for zoom-dependent visibility

  // Manual waypoints (จุดผ่านทาง - custom route editing during navigation)
  let customWaypoints: { lat: number; lng: number; id: number }[] = [];
  let customWaypointMarkers: any[] = [];
  let isAddingWaypoint = false;
  let nextWaypointId = 1;
  let isRecalculatingRoute = false;

  // Enhanced navigation features
  let nextTurnMarker: any = null;
  let turnApproaching = false;
  let currentRoadName = '';
  let compassHeading = 0;
  let compassDir = 'N';
  let lastDeliveryUndo: { point: any; index: number; time: number } | null = null;
  let undoTimeout: any = null;

  // Curve Warning & Lane Guidance
  let curveWarning: { active: boolean; severity: 'gentle' | 'sharp' | 'hairpin'; distance: number; direction: 'left' | 'right' } | null = null;
  let laneGuidance: { show: boolean; lane: 'left' | 'right' | 'center'; instruction: string } | null = null;
  let upcomingCurves: { distance: number; angle: number; direction: 'left' | 'right' }[] = [];

  // ==================== HELPER FUNCTIONS ====================

  // 🔄 ใช้ user_id แทน driver_id
  async function loadTodayStats() {
    try {
      const params = new URLSearchParams();
      if (currentUser?.id) params.append('user_id', String(currentUser.id));
      params.append('table', 'users');
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
      if (currentUser?.id) params.append('user_id', String(currentUser.id));
      params.append('table', 'users');
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
      if (currentUser?.id) params.append('user_id', String(currentUser.id));
      params.append('table', 'users');
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
        user_id: p.user_id ? Number(p.user_id) : null
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
          className: `custom-marker${isDragMode ? ' drag-mode' : ''}`,
          html: `<div class="marker-pin${isDragMode ? ' draggable' : ''}" style="background: ${colors.bg}; box-shadow: 0 0 20px ${colors.glow};"><span>${i + 1}</span>${isDragMode ? '<div class="drag-hint">✥</div>' : ''}</div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        }),
        draggable: isDragMode
      }).addTo(map);
      marker.bindPopup(`<div class="custom-popup"><div class="popup-header" style="background: ${colors.bg}"><span class="popup-number">${i + 1}</span><span class="popup-priority">P${point.priority}</span></div><div class="popup-content"><h4>${point.name}</h4><p>${point.address}</p></div></div>`, { className: 'dark-popup' });
      marker.on('dragend', async () => {
        const pos = marker.getLatLng();
        const oldLat = point.lat, oldLng = point.lng;
        const oldAddress = point.address;
        deliveryPoints[i] = { ...deliveryPoints[i], lat: pos.lat, lng: pos.lng };
        deliveryPoints = [...deliveryPoints];

        // ดึงที่อยู่ใหม่จาก reverse geocoding
        let newAddress = oldAddress;
        const geoResult = await reverseGeocode(pos.lat, pos.lng);
        if (geoResult) {
          newAddress = geoResult.address;
          deliveryPoints[i] = { ...deliveryPoints[i], address: newAddress };
          deliveryPoints = [...deliveryPoints];
        }

        try {
          const res = await fetch(`${API_URL}/points/${point.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: pos.lat, lng: pos.lng, address: newAddress, user_id: currentUser?.id, table: 'users' })
          });
          if (!res.ok) throw new Error();
          lastDragUndo = { pointId: point.id, pointIndex: i, name: point.name, oldLat, oldLng, oldAddress };
          showNotification(`ย้าย "${point.name}" สำเร็จ`, 'success');
          displayPoints(); // อัปเดต popup ด้วยที่อยู่ใหม่
          if (optimizedRoute) await optimizeRoute();
        } catch {
          deliveryPoints[i] = { ...deliveryPoints[i], lat: oldLat, lng: oldLng, address: oldAddress };
          deliveryPoints = [...deliveryPoints];
          marker.setLatLng([oldLat, oldLng]);
          showNotification('ย้ายจุดไม่สำเร็จ', 'error');
        }
      });
      markers.push(marker);
    });
  }

  function toggleDragMode() {
    isDragMode = !isDragMode;
    if (!isDragMode) lastDragUndo = null;
    isReorderMode = false;
    displayPoints();
    showNotification(isDragMode ? 'โหมดย้ายจุด: ลากจุดแวะเพื่อย้ายตำแหน่ง' : 'ปิดโหมดย้ายจุด', isDragMode ? 'warning' : 'success');
  }

  async function undoDragPoint() {
    if (!lastDragUndo) return;
    const { pointId, pointIndex, name, oldLat, oldLng, oldAddress } = lastDragUndo;
    lastDragUndo = null;
    try {
      const updateData: any = { lat: oldLat, lng: oldLng, user_id: currentUser?.id, table: 'users' };
      if (oldAddress) updateData.address = oldAddress;

      const res = await fetch(`${API_URL}/points/${pointId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      if (!res.ok) throw new Error();

      const pointUpdate: any = { lat: oldLat, lng: oldLng };
      if (oldAddress) pointUpdate.address = oldAddress;
      deliveryPoints[pointIndex] = { ...deliveryPoints[pointIndex], ...pointUpdate };
      deliveryPoints = [...deliveryPoints];
      displayPoints();
      showNotification(`ย้าย "${name}" กลับตำแหน่งเดิมแล้ว`, 'success');
      if (optimizedRoute) await optimizeRoute();
    } catch {
      showNotification('เลิกทำไม่สำเร็จ', 'error');
    }
  }

  // ==================== REORDER MODE (sidebar drag) ====================
  function toggleReorderMode() {
    isReorderMode = !isReorderMode;
    isDragMode = false;
    isMultiSelectMode = false;
    selectedPoints = [];
    dragSourceIndex = null;
    dragOverIndex = null;
    showNotification(isReorderMode ? 'โหมดลากเรียงลำดับ: ลากจุดแวะเพื่อเปลี่ยนลำดับ' : 'ปิดโหมดลากเรียงลำดับ', isReorderMode ? 'warning' : 'success');
  }

  function handleReorderDragStart(e: DragEvent, index: number) {
    dragSourceIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  function handleReorderDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOverIndex = index;
  }

  function handleReorderDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    if (dragSourceIndex === null || dragSourceIndex === targetIndex) {
      dragSourceIndex = null;
      dragOverIndex = null;
      return;
    }
    const [moved] = deliveryPoints.splice(dragSourceIndex, 1);
    deliveryPoints.splice(targetIndex, 0, moved);
    deliveryPoints = [...deliveryPoints];
    manualOrder = true;
    dragSourceIndex = null;
    dragOverIndex = null;
    displayPoints();
    showNotification('เปลี่ยนลำดับจุดแวะแล้ว', 'success');
    if (optimizedRoute) optimizeRoute();
  }

  function handleReorderDragEnd() {
    dragSourceIndex = null;
    dragOverIndex = null;
  }

  function resetManualOrder() {
    manualOrder = false;
    showNotification('กลับไปใช้ลำดับอัตโนมัติ (ใกล้สุดก่อน)', 'success');
    if (optimizedRoute) optimizeRoute();
  }

  async function addDeliveryPoint() {
    if (!newPoint.name.trim() || !newPoint.address.trim()) {
      showNotification('กรุณากรอกข้อมูลให้ครบ', 'error');
      return;
    }
    try {
      const payload = { ...newPoint, user_id: currentUser?.id || null };
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
      showNotification('เพิ่มจุดแวะสำเร็จ', 'success');
    } catch (err) {
      showNotification('เพิ่มไม่สำเร็จ', 'error');
    }
  }

  async function deletePoint(id: number, name: string) {
    if (!confirm(`ลบ "${name}" ใช่หรือไม่?`)) return;
    try {
      const params = new URLSearchParams();
      if (currentUser?.id) params.append('user_id', String(currentUser.id));
      params.append('table', 'users');
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

  // ==================== OSRM via Backend Proxy ====================
  async function callOSRMProxy(waypoints: string, options?: { alternatives?: boolean; steps?: boolean; exclude?: string[]; annotations?: string }, signal?: AbortSignal): Promise<any> {
    const payload: any = { waypoints };
    if (options?.alternatives) payload.alternatives = true;
    if (options?.steps) payload.steps = true;
    if (options?.exclude && options.exclude.length > 0) payload.exclude = options.exclude.join(',');
    if (options?.annotations) payload.annotations = options.annotations;
    const res = await fetch(`${API_URL}/route/osrm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('ไม่สามารถคำนวณเส้นทางได้');
    return data;
  }

  // ==================== ROUTE ALTERNATIVES ====================

  function getExcludeOptions(): string[] {
    const exclude: string[] = [];
    if (avoidTollRoads) exclude.push('toll');
    if (avoidExpressways) exclude.push('motorway');
    return exclude;
  }

  async function fetchRouteAlternatives(waypoints: string, signal?: AbortSignal): Promise<any[]> {
    const allRoutes: any[] = [];
    const seenKeys = new Set<string>();

    function addIfUnique(route: any, label: string, color: string, excludeUsed: string[]) {
      const key = `${Math.round(route.distance / 500)}-${Math.round(route.duration / 60)}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allRoutes.push({ ...route, _label: label, _color: color, _exclude: excludeUsed });
      }
    }

    const points = waypoints.split(';');
    const excludeConfigs: { exclude?: string[]; label: string }[] = [
      { exclude: undefined, label: '' },
      { exclude: ['toll'], label: 'เลี่ยงด่วน' },
      { exclude: ['motorway'], label: 'เลี่ยงมอเตอร์เวย์' },
      { exclude: ['toll', 'motorway'], label: 'เลี่ยงด่วน+มอเตอร์เวย์' }
    ];

    const annot = showTraffic ? 'congestion' : undefined;

    if (points.length <= 2) {
      // === Single segment — 4 calls with alternatives ===
      const results = await Promise.allSettled(
        excludeConfigs.map(cfg => callOSRMProxy(waypoints, { steps: true, alternatives: true, exclude: cfg.exclude, annotations: annot }, signal))
      );
      results.forEach((res, ci) => {
        if (res.status !== 'fulfilled' || !res.value.routes) return;
        const suffix = excludeConfigs[ci].label ? ` (${excludeConfigs[ci].label})` : '';
        res.value.routes.forEach((r: any) => {
          const label = allRoutes.length === 0 ? 'เส้นทางเร็วที่สุด' : `เส้นทาง ${allRoutes.length + 1}${suffix}`;
          addIfUnique(r, label, routeColors[allRoutes.length % routeColors.length], excludeConfigs[ci].exclude || []);
        });
      });
    } else {
      // === Multiple segments — per-segment alternatives แล้ว stitch รวมกัน ===
      const segments: string[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        segments.push(`${points[i]};${points[i + 1]}`);
      }

      // Fetch all segments × all configs in parallel
      const allCalls: Promise<any>[] = [];
      for (const seg of segments) {
        for (const cfg of excludeConfigs) {
          allCalls.push(callOSRMProxy(seg, { steps: true, alternatives: true, exclude: cfg.exclude, annotations: annot }, signal));
        }
      }
      const results = await Promise.allSettled(allCalls);

      // Organize: segAlts[segIdx] = array of unique routes for that segment
      const segAlts: any[][] = [];
      let ri = 0;
      for (let s = 0; s < segments.length; s++) {
        const segRoutes: any[] = [];
        const segSeen = new Set<string>();
        for (let c = 0; c < excludeConfigs.length; c++) {
          const res = results[ri++];
          if (res.status !== 'fulfilled' || !res.value.routes) continue;
          for (const route of res.value.routes) {
            const key = `${Math.round(route.distance / 500)}-${Math.round(route.duration / 60)}`;
            if (!segSeen.has(key)) {
              segSeen.add(key);
              segRoutes.push({ ...route, _exclude: excludeConfigs[c].exclude || [] });
            }
          }
        }
        segRoutes.sort((a, b) => a.duration - b.duration);
        segAlts[s] = segRoutes;
      }

      // Stitch segment routes into one full route
      function stitchRoutes(picks: any[]): any {
        const coords: number[][] = [];
        let totalDist = 0, totalDur = 0;
        const allLegs: any[] = [];
        const excludes = new Set<string>();
        picks.forEach((route, i) => {
          const c = route.geometry?.coordinates || [];
          coords.push(...(i === 0 ? c : c.slice(1)));
          totalDist += route.distance;
          totalDur += route.duration;
          if (route.legs) allLegs.push(...route.legs);
          (route._exclude || []).forEach((e: string) => excludes.add(e));
        });
        return {
          geometry: { type: 'LineString', coordinates: coords },
          distance: totalDist, duration: totalDur,
          legs: allLegs, _exclude: Array.from(excludes)
        };
      }

      // Strategy 1-5: fixed strategies (fastest, shortest, avoid-toll, avoid-motorway, avoid-both)
      const strategies: { name: string; pick: (segs: any[][]) => (any | null)[] }[] = [
        { name: 'เส้นทางเร็วที่สุด', pick: segs => segs.map(s => s[0]) },
        { name: 'เส้นทางสั้นที่สุด', pick: segs => segs.map(s => [...s].sort((a, b) => a.distance - b.distance)[0]) },
        { name: 'เลี่ยงทางด่วน', pick: segs => segs.map(s => s.find(r => r._exclude?.includes('toll')) || s[0]) },
        { name: 'เลี่ยงมอเตอร์เวย์', pick: segs => segs.map(s => s.find(r => r._exclude?.includes('motorway')) || s[0]) },
        { name: 'เลี่ยงด่วน+มอเตอร์เวย์', pick: segs => segs.map(s => s.find(r => r._exclude?.includes('toll') && r._exclude?.includes('motorway')) || s[0]) },
      ];

      for (const st of strategies) {
        try {
          const picks = st.pick(segAlts);
          if (picks.every(Boolean)) {
            const stitched = stitchRoutes(picks);
            addIfUnique(stitched, st.name, routeColors[allRoutes.length % routeColors.length], stitched._exclude);
          }
        } catch {}
      }

      // Strategy 6+: per-segment variations — swap alt into one segment, keep others fastest
      for (let s = 0; s < segments.length; s++) {
        const maxAlts = Math.min(segAlts[s].length, 4);
        for (let a = 1; a < maxAlts; a++) {
          const picks = segAlts.map((seg, idx) => idx === s ? seg[a] : seg[0]);
          if (picks.every(Boolean)) {
            const stitched = stitchRoutes(picks);
            const label = `เส้นทาง ${allRoutes.length + 1} (ช่วง ${s + 1} ทางเลือก)`;
            addIfUnique(stitched, label, routeColors[allRoutes.length % routeColors.length], stitched._exclude);
          }
        }
      }
    }

    // Fallback
    if (allRoutes.length === 0) {
      const data = await callOSRMProxy(waypoints, { steps: true });
      allRoutes.push({ ...data.routes[0], _label: 'เส้นทางหลัก', _color: '#00ff88', _exclude: [] });
    }

    return allRoutes;
  }

  function extractTurnInstructions(route: any): TurnInstruction[] {
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

  function getTurnIcon(type: string, modifier?: string): string {
    // Mapbox modifier-based icons
    const modIcons: Record<string, string> = {
      'uturn': '🔃', 'sharp right': '↪️', 'right': '➡️', 'slight right': '↗️',
      'straight': '⬆️', 'slight left': '↖️', 'left': '⬅️', 'sharp left': '↩️'
    };
    // Type-based icons (fallback)
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

  function getTurnText(type: string, modifier?: string, name?: string): string {
    const road = name && name !== 'ถนนไม่ทราบชื่อ' && name !== '' ? ` ${name}` : '';
    // Modifier-based Thai text
    const modTexts: Record<string, string> = {
      'uturn': 'กลับรถ', 'sharp right': 'เลี้ยวขวาแหลม', 'right': 'เลี้ยวขวา',
      'slight right': 'เบี่ยงขวาเล็กน้อย', 'straight': 'ตรงไป',
      'slight left': 'เบี่ยงซ้ายเล็กน้อย', 'left': 'เลี้ยวซ้าย', 'sharp left': 'เลี้ยวซ้ายแหลม'
    };
    // Type-specific overrides
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
    // Default: use modifier text
    if (modifier && modTexts[modifier]) return `${modTexts[modifier]}${road}`;
    return `ไปต่อ${road}`;
  }

  function detectTollRoad(route: any): boolean {
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

  function getExpresswayNames(route: any): string[] {
    const names = new Set<string>();
    if (!route.legs) return [];
    for (const leg of route.legs) {
      if (!leg.steps) continue;
      for (const step of leg.steps) {
        const name = step.name || '';
        const ref = step.ref || '';
        const lower = name.toLowerCase();
        if (lower.includes('motorway') || lower.includes('expressway') || lower.includes('ทางด่วน') || lower.includes('toll') || ref.toLowerCase().includes('motorway')) {
          names.add(name || ref);
        }
      }
    }
    return Array.from(names).filter(Boolean);
  }

  function estimateTollCost(route: any): number {
    const distKm = route.distance / 1000;
    if (!detectTollRoad(route)) return 0;
    return Math.round(distKm * 2.5 + 25); // ค่าผ่านทางโดยประมาณ
  }

  // ==================== TRAFFIC CONGESTION ====================
  const CONGESTION_COLORS: Record<string, string> = {
    'unknown': '#00ff88',
    'low': '#00ff88',
    'moderate': '#f59e0b',
    'heavy': '#ef4444',
    'severe': '#991b1b'
  };

  function getCongestionColor(level: string): string {
    return CONGESTION_COLORS[level] || CONGESTION_COLORS['unknown'];
  }

  // Get line options based on congestion level - enhanced styling
  function getTrafficLineOptions(level: string, baseWeight: number): { weight: number; opacity: number; dashArray?: string; className?: string } {
    switch (level) {
      case 'severe':
        return { weight: baseWeight + 3, opacity: 1, className: 'traffic-severe' };
      case 'heavy':
        return { weight: baseWeight + 2, opacity: 1, className: 'traffic-heavy' };
      case 'moderate':
        return { weight: baseWeight + 1, opacity: 0.9, dashArray: '12 6' };
      case 'low':
        return { weight: baseWeight, opacity: 0.85 };
      default:
        return { weight: baseWeight, opacity: 0.7 };
    }
  }

  function clearTrafficLayers() {
    trafficLayers.forEach(l => { try { if (map) map.removeLayer(l); } catch {} });
    trafficLayers = [];
  }

  function drawTrafficPolyline(route: any, weight: number, opacity: number) {
    clearTrafficLayers();
    if (!route?.geometry?.coordinates || !route?.legs) return;
    // Collect congestion from all legs
    const allCongestion: string[] = [];
    for (const leg of route.legs) {
      if (leg.annotation?.congestion) {
        allCongestion.push(...leg.annotation.congestion);
      }
    }
    if (allCongestion.length === 0) return;
    const coords = route.geometry.coordinates;

    // Enhanced: track current congestion level for styling
    let currentLevel = allCongestion[0];
    let currentColor = getCongestionColor(currentLevel);
    let segCoords: [number, number][] = [[coords[0][1], coords[0][0]]];

    for (let i = 0; i < allCongestion.length && i < coords.length - 1; i++) {
      const level = allCongestion[i];
      const color = getCongestionColor(level);
      const nextCoord: [number, number] = [coords[i + 1][1], coords[i + 1][0]];

      if (color === currentColor) {
        segCoords.push(nextCoord);
      } else {
        // Finish current segment with enhanced styling
        segCoords.push(nextCoord);
        const opts = getTrafficLineOptions(currentLevel, weight);

        // Draw glow layer for heavy/severe traffic
        if (currentLevel === 'heavy' || currentLevel === 'severe') {
          const glowLine = L.polyline(segCoords, {
            color: currentColor,
            weight: opts.weight + 6,
            opacity: 0.3,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(map);
          trafficLayers.push(glowLine);
        }

        // Main traffic line
        const line = L.polyline(segCoords, {
          color: currentColor,
          weight: opts.weight,
          opacity: opts.opacity,
          lineCap: 'round',
          lineJoin: 'round',
          dashArray: opts.dashArray
        }).addTo(map);
        trafficLayers.push(line);

        // Start new segment from overlap point
        segCoords = [nextCoord];
        currentLevel = level;
        currentColor = color;
      }
    }

    // Draw last segment with enhanced styling
    if (segCoords.length >= 2) {
      const opts = getTrafficLineOptions(currentLevel, weight);

      // Glow for heavy/severe
      if (currentLevel === 'heavy' || currentLevel === 'severe') {
        const glowLine = L.polyline(segCoords, {
          color: currentColor,
          weight: opts.weight + 6,
          opacity: 0.3,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);
        trafficLayers.push(glowLine);
      }

      const line = L.polyline(segCoords, {
        color: currentColor,
        weight: opts.weight,
        opacity: opts.opacity,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: opts.dashArray
      }).addTo(map);
      trafficLayers.push(line);
    }
  }

  // Get traffic statistics for legend
  function getTrafficStats(route: any): { low: number; moderate: number; heavy: number; severe: number; total: number } {
    const stats = { low: 0, moderate: 0, heavy: 0, severe: 0, total: 0 };
    if (!route?.legs) return stats;
    for (const leg of route.legs) {
      if (!leg.annotation?.congestion) continue;
      for (const c of leg.annotation.congestion) {
        stats.total++;
        if (c === 'low' || c === 'unknown') stats.low++;
        else if (c === 'moderate') stats.moderate++;
        else if (c === 'heavy') stats.heavy++;
        else if (c === 'severe') stats.severe++;
      }
    }
    return stats;
  }

  function getTrafficSummary(route: any): { level: string; label: string; color: string } {
    if (!route?.legs) return { level: 'unknown', label: 'ไม่ทราบ', color: '#6b7280' };
    const all: string[] = [];
    for (const leg of route.legs) {
      if (leg.annotation?.congestion) all.push(...leg.annotation.congestion);
    }
    if (all.length === 0) return { level: 'unknown', label: 'ไม่ทราบ', color: '#6b7280' };
    const counts: Record<string, number> = {};
    all.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
    const total = all.length;
    const heavyPct = ((counts['heavy'] || 0) + (counts['severe'] || 0)) / total;
    const moderatePct = (counts['moderate'] || 0) / total;
    if (heavyPct > 0.3) return { level: 'heavy', label: 'รถติดมาก', color: '#ef4444' };
    if (heavyPct > 0.1 || moderatePct > 0.3) return { level: 'moderate', label: 'รถปานกลาง', color: '#f59e0b' };
    return { level: 'low', label: 'รถไม่ติด', color: '#00ff88' };
  }

  function toggleTraffic() {
    showTraffic = !showTraffic;
    localStorage.setItem(getUserKey('showTraffic'), String(showTraffic));
    if (showTraffic && optimizedRoute) {
      // Refetch with traffic annotations
      optimizeRoute();
    } else {
      clearTrafficLayers();
    }
  }

  // ปรับความหนาเส้นตาม zoom — บางลงเมื่อซูมออก
  function getRouteWeight(zoom: number): { main: number; mainSel: number } {
    if (zoom >= 15) return { main: 4, mainSel: 5 };
    if (zoom >= 13) return { main: 3, mainSel: 4 };
    if (zoom >= 11) return { main: 2, mainSel: 3 };
    return { main: 1, mainSel: 2 };
  }

  function updateRouteWeights() {
    if (!map) return;
    const w = getRouteWeight(map.getZoom());
    alternativeRouteLayers.forEach((layer: any) => {
      if (!layer.setStyle || !layer.options?._isRoute) return;
      layer.setStyle({ weight: layer.options._isSelected ? w.mainSel : w.main });
    });
    if (routeLayer) routeLayer.setStyle({ weight: w.mainSel });
  }

  function displayAllRouteAlternatives(startPoint: any, sortedPoints: any[]) {
    clearAlternativeRouteLayers();
    const w = getRouteWeight(map?.getZoom?.() || 14);
    routeAlternatives.forEach((alt, idx) => {
      if (!alt.geometry?.coordinates) return;
      const coords = alt.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
      const isSelected = idx === selectedRouteIndex;
      const color = alt.color || routeColors[idx % routeColors.length];
      const mainLine = L.polyline(coords, {
        color: color, weight: isSelected ? w.mainSel : w.main, opacity: isSelected ? 1 : 0.5,
        lineCap: 'round', lineJoin: 'round', dashArray: isSelected ? '' : '10 8',
        _isSelected: isSelected, _isRoute: true
      } as any).addTo(map);
      mainLine.on('click', () => selectRoute(idx, startPoint, sortedPoints));
      const midIdx = Math.floor(coords.length / 2);
      const labelMarker = L.marker(coords[midIdx], {
        icon: L.divIcon({
          className: 'route-label-marker',
          html: `<div class="route-alt-label" style="background: ${color}; opacity: ${isSelected ? 1 : 0.7}">
            <span class="alt-label-text">${alt.label}</span>
            <span class="alt-label-info">${(alt.distance / 1000).toFixed(1)} กม. · ${Math.round(alt.duration / 60)} นาที</span>
            ${alt.hasTolls ? '<span class="alt-toll-badge">💰 ทางด่วน ~฿' + alt.tollEstimate + '</span>' : '<span class="alt-no-toll">✅ ไม่มีทางด่วน</span>'}
          </div>`,
          iconSize: [200, 70], iconAnchor: [100, 35]
        })
      }).addTo(map);
      alternativeRouteLayers.push(mainLine, labelMarker);
    });
  }

  function clearAlternativeRouteLayers() {
    alternativeRouteLayers.forEach(layer => {
      try { map.removeLayer(layer); } catch (e) {}
    });
    alternativeRouteLayers = [];
    altLabelMarkers = [];
    if (map) map.off('zoomend', updateAltLabelVisibility);
  }

  function updateAltLabelVisibility() {
    if (!map) return;
    const zoom = map.getZoom();
    altLabelMarkers.forEach(marker => {
      const el = marker.getElement?.();
      if (!el) return;
      if (zoom >= 11) {
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      } else if (zoom >= 10) {
        el.style.opacity = '0.6';
        el.style.pointerEvents = 'auto';
      } else {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
    });
  }

  // Show faded alternative routes during navigation (clickable to switch)
  // Show alternatives during navigation - only diverging sections
  function displayNavAlternatives() {
    clearNavAlternativeLayers();
    if (!routeAlternatives || routeAlternatives.length <= 1) return;
    const selected = routeAlternatives[selectedRouteIndex];
    if (!selected?.geometry?.coordinates) return;
    const mainCoords: [number, number][] = selected.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);

    routeAlternatives.forEach((alt, idx) => {
      if (idx === selectedRouteIndex) return;
      if (!alt.geometry?.coordinates) return;

      const altCoords: [number, number][] = alt.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
      const color = alt.color || routeColors[idx % routeColors.length];
      const divergingSections = getDivergingSections(altCoords, mainCoords);

      if (divergingSections.length === 0) return;

      const sectionLayers: any[] = [];
      const dw = getRouteWeight(map.getZoom());
      divergingSections.forEach(section => {
        if (section.length < 2) return;
        const line = L.polyline(section, {
          color: color, weight: dw.main, opacity: 0.15, lineCap: 'round', lineJoin: 'round'
        }).addTo(map);
        const hit = L.polyline(section, {
          color: 'transparent', weight: 30, opacity: 0
        }).addTo(map);
        sectionLayers.push(line, hit);
        navAlternativeLayers.push(line, hit);
      });

      // Label at longest diverging section
      const longestSection = divergingSections.reduce((a, b) => a.length > b.length ? a : b);
      const labelPoint = longestSection[Math.floor(longestSection.length / 2)];
      const timeDiff = Math.round((alt.duration - selected.duration) / 60);
      const timeLabel = timeDiff > 0 ? `+${timeDiff} น.` : timeDiff < 0 ? `-${Math.abs(timeDiff)} น.` : '=';

      const labelMarker = L.marker(labelPoint, {
        icon: L.divIcon({
          className: 'route-label-marker',
          html: `<div class="nav-alt-label" style="border-color: ${color}">
            <span class="nav-alt-name" style="color: ${color}">${alt.label}</span>
            <span class="nav-alt-info">${timeLabel} · ${(alt.distance / 1000).toFixed(1)} กม.</span>
          </div>`,
          iconSize: [140, 40], iconAnchor: [70, 20]
        })
      }).addTo(map);
      navAlternativeLayers.push(labelMarker);
      altLabelMarkers.push(labelMarker);

      const switchHandler = () => switchNavRoute(idx);
      sectionLayers.filter((_, i) => i % 3 >= 1).forEach(l => l.on('click', switchHandler));
      labelMarker.on('click', switchHandler);
    });

    // Zoom-dependent label visibility
    if (map && altLabelMarkers.length > 0) {
      map.on('zoomend', updateAltLabelVisibility);
      updateAltLabelVisibility();
    }

    // Bring main route to front so shared sections show only the main route line
    if (routeLayer) routeLayer.bringToFront();
    if (remainingRouteLayer) remainingRouteLayer.bringToFront();
  }

  function clearNavAlternativeLayers() {
    navAlternativeLayers.forEach(layer => {
      try { if (map) map.removeLayer(layer); } catch (e) {}
    });
    navAlternativeLayers = [];
    altLabelMarkers = [];
    if (map) map.off('zoomend', updateAltLabelVisibility);
  }

  // Switch to an alternative route during navigation
  function switchNavRoute(index: number) {
    if (!routeAlternatives[index]) return;
    const alt = routeAlternatives[index];
    selectedRouteIndex = index;

    // Sync routePreference with selected route type
    if (alt.excludeUsed?.includes('toll')) routePreference = 'no_tolls';
    else if (alt.excludeUsed?.includes('motorway')) routePreference = 'no_highways';
    else if (index === 0) routePreference = 'fastest';

    // Update optimized route with the new geometry
    optimizedRoute = {
      ...optimizedRoute,
      route: { geometry: alt.geometry },
      total_distance: alt.distance,
      total_time: alt.duration
    };

    // Update cached route coordinates for progressive search
    if (alt.geometry?.coordinates) {
      cachedRouteCoords = alt.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
      lastRouteIndex = 0;
      lastDrawnRouteIndex = -1;
      lastArrivalDist = Infinity;
      avgSpeedSamples = [];
    }

    // Update turn instructions
    turnInstructions = extractTurnInstructions(alt);
    currentStepIndex = 0;
    lastSpokenStepIndex = -1;
    lastSpokenThreshold = '';
    updateNextTurnInfo();

    remainingDistance = alt.distance;
    remainingTime = alt.duration;
    tollCostEstimate = alt.tollEstimate || 0;

    // Clear and redraw route + alternatives
    clearAllRouteLayers();
    clearNavAlternativeLayers();
    updateRouteDisplayForNavigation();
    updateNavigationMarkers();
    displayNavAlternatives(); // redraw alternatives (now this route is active, so it won't show)

    showNotification(`เปลี่ยนเส้นทาง: ${alt.label}`, 'success');
    speak(`เปลี่ยนไป${alt.label}`);
  }

  // ==================== MANUAL WAYPOINT (จุดผ่านทาง) ====================

  function toggleWaypointMode() {
    isAddingWaypoint = !isAddingWaypoint;
    if (isAddingWaypoint) {
      showNotification('แตะบนแผนที่เพื่อเพิ่มจุดผ่านทาง', 'success');
      map.getContainer().style.cursor = 'crosshair';
      map.on('click', onMapClickWaypoint);
    } else {
      map.getContainer().style.cursor = '';
      map.off('click', onMapClickWaypoint);
    }
  }

  function onMapClickWaypoint(e: any) {
    const { lat, lng } = e.latlng;
    addCustomWaypoint(lat, lng);
  }

  function addCustomWaypoint(lat: number, lng: number) {
    const wp = { lat, lng, id: nextWaypointId++ };
    customWaypoints = [...customWaypoints, wp];

    // Add draggable marker on map
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'custom-waypoint-marker',
        html: `<div class="waypoint-pin">
          <div class="waypoint-dot"></div>
          <div class="waypoint-label">จุดผ่าน ${customWaypoints.length}</div>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      }),
      draggable: true,
      zIndexOffset: 800
    }).addTo(map);

    // Drag to reposition waypoint
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      const idx = customWaypoints.findIndex(w => w.id === wp.id);
      if (idx !== -1) {
        customWaypoints[idx] = { ...customWaypoints[idx], lat: pos.lat, lng: pos.lng };
        customWaypoints = [...customWaypoints];
        recalculateWithWaypoints();
      }
    });

    // Click to remove
    marker.on('contextmenu', () => {
      removeCustomWaypoint(wp.id);
    });

    customWaypointMarkers.push({ id: wp.id, marker });
    recalculateWithWaypoints();
  }

  function removeCustomWaypoint(id: number) {
    customWaypoints = customWaypoints.filter(w => w.id !== id);
    const markerEntry = customWaypointMarkers.find(m => m.id === id);
    if (markerEntry) {
      try { map.removeLayer(markerEntry.marker); } catch (e) {}
    }
    customWaypointMarkers = customWaypointMarkers.filter(m => m.id !== id);
    // Update labels
    updateWaypointLabels();
    if (customWaypoints.length > 0) {
      recalculateWithWaypoints();
    } else {
      // No more waypoints, recalculate normal route
      recalculateRouteFromCurrentPosition();
    }
    showNotification('ลบจุดผ่านทางแล้ว', 'success');
  }

  function updateWaypointLabels() {
    customWaypointMarkers.forEach((entry, idx) => {
      const el = entry.marker.getElement();
      if (el) {
        const label = el.querySelector('.waypoint-label');
        if (label) label.textContent = `จุดผ่าน ${idx + 1}`;
      }
    });
  }

  function clearAllCustomWaypoints() {
    customWaypointMarkers.forEach(entry => {
      try { map.removeLayer(entry.marker); } catch (e) {}
    });
    customWaypoints = [];
    customWaypointMarkers = [];
    nextWaypointId = 1;
    if (isAddingWaypoint) {
      isAddingWaypoint = false;
      map.getContainer().style.cursor = '';
      map.off('click', onMapClickWaypoint);
    }
    recalculateRouteFromCurrentPosition();
    showNotification('ล้างจุดผ่านทางทั้งหมดแล้ว', 'success');
  }

  async function recalculateWithWaypoints() {
    if (!currentLocation || !optimizedRoute || isRecalculatingRoute) return;
    isRecalculatingRoute = true;
    try {
      // Build waypoints: current position → custom waypoints → remaining delivery points
      const remainingDeliveryPoints = optimizedRoute.optimized_order
        .slice(currentTargetIndex)
        .filter((p: any) => p.id !== -1);

      if (remainingDeliveryPoints.length === 0) {
        isRecalculatingRoute = false;
        return;
      }

      const waypointCoords = [
        `${currentLocation.lng},${currentLocation.lat}`,
        ...customWaypoints.map(w => `${w.lng},${w.lat}`),
        ...remainingDeliveryPoints.map((p: any) => `${p.lng},${p.lat}`)
      ].join(';');

      const data = await callOSRMProxy(waypointCoords, { steps: true, exclude: getExcludeOptions() });

      optimizedRoute = {
        ...optimizedRoute,
        route: { geometry: data.routes[0].geometry },
        total_distance: data.routes[0].distance,
        total_time: data.routes[0].duration,
        optimized_order: [
          { ...currentLocation, name: 'ตำแหน่งปัจจุบัน', address: 'ตำแหน่งของคุณ', id: -1 },
          ...remainingDeliveryPoints
        ]
      };

      turnInstructions = extractTurnInstructions(data.routes[0]);
      currentStepIndex = 0;
      lastSpokenStepIndex = -1;
      lastSpokenThreshold = '';
      arrivalAnnounced = false;
      arrivalProximityAnnounced = false;
      updateNextTurnInfo();

      remainingDistance = data.routes[0].distance;
      remainingTime = data.routes[0].duration;
      currentTargetIndex = 1;
      arrivedPoints = [0];

      clearAllRouteLayers();
      updateRouteDisplayForNavigation();
      updateNavigationMarkers();
    } catch (err) {
      console.error('Recalculate with waypoints error:', err);
      showNotification('คำนวณเส้นทางใหม่ไม่สำเร็จ', 'error');
    } finally {
      isRecalculatingRoute = false;
    }
  }

  function selectRoute(index: number, startPoint: any, sortedPoints: any[], silent = false) {
    selectedRouteIndex = index;
    const selected = routeAlternatives[index];
    if (!selected) return;

    // Sync routePreference with selected route type
    if (selected.excludeUsed?.includes('toll')) routePreference = 'no_tolls';
    else if (selected.excludeUsed?.includes('motorway')) routePreference = 'no_highways';
    else if (index === 0) routePreference = 'fastest';

    // Store start + sorted for re-selection later
    _lastStartPoint = startPoint;
    _lastSortedPoints = sortedPoints;

    optimizedRoute = {
      route: { geometry: selected.geometry },
      total_distance: selected.distance,
      total_time: selected.duration,
      optimized_order: [
        { ...startPoint, name: 'ตำแหน่งปัจจุบัน', address: 'จุดเริ่มต้นของคุณ', id: -1 },
        ...sortedPoints
      ]
    };
    // Update cached route coordinates for navigation
    if (selected.geometry?.coordinates) {
      cachedRouteCoords = selected.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
      lastRouteIndex = 0;
      lastDrawnRouteIndex = -1;
      lastArrivalDist = Infinity;
      avgSpeedSamples = [];
    }

    turnInstructions = selected._turns || extractTurnInstructions(selected);
    currentStepIndex = 0;
    updateNextTurnInfo();
    remainingDistance = selected.distance;
    remainingTime = selected.duration;
    tollCostEstimate = selected.tollEstimate || 0;
    clearAlternativeRouteLayers();
    // Draw alternatives FIRST (underneath) so main route covers shared sections
    if (routeAlternatives.length > 1) {
      displayFadedAlternatives(startPoint, sortedPoints);
    }
    // Draw main route ON TOP - no overlapping lines on shared road
    displayOptimizedRoute();
    activeTab = 'route';
    // Notify with toll/expressway info (skip on silent restore)
    if (!silent) {
      const expNames = getExpresswayNames(selected);
      if (selected.hasTolls && expNames.length > 0) {
        showNotification(`เลือก: ${selected.label} — ผ่านทางด่วน: ${expNames.join(', ')} (~฿${selected.tollEstimate})`, 'warning');
        speak(`เลือก ${selected.label} ระยะทาง ${(selected.distance / 1000).toFixed(1)} กิโลเมตร ใช้เวลา ${Math.round(selected.duration / 60)} นาที เส้นทางนี้ผ่านทางด่วน ค่าผ่านทางประมาณ ${selected.tollEstimate} บาท`);
      } else if (selected.hasTolls) {
        showNotification(`เลือก: ${selected.label} — ผ่านทางด่วน (~฿${selected.tollEstimate})`, 'warning');
        speak(`เลือก ${selected.label} ระยะทาง ${(selected.distance / 1000).toFixed(1)} กิโลเมตร ใช้เวลา ${Math.round(selected.duration / 60)} นาที มีทางด่วน`);
      } else {
        showNotification(`เลือก: ${selected.label} — ไม่ผ่านทางด่วน`, 'success');
        speak(`เลือก ${selected.label} ระยะทาง ${(selected.distance / 1000).toFixed(1)} กิโลเมตร ใช้เวลา ${Math.round(selected.duration / 60)} นาที ไม่มีทางด่วน`);
      }
    }
    saveRouteState();
    // Clear old incidents when route changes
    if (trafficIncidents.length > 0) {
      trafficIncidents = [];
      incidentsOnRoute = [];
      clearIncidentMarkers();
    }
  }

  // Extract diverging segments of altCoords that don't overlap with mainCoords
  function getDivergingSections(altCoords: [number, number][], mainCoords: [number, number][], threshold = 40): [number, number][][] {
    // Build a simple spatial grid of main route points for fast lookup
    const gridSize = 0.001; // ~100m grid cells
    const mainGrid: Record<string, [number, number][]> = {};
    // Sample every 3rd point for speed (still accurate enough)
    for (let i = 0; i < mainCoords.length; i += 3) {
      const key = `${Math.floor(mainCoords[i][0] / gridSize)},${Math.floor(mainCoords[i][1] / gridSize)}`;
      if (!mainGrid[key]) mainGrid[key] = [];
      mainGrid[key].push(mainCoords[i]);
    }

    function isNearMainRoute(lat: number, lng: number): boolean {
      const gx = Math.floor(lat / gridSize);
      const gy = Math.floor(lng / gridSize);
      // Check 3x3 grid cells around the point
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const pts = mainGrid[`${gx + dx},${gy + dy}`];
          if (pts) {
            for (const p of pts) {
              if (getDistance(lat, lng, p[0], p[1]) < threshold) return true;
            }
          }
        }
      }
      return false;
    }

    // Mark each alt point as overlapping or diverging
    const segments: [number, number][][] = [];
    let currentSeg: [number, number][] = [];

    for (let i = 0; i < altCoords.length; i++) {
      const overlapping = isNearMainRoute(altCoords[i][0], altCoords[i][1]);
      if (!overlapping) {
        // Diverging point - add to segment
        if (currentSeg.length === 0 && i > 0) {
          currentSeg.push(altCoords[i - 1]); // include last overlap point for smooth connection
        }
        currentSeg.push(altCoords[i]);
      } else {
        // Overlapping point - end current segment
        if (currentSeg.length > 0) {
          currentSeg.push(altCoords[i]); // include first overlap point for smooth connection
          segments.push([...currentSeg]);
          currentSeg = [];
        }
      }
    }
    if (currentSeg.length > 0) {
      segments.push(currentSeg);
    }

    return segments;
  }

  // Show non-selected routes - only diverging sections (Google Maps style)
  function displayFadedAlternatives(startPoint: any, sortedPoints: any[]) {
    const selected = routeAlternatives[selectedRouteIndex];
    if (!selected?.geometry?.coordinates) return;
    const mainCoords: [number, number][] = selected.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);

    // First pass: draw lines & collect label info
    const labelInfos: { point: [number, number]; alt: any; idx: number; color: string; sectionLayers: any[]; sections: [number, number][][] }[] = [];

    routeAlternatives.forEach((alt, idx) => {
      if (idx === selectedRouteIndex) return;
      if (!alt.geometry?.coordinates) return;

      const altCoords: [number, number][] = alt.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
      const color = alt.color || routeColors[idx % routeColors.length];
      const divergingSections = getDivergingSections(altCoords, mainCoords);
      if (divergingSections.length === 0) return;

      const sectionLayers: any[] = [];
      divergingSections.forEach(section => {
        if (section.length < 2) return;
        const rw = getRouteWeight(map.getZoom());
        const line = L.polyline(section, { color, weight: rw.main, opacity: 0.18, lineCap: 'round', lineJoin: 'round' }).addTo(map);
        const hit = L.polyline(section, { color: 'transparent', weight: 30, opacity: 0 }).addTo(map);
        sectionLayers.push(line, hit);
        alternativeRouteLayers.push(line, hit);
      });

      const longestSection = divergingSections.reduce((a, b) => a.length > b.length ? a : b);
      const labelPoint: [number, number] = longestSection[Math.floor(longestSection.length / 2)];
      labelInfos.push({ point: labelPoint, alt, idx, color, sectionLayers, sections: divergingSections });
    });

    // Second pass: place labels with collision avoidance
    const placedLabels: [number, number][] = [];
    const MIN_LABEL_DIST = 300; // meters

    labelInfos.forEach(info => {
      let bestPoint = info.point;
      const isTooClose = (pt: [number, number]) => placedLabels.some(p => getDistance(pt[0], pt[1], p[0], p[1]) < MIN_LABEL_DIST);

      if (isTooClose(bestPoint)) {
        // Try different positions along the longest diverging section
        const section = info.sections.reduce((a, b) => a.length > b.length ? a : b);
        for (const pos of [0.25, 0.75, 0.15, 0.85]) {
          const candidate = section[Math.floor(section.length * pos)];
          if (candidate && !isTooClose(candidate)) { bestPoint = candidate; break; }
        }
        // Try other diverging sections
        if (isTooClose(bestPoint)) {
          for (const sec of info.sections) {
            if (sec.length < 3) continue;
            const mid = sec[Math.floor(sec.length / 2)];
            if (!isTooClose(mid)) { bestPoint = mid; break; }
          }
        }
      }
      placedLabels.push(bestPoint);

      const timeDiff = Math.round((info.alt.duration - selected.duration) / 60);
      const distKm = (info.alt.distance / 1000).toFixed(1);
      const timeLabel = timeDiff > 0 ? `+${timeDiff} นาที` : timeDiff < 0 ? `เร็วกว่า ${Math.abs(timeDiff)} นาที` : 'เวลาเท่ากัน';

      const labelMarker = L.marker(bestPoint, {
        icon: L.divIcon({
          className: 'route-label-marker',
          html: `<div class="gmap-alt-label" style="--alt-color: ${info.color}">
            <div class="gmap-alt-name">${info.alt.label}</div>
            <div class="gmap-alt-sub">${timeLabel} · ${distKm} กม.</div>
          </div>`,
          iconSize: [0, 0], iconAnchor: [0, 22]
        })
      }).addTo(map);
      alternativeRouteLayers.push(labelMarker);
      altLabelMarkers.push(labelMarker);

      // Click/Hover handlers
      const allLines = info.sectionLayers.filter((_, i) => i % 2 === 0);
      const allHits = info.sectionLayers.filter((_, i) => i % 2 === 1);

      const highlight = () => { allLines.forEach(l => l.setStyle({ opacity: 0.45, weight: 5 })); };
      const unhighlight = () => { allLines.forEach(l => l.setStyle({ opacity: 0.18, weight: 4 })); };
      const switchHandler = () => { clearAlternativeRouteLayers(); selectRoute(info.idx, startPoint, sortedPoints); };

      [...allHits, ...allLines].forEach(layer => { layer.on('click', switchHandler); layer.on('mouseover', highlight); layer.on('mouseout', unhighlight); });
      labelMarker.on('click', switchHandler);
    });

    // Zoom-dependent label visibility
    if (map && altLabelMarkers.length > 0) {
      map.on('zoomend', updateAltLabelVisibility);
      updateAltLabelVisibility();
    }
  }

  function updateNextTurnInfo() {
    if (!turnInstructions.length || currentStepIndex >= turnInstructions.length) {
      nextTurnInstruction = 'ถึงจุดหมาย';
      nextTurnIcon = '🏁';
      nextTurnDistance = 0;
      laneGuidance = null;
      return;
    }
    const step = turnInstructions[currentStepIndex];
    nextTurnInstruction = getTurnText(step.type, step.modifier, step.name);
    nextTurnIcon = getTurnIcon(step.type, step.modifier);
    nextTurnDistance = step.distance;

    // Update lane guidance based on upcoming turn
    updateLaneGuidance(step);
  }

  // ==================== CURVE WARNING ====================
  function detectCurvesOnRoute() {
    if (!cachedRouteCoords || cachedRouteCoords.length < 10) {
      upcomingCurves = [];
      return;
    }

    const curves: { distance: number; angle: number; direction: 'left' | 'right' }[] = [];
    let accumulatedDistance = 0;

    // Analyze route geometry for sharp turns
    for (let i = lastRouteIndex + 5; i < cachedRouteCoords.length - 5; i += 5) {
      const prev = cachedRouteCoords[i - 5];
      const curr = cachedRouteCoords[i];
      const next = cachedRouteCoords[i + 5];

      // Calculate bearing change
      const bearing1 = calculateBearing(prev[0], prev[1], curr[0], curr[1]);
      const bearing2 = calculateBearing(curr[0], curr[1], next[0], next[1]);
      let angleDiff = bearing2 - bearing1;

      // Normalize to -180 to 180
      if (angleDiff > 180) angleDiff -= 360;
      if (angleDiff < -180) angleDiff += 360;

      const absAngle = Math.abs(angleDiff);

      // Track distance from current position
      if (i > lastRouteIndex) {
        accumulatedDistance += getDistance(
          cachedRouteCoords[i - 5][0], cachedRouteCoords[i - 5][1],
          cachedRouteCoords[i][0], cachedRouteCoords[i][1]
        );
      }

      // Detect significant curves (> 30 degrees)
      if (absAngle > 30 && accumulatedDistance < 2000) {
        curves.push({
          distance: accumulatedDistance,
          angle: absAngle,
          direction: angleDiff > 0 ? 'right' : 'left'
        });
      }
    }

    upcomingCurves = curves.slice(0, 5); // Keep only next 5 curves
  }

  function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const x = Math.sin(dLng) * Math.cos(lat2Rad);
    const y = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  }

  function updateCurveWarning() {
    if (!isNavigating || upcomingCurves.length === 0) {
      curveWarning = null;
      return;
    }

    const nextCurve = upcomingCurves[0];
    if (!nextCurve) {
      curveWarning = null;
      return;
    }

    // Warn when within 300m of curve
    if (nextCurve.distance < 300) {
      let severity: 'gentle' | 'sharp' | 'hairpin' = 'gentle';
      if (nextCurve.angle > 90) severity = 'hairpin';
      else if (nextCurve.angle > 50) severity = 'sharp';

      const newWarning = {
        active: true,
        severity,
        distance: Math.round(nextCurve.distance),
        direction: nextCurve.direction
      };

      // Only speak once per curve
      if (!curveWarning || curveWarning.distance > nextCurve.distance + 50) {
        if (severity === 'hairpin') {
          speak(`ระวัง โค้งหักศอก${nextCurve.direction === 'left' ? 'ซ้าย' : 'ขวา'} ใน ${Math.round(nextCurve.distance)} เมตร`);
        } else if (severity === 'sharp') {
          speak(`โค้ง${nextCurve.direction === 'left' ? 'ซ้าย' : 'ขวา'}หน้า`);
        }
      }

      curveWarning = newWarning;
    } else if (nextCurve.distance > 500) {
      curveWarning = null;
    }
  }

  // ==================== LANE GUIDANCE ====================
  function updateLaneGuidance(step: TurnInstruction) {
    if (!step || !isNavigating) {
      laneGuidance = null;
      return;
    }

    const dist = nextTurnDistance;
    const modifier = step.modifier || '';
    const type = step.type;

    // Show lane guidance when within 500m of turn
    if (dist > 500 || dist < 10) {
      laneGuidance = null;
      return;
    }

    let lane: 'left' | 'right' | 'center' = 'center';
    let instruction = '';

    if (type === 'turn' || type === 'end of road' || type === 'fork') {
      if (modifier.includes('left')) {
        lane = 'left';
        instruction = 'ชิดซ้าย';
      } else if (modifier.includes('right')) {
        lane = 'right';
        instruction = 'ชิดขวา';
      }
    } else if (type === 'roundabout') {
      lane = 'left';
      instruction = 'ชิดซ้ายเข้าวงเวียน';
    } else if (type === 'off ramp' || type === 'on ramp') {
      if (modifier.includes('left')) {
        lane = 'left';
        instruction = 'ชิดซ้ายออกทางด่วน';
      } else {
        lane = 'right';
        instruction = 'ชิดขวาออกทางด่วน';
      }
    } else if (type === 'merge') {
      lane = 'center';
      instruction = 'เตรียมรวมเลน';
    }

    if (instruction) {
      laneGuidance = { show: true, lane, instruction };
    } else {
      laneGuidance = null;
    }
  }

  function advanceTurnStep() {
    if (currentStepIndex < turnInstructions.length - 1) {
      currentStepIndex++;
      updateNextTurnInfo();
      const step = turnInstructions[currentStepIndex];
      lastVoiceTime = Date.now();
      lastSpokenStepIndex = currentStepIndex;
      lastSpokenThreshold = '';
      speak(nextTurnInstruction);
      if (step.location) {
        map.setView([step.location[1], step.location[0]], map.getZoom(), { animate: true });
      }
    }
  }

  // ==================== OFF-ROUTE DETECTION & AUTO-REROUTE ====================

  function checkOffRoute(): boolean {
    if (!currentLocation || !cachedRouteCoords.length) return false;
    // Progressive search near last known position (O(1) instead of O(n))
    const searchRadius = 80;
    const start = Math.max(0, lastRouteIndex - 20);
    const end = Math.min(cachedRouteCoords.length, lastRouteIndex + searchRadius);
    let minDist = Infinity;
    for (let i = start; i < end; i++) {
      const d = getDistance(currentLocation.lat, currentLocation.lng, cachedRouteCoords[i][0], cachedRouteCoords[i][1]);
      if (d < minDist) minDist = d;
    }
    // If closest point is far, do a wider search to be sure
    if (minDist > offRouteThreshold) {
      for (let i = 0; i < cachedRouteCoords.length; i += 10) { // sample every 10th point
        const d = getDistance(currentLocation.lat, currentLocation.lng, cachedRouteCoords[i][0], cachedRouteCoords[i][1]);
        if (d < minDist) minDist = d;
      }
    }
    offRouteDistance = minDist;
    return minDist > offRouteThreshold;
  }

  async function handleOffRouteDetection() {
    if (!isNavigating || !navigationStartTime) return;
    // Skip off-route check for first 5 seconds (GPS settling period)
    if (Date.now() - navigationStartTime.getTime() < 5000) return;
    const offRoute = checkOffRoute();
    if (offRoute) {
      consecutiveOffRouteCount++;
      if (consecutiveOffRouteCount >= offRouteRequiredCount) {
        if (!isOffRoute) {
          isOffRoute = true;
          speak('ออกนอกเส้นทาง');
        }
        // Auto-reroute only if enabled, cooldown passed, and not exceeded max
        if (autoRerouteEnabled && rerouteCount < 10) {
          const now = Date.now();
          if (now - lastRerouteTime > rerouteCooldown) {
            lastRerouteTime = now;
            rerouteCount++;
            showNotification(`🔄 ออกนอกเส้นทาง ${Math.round(offRouteDistance)} ม. - กำลังคำนวณเส้นทางใหม่...`, 'warning');
            speak('กำลังคำนวณเส้นทางใหม่');
            addAlert('navigation', `คำนวณเส้นทางใหม่ครั้งที่ ${rerouteCount} (ห่าง ${Math.round(offRouteDistance)} ม.)`);
            const success = await autoReroute();
            if (success) {
              consecutiveOffRouteCount = 0;
            }
          }
        } else if (rerouteCount >= 10) {
          showNotification('คำนวณเส้นทางใหม่เกินจำนวน กรุณาตรวจสอบตำแหน่ง', 'warning');
        }
      }
    } else {
      consecutiveOffRouteCount = 0;
      if (isOffRoute) {
        isOffRoute = false;
        showNotification('✅ กลับเข้าเส้นทางแล้ว', 'success');
        speak('กลับเข้าเส้นทางแล้ว');
      }
    }
  }

  async function autoReroute(): Promise<boolean> {
    if (!currentLocation || !optimizedRoute) return false;
    try {
      const remainingPoints = optimizedRoute.optimized_order.filter((p: any) => p.id !== -1 && !arrivedPoints.includes(optimizedRoute.optimized_order.indexOf(p)));
      if (remainingPoints.length === 0) {
        showNotification('ถึงจุดหมายแล้ว!', 'success');
        stopNavigation();
        return;
      }
      const sortedPoints = sortByNearestNeighbor(currentLocation, remainingPoints);
      // Include custom waypoints if any
      const waypointCoords = [
        `${currentLocation.lng},${currentLocation.lat}`,
        ...customWaypoints.map(w => `${w.lng},${w.lat}`),
        ...sortedPoints.map((p: any) => `${p.lng},${p.lat}`)
      ].join(';');
      const data = await callOSRMProxy(waypointCoords, { steps: true, exclude: getExcludeOptions() });
      optimizedRoute = {
        route: { geometry: data.routes[0].geometry },
        total_distance: data.routes[0].distance,
        total_time: data.routes[0].duration,
        optimized_order: [{ ...currentLocation, name: 'ตำแหน่งปัจจุบัน', address: 'ตำแหน่งของคุณ', id: -1 }, ...sortedPoints]
      };
      turnInstructions = extractTurnInstructions(data.routes[0]);
      currentStepIndex = 0;
      lastSpokenStepIndex = -1;
      lastSpokenThreshold = '';
      arrivalAnnounced = false;
      arrivalProximityAnnounced = false;
      lastArrivalDist = Infinity;
      updateNextTurnInfo();
      remainingDistance = data.routes[0].distance;
      remainingTime = data.routes[0].duration;
      currentTargetIndex = 1;
      arrivedPoints = [0];
      // Re-cache route coordinates after reroute
      cachedRouteCoords = data.routes[0].geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
      lastRouteIndex = 0;
      lastDrawnRouteIndex = -1;
      clearAllRouteLayers();
      updateRouteDisplayForNavigation();
      updateNavigationMarkers();
      isOffRoute = false;
      showNotification('✅ คำนวณเส้นทางใหม่สำเร็จ', 'success');
      return true;
    } catch (err) {
      console.error('Auto reroute error:', err);
      showNotification('คำนวณเส้นทางใหม่ไม่สำเร็จ', 'error');
      return false;
    }
  }

  // ==================== TURN-BY-TURN STEP TRACKING ====================

  function updateTurnByTurnProgress() {
    if (!currentLocation || !turnInstructions.length || currentStepIndex >= turnInstructions.length) return;
    const step = turnInstructions[currentStepIndex];
    if (!step.location) return;
    const distToStep = getDistance(currentLocation.lat, currentLocation.lng, step.location[1], step.location[0]);
    nextTurnDistance = distToStep;

    if (distToStep < 30 && currentStepIndex < turnInstructions.length - 1) {
      // ถึงจุดเลี้ยวแล้ว - advance ไป step ถัดไป
      lastSpokenStepIndex = -1;
      lastSpokenThreshold = '';
      advanceTurnStep();
    } else {
      // ประกาศเสียงเมื่อเข้าใกล้จุดเลี้ยว (แต่ละ threshold พูดแค่ครั้งเดียว)
      const now = Date.now();
      const minInterval = 5000; // ห่างกันอย่างน้อย 5 วินาที
      let threshold = '';
      let announcement = '';

      if (distToStep < 100 && lastSpokenThreshold !== '100') {
        threshold = '100';
        announcement = `อีก ${Math.round(distToStep)} เมตร ${nextTurnInstruction}`;
      } else if (distToStep < 300 && distToStep >= 100 && lastSpokenThreshold !== '300' && lastSpokenThreshold !== '100') {
        threshold = '300';
        announcement = `อีก ${Math.round(distToStep)} เมตร เตรียม${nextTurnInstruction}`;
      } else if (distToStep < 500 && distToStep >= 300 && lastSpokenStepIndex !== currentStepIndex) {
        threshold = '500';
        announcement = `อีก ${Math.round(distToStep)} เมตร ${nextTurnInstruction}`;
      }

      if (threshold && announcement && now - lastVoiceTime > minInterval) {
        lastVoiceTime = now;
        lastSpokenStepIndex = currentStepIndex;
        lastSpokenThreshold = threshold;
        speak(announcement);
      }
    }
  }

  // ==================== PLACE SEARCH (NOMINATIM) ====================

  async function searchPlace(query: string) {
    if (!query || query.length < 2) { searchResults = []; showSearchResults = false; return; }
    isSearching = true;
    try {
      const params = new URLSearchParams({
        q: query, format: 'json', limit: '8', countrycodes: 'th',
        addressdetails: '1', 'accept-language': 'th'
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { 'User-Agent': 'RouteOptimization/2.0' }
      });
      const data = await res.json();
      searchResults = data.map((r: any) => ({
        lat: parseFloat(r.lat), lng: parseFloat(r.lon),
        name: r.display_name.split(',')[0],
        address: r.display_name,
        type: r.type, category: r.category
      }));
      showSearchResults = searchResults.length > 0;
    } catch (err) {
      console.error('Search error:', err);
      showNotification('ค้นหาไม่สำเร็จ', 'error');
    } finally {
      isSearching = false;
    }
  }

  function handleSearchInput() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => searchPlace(searchQuery), 500);
  }

  // Reverse geocode: แปลงพิกัดเป็นที่อยู่
  async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; address: string } | null> {
    try {
      const params = new URLSearchParams({
        lat: String(lat), lon: String(lng),
        format: 'json', addressdetails: '1', 'accept-language': 'th'
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
        headers: { 'User-Agent': 'RouteOptimization/2.0' }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.error) return null;

      // สร้างชื่อสถานที่จาก address details
      const addr = data.address || {};
      const nameParts = [
        addr.amenity || addr.shop || addr.building || addr.road || addr.hamlet || addr.village,
        addr.subdistrict || addr.suburb,
        addr.district || addr.city_district,
        addr.city || addr.town || addr.province
      ].filter(Boolean);

      return {
        name: nameParts[0] || data.display_name?.split(',')[0] || 'ไม่ทราบชื่อ',
        address: data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`
      };
    } catch (err) {
      console.error('Reverse geocode error:', err);
      return null;
    }
  }

  function selectSearchResult(result: any) {
    showSearchResults = false;
    searchQuery = result.name;
    if (map) map.flyTo([result.lat, result.lng], 16, { duration: 0.8 });
    if (destinationMarker) destinationMarker.remove();
    destinationMarker = L.marker([result.lat, result.lng], {
      icon: L.divIcon({
        className: 'search-result-marker',
        html: `<div class="search-pin">📍<div class="search-pin-label">${result.name}</div></div>`,
        iconSize: [40, 50], iconAnchor: [20, 50]
      })
    }).addTo(map);
    directDestination = { lat: result.lat, lng: result.lng, name: result.name, address: result.address };

    // Save to recent searches
    addToRecentSearches({ name: result.name, address: result.address, lat: result.lat, lng: result.lng });
  }

  function loadRecentSearches() {
    try {
      const saved = localStorage.getItem(getUserKey('recentSearches'));
      if (saved) recentSearches = JSON.parse(saved);
    } catch (e) { recentSearches = []; }
  }

  function saveRecentSearches() {
    try {
      localStorage.setItem(getUserKey('recentSearches'), JSON.stringify(recentSearches));
    } catch (e) {}
  }

  function addToRecentSearches(item: { name: string; address: string; lat: number; lng: number }) {
    // Remove duplicate if exists
    recentSearches = recentSearches.filter(r => !(Math.abs(r.lat - item.lat) < 0.0001 && Math.abs(r.lng - item.lng) < 0.0001));
    // Add to front
    recentSearches.unshift({ ...item, timestamp: Date.now() });
    // Limit size
    if (recentSearches.length > MAX_RECENT_SEARCHES) recentSearches = recentSearches.slice(0, MAX_RECENT_SEARCHES);
    saveRecentSearches();
  }

  function selectRecentSearch(recent: RecentSearch) {
    selectSearchResult({ name: recent.name, address: recent.address, lat: recent.lat, lng: recent.lng });
  }

  function clearRecentSearches() {
    recentSearches = [];
    saveRecentSearches();
  }

  async function navigateToSearchResult() {
    if (!directDestination) return;
    newPoint = { name: directDestination.name, address: directDestination.address, lat: directDestination.lat, lng: directDestination.lng, priority: 1 };
    try {
      await addDeliveryPoint();
      await calculateRouteWithAlternatives();
    } catch (err) {
      showNotification('ไม่สามารถนำทางได้', 'error');
    }
  }

  // ==================== DIRECT A→B NAVIGATION ====================

  async function directNavigate(destination: { lat: number; lng: number; name: string }) {
    try {
      const startPoint = await getCurrentLocationAsStart();
      const waypoints = `${startPoint.lng},${startPoint.lat};${destination.lng},${destination.lat}`;

      // Use fetchRouteAlternatives for consistent multi-route fetching
      const routes = await fetchRouteAlternatives(waypoints);

      routeAlternatives = routes.map((route: any, index: number) => ({
        index, geometry: route.geometry, distance: route.distance, duration: route.duration,
        legs: route.legs || [], steps: extractTurnInstructions(route),
        hasTolls: detectTollRoad(route), tollEstimate: estimateTollCost(route),
        label: route._label || routeLabels[index] || `เส้นทาง ${index + 1}`,
        color: route._color || routeColors[index % routeColors.length],
        excludeUsed: route._exclude || []
      }));
      const startData = { ...startPoint, name: 'ตำแหน่งปัจจุบัน', address: 'จุดเริ่มต้น', id: -1 };
      const destData = { ...destination, address: destination.name, id: Date.now(), priority: 1 };
      if (routeAlternatives.length > 1) {
        showRouteSelector = true;
        displayAllRouteAlternatives(startData, [destData]);
      }
      selectRoute(0, startData, [destData]);
    } catch (err: any) {
      showNotification(err.message || 'คำนวณเส้นทางไม่สำเร็จ', 'error');
    }
  }

  // ==================== SAVED ROUTES ====================

  function loadSavedRoutes() {
    if (!currentUser?.id) {
      console.warn('Cannot load saved routes: no user ID');
      savedRoutes = [];
      return;
    }
    try {
      const key = `savedRoutes_${currentUser.id}`;
      const saved = localStorage.getItem(key);
      if (saved) savedRoutes = JSON.parse(saved);
      else savedRoutes = [];
    } catch { savedRoutes = []; }
  }

  function saveCurrentRoute() {
    if (!optimizedRoute || !optimizedRoute.optimized_order || optimizedRoute.optimized_order.length < 2) {
      showNotification('ไม่มีเส้นทางให้บันทึก', 'error');
      return;
    }
    const from = optimizedRoute.optimized_order[0];
    const to = optimizedRoute.optimized_order[optimizedRoute.optimized_order.length - 1];
    const route: SavedRoute = {
      id: Date.now().toString(),
      name: `${from.name} → ${to.name}`,
      from: { lat: from.lat, lng: from.lng, name: from.name },
      to: { lat: to.lat, lng: to.lng, name: to.name },
      distance: optimizedRoute.total_distance,
      duration: optimizedRoute.total_time,
      avoidTolls: avoidTollRoads,
      createdAt: new Date().toISOString()
    };
    if (!currentUser?.id) {
      showNotification('ไม่สามารถบันทึก: ไม่พบ user ID', 'error');
      return;
    }
    savedRoutes = [route, ...savedRoutes].slice(0, 20);
    const key = `savedRoutes_${currentUser.id}`;
    localStorage.setItem(key, JSON.stringify(savedRoutes));
    showNotification('💾 บันทึกเส้นทางสำเร็จ', 'success');
  }

  function deleteSavedRoute(id: string) {
    if (!currentUser?.id) return;
    savedRoutes = savedRoutes.filter(r => r.id !== id);
    const key = `savedRoutes_${currentUser.id}`;
    localStorage.setItem(key, JSON.stringify(savedRoutes));
    showNotification('ลบเส้นทางที่บันทึกแล้ว', 'success');
  }

  async function loadSavedRoute(route: SavedRoute) {
    avoidTollRoads = route.avoidTolls;
    await directNavigate({ lat: route.to.lat, lng: route.to.lng, name: route.to.name });
    showSavedRoutes = false;
  }

  // ==================== SPEED ALERT ====================

  function checkSpeedAlert() {
    if (!speedAlertEnabled || !isNavigating) return;
    if (currentSpeed > estimatedSpeedLimit) {
      if (!speedLimitWarning) {
        speedLimitWarning = true;
        speak(`เตือน คุณขับเร็วเกิน ${estimatedSpeedLimit} กิโลเมตรต่อชั่วโมง`);
        addAlert('navigation', `⚠️ ขับเร็วเกิน! ${Math.round(currentSpeed)} km/h (จำกัด ${estimatedSpeedLimit} km/h)`);
      }
    } else {
      speedLimitWarning = false;
    }
  }

  // ==================== SHARE ETA (แชร์เวลาถึง) ====================

  async function shareETA() {
    const target = optimizedRoute?.optimized_order?.[currentTargetIndex];
    const targetName = target?.name || 'จุดหมาย';
    const etaText = estimatedArrivalTime ? estimatedArrivalTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const distText = formatDistance(distanceToNextPoint);
    const remaining = getRemainingPointsCount();
    const speedText = Math.round(currentSpeed);

    const shareText = `🚗 กำลังเดินทางไป: ${targetName}\n📍 เหลืออีก ${distText}\n⏰ ถึงประมาณ ${etaText}\n🏎️ ความเร็ว ${speedText} km/h\n📦 เหลือ ${remaining} จุดส่ง`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'แชร์เวลาถึง', text: shareText });
        showNotification('📤 แชร์แล้ว!', 'success');
        return;
      } catch {}
    }

    try {
      await navigator.clipboard.writeText(shareText);
      showNotification('📋 คัดลอกข้อมูลเวลาถึงแล้ว', 'success');
    } catch {
      showNotification('ไม่สามารถคัดลอกได้', 'error');
    }
  }

  // Helper function to get user-specific localStorage key
  function getUserKey(key: string): string {
    return `${key}_${currentUser?.id || 'guest'}`;
  }

  function toggleRoutePreference(pref: typeof routePreference) {
    routePreference = pref;
    const prefLabels: Record<string, string> = {
      'fastest': 'เส้นทางเร็วที่สุด',
      'no_tolls': 'เลี่ยงทางด่วน',
      'no_highways': 'เลี่ยงมอเตอร์เวย์'
    };
    switch (pref) {
      case 'no_tolls':
        avoidTollRoads = true; avoidExpressways = false; break;
      case 'no_highways':
        avoidTollRoads = false; avoidExpressways = true; break;
      case 'fastest':
      case 'shortest':
        avoidTollRoads = false; avoidExpressways = false; break;
    }
    showNotification(`เลือก: ${prefLabels[pref]}`, 'success');
    speak(prefLabels[pref]);
    localStorage.setItem(getUserKey('routePreference'), pref);
    localStorage.setItem(getUserKey('avoidTollRoads'), String(avoidTollRoads));
    localStorage.setItem(getUserKey('avoidExpressways'), String(avoidExpressways));

    // If we already have route alternatives, auto-select the best one
    if (routeAlternatives.length > 1 && _lastStartPoint && _lastSortedPoints.length > 0) {
      let bestIdx = 0;
      if (pref === 'no_tolls') {
        const idx = routeAlternatives.findIndex(r => r.excludeUsed?.includes('toll') || !r.hasTolls);
        if (idx >= 0) bestIdx = idx;
      } else if (pref === 'no_highways') {
        const idx = routeAlternatives.findIndex(r => r.excludeUsed?.includes('motorway'));
        if (idx >= 0) bestIdx = idx;
      } else if (pref === 'shortest') {
        let minDist = Infinity;
        routeAlternatives.forEach((r, i) => { if (r.distance < minDist) { minDist = r.distance; bestIdx = i; } });
      } else {
        let minTime = Infinity;
        routeAlternatives.forEach((r, i) => { if (r.duration < minTime) { minTime = r.duration; bestIdx = i; } });
      }
      selectRoute(bestIdx, _lastStartPoint, _lastSortedPoints);
    }
    // If we have delivery points but no route yet, calculate
    else if (allDeliveryPoints.length > 0 && !optimizedRoute) {
      optimizeRoute();
    }
  }

  // ==================== ROUTE COMPARISON HELPERS ====================

  function getTimeSaved(alt: any, baseIndex: number = 0): number {
    if (!routeAlternatives[baseIndex]) return 0;
    return alt.duration - routeAlternatives[baseIndex].duration;
  }

  function getFuelCostForRoute(distanceMeters: number): number {
    const distKm = distanceMeters / 1000;
    if (vehicleType === 'fuel') {
      return (distKm / KM_PER_LITER) * currentFuelPrice;
    }
    return ((distKm / 100) * KWH_PER_100KM) * ELECTRICITY_PRICE_PER_KWH;
  }

  async function optimizeRoute() {
    if (allDeliveryPoints.length < 1) {
      showNotification('ต้องมีอย่างน้อย 1 จุดแวะ', 'error');
      return;
    }
    isOptimizing = true;
    if (routeAbortController) routeAbortController.abort();
    routeAbortController = new AbortController();
    const signal = routeAbortController.signal;
    try {
      const startPoint = await getCurrentLocationAsStart();
      const sortedPoints = manualOrder
        ? [...allDeliveryPoints]
        : sortByNearestNeighbor(startPoint, [...allDeliveryPoints]);
      const waypoints = [`${startPoint.lng},${startPoint.lat}`, ...sortedPoints.map((p: any) => `${p.lng},${p.lat}`)].join(';');

      const routes = await fetchRouteAlternatives(waypoints, signal);

      routeAlternatives = routes.map((route: any, index: number) => ({
        index, geometry: route.geometry, distance: route.distance, duration: route.duration,
        legs: route.legs || [],
        hasTolls: detectTollRoad(route), tollEstimate: estimateTollCost(route),
        label: route._label || routeLabels[index] || `เส้นทาง ${index + 1}`,
        color: route._color || routeColors[index % routeColors.length],
        excludeUsed: route._exclude || []
      }));

      // Auto-select route based on preference
      let bestIdx = 0;
      if (routePreference === 'no_tolls') {
        const idx = routeAlternatives.findIndex(r => r.excludeUsed?.includes('toll') || !r.hasTolls);
        if (idx >= 0) bestIdx = idx;
      } else if (routePreference === 'no_highways') {
        const idx = routeAlternatives.findIndex(r => r.excludeUsed?.includes('motorway'));
        if (idx >= 0) bestIdx = idx;
      } else if (routePreference === 'shortest') {
        let minDist = Infinity;
        routeAlternatives.forEach((r, i) => { if (r.distance < minDist) { minDist = r.distance; bestIdx = i; } });
      }

      // Select best route and show alternatives as faded lines on map (Google Maps style)
      selectRoute(bestIdx, startPoint, sortedPoints);

      if (routeAlternatives.length > 1) {
        showNotification(`พบ ${routeAlternatives.length} เส้นทาง - กดเส้นทางบนแผนที่เพื่อเปลี่ยน`, 'success');
        speak(`พบ ${routeAlternatives.length} เส้นทาง กดที่เส้นทางบนแผนที่เพื่อเลือก`);
      } else {
        showNotification('คำนวณเส้นทางสำเร็จ', 'success');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // aborted by new request
      showNotification(err.message || 'คำนวณไม่สำเร็จ', 'error');
    } finally {
      isOptimizing = false;
    }
  }

  async function calculateRouteWithAlternatives() {
    await optimizeRoute();
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
        const priorityBonus = point.priority ? (6 - point.priority) * 100 : 0;
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

  // ==================== 2-OPT OPTIMIZATION ALGORITHM ====================

  // Build Haversine distance matrix
  function buildHaversineMatrix(points: { lat: number; lng: number }[]): number[][] {
    const n = points.length;
    const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dist = getDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
        matrix[i][j] = dist;
        matrix[j][i] = dist;
      }
    }
    return matrix;
  }

  // Build real distance matrix using Mapbox API (slow but accurate)
  async function buildRealDistanceMatrix(points: { lat: number; lng: number }[]): Promise<number[][]> {
    const n = points.length;
    const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

    // Fetch all pairs in batches to avoid too many concurrent requests
    const pairs: { i: number; j: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        pairs.push({ i, j });
      }
    }

    const batchSize = 5;
    const totalPairs = pairs.length;
    let completed = 0;

    for (let b = 0; b < pairs.length; b += batchSize) {
      const batch = pairs.slice(b, b + batchSize);
      const results = await Promise.allSettled(
        batch.map(async ({ i, j }) => {
          const waypoints = `${points[i].lng},${points[i].lat};${points[j].lng},${points[j].lat}`;
          try {
            const data = await callOSRMProxy(waypoints, { steps: false });
            return { i, j, distance: data.routes[0].distance };
          } catch {
            // Fallback to Haversine if API fails
            return { i, j, distance: getDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng) };
          }
        })
      );

      results.forEach((res) => {
        if (res.status === 'fulfilled') {
          const { i, j, distance } = res.value;
          matrix[i][j] = distance;
          matrix[j][i] = distance;
        }
      });

      completed += batch.length;
      optimizationProgress = Math.round((completed / totalPairs) * 50) + 50; // 50-100%
    }

    return matrix;
  }

  // Calculate total tour distance using distance matrix
  function calculateTourDistance(tour: number[], matrix: number[][]): number {
    let total = 0;
    for (let i = 0; i < tour.length - 1; i++) {
      total += matrix[tour[i]][tour[i + 1]];
    }
    return total;
  }

  // 2-opt improvement: reverse segment between i and j if it improves the tour
  function improveWith2opt(tour: number[], matrix: number[][]): number[] {
    const n = tour.length;
    let improved = true;
    let best = [...tour];

    while (improved) {
      improved = false;
      for (let i = 1; i < n - 2; i++) {
        for (let j = i + 1; j < n - 1; j++) {
          // Current edges: (i-1, i) and (j, j+1)
          // New edges after reverse: (i-1, j) and (i, j+1)
          const currentCost = matrix[best[i - 1]][best[i]] + matrix[best[j]][best[j + 1]];
          const newCost = matrix[best[i - 1]][best[j]] + matrix[best[i]][best[j + 1]];

          if (newCost < currentCost - 0.1) { // Small epsilon for floating point
            // Reverse segment from i to j
            const segment = best.slice(i, j + 1).reverse();
            best = [...best.slice(0, i), ...segment, ...best.slice(j + 1)];
            improved = true;
          }
        }
      }
    }

    return best;
  }

  // Main optimization function
  async function optimizePointOrder() {
    if (allDeliveryPoints.length < 3) {
      showNotification('ต้องมีอย่างน้อย 3 จุดแวะเพื่อใช้การจัดลำดับ', 'warning');
      return;
    }

    isOptimizingOrder = true;
    optimizationProgress = 0;

    try {
      // Get start point
      const startPoint = await getCurrentLocationAsStart();

      // Build points array with start at index 0
      const points = [startPoint, ...allDeliveryPoints.map(p => ({ lat: p.lat, lng: p.lng }))];

      optimizationProgress = 10;

      // Step 1: Get initial tour from nearest neighbor
      const nnOrder = sortByNearestNeighbor(startPoint, [...allDeliveryPoints]);
      const initialTour = [0, ...nnOrder.map((p: any) => allDeliveryPoints.findIndex((dp: any) => dp.id === p.id) + 1)];

      optimizationProgress = 20;

      // Step 2: Build distance matrix
      let matrix: number[][];
      if (useRealDistances) {
        optimizationProgress = 25;
        matrix = await buildRealDistanceMatrix(points);
      } else {
        matrix = buildHaversineMatrix(points);
        optimizationProgress = 50;
      }

      // Calculate before distance
      const beforeDistance = calculateTourDistance(initialTour, matrix);

      optimizationProgress = 60;

      // Step 3: Apply 2-opt improvement
      const improvedTour = improveWith2opt(initialTour, matrix);

      optimizationProgress = 90;

      // Calculate after distance
      const afterDistance = calculateTourDistance(improvedTour, matrix);
      const improvement = ((beforeDistance - afterDistance) / beforeDistance) * 100;

      // Step 4: Reorder delivery points according to improved tour
      const newOrder = improvedTour.slice(1).map(idx => allDeliveryPoints[idx - 1]);
      deliveryPoints = newOrder;
      manualOrder = true; // Lock to this order

      optimizationProgress = 100;

      // Store result for display
      optimizationResult = {
        beforeDistance,
        afterDistance,
        improvement
      };
      showOptimizationResult = true;

      displayPoints();

      if (improvement > 0.1) {
        showNotification(`จัดลำดับใหม่แล้ว! ประหยัดระยะทาง ${improvement.toFixed(1)}%`, 'success');
        speak(`จัดลำดับจุดแวะใหม่แล้ว ประหยัดระยะทาง ${improvement.toFixed(0)} เปอร์เซ็นต์`);
      } else {
        showNotification('ลำดับเดิมดีที่สุดแล้ว', 'success');
      }

      // Recalculate route with new order
      if (optimizedRoute) {
        await optimizeRoute();
      }

    } catch (err: any) {
      console.error('Optimization error:', err);
      showNotification(err.message || 'จัดลำดับไม่สำเร็จ', 'error');
    } finally {
      isOptimizingOrder = false;
      optimizationProgress = 0;
    }
  }

  // ==================== GPS FUNCTIONS - COPIED EXACTLY FROM ORIGINAL ====================
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
          // Fallback: lower accuracy but still fresh position
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
              timeout: 10000,
              maximumAge: 5000
            }
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0
        }
      );
    });
  }

  function displayOptimizedRoute() {
    if (!L || !map || !optimizedRoute?.route?.geometry) return;
    if (routeLayer) routeLayer.remove();
    clearTrafficLayers();
    const coords = optimizedRoute.route.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    const w = getRouteWeight(map.getZoom());
    // Only reduce opacity if traffic data actually exists (legs with congestion)
    const selectedAlt = routeAlternatives[selectedRouteIndex];
    const hasTrafficData = showTraffic && selectedAlt?.legs?.some((l: any) => l?.annotation?.congestion);
    routeLayer = L.polyline(coords, { color: '#00ff88', weight: w.mainSel, opacity: hasTrafficData ? 0.3 : 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    // Draw traffic overlay on top of base route
    if (hasTrafficData) {
      drawTrafficPolyline(selectedAlt, w.mainSel, 1);
    }
    map.fitBounds(routeLayer.getBounds(), { padding: [80, 80] });
    markers.forEach(m => m.remove());
    markers = [];
    optimizedRoute.optimized_order.forEach((point: any, i: number) => {
      const isStart = i === 0;
      const isCurrentLocation = isStart && point.id === -1;

      let markerHtml: string;
      let markerSize: [number, number];
      let markerAnchor: [number, number];

      if (isCurrentLocation) {
        // Clean start-point marker
        markerHtml = `
          <div class="start-loc-marker">
            <div class="start-loc-ripple"></div>
            <div class="start-loc-ripple start-loc-ripple-2"></div>
            <div class="start-loc-core">
              <svg viewBox="0 0 24 24" fill="white" width="14" height="14"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/></svg>
            </div>
            <div class="start-loc-label">คุณอยู่ที่นี่</div>
          </div>`;
        markerSize = [48, 48];
        markerAnchor = [24, 24];
      } else {
        const gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        const glow = '#667eea';
        markerHtml = `<div class="marker-pin route-pin" style="background: ${gradient}; box-shadow: 0 0 25px ${glow};"><span>${i}</span></div>`;
        markerSize = [52, 52];
        markerAnchor = [26, 26];
      }

      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: 'route-marker',
          html: markerHtml,
          iconSize: markerSize,
          iconAnchor: markerAnchor
        })
      }).addTo(map);
      const popupGradient = isCurrentLocation ? 'linear-gradient(135deg, #00ff88 0%, #00c06a 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      marker.bindPopup(`<div class="custom-popup"><div class="popup-header" style="background: ${popupGradient}"><span class="popup-number">${isCurrentLocation ? '📍' : i}</span><span class="popup-priority">${isCurrentLocation ? 'จุดเริ่มต้น' : 'จุดแวะ'}</span></div><div class="popup-content"><h4>${point.name}</h4><p>${point.address}</p></div></div>`, { className: 'dark-popup' });
      markers.push(marker);
    });
  }

  function clearRoute() {
    clearTrafficLayers();
    if (routeLayer) { try { map.removeLayer(routeLayer); } catch (e) {} routeLayer = null; }
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
    clearRouteState();
    displayPoints();
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

    remainingDistance = optimizedRoute.total_distance;
    remainingTime = optimizedRoute.total_time;
    navigationStartTime = new Date();
    elapsedTime = 0;
    maxSpeed = 0;
    avgSpeedSamples = [];
    lastArrivalDist = Infinity;
    lastDrawnRouteIndex = -1;

    // Cache route coordinates once (prevents O(n) allocation every second)
    if (optimizedRoute?.route?.geometry?.coordinates) {
      cachedRouteCoords = optimizedRoute.route.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
      lastRouteIndex = 0;
    }

    // Lock to user's GPS position immediately (like Google Maps)
    isMapFollowing = true;
    if (currentLocation && map) {
      map.setView([currentLocation.lat, currentLocation.lng], 17, { animate: false });
      updateCurrentLocationMarker();
    }

    // Clear existing watch before starting new one (prevent orphaned watches)
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    watchId = navigator.geolocation.watchPosition(
      updatePosition,
      handleGeoError,
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );

    currentHeading = null;
    consecutiveOffRouteCount = 0;
    rerouteCount = 0;
    isOffRoute = false;
    currentStepIndex = 0;
    arrivalAnnounced = false;
    arrivalProximityAnnounced = false;
    lastSpokenStepIndex = -1;
    lastSpokenThreshold = '';
    updateNextTurnInfo();

    // Detect manual map drag to disable auto-follow (Google Maps behavior)
    map.on('dragstart', () => { isMapFollowing = false; });

    if (navigationInterval) { clearInterval(navigationInterval); navigationInterval = null; }
    navigationInterval = setInterval(() => {
      updateNavigationInfo();
      updateETA();
      updateFuelEstimate();
      updateStatistics();
      updateCompass();
      detectCurvesOnRoute();
      updateCurveWarning();
    }, 2000);

    speak('เริ่มนำทาง');
    showNotification('เริ่มนำทางแล้ว', 'success');
    // Clear pre-navigation faded alternatives, then show nav-mode alternatives
    clearAlternativeRouteLayers();
    showRouteSelector = false;
    updateNavigationMarkers();

    const firstTarget = optimizedRoute.optimized_order[currentTargetIndex];
    if (firstTarget) {
      speak(`มุ่งหน้าไปยัง ${firstTarget.name}`);
    }

    // Show faded alternative routes on the map (clickable to switch)
    displayNavAlternatives();
    lastDeliveryUndo = null;

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
      headingMarkerElement = null;
    }
    if (accuracyCircle) {
      accuracyCircle.remove();
      accuracyCircle = null;
    }
    if (traveledLayer) {
      traveledLayer.remove();
      traveledLayer = null;
    }
    if (remainingRouteLayer) {
      remainingRouteLayer.remove();
      remainingRouteLayer = null;
    }
    // Clean up map drag listener, nav alternatives, and custom waypoints
    if (map) {
      map.off('dragstart');
      map.off('click', onMapClickWaypoint);
      map.getContainer().style.cursor = '';
      map.getContainer().style.transform = 'rotate(0deg)';
    }
    clearNavAlternativeLayers();
    if (nextTurnMarker && map) { try { map.removeLayer(nextTurnMarker); } catch (e) {} nextTurnMarker = null; }
    turnApproaching = false;
    currentRoadName = '';
    if (undoTimeout) { clearTimeout(undoTimeout); undoTimeout = null; }
    lastDeliveryUndo = null;
    // Clear custom waypoints
    customWaypointMarkers.forEach(entry => {
      try { map.removeLayer(entry.marker); } catch (e) {}
    });
    customWaypoints = [];
    customWaypointMarkers = [];
    nextWaypointId = 1;
    isAddingWaypoint = false;
    isRecalculatingRoute = false;
    cachedRouteCoords = [];
    lastRouteIndex = 0;
    avgSpeedSamples = [];
    lastDrawnRouteIndex = -1;
    currentSpeed = 0;
    maxSpeed = 0;
    lastPosition = null;
    lastRerouteTime = 0;
    // Keep currentLocation so next startNavigation can center on user
    currentHeading = null;
    currentTargetIndex = 0;
    arrivedPoints = [];

    isMapFollowing = true;
    if (optimizedRoute) {
      displayOptimizedRoute();
    }
    showNotification('หยุดนำทางแล้ว', 'success');
  }

  // ⚠️ CRITICAL: updatePosition - ENHANCED WITH SMOOTH TRACKING & HEADING
  function updatePosition(position: GeolocationPosition) {
    const { latitude, longitude, accuracy: acc, heading, speed: gpsSpeed } = position.coords;
    currentLocation = { lat: latitude, lng: longitude, heading, speed: gpsSpeed };
    accuracy = acc;
    // Update heading from GPS (only if moving and heading is valid)
    if (heading !== null && heading !== undefined && !isNaN(heading) && gpsSpeed && gpsSpeed > 1) {
      currentHeading = heading;
    }
    // อัพเดท GPS status ตามความแม่นยำ
    if (acc <= 10) gpsStatus = 'excellent';
    else if (acc <= 30) gpsStatus = 'good';
    else if (acc <= 100) gpsStatus = 'weak';
    else gpsStatus = 'poor';
    // Use GPS speed if available and reliable (with low-pass filter)
    if (gpsSpeed !== null && gpsSpeed !== undefined && !isNaN(gpsSpeed) && gpsSpeed >= 0) {
      const rawSpeed = gpsSpeed * 3.6; // m/s to km/h
      if (rawSpeed < 250) { // sanity check
        const alpha = 0.35;
        currentSpeed = currentSpeed * (1 - alpha) + rawSpeed * alpha;
        if (currentSpeed > maxSpeed && currentSpeed < 200) maxSpeed = currentSpeed;
      }
    } else {
      calculateSpeed(latitude, longitude);
    }
    // Track rolling average speed for ETA (last 30 samples)
    if (currentSpeed > 3) {
      avgSpeedSamples.push(currentSpeed);
      if (avgSpeedSamples.length > 30) avgSpeedSamples.shift();
    }
    updateCurrentLocationMarker();
    updateRouteDisplayForNavigation();
    updateNavigationMarkers();
    checkArrival();
    // Advanced features
    handleOffRouteDetection();
    updateTurnByTurnProgress();
    checkSpeedAlert();
    // Smooth Google Maps-like map following + heading rotation
    if (isNavigating && isMapFollowing && map) {
      const targetZoom = getAutoZoom(currentSpeed);
      map.panTo([latitude, longitude], { animate: true, duration: 0.5 });
      // Smooth zoom adjustment based on speed
      const currentZoom = map.getZoom();
      if (Math.abs(currentZoom - targetZoom) > 0.5) {
        map.setZoom(targetZoom, { animate: true });
      }
      // Rotate map container based on heading (Google Maps-like)
      const mapEl = map.getContainer();
      if (currentHeading !== null && currentSpeed > 5) {
        mapEl.style.transition = 'transform 0.8s ease-out';
        mapEl.style.transform = `rotate(${-currentHeading}deg)`;
      } else {
        mapEl.style.transition = 'transform 0.8s ease-out';
        mapEl.style.transform = 'rotate(0deg)';
      }
    }
  }

  // Auto-zoom: zoom out when fast, zoom in when slow (Google Maps style)
  function getAutoZoom(speed: number): number {
    if (speed > 100) return 14;      // highway
    if (speed > 60) return 15;       // fast road
    if (speed > 30) return 16;       // city driving
    if (speed > 10) return 17;       // slow driving
    return 18;                       // walking/stopped
  }

  // Toggle map follow mode
  function toggleMapFollow() {
    isMapFollowing = !isMapFollowing;
    if (isMapFollowing && currentLocation) {
      map.panTo([currentLocation.lat, currentLocation.lng], { animate: true, duration: 0.5 });
    }
  }

  function handleGeoError(error: GeolocationPositionError) {
    console.error('GPS Error:', error);
    let msg = 'ไม่สามารถระบุตำแหน่งได้';
    if (error.code === 1) msg = 'กรุณาอนุญาตการเข้าถึง GPS';
    if (error.code === 2) msg = 'ไม่สามารถระบุตำแหน่งได้';
    if (error.code === 3) msg = 'หมดเวลาการระบุตำแหน่ง';
    showNotification(msg, 'error');
    
    gpsStatus = 'poor';
  }

  function updateCurrentLocationMarker() {
    if (!L || !map || !currentLocation) return;
    const headingDeg = currentHeading !== null ? currentHeading : 0;
    const showHeading = currentHeading !== null && currentSpeed > 3;

    // Update or create accuracy circle
    if (accuracy > 0) {
      if (accuracyCircle) {
        accuracyCircle.setLatLng([currentLocation.lat, currentLocation.lng]);
        accuracyCircle.setRadius(accuracy);
      } else {
        accuracyCircle = L.circle([currentLocation.lat, currentLocation.lng], {
          radius: accuracy,
          color: '#00ff88',
          fillColor: '#00ff88',
          fillOpacity: 0.08,
          weight: 1.5,
          opacity: 0.35,
          dashArray: '4 6'
        }).addTo(map);
      }
    }

    if (currentLocationMarker) {
      currentLocationMarker.setLatLng([currentLocation.lat, currentLocation.lng]);
      // Update heading arrow rotation
      if (headingMarkerElement) {
        const arrow = headingMarkerElement.querySelector('.heading-arrow') as HTMLElement;
        if (arrow) {
          arrow.style.transform = `rotate(${headingDeg}deg)`;
          arrow.style.opacity = showHeading ? '1' : '0';
        }
      }
    } else {
      currentLocationMarker = L.marker([currentLocation.lat, currentLocation.lng], {
        icon: L.divIcon({
          className: '',
          html: `
            <div class="my-loc-wrapper">
              <div class="loc-pulse-ring"></div>
              <div class="loc-pulse-ring loc-pulse-ring-2"></div>
              <div class="heading-arrow" style="transform: rotate(${headingDeg}deg); opacity: ${showHeading ? 1 : 0};"></div>
              <div class="my-loc-dot"></div>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        }),
        zIndexOffset: 1000
      }).addTo(map);
      headingMarkerElement = currentLocationMarker.getElement();
    }
  }

  // Manual GPS refresh button
  let isRefreshingGps = false;
  async function refreshGpsPosition() {
    if (isRefreshingGps || !navigator.geolocation) return;
    isRefreshingGps = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        accuracy = pos.coords.accuracy;
        updateCurrentLocationMarker();
        if (map) {
          map.setView([pos.coords.latitude, pos.coords.longitude], map.getZoom(), { animate: true });
        }
        showNotification(`GPS อัพเดท (±${Math.round(accuracy)}m)`, 'success');
        isRefreshingGps = false;
      },
      (err) => {
        showNotification('ไม่สามารถรับตำแหน่ง GPS ได้', 'error');
        isRefreshingGps = false;
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function calculateSpeed(newLat: number, newLng: number) {
    const now = Date.now();
    if (lastPosition) {
      const distance = getDistance(lastPosition.lat, lastPosition.lng, newLat, newLng);
      const timeDiff = (now - lastPosition.time) / 1000;
      if (timeDiff > 0.5 && timeDiff < 30) {
        const rawSpeed = (distance / timeDiff) * 3.6;
        if (rawSpeed < 250) { // sanity check
          // Low-pass filter: smooth out GPS jitter
          const alpha = 0.35;
          currentSpeed = currentSpeed * (1 - alpha) + rawSpeed * alpha;
          if (currentSpeed > maxSpeed && currentSpeed < 200) maxSpeed = currentSpeed;
        }
      }
    }
    lastPosition = { lat: newLat, lng: newLng, time: now };
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

      let gradient, glow;
      if (isArrived) { gradient = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'; glow = '#6b7280'; }
      else if (isCurrent) { gradient = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'; glow = '#f59e0b'; }
      else if (isStart) { gradient = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)'; glow = '#00ff88'; }
      else { gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; glow = '#667eea'; }

      const displayNumber = isStart ? '📍' : (isArrived ? '✓' : i);
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

  let arrivalAnnounced = false;
  let arrivalProximityAnnounced = false;

  function checkArrival() {
    if (!currentLocation || !optimizedRoute) return;
    if (currentTargetIndex >= optimizedRoute.optimized_order.length) return;
    const target = optimizedRoute.optimized_order[currentTargetIndex];
    if (!target || target.id === -1) return;
    const dist = getDistance(currentLocation.lat, currentLocation.lng, target.lat, target.lng);
    distanceToNextPoint = dist;

    // Adjust threshold based on GPS accuracy (more lenient when GPS is weak)
    const accOffset = Math.min(accuracy * 0.5, 30);
    const proximityThreshold = 100 + accOffset;
    const arrivalThreshold = 50 + accOffset;

    // Hysteresis: only trigger if moving closer (not GPS jitter bouncing out and back)
    const jitterTolerance = Math.max(10, accuracy * 0.5);
    const movingCloser = dist < lastArrivalDist + jitterTolerance;

    // ใกล้ถึง - แจ้งเตือนว่าใกล้ถึงแล้ว
    if (dist < proximityThreshold && !arrivalProximityAnnounced && movingCloser) {
      arrivalProximityAnnounced = true;
      speak(`ใกล้ถึง ${target.name} อีก ${Math.round(dist)} เมตร`);
    }

    // ถึงเป้าหมาย - แจ้งเตือนถึงแล้ว
    if (dist < arrivalThreshold && !arrivalAnnounced && movingCloser) {
      arrivalAnnounced = true;
      speak(`ถึง ${target.name} แล้ว กดปุ่มยืนยัน`);
      showNotification(`ถึง ${target.name} แล้ว - กดยืนยัน`, 'success');
      addAlert('delivery', `ถึงเป้าหมาย: ${target.name}`);
    }

    // รีเซ็ตเมื่อออกจากรัศมีไกลพอ (200m + buffer to prevent jitter reset)
    if (dist > 200) {
      arrivalAnnounced = false;
      arrivalProximityAnnounced = false;
    }

    lastArrivalDist = dist;
  }

  function updateNavigationInfo() {
    if (!currentLocation || !optimizedRoute || !cachedRouteCoords.length) return;
    const nearestIndex = findNearestPointIndex(cachedRouteCoords, currentLocation);
    // Calculate remaining distance using cached coords
    let totalRemaining = 0;
    for (let i = nearestIndex; i < cachedRouteCoords.length - 1; i++) {
      totalRemaining += getDistance(cachedRouteCoords[i][0], cachedRouteCoords[i][1], cachedRouteCoords[i + 1][0], cachedRouteCoords[i + 1][1]);
    }
    remainingDistance = totalRemaining;
    // Use rolling average speed for more stable ETA (or fallback 25 km/h)
    const avgSpeed = avgSpeedSamples.length > 3
      ? avgSpeedSamples.reduce((a, b) => a + b, 0) / avgSpeedSamples.length
      : (currentSpeed > 5 ? currentSpeed : 25);
    remainingTime = (totalRemaining / 1000) / avgSpeed * 3600;
    if (currentTargetIndex < optimizedRoute.optimized_order.length) {
      const target = optimizedRoute.optimized_order[currentTargetIndex];
      distanceToNextPoint = getDistance(currentLocation.lat, currentLocation.lng, target.lat, target.lng);
    }
    // Update next turn marker position
    updateNextTurnMarker();
    // Check if approaching turn
    turnApproaching = nextTurnDistance > 0 && nextTurnDistance < 200;
  }

  // ==================== ENHANCED NAV FEATURES ====================

  function updateNextTurnMarker() {
    if (!map || !L || !turnInstructions.length || currentStepIndex >= turnInstructions.length) {
      if (nextTurnMarker) { map?.removeLayer(nextTurnMarker); nextTurnMarker = null; }
      return;
    }
    const step = turnInstructions[currentStepIndex];
    if (!step?.location) return;
    const pos: [number, number] = [step.location[1], step.location[0]];
    if (nextTurnMarker) {
      nextTurnMarker.setLatLng(pos);
    } else {
      nextTurnMarker = L.marker(pos, {
        icon: L.divIcon({
          className: 'next-turn-marker-container',
          html: `<div class="next-turn-pulse"><div class="next-turn-ring"></div><div class="next-turn-dot"></div></div>`,
          iconSize: [40, 40], iconAnchor: [20, 20]
        }),
        interactive: false,
        zIndexOffset: -100
      }).addTo(map);
    }
  }

  function getArrivalClockTime(): string {
    if (!remainingTime || remainingTime <= 0) return '--:--';
    const arrival = new Date(Date.now() + remainingTime * 1000);
    return arrival.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  // --- Current Road Name ---
  function updateCurrentRoadName() {
    if (!turnInstructions.length || currentStepIndex >= turnInstructions.length) { currentRoadName = ''; return; }
    const step = turnInstructions[currentStepIndex];
    currentRoadName = step?.name || '';
  }

  // --- Compass ---
  function updateCompass() {
    if (currentHeading !== null && currentHeading !== undefined && !isNaN(currentHeading)) {
      compassHeading = currentHeading;
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      compassDir = dirs[Math.round(compassHeading / 45) % 8];
    }
  }

  // Progressive search: only search near last known index (O(1) amortized instead of O(n))
  function findNearestPointIndex(coords: [number, number][], location: { lat: number; lng: number }): number {
    if (!coords.length) return 0;
    const searchRadius = 50; // search 50 points forward/backward from last known
    const start = Math.max(0, lastRouteIndex - 10); // look 10 back (in case of GPS correction)
    const end = Math.min(coords.length, lastRouteIndex + searchRadius);
    let minDist = Infinity;
    let nearestIndex = lastRouteIndex;
    for (let i = start; i < end; i++) {
      const dist = getDistance(location.lat, location.lng, coords[i][0], coords[i][1]);
      if (dist < minDist) {
        minDist = dist;
        nearestIndex = i;
      }
    }
    // If nearest is at edge of search window, do a wider search (rare)
    if (nearestIndex === start && start > 0 || nearestIndex === end - 1 && end < coords.length) {
      const wideStart = Math.max(0, nearestIndex - 200);
      const wideEnd = Math.min(coords.length, nearestIndex + 200);
      for (let i = wideStart; i < wideEnd; i++) {
        const dist = getDistance(location.lat, location.lng, coords[i][0], coords[i][1]);
        if (dist < minDist) {
          minDist = dist;
          nearestIndex = i;
        }
      }
    }
    lastRouteIndex = nearestIndex;
    return nearestIndex;
  }

  function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ==================== TRAFFIC INCIDENTS FUNCTIONS ====================
  async function fetchTrafficIncidents() {
    if (!map || !optimizedRoute?.route?.geometry?.coordinates) {
      showNotification('กรุณาคำนวณเส้นทางก่อน', 'warning');
      return;
    }
    isLoadingIncidents = true;
    try {
      const routeCoords = optimizedRoute.route.geometry.coordinates;
      const incidents: TrafficIncident[] = [];

      // Sample points along route for Overpass query (every ~1km)
      const samplePoints: [number, number][] = [];
      let lastSampleDist = 0;
      for (let i = 0; i < routeCoords.length; i++) {
        if (i === 0 || i === routeCoords.length - 1) {
          samplePoints.push([routeCoords[i][1], routeCoords[i][0]]);
        } else if (i > 0) {
          const dist = getDistance(routeCoords[i-1][1], routeCoords[i-1][0], routeCoords[i][1], routeCoords[i][0]);
          lastSampleDist += dist;
          if (lastSampleDist >= 2000) { // every 2km
            samplePoints.push([routeCoords[i][1], routeCoords[i][0]]);
            lastSampleDist = 0;
          }
        }
      }

      // Build bounding box along route
      const lats = routeCoords.map((c: number[]) => c[1]);
      const lngs = routeCoords.map((c: number[]) => c[0]);
      const minLat = Math.min(...lats) - 0.005;
      const maxLat = Math.max(...lats) + 0.005;
      const minLng = Math.min(...lngs) - 0.005;
      const maxLng = Math.max(...lngs) + 0.005;

      // Try to fetch road works from Overpass API along route
      try {
        const overpassQuery = `
          [out:json][timeout:15];
          (
            node["highway"="construction"](${minLat},${minLng},${maxLat},${maxLng});
            way["highway"="construction"](${minLat},${minLng},${maxLat},${maxLng});
            node["barrier"="block"](${minLat},${minLng},${maxLat},${maxLng});
          );
          out center;
        `;
        const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: `data=${encodeURIComponent(overpassQuery)}`
        });
        if (overpassRes.ok) {
          const overpassData = await overpassRes.json();
          overpassData.elements?.forEach((el: any) => {
            const lat = el.lat || el.center?.lat;
            const lng = el.lon || el.center?.lon;
            if (lat && lng && isNearRoute(lat, lng, 300)) {
              incidents.push({
                id: `osm-${el.id}`,
                type: 'construction',
                severity: 'moderate',
                title: 'งานก่อสร้างถนน',
                description: el.tags?.name || 'พื้นที่ก่อสร้าง',
                lat, lng,
                road: el.tags?.name || 'บนเส้นทาง',
                startTime: new Date(),
                delay: 5 + Math.floor(Math.random() * 10)
              });
            }
          });
        }
      } catch (e) {
        console.log('Overpass fetch skipped');
      }

      // Generate mock incidents along the actual route
      const mockCount = Math.min(3, Math.floor(routeCoords.length / 100));
      for (let i = 0; i < mockCount; i++) {
        const idx = Math.floor((i + 1) * routeCoords.length / (mockCount + 1));
        const [lng, lat] = routeCoords[idx];
        const mockIncident = generateMockIncidentAtPoint(lat, lng, i);
        incidents.push(mockIncident);
      }

      trafficIncidents = incidents;
      incidentsOnRoute = incidents; // ทุกอันอยู่บนเส้นทาง
      lastIncidentFetch = new Date();
      displayIncidentMarkers();

      if (incidents.length > 0) {
        showNotification(`พบ ${incidents.length} เหตุการณ์บนเส้นทาง`, 'warning');

        // Check for serious incidents that need rerouting
        const seriousIncidents = incidents.filter(i =>
          i.type === 'road_closed' ||
          i.type === 'accident' && (i.severity === 'critical' || i.severity === 'major') ||
          i.severity === 'critical'
        );

        if (seriousIncidents.length > 0) {
          suggestReroute(seriousIncidents);
        }
      } else {
        showNotification('ไม่พบเหตุการณ์บนเส้นทาง ✓', 'success');
      }
    } catch (err) {
      console.error('Error fetching traffic incidents:', err);
      showNotification('ไม่สามารถโหลดข้อมูลจราจรได้', 'error');
    } finally {
      isLoadingIncidents = false;
    }
  }

  let showRerouteModal = false;
  let rerouteReason = '';
  let rerouteIncidents: TrafficIncident[] = [];

  function suggestReroute(seriousIncidents: TrafficIncident[]) {
    rerouteIncidents = seriousIncidents;
    const roadClosed = seriousIncidents.filter(i => i.type === 'road_closed');
    const accidents = seriousIncidents.filter(i => i.type === 'accident');

    if (roadClosed.length > 0) {
      rerouteReason = `พบถนนปิด ${roadClosed.length} จุด`;
    } else if (accidents.length > 0) {
      rerouteReason = `พบอุบัติเหตุรุนแรง ${accidents.length} จุด`;
    } else {
      rerouteReason = `พบเหตุการณ์วิกฤต ${seriousIncidents.length} จุด`;
    }

    showRerouteModal = true;
    speak(`แจ้งเตือน ${rerouteReason} บนเส้นทาง แนะนำให้เปลี่ยนเส้นทาง`);
  }

  async function acceptReroute() {
    showRerouteModal = false;
    showNotification('กำลังคำนวณเส้นทางใหม่...', 'warning');

    // Try to find alternative route avoiding incidents
    // Use different route preference
    const oldPref = routePreference;

    if (routePreference === 'fastest') {
      routePreference = 'no_highways';
    } else if (routePreference === 'no_tolls') {
      routePreference = 'no_highways';
    } else {
      routePreference = 'no_tolls';
    }

    // Clear incidents and recalculate
    trafficIncidents = [];
    incidentsOnRoute = [];
    clearIncidentMarkers();

    // Trigger route recalculation
    if (deliveryPoints.length >= 1) {
      await optimizeRoute();
      showNotification('เปลี่ยนเส้นทางเรียบร้อย', 'success');
      speak('เปลี่ยนเส้นทางเรียบร้อยแล้ว');
    }
  }

  function dismissReroute() {
    showRerouteModal = false;
    showNotification('ใช้เส้นทางเดิมต่อ', 'warning');
  }

  function isNearRoute(lat: number, lng: number, threshold: number): boolean {
    if (!optimizedRoute?.route?.geometry?.coordinates) return false;
    const routeCoords = optimizedRoute.route.geometry.coordinates;
    for (let i = 0; i < routeCoords.length; i += 5) {
      const [rLng, rLat] = routeCoords[i];
      if (getDistance(lat, lng, rLat, rLng) < threshold) return true;
    }
    return false;
  }

  function generateMockIncidentAtPoint(lat: number, lng: number, index: number): TrafficIncident {
    const types: TrafficIncident['type'][] = ['accident', 'construction', 'congestion', 'hazard'];
    const severities: TrafficIncident['severity'][] = ['minor', 'moderate', 'major'];
    const type = types[index % types.length];
    const severity = severities[Math.floor(Math.random() * severities.length)];

    // Small offset so marker doesn't cover the route exactly
    const offset = 0.0003;
    return {
      id: `route-${index}-${Date.now()}`,
      type,
      severity,
      title: getIncidentTitle(type),
      description: getIncidentDescription(type, 'บนเส้นทาง'),
      lat: lat + (Math.random() - 0.5) * offset,
      lng: lng + (Math.random() - 0.5) * offset,
      road: 'บนเส้นทางของคุณ',
      startTime: new Date(Date.now() - Math.random() * 3600000),
      delay: type === 'accident' ? 10 + Math.floor(Math.random() * 15) :
             type === 'construction' ? 5 + Math.floor(Math.random() * 10) :
             3 + Math.floor(Math.random() * 8)
    };
  }

  function getIncidentTitle(type: TrafficIncident['type']): string {
    const titles: Record<TrafficIncident['type'], string> = {
      accident: 'อุบัติเหตุ',
      construction: 'งานก่อสร้าง',
      road_closed: 'ถนนปิด',
      congestion: 'การจราจรติดขัด',
      hazard: 'อันตรายบนถนน',
      event: 'กิจกรรมพิเศษ'
    };
    return titles[type];
  }

  function getIncidentDescription(type: TrafficIncident['type'], road: string): string {
    const descriptions: Record<TrafficIncident['type'], string[]> = {
      accident: ['รถชนกัน', 'รถเสียบนถนน', 'อุบัติเหตุรถจักรยานยนต์'],
      construction: ['ซ่อมผิวถนน', 'วางท่อประปา', 'ติดตั้งสัญญาณไฟ'],
      road_closed: ['ปิดซ่อมบำรุง', 'น้ำท่วม', 'มีขบวนรถผ่าน'],
      congestion: ['การจราจรหนาแน่น', 'รถติดสะสม', 'ช่วงชั่วโมงเร่งด่วน'],
      hazard: ['สิ่งกีดขวางบนถนน', 'หลุมบ่อ', 'น้ำมันหก'],
      event: ['งานวิ่ง', 'ขบวนพาเหรด', 'กิจกรรมชุมชน']
    };
    const desc = descriptions[type][Math.floor(Math.random() * descriptions[type].length)];
    return `${desc} บน${road}`;
  }

  function getIncidentIcon(type: TrafficIncident['type']): string {
    const icons: Record<TrafficIncident['type'], string> = {
      accident: '🚨',
      construction: '🚧',
      road_closed: '⛔',
      congestion: '🚗',
      hazard: '⚠️',
      event: '🎪'
    };
    return icons[type];
  }

  function getIncidentColor(severity: TrafficIncident['severity']): string {
    const colors: Record<TrafficIncident['severity'], string> = {
      minor: '#fbbf24',
      moderate: '#f97316',
      major: '#ef4444',
      critical: '#dc2626'
    };
    return colors[severity];
  }

  function displayIncidentMarkers() {
    if (!L || !map) return;
    clearIncidentMarkers();

    const filteredIncidents = selectedIncidentFilter === 'all'
      ? trafficIncidents
      : trafficIncidents.filter(i => i.type === selectedIncidentFilter);

    filteredIncidents.forEach(incident => {
      const color = getIncidentColor(incident.severity);
      const icon = getIncidentIcon(incident.type);

      const marker = L.marker([incident.lat, incident.lng], {
        icon: L.divIcon({
          className: 'incident-marker',
          html: `<div class="incident-pin" style="background: ${color}; border-color: ${color};">
            <span class="incident-icon">${icon}</span>
          </div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        })
      }).addTo(map);

      marker.bindPopup(`
        <div class="incident-popup">
          <div class="incident-popup-header" style="background: ${color}">
            <span class="incident-popup-icon">${icon}</span>
            <span class="incident-popup-title">${incident.title}</span>
          </div>
          <div class="incident-popup-content">
            <p>${incident.description}</p>
            <div class="incident-popup-meta">
              <span>📍 ${incident.road}</span>
              ${incident.delay ? `<span>⏱️ ล่าช้า ~${incident.delay} นาที</span>` : ''}
            </div>
            <div class="incident-popup-time">
              🕐 ${incident.startTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      `, { className: 'dark-popup incident-dark-popup' });

      incidentMarkers.push(marker);
    });
  }

  function clearIncidentMarkers() {
    incidentMarkers.forEach(m => {
      try { map.removeLayer(m); } catch (e) {}
    });
    incidentMarkers = [];
  }

  function checkIncidentsOnRoute() {
    // All fetched incidents are already on route, just update the count
    incidentsOnRoute = trafficIncidents;

    if (incidentsOnRoute.length > 0 && isNavigating) {
      const criticalCount = incidentsOnRoute.filter(i => i.severity === 'critical' || i.severity === 'major').length;
      if (criticalCount > 0) {
        speak(`แจ้งเตือน: มี ${criticalCount} เหตุการณ์สำคัญบนเส้นทาง`);
        showNotification(`⚠️ มี ${criticalCount} เหตุการณ์สำคัญบนเส้นทาง!`, 'warning');
      }
    }
  }

  function toggleIncidentsPanel() {
    showIncidentsPanel = !showIncidentsPanel;
    if (showIncidentsPanel && (!lastIncidentFetch || Date.now() - lastIncidentFetch.getTime() > 300000)) {
      fetchTrafficIncidents();
    }
  }

  function focusOnIncident(incident: TrafficIncident) {
    if (map) {
      map.setView([incident.lat, incident.lng], 16, { animate: true });
    }
  }

  function refreshIncidents() {
    fetchTrafficIncidents();
  }

  // ⚠️ CRITICAL: updateRouteDisplayForNavigation - หายไปจากไฟล์ใหม่!
  let lastDrawnRouteIndex = -1;
  function updateRouteDisplayForNavigation() {
    if (!L || !map || !cachedRouteCoords.length) return;
    const startIndex = lastRouteIndex; // use progressive index (already updated)
    // Only redraw if moved at least 3 route points (prevents flicker)
    if (Math.abs(startIndex - lastDrawnRouteIndex) < 3 && lastDrawnRouteIndex >= 0) return;
    lastDrawnRouteIndex = startIndex;
    // Clear old layers
    clearAllRouteLayers();
    if (traveledLayer) { traveledLayer.remove(); traveledLayer = null; }
    const nw = getRouteWeight(map.getZoom());
    if (startIndex > 0) {
      const traveledCoords = cachedRouteCoords.slice(0, startIndex + 1);
      traveledLayer = L.polyline(traveledCoords, { color: '#6b7280', weight: nw.mainSel, opacity: 0.6 }).addTo(map);
    }
    const remainingCoords = cachedRouteCoords.slice(startIndex);
    if (remainingCoords.length > 1) {
      remainingRouteLayer = L.polyline(remainingCoords, { color: '#00ff88', weight: nw.mainSel, opacity: 1 }).addTo(map);
    }
  }

  function clearAllRouteLayers() {
    if (remainingRouteLayer) map.removeLayer(remainingRouteLayer);
    if (routeLayer) map.removeLayer(routeLayer);
    remainingRouteLayer = routeLayer = null;
  }

  // ⚠️ CRITICAL: recalculateRouteFromCurrentPosition
  async function recalculateRouteFromCurrentPosition() {
    if (!currentLocation || !optimizedRoute) return;
    try {
      const remainingPoints = optimizedRoute.optimized_order.filter((p: any) => p.id !== -1);
      if (remainingPoints.length === 0) {
        showNotification('ถึงจุดหมายแล้ว!', 'success');
        stopNavigation();
        clearAllMarkersAndLayers();
        return;
      }
      const sortedPoints = sortByNearestNeighbor(currentLocation, remainingPoints);
      // Include custom waypoints if any
      const waypointCoords = [
        `${currentLocation.lng},${currentLocation.lat}`,
        ...customWaypoints.map(w => `${w.lng},${w.lat}`),
        ...sortedPoints.map((p: any) => `${p.lng},${p.lat}`)
      ].join(';');

      const data = await callOSRMProxy(waypointCoords, { steps: true, exclude: getExcludeOptions() });

      optimizedRoute = {
        route: { geometry: data.routes[0].geometry },
        total_distance: data.routes[0].distance,
        total_time: data.routes[0].duration,
        optimized_order: [{ ...currentLocation, name: 'ตำแหน่งปัจจุบัน', address: 'ตำแหน่งของคุณ', id: -1 }, ...sortedPoints]
      };
      // อัพเดท turn-by-turn instructions จากเส้นทางใหม่
      turnInstructions = extractTurnInstructions(data.routes[0]);
      currentStepIndex = 0;
      lastSpokenStepIndex = -1;
      lastSpokenThreshold = '';
      arrivalAnnounced = false;
      arrivalProximityAnnounced = false;
      lastArrivalDist = Infinity;
      updateNextTurnInfo();

      remainingDistance = data.routes[0].distance;
      remainingTime = data.routes[0].duration;
      currentTargetIndex = 1;
      arrivedPoints = [0];

      // Re-cache route coordinates for the new route
      cachedRouteCoords = data.routes[0].geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
      lastRouteIndex = 0;
      lastDrawnRouteIndex = -1;

      clearAllRouteLayers();
      updateRouteDisplayForNavigation();
      updateNavigationMarkers();
      // Stay centered on user (don't jump to target)
      if (isMapFollowing && currentLocation && map) {
        const zoom = getAutoZoom(currentSpeed);
        map.setView([currentLocation.lat, currentLocation.lng], zoom, { animate: false });
      }
      const nextTarget = optimizedRoute.optimized_order[currentTargetIndex];
      if (nextTarget) {
        speak(`มุ่งหน้าไปยัง ${nextTarget.name}`);
      }
      // Redraw nav alternatives
      clearNavAlternativeLayers();
      displayNavAlternatives();
    } catch (err) {
      console.error('Error recalculating route:', err);
      currentTargetIndex = 1;
      arrivedPoints = [0];
      clearAllRouteLayers();
      updateRouteDisplayForNavigation();
      updateNavigationMarkers();
    }
  }

  // ⚠️ CRITICAL: clearAllMarkersAndLayers - หายไปจากไฟล์ใหม่!
  function clearAllMarkersAndLayers() {
    if (markers && markers.length > 0) {
      markers.forEach((m) => { try { if (m && map) map.removeLayer(m); } catch(e) {} });
      markers = [];
    }
    if (routeLayer && map) { try { map.removeLayer(routeLayer); } catch(e) {} routeLayer = null; }
    if (remainingRouteLayer && map) { try { map.removeLayer(remainingRouteLayer); } catch(e) {} remainingRouteLayer = null; }
    if (traveledLayer && map) { try { map.removeLayer(traveledLayer); } catch(e) {} traveledLayer = null; }
    if (clickMarker && map) { try { map.removeLayer(clickMarker); } catch(e) {} clickMarker = null; }
  }

  function updateETA() {
    if (remainingDistance <= 0) {
      estimatedArrivalTime = new Date();
      return;
    }
    // Use rolling average speed for stable ETA (prevents wild jumps)
    const avgSpeed = avgSpeedSamples.length > 3
      ? avgSpeedSamples.reduce((a, b) => a + b, 0) / avgSpeedSamples.length
      : (currentSpeed > 5 ? currentSpeed : 25);
    const hoursRemaining = (remainingDistance / 1000) / avgSpeed;
    estimatedArrivalTime = new Date(Date.now() + hoursRemaining * 3600 * 1000);
  }

  function formatETA(date: Date | null): string {
    if (!date) return '--:--';
    return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  function updateFuelEstimate() {
    const distanceKm = remainingDistance / 1000;
    fuelConsumption = distanceKm / KM_PER_LITER;
    fuelCostEstimate = fuelConsumption * currentFuelPrice;
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

  function toggleVehicleType() {
    vehicleType = vehicleType === 'fuel' ? 'ev' : 'fuel';
    localStorage.setItem(getUserKey('vehicleType'), vehicleType);
    showNotification(`เปลี่ยนเป็น${vehicleType === 'fuel' ? 'รถน้ำมัน' : 'รถไฟฟ้า'}`, 'success');
  }

  // ==================== EV CHARGING STATIONS ====================
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
      const res = await fetch(`${API_URL}/ev-stations/nearby?lat=${searchLat}&lng=${searchLng}&radius=100&limit=20`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

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
    chargingStationMarkers.forEach(m => { try { map.removeLayer(m); } catch(e) {} });
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
        </div>
      `, { className: 'dark-popup ev-dark-popup', maxWidth: 300 });
      chargingStationMarkers.push(marker);
    });
  }

  async function optimizeEVRoute() {
    if (allDeliveryPoints.length < 1) {
      showNotification('ต้องมีอย่างน้อย 1 จุดแวะ', 'error');
      return;
    }
    isOptimizing = true;
    try {
      const startPoint = await getCurrentLocationAsStart();
      const sortedPoints = manualOrder
        ? [...allDeliveryPoints]
        : sortByNearestNeighbor(startPoint, [...allDeliveryPoints]);

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
      if (data.error) throw new Error(data.error);

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
        showNotification(`⚡ ต้องแวะชาร์จ ${routeChargingStops.length} จุด! แบตจะเหลือ ${data.battery.estimatedChargeAtArrival.toFixed(0)}%`, 'warning');
        speak(`ต้องแวะชาร์จ ${routeChargingStops.length} จุดระหว่างทาง`);
      } else if (data.battery.warningLevel === 'warning') {
        showNotification(`⚠️ แบตจะเหลือ ${data.battery.estimatedChargeAtArrival.toFixed(0)}% - ควรพิจารณาชาร์จ`, 'warning');
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
    localStorage.setItem(getUserKey('vehicleType'), vehicleType);
    localStorage.setItem(getUserKey('evCurrentCharge'), String(evCurrentCharge));
    localStorage.setItem(getUserKey('kmPerLiter'), String(KM_PER_LITER));
    localStorage.setItem(getUserKey('kwhPer100km'), String(KWH_PER_100KM));
    localStorage.setItem(getUserKey('electricityPrice'), String(ELECTRICITY_PRICE_PER_KWH));
    showNotification('บันทึกการตั้งค่ารถสำเร็จ', 'success');
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
      user: userInfo,
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

  function initExtraFeatures() {
    updateBatteryStatus();
    if (extraFeaturesInterval) clearInterval(extraFeaturesInterval);
    extraFeaturesInterval = setInterval(() => {
      updateStatistics();
      updateETA();
      updateFuelEstimate();
    }, 60000);
    if (batteryInterval) clearInterval(batteryInterval);
    batteryInterval = setInterval(updateBatteryStatus, 300000);
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

  // ==================== MULTI-SELECT FUNCTIONS ====================

  function toggleMultiSelect() {
    isMultiSelectMode = !isMultiSelectMode;
    isReorderMode = false;
    if (!isMultiSelectMode) {
      selectedPoints = [];
    }
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
    if (meters < 1000) return `${Math.round(meters)} ม.`;
    return `${(meters / 1000).toFixed(1)} กม.`;
  }

  function formatTime(seconds: number): string {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} นาที`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours} ชม. ${remainMins} นาที`;
  }

  function centerOnCurrentLocation() {
    if (currentLocation && map) {
      isMapFollowing = true;
      const zoom = isNavigating ? getAutoZoom(currentSpeed) : 16;
      // Snap immediately to current GPS position - no animation delay
      map.setView([currentLocation.lat, currentLocation.lng], zoom, { animate: false });
    }
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

  // ==================== ALONG-ROUTE POI FUNCTIONS ====================
  function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  }

  function matchPOIToRoute(lat: number, lng: number, routeCoords: [number, number][]): { routeIndex: number; distFromRoute: number; distAlongRoute: number } {
    const R = 111320; // meters per degree at equator (approx for Thailand)
    const cosLat = Math.cos(lat * Math.PI / 180);
    let bestIdx = 0, bestDist = Infinity;

    // Coarse pass: sample every 5th coord
    for (let i = 0; i < routeCoords.length - 1; i += 5) {
      const d = distToSegment(lng, lat, routeCoords[i][0], routeCoords[i][1], routeCoords[Math.min(i + 5, routeCoords.length - 1)][0], routeCoords[Math.min(i + 5, routeCoords.length - 1)][1]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    // Fine pass: check around best match
    const fineStart = Math.max(0, bestIdx - 6);
    const fineEnd = Math.min(routeCoords.length - 1, bestIdx + 11);
    bestDist = Infinity;
    for (let i = fineStart; i < fineEnd; i++) {
      const d = distToSegment(lng, lat, routeCoords[i][0], routeCoords[i][1], routeCoords[i + 1][0], routeCoords[i + 1][1]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    // Convert degree distance to meters
    const distMeters = bestDist * R * cosLat;

    // Calculate distance along route to this index
    let distAlong = 0;
    for (let i = 0; i < bestIdx && i < routeCoords.length - 1; i++) {
      const dlng = (routeCoords[i + 1][0] - routeCoords[i][0]) * R * cosLat;
      const dlat = (routeCoords[i + 1][1] - routeCoords[i][1]) * R;
      distAlong += Math.sqrt(dlng * dlng + dlat * dlat);
    }

    return { routeIndex: bestIdx, distFromRoute: Math.round(distMeters), distAlongRoute: Math.round(distAlong) };
  }

  async function searchPOIsAlongRoute() {
    if (!optimizedRoute?.route?.geometry?.coordinates) {
      showNotification('ยังไม่มีเส้นทาง กรุณาคำนวณเส้นทางก่อน', 'error');
      return;
    }
    isLoadingPOIs = true;
    showPOIOverlay = true;

    try {
      const coords = optimizedRoute.route.geometry.coordinates;
      // Calculate bbox with padding
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const c of coords) {
        if (c[0] < minLng) minLng = c[0];
        if (c[0] > maxLng) maxLng = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
      }
      const pad = 0.005; // ~500m for attractions
      minLat -= pad; maxLat += pad; minLng -= pad; maxLng += pad;

      const query = `[out:json][timeout:25];
(
  // Amenities
  node["amenity"="fuel"](${minLat},${minLng},${maxLat},${maxLng});
  node["shop"="convenience"](${minLat},${minLng},${maxLat},${maxLng});
  node["amenity"="restaurant"](${minLat},${minLng},${maxLat},${maxLng});
  node["amenity"="cafe"](${minLat},${minLng},${maxLat},${maxLng});
  node["amenity"="charging_station"](${minLat},${minLng},${maxLat},${maxLng});
  // Tourism & Attractions
  node["tourism"="viewpoint"](${minLat},${minLng},${maxLat},${maxLng});
  node["tourism"="attraction"](${minLat},${minLng},${maxLat},${maxLng});
  node["tourism"="museum"](${minLat},${minLng},${maxLat},${maxLng});
  way["tourism"="attraction"](${minLat},${minLng},${maxLat},${maxLng});
  way["tourism"="museum"](${minLat},${minLng},${maxLat},${maxLng});
  // Temples & Historic
  node["amenity"="place_of_worship"]["religion"="buddhist"](${minLat},${minLng},${maxLat},${maxLng});
  way["amenity"="place_of_worship"]["religion"="buddhist"](${minLat},${minLng},${maxLat},${maxLng});
  node["historic"](${minLat},${minLng},${maxLat},${maxLng});
  // Parks
  node["leisure"="park"](${minLat},${minLng},${maxLat},${maxLng});
  way["leisure"="park"](${minLat},${minLng},${maxLat},${maxLng});
);
out center body;`;

      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`
      });
      const data = await res.json();

      if (!data.elements) {
        alongRoutePOIs = [];
        showNotification('ไม่พบสถานที่บนเส้นทาง', 'warning');
        return;
      }

      const pois: RoutePOI[] = [];
      for (const el of data.elements) {
        // way elements use center lat/lon
        const lat = el.lat || el.center?.lat;
        const lon = el.lon || el.center?.lon;
        if (!lat || !lon) continue;

        let poiType: RoutePOI['type'];
        const tags = el.tags || {};

        // Determine POI type
        if (tags.amenity === 'fuel') poiType = 'gas';
        else if (tags.shop === 'convenience') poiType = 'convenience';
        else if (tags.amenity === 'restaurant') poiType = 'restaurant';
        else if (tags.amenity === 'cafe') poiType = 'cafe';
        else if (tags.amenity === 'charging_station') poiType = 'ev_charging';
        else if (tags.tourism === 'viewpoint') poiType = 'viewpoint';
        else if (tags.tourism === 'attraction') poiType = 'attraction';
        else if (tags.tourism === 'museum') poiType = 'museum';
        else if (tags.amenity === 'place_of_worship' && tags.religion === 'buddhist') poiType = 'temple';
        else if (tags.historic) poiType = 'attraction'; // historic sites as attractions
        else if (tags.leisure === 'park') poiType = 'park';
        else continue;

        const match = matchPOIToRoute(lat, lon, coords);
        if (match.distFromRoute <= POI_MAX_DIST) {
          pois.push({
            id: String(el.id),
            type: poiType,
            name: tags.name || tags['name:th'] || tags.brand || '',
            lat: lat,
            lng: lon,
            routeIndex: match.routeIndex,
            distFromRoute: match.distFromRoute,
            distAlongRoute: match.distAlongRoute,
            tags: tags
          });
        }
      }

      pois.sort((a, b) => a.distAlongRoute - b.distAlongRoute);
      alongRoutePOIs = pois;
      displayPOIMarkers();

      const attractionCount = pois.filter(p => ['viewpoint', 'attraction', 'temple', 'park', 'museum'].includes(p.type)).length;
      showNotification(`พบ ${pois.length} สถานที่ (${attractionCount} ที่เที่ยว)`, 'success');
    } catch (err: any) {
      console.error('POI search error:', err);
      showNotification('ค้นหาสถานที่ล้มเหลว', 'error');
    } finally {
      isLoadingPOIs = false;
    }
  }

  async function searchEVAlongRoute() {
    if (!optimizedRoute?.route?.geometry?.coordinates) {
      showNotification('ยังไม่มีเส้นทาง กรุณาคำนวณเส้นทางก่อน', 'error');
      return;
    }
    isLoadingStations = true;
    try {
      const coords = optimizedRoute.route.geometry.coordinates;
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const c of coords) {
        if (c[0] < minLng) minLng = c[0];
        if (c[0] > maxLng) maxLng = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
      }
      const pad = 0.003;
      minLat -= pad; maxLat += pad; minLng -= pad; maxLng += pad;

      const query = `[out:json][timeout:15];node["amenity"="charging_station"](${minLat},${minLng},${maxLat},${maxLng});out body;`;
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`
      });
      const data = await res.json();

      if (!data.elements?.length) {
        showNotification('ไม่พบสถานีชาร์จบนเส้นทาง', 'warning');
        return;
      }

      let count = 0;
      for (const el of data.elements) {
        if (!el.lat || !el.lon) continue;
        const match = matchPOIToRoute(el.lat, el.lon, coords);
        if (match.distFromRoute > POI_MAX_DIST) continue;
        const existsAlready = chargingStations.some(s => Math.abs(s.lat - el.lat) < 0.0001 && Math.abs(s.lng - el.lon) < 0.0001);
        if (existsAlready) continue;
        chargingStations.push({
          id: el.id,
          name: el.tags?.name || el.tags?.operator || 'สถานีชาร์จ EV',
          lat: el.lat,
          lng: el.lon,
          address: el.tags?.['addr:full'] || el.tags?.['addr:street'] || 'บนเส้นทาง',
          operator: el.tags?.operator || el.tags?.brand || '',
          connectionTypes: el.tags?.socket ? [el.tags.socket] : [],
          powerKW: el.tags?.['socket:type2:output'] ? parseFloat(el.tags['socket:type2:output']) : undefined,
          isOperational: el.tags?.['access'] !== 'no',
          distance: match.distAlongRoute / 1000
        });
        count++;
      }
      chargingStations = [...chargingStations];
      displayChargingStationMarkers();
      showNotification(`พบ ${count} สถานีชาร์จบนเส้นทาง`, 'success');
    } catch (err: any) {
      console.error('EV route search error:', err);
      showNotification('ค้นหาสถานีชาร์จบนเส้นทางล้มเหลว', 'error');
    } finally {
      isLoadingStations = false;
    }
  }

  function getPOIIcon(type: string): string {
    switch (type) {
      case 'gas': return '⛽';
      case 'convenience': return '🏪';
      case 'restaurant': return '🍜';
      case 'cafe': return '☕';
      case 'ev_charging': return '⚡';
      case 'viewpoint': return '📸';
      case 'attraction': return '🏛️';
      case 'temple': return '🏯';
      case 'park': return '🌳';
      case 'museum': return '🎨';
      default: return '📍';
    }
  }

  function getPOILabel(type: string): string {
    switch (type) {
      case 'gas': return 'ปั๊มน้ำมัน';
      case 'convenience': return 'ร้านสะดวกซื้อ';
      case 'restaurant': return 'ร้านอาหาร';
      case 'cafe': return 'คาเฟ่';
      case 'ev_charging': return 'สถานีชาร์จ';
      case 'viewpoint': return 'จุดชมวิว';
      case 'attraction': return 'สถานที่ท่องเที่ยว';
      case 'temple': return 'วัด';
      case 'park': return 'สวนสาธารณะ';
      case 'museum': return 'พิพิธภัณฑ์';
      default: return 'สถานที่';
    }
  }

  function displayPOIMarkers() {
    if (!L || !map) return;
    clearPOIMarkers();
    const filtered = alongRoutePOIs.filter(p => activePOITypes.has(p.type));
    for (const poi of filtered) {
      if (isNavigating && poi.routeIndex <= lastRouteIndex) continue;
      const marker = L.marker([poi.lat, poi.lng], {
        icon: L.divIcon({
          className: 'poi-marker-wrap',
          html: `<div class="poi-pin ${poi.type}">${getPOIIcon(poi.type)}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        })
      }).addTo(map);

      const etaMin = Math.round(poi.distAlongRoute / (currentSpeed > 3 ? currentSpeed * 1000 / 3600 : 30000 / 3600) / 60);
      marker.bindPopup(`
        <div class="poi-popup">
          <div class="poi-popup-header">${getPOIIcon(poi.type)} ${poi.name || getPOILabel(poi.type)}</div>
          <div class="poi-popup-meta">
            <p>📏 ${formatDistance(poi.distAlongRoute)} บนเส้นทาง</p>
            <p>↔️ ห่างจากเส้นทาง ${poi.distFromRoute} ม.</p>
            <p>⏱️ ~${etaMin} นาที</p>
            ${poi.tags?.brand ? `<p>🏷️ ${poi.tags.brand}</p>` : ''}
            ${poi.tags?.opening_hours ? `<p>🕐 ${poi.tags.opening_hours}</p>` : ''}
          </div>
        </div>
      `, { className: 'dark-popup', maxWidth: 260 });
      poiMarkers.push(marker);
    }
  }

  function clearPOIMarkers() {
    poiMarkers.forEach(m => { try { map.removeLayer(m); } catch(e) {} });
    poiMarkers = [];
  }

  function togglePOIType(type: string) {
    if (activePOITypes.has(type)) {
      activePOITypes.delete(type);
    } else {
      activePOITypes.add(type);
    }
    activePOITypes = new Set(activePOITypes);
    displayPOIMarkers();
  }

  function flyToPOI(poi: RoutePOI) {
    if (map) {
      map.flyTo([poi.lat, poi.lng], 17, { duration: 0.8 });
    }
  }

  function closePOIPanel() {
    clearPOIMarkers();
    alongRoutePOIs = [];
  }

  // ==================== SHARE ROUTE QR ====================
  function openShareQR() {
    if (!optimizedRoute?.optimized_order || optimizedRoute.optimized_order.length < 2) {
      showNotification('ยังไม่มีเส้นทาง กรุณาคำนวณเส้นทางก่อน', 'warning');
      return;
    }

    // Build Google Maps directions URL
    const points = optimizedRoute.optimized_order;
    const origin = points[0];
    const destination = points[points.length - 1];
    const waypoints = points.slice(1, -1);

    let url = `https://www.google.com/maps/dir/?api=1`;
    url += `&origin=${origin.lat},${origin.lng}`;
    url += `&destination=${destination.lat},${destination.lng}`;

    if (waypoints.length > 0) {
      const waypointStr = waypoints.map((p: any) => `${p.lat},${p.lng}`).join('|');
      url += `&waypoints=${encodeURIComponent(waypointStr)}`;
    }

    url += `&travelmode=driving`;

    shareQRUrl = url;
    showShareQR = true;
  }

  function closeShareQR() {
    showShareQR = false;
  }

  async function copyRouteLink() {
    try {
      await navigator.clipboard.writeText(shareQRUrl);
      showNotification('คัดลอก link แล้ว', 'success');
    } catch (e) {
      showNotification('ไม่สามารถคัดลอกได้', 'error');
    }
  }

  function openRouteInGoogleMaps() {
    window.open(shareQRUrl, '_blank');
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

  // ==================== DELIVERY FUNCTIONS - ใช้ user_id ====================
  async function markDeliverySuccess() {
    if (isProcessingDelivery) { showNotification('กำลังประมวลผล...', 'warning'); return; }
    if (!optimizedRoute?.optimized_order) { showNotification('ไม่มีเส้นทาง', 'error'); return; }
    
    const deliveredPoint = optimizedRoute.optimized_order[currentTargetIndex];
    if (!deliveredPoint || deliveredPoint.id === -1) { showNotification('ไม่พบจุดแวะ', 'error'); return; }
    
    isProcessingDelivery = true;
    try {
      const payload: any = {
        point_id: Number(deliveredPoint.id),
        point_name: String(deliveredPoint.name),
        address: deliveredPoint.address || '',
        lat: Number(deliveredPoint.lat),
        lng: Number(deliveredPoint.lng),
        notes: `ส่งสำเร็จ - ${new Date().toLocaleString('th-TH')}`
      };

      if (currentUser?.id) payload.user_id = Number(currentUser.id);
      if (currentUser?.name) payload.user_name = String(currentUser.name);
      payload.table = 'users';
      
      const res = await fetch(`${API_URL}/deliveries/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) { const errorText = await res.text(); throw new Error(`HTTP ${res.status}: ${errorText}`); }
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
        showNotification('🎉 ถึงจุดหมายแล้ว!', 'success');
        speak('ถึงจุดหมายแล้ว');
        stopNavigation();
        clearAllMarkersAndLayers();
        optimizedRoute = null;
        await loadDeliveryPoints();
        await loadTodayStats();
      } else {
        showNotification(`ส่ง ${deliveredPoint.name} สำเร็จ`, 'success');
        speak(`ส่ง ${deliveredPoint.name} สำเร็จ`);
        // Enable undo for 30 seconds
        lastDeliveryUndo = { point: deliveredPoint, index: currentTargetIndex, time: Date.now() };
        if (undoTimeout) clearTimeout(undoTimeout);
        undoTimeout = setTimeout(() => { lastDeliveryUndo = null; }, 30000);
        addAlert('delivery', `ส่งสำเร็จ: ${deliveredPoint.name}`);
        currentTargetIndex = 1;
        arrivedPoints = [0];
        if (currentLocation) { await recalculateRouteFromCurrentPosition(); } else { updateNavigationMarkers(); }
      }
    } catch (err: any) {
      showNotification(`บันทึกไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
      isProcessingDelivery = false;
    }
  }

  async function skipToNextPoint() {
    if (isProcessingDelivery) { showNotification('กำลังประมวลผล...', 'warning'); return; }
    if (!optimizedRoute?.optimized_order) { showNotification('ไม่มีเส้นทาง', 'error'); return; }
    
    const skippedPoint = optimizedRoute.optimized_order[currentTargetIndex];
    if (!skippedPoint || skippedPoint.id === -1) { showNotification('ไม่พบจุดที่จะข้าม', 'error'); return; }
    
    isProcessingDelivery = true;
    try {
      const payload: any = {
        point_id: Number(skippedPoint.id),
        point_name: String(skippedPoint.name),
        address: skippedPoint.address || '',
        lat: Number(skippedPoint.lat),
        lng: Number(skippedPoint.lng),
        notes: `ข้ามจุดแวะ - ${new Date().toLocaleString('th-TH')}`
      };

      if (currentUser?.id) payload.user_id = Number(currentUser.id);
      if (currentUser?.name) payload.user_name = String(currentUser.name);
      payload.table = 'users';
      
      const res = await fetch(`${API_URL}/deliveries/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) { const errorText = await res.text(); throw new Error(`HTTP ${res.status}: ${errorText}`); }
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
      allDeliveryPoints = allDeliveryPoints.filter((p: any) => p.id !== pointIdToRemove);

      const remainingDeliveryPoints = optimizedRoute.optimized_order.filter((p: any) => p.id !== -1);
      if (remainingDeliveryPoints.length === 0) {
        showNotification('🎉 ครบทุกจุดแล้ว!', 'success');
        speak('ครบทุกจุดแล้ว');
        stopNavigation();
        clearAllMarkersAndLayers();
        optimizedRoute = null;
        await loadDeliveryPoints();
        await loadTodayStats();
      } else {
        showNotification(`⏭️ ข้าม ${skippedPoint.name} — คำนวณเส้นทางใหม่...`, 'warning');
        addAlert('navigation', `ข้ามจุด: ${skippedPoint.name}`);
        // Reset nav state + clear old route layers immediately
        currentTargetIndex = 1;
        arrivedPoints = [0];
    
        clearAllRouteLayers();
        if (traveledLayer) { traveledLayer.remove(); traveledLayer = null; }
        cachedRouteCoords = [];
        lastRouteIndex = 0;
        lastDrawnRouteIndex = -1;
        lastArrivalDist = Infinity;
        // Recalculate full route from current position
        await recalculateRouteFromCurrentPosition();
      }
    } catch (err: any) {
      showNotification(`ข้ามไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
      isProcessingDelivery = false;
    }
  }

  // Voice Navigation
  let thaiVoice: SpeechSynthesisVoice | null = null;
  function initVoiceNavigation() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      thaiVoice = voices.find(v => v.lang === 'th-TH') || voices.find(v => v.lang.startsWith('th')) || voices.find(v => v.name.toLowerCase().includes('thai')) || null;
    };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  function speak(text: string) {
    if (!voiceEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'th-TH';
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (thaiVoice) utterance.voice = thaiVoice;
    speechSynthesis.speak(utterance);
  }
  function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    showNotification(voiceEnabled ? 'เปิดเสียงนำทาง' : 'ปิดเสียงนำทาง', 'success');
  }

  // ==================== NIGHT MODE (manual toggle) ====================
  function toggleNightMode() {
    nightMode = !nightMode;
    localStorage.setItem(getUserKey('nightMode'), nightMode ? 'dark' : 'light');
    showNotification(nightMode ? 'โหมดกลางคืน' : 'โหมดกลางวัน', 'success');
  }

  // ==================== KEYBOARD SHORTCUTS ====================
  let selectedPointIndex = -1; // สำหรับ keyboard navigation ใน point list
  let showKeyboardHelp = false;

  // ==================== QUICK ADD FROM CLIPBOARD ====================
  let showQuickAdd = false;
  let quickAddLoading = false;
  let quickAddResults: { name: string; address: string; lat: number; lng: number }[] = [];
  let quickAddSelectedIndex = 0;
  let quickAddError: string | null = null;
  let quickAddInput = '';

  // Getter for currently selected result
  $: quickAddResult = quickAddResults.length > 0 ? quickAddResults[quickAddSelectedIndex] : null;

  async function quickAddFromClipboard() {
    if (optimizedRoute || isNavigating) {
      showNotification('ล้างเส้นทางก่อนเพิ่มจุดใหม่', 'warning');
      return;
    }

    try {
      // อ่าน clipboard
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText || clipboardText.trim().length === 0) {
        showNotification('ไม่มีข้อความใน clipboard', 'warning');
        return;
      }

      quickAddInput = clipboardText.trim();
      showQuickAdd = true;
      quickAddLoading = true;
      quickAddResults = [];
      quickAddSelectedIndex = 0;
      quickAddError = null;

      // พยายาม parse content
      const results = await parseClipboardContent(clipboardText.trim());

      if (results && results.length > 0) {
        quickAddResults = results;
        quickAddSelectedIndex = 0;
      } else {
        quickAddError = 'ไม่พบตำแหน่ง ลองพิมพ์ชื่อสถานที่ให้ชัดเจนขึ้น';
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        showNotification('กรุณาอนุญาตการเข้าถึง clipboard', 'error');
        showQuickAdd = false;
      } else {
        quickAddError = 'เกิดข้อผิดพลาด: ' + (err.message || 'Unknown error');
      }
    } finally {
      quickAddLoading = false;
    }
  }

  async function parseClipboardContent(text: string): Promise<{ name: string; address: string; lat: number; lng: number }[]> {
    const results: { name: string; address: string; lat: number; lng: number }[] = [];

    // 1. ตรวจสอบว่าเป็นพิกัดโดยตรง (13.7563, 100.5018) หรือ 13.7563 100.5018
    const coordsRegex = /^[-]?\d+\.?\d*[,\s]+[-]?\d+\.?\d*$/;
    if (coordsRegex.test(text)) {
      const parts = text.split(/[,\s]+/).map(s => parseFloat(s.trim()));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const [lat, lng] = parts;
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          // Reverse geocode เพื่อหาชื่อ
          const geo = await reverseGeocode(lat, lng);
          return [{
            name: geo?.name || `จุดที่ ${allDeliveryPoints.length + 1}`,
            address: geo?.address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            lat, lng
          }];
        }
      }
    }

    // 2. ตรวจสอบ Google Maps URL
    const gmapsRegex = /(?:google\.com\/maps|maps\.google\.com|goo\.gl\/maps|maps\.app\.goo\.gl)/i;
    if (gmapsRegex.test(text)) {
      const coords = extractCoordsFromGoogleMapsUrl(text);
      if (coords) {
        const geo = await reverseGeocode(coords.lat, coords.lng);
        return [{
          name: geo?.name || `จุดที่ ${allDeliveryPoints.length + 1}`,
          address: geo?.address || `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`,
          lat: coords.lat, lng: coords.lng
        }];
      }
    }

    // 3. ค้นหาที่อยู่ด้วย Nominatim (ลองหลายวิธี)
    const searchStrategies = [
      // Strategy 1: ค้นหาตรงๆ ในไทย
      { q: text, countrycodes: 'th' },
      // Strategy 2: เพิ่ม "ประเทศไทย" ต่อท้าย
      { q: `${text} ประเทศไทย`, countrycodes: undefined },
      // Strategy 3: เพิ่ม "Thailand" ต่อท้าย
      { q: `${text} Thailand`, countrycodes: undefined },
      // Strategy 4: ค้นหาแบบไม่จำกัดประเทศ
      { q: text, countrycodes: undefined },
      // Strategy 5: ลองแยกคำค้นหา (เอาเฉพาะคำแรก + กรุงเทพ)
      { q: `${text.split(/[,\s]+/)[0]} กรุงเทพ`, countrycodes: 'th' },
    ];

    // เก็บ place_id ที่เจอแล้วเพื่อไม่ให้ซ้ำ
    const seenPlaceIds = new Set<string>();

    for (const strategy of searchStrategies) {
      if (results.length >= 5) break; // จำกัดไม่เกิน 5 ผลลัพธ์

      try {
        const params = new URLSearchParams({
          q: strategy.q,
          format: 'json',
          limit: '5',
          'accept-language': 'th',
          addressdetails: '1'
        });
        if (strategy.countrycodes) {
          params.append('countrycodes', strategy.countrycodes);
        }

        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          headers: { 'User-Agent': 'RouteOptimization/2.0' }
        });
        const data = await res.json();

        if (data && data.length > 0) {
          // เพิ่มผลลัพธ์ที่ไม่ซ้ำ (ให้ priority กับไทย)
          const sortedData = [...data].sort((a, b) => {
            const aIsThai = a.address?.country_code === 'th' ? 0 : 1;
            const bIsThai = b.address?.country_code === 'th' ? 0 : 1;
            return aIsThai - bIsThai;
          });

          for (const place of sortedData) {
            if (results.length >= 5) break;

            const placeKey = `${parseFloat(place.lat).toFixed(4)},${parseFloat(place.lon).toFixed(4)}`;
            if (seenPlaceIds.has(placeKey)) continue;
            seenPlaceIds.add(placeKey);

            results.push({
              name: place.name || place.display_name?.split(',')[0] || text.substring(0, 30),
              address: place.display_name || text,
              lat: parseFloat(place.lat),
              lng: parseFloat(place.lon)
            });
          }

          // ถ้าเจอผลลัพธ์ในไทยแล้ว หยุดค้นหา
          if (results.some(r => data.find((p: any) =>
            parseFloat(p.lat).toFixed(4) === r.lat.toFixed(4) &&
            p.address?.country_code === 'th'
          ))) {
            break;
          }
        }
      } catch (err) {
        console.error('Nominatim search failed:', err);
      }
    }

    // ถ้ายังไม่เจอ ลอง fallback - ถ้ามีคำว่า "ซอย" หรือ "ถนน" ลองตัดออก
    if (results.length === 0) {
      const simplifiedText = text
        .replace(/ซอย\s*\S+/g, '')
        .replace(/ถนน\s*\S+/g, '')
        .replace(/เลขที่\s*\S+/g, '')
        .replace(/\d+\/\d+/g, '')
        .trim();

      if (simplifiedText && simplifiedText !== text && simplifiedText.length > 3) {
        try {
          const params = new URLSearchParams({
            q: `${simplifiedText} Thailand`,
            format: 'json',
            limit: '3',
            'accept-language': 'th'
          });
          const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
            headers: { 'User-Agent': 'RouteOptimization/2.0' }
          });
          const data = await res.json();
          if (data && data.length > 0) {
            for (const place of data) {
              const placeKey = `${parseFloat(place.lat).toFixed(4)},${parseFloat(place.lon).toFixed(4)}`;
              if (seenPlaceIds.has(placeKey)) continue;
              seenPlaceIds.add(placeKey);

              results.push({
                name: text.substring(0, 40), // ใช้ชื่อเดิมที่ผู้ใช้ป้อน
                address: place.display_name || text,
                lat: parseFloat(place.lat),
                lng: parseFloat(place.lon)
              });
            }
          }
        } catch (err) {
          console.error('Simplified search failed:', err);
        }
      }
    }

    return results;
  }

  function extractCoordsFromGoogleMapsUrl(url: string): { lat: number; lng: number } | null {
    // Pattern: @13.7563,100.5018 หรือ !3d13.7563!4d100.5018 หรือ q=13.7563,100.5018
    const patterns = [
      /@(-?\d+\.?\d*),(-?\d+\.?\d*)/,           // @lat,lng
      /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/,       // !3dlat!4dlng
      /q=(-?\d+\.?\d*),(-?\d+\.?\d*)/,          // q=lat,lng
      /place\/.*\/@(-?\d+\.?\d*),(-?\d+\.?\d*)/ // place/.../@lat,lng
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          return { lat, lng };
        }
      }
    }
    return null;
  }

  async function confirmQuickAdd() {
    if (!quickAddResult) return;

    try {
      const params = new URLSearchParams();
      params.append('user_id', $page.params.id);
      params.append('name', quickAddResult.name);
      params.append('address', quickAddResult.address);
      params.append('lat', String(quickAddResult.lat));
      params.append('lng', String(quickAddResult.lng));
      params.append('priority', '3');

      const res = await fetch(`${API_URL}/points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!res.ok) throw new Error('Failed to add point');

      const data = await res.json();
      if (data.success && data.point) {
        deliveryPoints = [...deliveryPoints, data.point];
        showNotification(`เพิ่ม "${quickAddResult.name}" สำเร็จ`, 'success');

        // แสดงบนแผนที่
        if (map && L) {
          map.setView([quickAddResult.lat, quickAddResult.lng], 15, { animate: true });
        }
      }
    } catch (err) {
      showNotification('เพิ่มจุดไม่สำเร็จ', 'error');
    } finally {
      closeQuickAdd();
    }
  }

  function closeQuickAdd() {
    showQuickAdd = false;
    quickAddResults = [];
    quickAddSelectedIndex = 0;
    quickAddError = null;
    quickAddInput = '';
    quickAddLoading = false;
  }

  function handleKeyboardShortcuts(e: KeyboardEvent) {
    // ไม่ทำงานถ้ากำลังพิมพ์ใน input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

    const key = e.key.toLowerCase();
    const isShift = e.shiftKey;
    const isCtrl = e.ctrlKey || e.metaKey;

    // Ctrl+? หรือ ? = แสดง keyboard help
    if (key === '?' || (isShift && key === '/')) {
      e.preventDefault();
      showKeyboardHelp = !showKeyboardHelp;
      return;
    }

    // ไม่ทำงานถ้ากด Ctrl/Cmd/Alt (ยกเว้นบางคำสั่ง)
    if (e.altKey) return;

    // Ctrl shortcuts
    if (isCtrl) {
      switch (key) {
        case 'v': // Ctrl+V = Quick Add from Clipboard
          if (!optimizedRoute && !isNavigating) {
            e.preventDefault();
            quickAddFromClipboard();
          }
          break;
        case 'arrowup': // Zoom in
          e.preventDefault();
          if (map) map.zoomIn();
          break;
        case 'arrowdown': // Zoom out
          e.preventDefault();
          if (map) map.zoomOut();
          break;
      }
      return;
    }

    switch (key) {
      // ==================== NAVIGATION KEYS ====================
      case 'arrowup': // เลื่อนขึ้นใน point list
        e.preventDefault();
        if (allDeliveryPoints.length > 0) {
          selectedPointIndex = selectedPointIndex <= 0 ? allDeliveryPoints.length - 1 : selectedPointIndex - 1;
          activePointId = allDeliveryPoints[selectedPointIndex]?.id || null;
          scrollToSelectedPoint();
        }
        break;
      case 'arrowdown': // เลื่อนลงใน point list
        e.preventDefault();
        if (allDeliveryPoints.length > 0) {
          selectedPointIndex = selectedPointIndex >= allDeliveryPoints.length - 1 ? 0 : selectedPointIndex + 1;
          activePointId = allDeliveryPoints[selectedPointIndex]?.id || null;
          scrollToSelectedPoint();
        }
        break;
      case 'enter': // เลือก/ยืนยัน point ที่เลือก
        e.preventDefault();
        if (showKeyboardHelp) {
          showKeyboardHelp = false;
        } else if (selectedPointIndex >= 0 && selectedPointIndex < allDeliveryPoints.length) {
          const point = allDeliveryPoints[selectedPointIndex];
          if (point && map) {
            map.setView([point.lat, point.lng], 16, { animate: true });
          }
        }
        break;
      case 'delete': // ลบ point ที่เลือก
      case 'backspace':
        if (!isNavigating && !optimizedRoute && selectedPointIndex >= 0) {
          e.preventDefault();
          const point = allDeliveryPoints[selectedPointIndex];
          if (point) {
            deletePoint(point.id, point.name);
            selectedPointIndex = Math.min(selectedPointIndex, allDeliveryPoints.length - 1);
          }
        }
        break;

      // ==================== NUMBER KEYS - SELECT POINT / ROUTE ====================
      case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
        e.preventDefault();
        const num = parseInt(key);
        if (isShift && routeAlternatives.length > 0 && optimizedRoute) {
          // Shift+1-4 = เลือก route alternative
          if (num <= routeAlternatives.length) {
            const start = optimizedRoute?.optimized_order?.[0];
            const points = optimizedRoute?.optimized_order?.filter((p: any) => p.id !== -1);
            if (start && points) {
              selectRoute(num - 1, start, points, true);
              showNotification(`เลือกเส้นทาง ${num}`, 'success');
            }
          }
        } else if (allDeliveryPoints.length >= num) {
          // 1-9 = เลือก point
          selectedPointIndex = num - 1;
          activePointId = allDeliveryPoints[selectedPointIndex]?.id || null;
          const point = allDeliveryPoints[selectedPointIndex];
          if (point && map) {
            map.setView([point.lat, point.lng], 16, { animate: true });
          }
        }
        break;

      // ==================== TAB NAVIGATION ====================
      case 'tab':
        if (!showAddForm && !showSettings && !isNavigating) {
          e.preventDefault();
          activeTab = activeTab === 'points' ? 'route' : 'points';
        }
        break;

      // ==================== ACTION KEYS ====================
      case 'r': // คำนวณเส้นทาง
        if (!isOptimizing && allDeliveryPoints.length >= 1 && !isNavigating) {
          e.preventDefault();
          optimizeRoute();
        }
        break;
      case 'n': // เริ่มนำทาง
        if (optimizedRoute && !isNavigating) {
          e.preventDefault();
          startNavigation();
        }
        break;
      case 'm': // ซ่อน/แสดง sidebar
        if (!isNavigating) {
          e.preventDefault();
          desktopSidebarCollapsed = !desktopSidebarCollapsed;
          const resizeMap = () => { if (map) map.invalidateSize({ animate: true }); };
          requestAnimationFrame(resizeMap);
          setTimeout(resizeMap, 100);
          setTimeout(resizeMap, 350);
        }
        break;
      case 't': // เปิด/ปิด traffic
        e.preventDefault();
        toggleTraffic();
        break;
      case 'd': // โหมดกลางวัน/กลางคืน
        e.preventDefault();
        toggleNightMode();
        break;
      case 'a': // เพิ่มจุดแวะ
        if (!optimizedRoute && !isNavigating) {
          e.preventDefault();
          showAddForm = !showAddForm;
        }
        break;
      case 'escape': // ปิด modal / หยุดนำทาง / ยกเลิกการเลือก
        e.preventDefault();
        if (showKeyboardHelp) showKeyboardHelp = false;
        else if (showSettings) showSettings = false;
        else if (showAlerts) showAlerts = false;
        else if (showAddForm) showAddForm = false;
        else if (showRouteSelector) showRouteSelector = false;
        else if (showOptimizationResult) showOptimizationResult = false;
        else if (selectedPointIndex >= 0) { selectedPointIndex = -1; activePointId = null; }
        else if (isNavigating) stopNavigation();
        break;
      case 's': // บันทึกเส้นทาง
        if (optimizedRoute && !isNavigating) {
          e.preventDefault();
          saveCurrentRoute();
        }
        break;
      case 'c': // ล้างเส้นทาง
        if (optimizedRoute && !isNavigating) {
          e.preventDefault();
          clearRoute();
          clearAlternativeRouteLayers();
          routeAlternatives = [];
        }
        break;
      case 'o': // 2-opt optimization
        if (allDeliveryPoints.length >= 3 && !isOptimizingOrder && !isNavigating && !optimizedRoute) {
          e.preventDefault();
          optimizePointOrder();
        }
        break;

      // ==================== MAP CONTROLS ====================
      case 'g': // ไปที่ตำแหน่ง GPS ปัจจุบัน
        e.preventDefault();
        if (currentLocation && map) {
          map.setView([currentLocation.lat, currentLocation.lng], 17, { animate: true });
          showNotification('ไปที่ตำแหน่งปัจจุบัน', 'success');
        } else {
          showNotification('ไม่พบตำแหน่ง GPS', 'warning');
        }
        break;
      case 'l': // Lock/Unlock map following (navigation mode)
        if (isNavigating) {
          e.preventDefault();
          isMapFollowing = !isMapFollowing;
          showNotification(isMapFollowing ? 'ติดตามตำแหน่งอัตโนมัติ' : 'หยุดติดตาม', 'success');
        }
        break;
      case 'f': // Full screen toggle
        e.preventDefault();
        if (!isNavigating) {
          desktopSidebarCollapsed = !desktopSidebarCollapsed;
          const resizeMap = () => { if (map) map.invalidateSize({ animate: true }); };
          requestAnimationFrame(resizeMap);
          setTimeout(resizeMap, 350);
        }
        break;
      case '+': case '=': // Zoom in
        e.preventDefault();
        if (map) map.zoomIn();
        break;
      case '-': case '_': // Zoom out
        e.preventDefault();
        if (map) map.zoomOut();
        break;
      case 'h': // Home - zoom to fit all points
        e.preventDefault();
        if (allDeliveryPoints.length > 0 && map) {
          const bounds = L.latLngBounds(allDeliveryPoints.map((p: any) => [p.lat, p.lng]));
          map.fitBounds(bounds, { padding: [50, 50], animate: true });
        }
        break;

      // ==================== QUICK ACTIONS ====================
      case 'q': // Quick Add from Clipboard
        if (!optimizedRoute && !isNavigating) {
          e.preventDefault();
          quickAddFromClipboard();
        }
        break;
      case 'p': // Toggle POI panel
        e.preventDefault();
        showPOIOverlay = !showPOIOverlay;
        break;
      case 'e': // Toggle EV mode
        e.preventDefault();
        toggleVehicleType();
        break;
      case 'v': // เปิด voice navigation
        if (isNavigating) {
          e.preventDefault();
          voiceEnabled = !voiceEnabled;
          showNotification(voiceEnabled ? 'เปิดเสียงนำทาง' : 'ปิดเสียงนำทาง', 'success');
        }
        break;
    }
  }

  function scrollToSelectedPoint() {
    if (selectedPointIndex >= 0) {
      const pointCard = document.querySelector(`.point-card[data-index="${selectedPointIndex}"]`);
      if (pointCard) {
        pointCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  // ==================== onMount - เปลี่ยน redirect path ====================
  onMount(async () => {
    const userStr = localStorage.getItem('user');
    if (!userStr) { goto('/'); return; }
    currentUser = JSON.parse(userStr);

    // 🔄 ตรวจสอบ role - redirect ไปหน้าที่ถูกต้อง
    if (currentUser.role) {
      const role = currentUser.role.toLowerCase();
      if (role === 'admin') { goto(`/Admin/${currentUser.id}`); return; }
      if (role === 'driver') { goto(`/Home/${currentUser.id}`); return; }
      if (role === 'customer') { goto(`/Customer/${currentUser.id}`); return; }
    }

    const savedVehicleType = localStorage.getItem(getUserKey('vehicleType'));
    if (savedVehicleType === 'ev' || savedVehicleType === 'fuel') {
      vehicleType = savedVehicleType;
    }
    const savedEVCharge = localStorage.getItem(getUserKey('evCurrentCharge'));
    if (savedEVCharge) evCurrentCharge = parseFloat(savedEVCharge);
    const savedKmPerLiter = localStorage.getItem(getUserKey('kmPerLiter'));
    if (savedKmPerLiter) KM_PER_LITER = parseFloat(savedKmPerLiter) || 15;
    const savedKwhPer100km = localStorage.getItem(getUserKey('kwhPer100km'));
    if (savedKwhPer100km) KWH_PER_100KM = parseFloat(savedKwhPer100km) || 15;
    const savedElectricityPrice = localStorage.getItem(getUserKey('electricityPrice'));
    if (savedElectricityPrice) ELECTRICITY_PRICE_PER_KWH = parseFloat(savedElectricityPrice) || 4.5;

    const savedStation = localStorage.getItem(getUserKey('selectedStation'));
    if (savedStation) selectedStation = savedStation;
    const savedFuelType = localStorage.getItem(getUserKey('selectedFuelType'));
    if (savedFuelType) selectedFuelType = savedFuelType;

    // Load route preferences (per user)
    const savedPref = localStorage.getItem(getUserKey('routePreference'));
    if (savedPref) routePreference = savedPref as typeof routePreference;
    const savedAvoidToll = localStorage.getItem(getUserKey('avoidTollRoads'));
    if (savedAvoidToll) avoidTollRoads = savedAvoidToll === 'true';
    const savedAvoidHwy = localStorage.getItem(getUserKey('avoidExpressways'));
    if (savedAvoidHwy) avoidExpressways = savedAvoidHwy === 'true';

    // Load recent searches
    loadRecentSearches();

    const savedAutoReroute = localStorage.getItem(getUserKey('autoRerouteEnabled'));
    if (savedAutoReroute !== null) autoRerouteEnabled = savedAutoReroute === 'true';
    const savedSpeedAlert = localStorage.getItem(getUserKey('speedAlertEnabled'));
    if (savedSpeedAlert !== null) speedAlertEnabled = savedSpeedAlert === 'true';
    const savedTraffic = localStorage.getItem(getUserKey('showTraffic'));
    if (savedTraffic !== null) showTraffic = savedTraffic === 'true';
    const savedNightMode = localStorage.getItem(getUserKey('nightMode'));
    if (savedNightMode === 'light') nightMode = false;
    else nightMode = true;
    loadSavedRoutes();

    const urlId = $page.params.id;
    // 🔄 เปลี่ยนจาก /Home/ เป็น /User/
    if (Number(urlId) !== currentUser.id) { goto(`/User/${currentUser.id}`); return; }

    try {
      // Start GPS + Leaflet import in parallel for faster load
      const gpsPromise = new Promise<{lat: number, lng: number} | null>((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
      });

      const [leafletModule, , userPos] = await Promise.all([
        import('leaflet'),
        import('leaflet/dist/leaflet.css'),
        gpsPromise
      ]);
      L = leafletModule;

      // Center on user's current position if available, otherwise Bangkok
      const initLat = userPos?.lat ?? 13.7465;
      const initLng = userPos?.lng ?? 100.5348;
      const initZoom = userPos ? 16 : 12;

      map = L.map('map', {
        zoomControl: false,
        preferCanvas: true,
        zoomSnap: 1,
        wheelDebounceTime: 80
      }).setView([initLat, initLng], initZoom);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      // OSM Standard — ป้ายภาษาไทยครบ + CSS dark filter
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19, keepBuffer: 2,
        updateWhenZooming: false,
        updateWhenIdle: true,
        crossOrigin: 'anonymous'
      }).addTo(map);

      // Set current location immediately if GPS succeeded
      if (userPos) {
        currentLocation = { lat: userPos.lat, lng: userPos.lng };
        updateCurrentLocationMarker();
      }

      // Start continuous GPS tracking (always-on, real-time)
      if (navigator.geolocation) {
        continuousWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude, accuracy: acc, heading, speed } = pos.coords;
            // Update location when not navigating (navigation has its own watch)
            if (!isNavigating) {
              currentLocation = { lat: latitude, lng: longitude, heading, speed };
              accuracy = acc;
              if (heading !== null && !isNaN(heading) && speed && speed > 1) {
                currentHeading = heading;
              }
              updateCurrentLocationMarker();
            }
          },
          (err) => {
            console.warn('Continuous GPS error:', err.code, err.message);
            // Permission denied - stop trying
            if (err.code === 1) {
              if (continuousWatchId !== null) {
                navigator.geolocation.clearWatch(continuousWatchId);
                continuousWatchId = null;
              }
              showNotification('กรุณาอนุญาตการเข้าถึง GPS', 'error');
            }
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      }

      setTimeout(() => map.invalidateSize(), 100);
      setTimeout(() => map.invalidateSize(), 500);

      resizeHandler = () => { setTimeout(() => map?.invalidateSize(), 100); };
      window.addEventListener('resize', resizeHandler);

      map.on('zoomend', updateRouteWeights);

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

      // Load data in parallel instead of sequential
      await Promise.all([
        loadDeliveryPoints(),
        loadTodayStats(),
        loadDeliveryHistory(),
        fetchOilPrices()
      ]);
      initExtraFeatures();
      initVoiceNavigation();

      // Restore route from previous session (page refresh)
      if (restoreRouteState()) {
        showNotification('กู้คืนเส้นทางที่คำนวณไว้แล้ว', 'success');
      }

      // Keyboard shortcuts
      window.addEventListener('keydown', handleKeyboardShortcuts);

      oilPriceInterval = setInterval(() => { fetchOilPrices(); }, 1800000);
    } catch (error) {
      console.error('Map init error:', error);
      showNotification('ไม่สามารถโหลดแผนที่ได้', 'error');
    }
  });

  onDestroy(() => {
    stopNavigation();
    clearTrafficLayers();
    clearIncidentMarkers();
    // Stop navigation GPS tracking
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    // Stop continuous GPS tracking
    if (continuousWatchId !== null) {
      navigator.geolocation.clearWatch(continuousWatchId);
      continuousWatchId = null;
    }
    // Clean up accuracy circle
    if (accuracyCircle && map) {
      try { map.removeLayer(accuracyCircle); } catch(e) {}
      accuracyCircle = null;
    }
    // Clean up location marker
    if (currentLocationMarker && map) {
      try { map.removeLayer(currentLocationMarker); } catch(e) {}
      currentLocationMarker = null;
    }
    if (browser) {
      window.removeEventListener('keydown', handleKeyboardShortcuts);
      if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
    }
    if (extraFeaturesInterval) { clearInterval(extraFeaturesInterval); extraFeaturesInterval = null; }
    if (batteryInterval) { clearInterval(batteryInterval); batteryInterval = null; }
    if (oilPriceInterval) { clearInterval(oilPriceInterval); oilPriceInterval = null; }
    if (routeAbortController) { routeAbortController.abort(); routeAbortController = null; }
    if (navigationInterval) { clearInterval(navigationInterval); navigationInterval = null; }
    if (map) { map.off('zoomend', updateRouteWeights); map.remove(); map = null; }
  });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://tile.openstreetmap.org">
  <title>ผู้ใช้ทั่วไป | Route Optimization</title>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</svelte:head>

<div class="app-container" class:day-mode={!nightMode}>
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
                  <div class="driver-avatar">{userInfo.avatar}</div>
                  <div class="driver-details">
                    <div class="driver-name">{userInfo.name}</div>
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
                      <span class="info-icon">💰</span>
                      <span class="info-text">ราคาที่ใช้: <strong style="color: #00ff88">฿{currentFuelPrice.toFixed(2)}/ลิตร</strong></span>
                    </div>
                    <div class="vehicle-adjust">
                      <!-- svelte-ignore a11y_label_has_associated_control -->
                      <label>📊 อัตราสิ้นเปลือง: <strong>{KM_PER_LITER}</strong> กม./ลิตร</label>
                      <input type="range" min="5" max="30" step="0.5" bind:value={KM_PER_LITER} on:change={saveVehicleSettings} class="ev-slider" />
                      <div class="adjust-range-hint"><span>5</span><span>30</span></div>
                    </div>
                  </div>
                {:else}
                  <div class="vehicle-info-card ev">
                    <div class="vehicle-adjust">
                      <!-- svelte-ignore a11y_label_has_associated_control -->
                      <label>🔌 ค่าไฟ: <strong>{ELECTRICITY_PRICE_PER_KWH}</strong> ฿/kWh</label>
                      <input type="range" min="1" max="10" step="0.1" bind:value={ELECTRICITY_PRICE_PER_KWH} on:change={saveVehicleSettings} class="ev-slider" />
                      <div class="adjust-range-hint"><span>1</span><span>10</span></div>
                    </div>
                    <div class="vehicle-adjust">
                      <!-- svelte-ignore a11y_label_has_associated_control -->
                      <label>📊 กินไฟ: <strong>{KWH_PER_100KM}</strong> kWh/100กม.</label>
                      <input type="range" min="8" max="30" step="0.5" bind:value={KWH_PER_100KM} on:change={saveVehicleSettings} class="ev-slider" />
                      <div class="adjust-range-hint"><span>8</span><span>30</span></div>
                    </div>
                    <div class="ev-battery-setting">
                      <!-- svelte-ignore a11y_label_has_associated_control -->
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
                <h4>🌓 โหมดแสง</h4>
                <div class="night-mode-selector">
                  <button class="night-mode-btn" class:active={nightMode} on:click={() => { nightMode = true; localStorage.setItem(getUserKey('nightMode'), 'dark'); }}>
                    <span>🌙</span><span>มืด</span>
                  </button>
                  <button class="night-mode-btn" class:active={!nightMode} on:click={() => { nightMode = false; localStorage.setItem(getUserKey('nightMode'), 'light'); }}>
                    <span>☀️</span><span>สว่าง</span>
                  </button>
                </div>
              </div>

              <!-- ⛽ ราคาน้ำมันวันนี้ -->
              {#if vehicleType === 'fuel'}
                <div class="settings-section">
                  <div class="oil-price-header">
                    <h4>⛽ ราคาน้ำมันวันนี้</h4>
                    <button class="refresh-oil-btn" on:click={fetchOilPrices} disabled={isLoadingOilPrice} title="รีเฟรชราคา">
                      {#if isLoadingOilPrice}
                        <div class="spinner-tiny"></div>
                      {:else}
                        🔄
                      {/if}
                    </button>
                  </div>
                  
                  {#if oilPriceData}
                    <div class="oil-price-date">📅 {oilPriceData.date}</div>
                  {/if}

                  <!-- เลือกปั๊ม -->
                  <div class="oil-select-group">
                    <label>เลือกปั๊ม:</label>
                    <select bind:value={selectedStation} on:change={updateCurrentFuelPrice}>
                      {#each stationOptions as station}
                        <option value={station.value}>{station.label}</option>
                      {/each}
                    </select>
                  </div>

                  <!-- เลือกประเภทน้ำมัน -->
                  <div class="oil-select-group">
                    <label>ประเภทน้ำมัน:</label>
                    <select bind:value={selectedFuelType} on:change={updateCurrentFuelPrice}>
                      {#each getAvailableFuelTypes() as fuel}
                        <option value={fuel.value}>{fuel.label} - ฿{fuel.price}</option>
                      {/each}
                    </select>
                  </div>

                  <!-- แสดงราคาปัจจุบัน -->
                  <div class="current-oil-price">
                    <span class="price-label">ราคาที่ใช้คำนวณ:</span>
                    <span class="price-value">฿{currentFuelPrice.toFixed(2)}/ลิตร</span>
                  </div>

                  <!-- เปรียบเทียบราคา -->
                  {#if getAllStationPrices().length > 1}
                    <div class="price-comparison">
                      <div class="comparison-header">📊 เปรียบเทียบราคา ({getSelectedFuelName()})</div>
                      <div class="comparison-list">
                        {#each getAllStationPrices().slice(0, 5) as priceInfo, i}
                          <div class="comparison-item" class:cheapest={i === 0} class:selected={priceInfo.station === selectedStation}>
                            <span class="station-name">{priceInfo.label}</span>
                            <span class="station-price">฿{priceInfo.price}</span>
                            {#if i === 0}
                              <span class="cheapest-badge">ถูกสุด!</span>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}

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
                  <button class="btn btn-ev-search" on:click={searchEVAlongRoute} disabled={isLoadingStations || !optimizedRoute}>
                    <span>🛣️</span>
                    <span>ค้นหาตามเส้นทาง</span>
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
    <div class="alerts-backdrop" on:click={() => showAlerts = false} role="presentation"></div>
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
      {#if lastDragUndo && notification.type === 'success'}
        <button class="undo-btn" on:click={undoDragPoint}>เลิกทำ</button>
      {/if}
    </div>
  {/if}

  <!-- 2-opt Optimization Result Modal -->
  {#if showOptimizationResult && optimizationResult}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="optimization-result-overlay" on:click={() => showOptimizationResult = false}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="optimization-result-modal glass-card" on:click|stopPropagation>
        <div class="opt-result-header">
          <span class="opt-result-icon">🎯</span>
          <h3>ผลการจัดลำดับ 2-opt</h3>
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <button class="opt-close-btn" on:click={() => showOptimizationResult = false}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="opt-result-body">
          <div class="opt-comparison">
            <div class="opt-before">
              <span class="opt-label">ก่อน</span>
              <span class="opt-value">{(optimizationResult.beforeDistance / 1000).toFixed(2)} กม.</span>
            </div>
            <div class="opt-arrow">→</div>
            <div class="opt-after">
              <span class="opt-label">หลัง</span>
              <span class="opt-value">{(optimizationResult.afterDistance / 1000).toFixed(2)} กม.</span>
            </div>
          </div>
          <div class="opt-improvement" class:positive={optimizationResult.improvement > 0}>
            {#if optimizationResult.improvement > 0}
              <span class="opt-improvement-icon">📉</span>
              <span>ลดระยะทาง {optimizationResult.improvement.toFixed(1)}%</span>
              <span class="opt-saved">(-{((optimizationResult.beforeDistance - optimizationResult.afterDistance) / 1000).toFixed(2)} กม.)</span>
            {:else}
              <span class="opt-improvement-icon">✅</span>
              <span>ลำดับเดิมดีที่สุดแล้ว</span>
            {/if}
          </div>
        </div>
        <div class="opt-result-footer">
          <button class="btn btn-primary" on:click={() => showOptimizationResult = false}>ตกลง</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Quick Add from Clipboard Modal -->
  {#if showQuickAdd}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="quick-add-overlay" on:click={closeQuickAdd} on:keydown={(e) => {
      if (e.key === 'Escape') closeQuickAdd();
      if (e.key === 'Enter' && quickAddResult) confirmQuickAdd();
      if (e.key === 'ArrowUp' && quickAddResults.length > 1) {
        e.preventDefault();
        quickAddSelectedIndex = quickAddSelectedIndex <= 0 ? quickAddResults.length - 1 : quickAddSelectedIndex - 1;
      }
      if (e.key === 'ArrowDown' && quickAddResults.length > 1) {
        e.preventDefault();
        quickAddSelectedIndex = quickAddSelectedIndex >= quickAddResults.length - 1 ? 0 : quickAddSelectedIndex + 1;
      }
    }}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="quick-add-modal glass-card" on:click|stopPropagation>
        <div class="qa-header">
          <div class="qa-title">
            <span class="qa-icon">📋</span>
            <h3>เพิ่มจุดจาก Clipboard</h3>
          </div>
          <button class="close-btn" on:click={closeQuickAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="qa-body">
          <div class="qa-input-preview">
            <span class="qa-label">ข้อความที่วาง:</span>
            <div class="qa-input-text">{quickAddInput}</div>
          </div>

          {#if quickAddLoading}
            <div class="qa-loading">
              <div class="qa-spinner"></div>
              <span>กำลังค้นหาตำแหน่ง...</span>
            </div>
          {:else if quickAddError}
            <div class="qa-error">
              <span class="qa-error-icon">❌</span>
              <span>{quickAddError}</span>
            </div>
          {:else if quickAddResults.length > 0}
            <div class="qa-results-list">
              {#if quickAddResults.length > 1}
                <div class="qa-results-hint">
                  <span>พบ {quickAddResults.length} ผลลัพธ์ - ใช้ ↑↓ เลือก</span>
                </div>
              {/if}
              {#each quickAddResults as result, i}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="qa-result" class:selected={quickAddSelectedIndex === i} on:click={() => quickAddSelectedIndex = i}>
                  <div class="qa-result-number">{i + 1}</div>
                  <div class="qa-result-info">
                    <div class="qa-result-name">{result.name}</div>
                    <div class="qa-result-address">{result.address}</div>
                    <div class="qa-result-coords">{result.lat.toFixed(6)}, {result.lng.toFixed(6)}</div>
                  </div>
                  {#if quickAddSelectedIndex === i}
                    <div class="qa-result-check">✓</div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="qa-footer">
          <button class="btn btn-secondary" on:click={closeQuickAdd}>
            <span>ยกเลิก</span>
            <kbd>Esc</kbd>
          </button>
          <button class="btn btn-primary" on:click={confirmQuickAdd} disabled={!quickAddResult || quickAddLoading}>
            <span>เพิ่มจุดนี้</span>
            <kbd>Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Share Route QR Modal -->
  {#if showShareQR}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="share-qr-overlay" on:click={closeShareQR} on:keydown={(e) => e.key === 'Escape' && closeShareQR()}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="share-qr-modal glass-card" on:click|stopPropagation>
        <div class="share-qr-header">
          <h3>📲 แชร์เส้นทาง</h3>
          <button class="close-btn" on:click={closeShareQR}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="share-qr-body">
          <div class="qr-code-container">
            <img
              src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={encodeURIComponent(shareQRUrl)}"
              alt="QR Code"
              class="qr-code-img"
            />
          </div>
          <p class="share-qr-hint">สแกน QR เพื่อเปิดเส้นทางใน Google Maps</p>
          <div class="share-qr-actions">
            <button class="btn btn-secondary" on:click={copyRouteLink}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>คัดลอก Link</span>
            </button>
            <button class="btn btn-primary" on:click={openRouteInGoogleMaps}>
              <svg viewBox="0 0 24 24" fill="currentColor" style="width: 16px; height: 16px;">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
              <span>เปิด Google Maps</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Keyboard Help Modal -->
  {#if showKeyboardHelp}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="keyboard-help-overlay" on:click={() => showKeyboardHelp = false} on:keydown={(e) => e.key === 'Escape' && (showKeyboardHelp = false)}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="keyboard-help-modal glass-card" on:click|stopPropagation>
        <div class="kbh-header">
          <h3>⌨️ คีย์ลัด</h3>
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <button class="close-btn" on:click={() => showKeyboardHelp = false}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="kbh-body">
          <div class="kbh-section">
            <h4>การนำทาง</h4>
            <div class="kbh-grid">
              <div class="kbh-item"><kbd>↑</kbd><kbd>↓</kbd><span>เลือกจุดแวะ</span></div>
              <div class="kbh-item"><kbd>1</kbd>-<kbd>9</kbd><span>ไปจุดที่ 1-9</span></div>
              <div class="kbh-item"><kbd>Enter</kbd><span>ซูมไปจุดที่เลือก</span></div>
              <div class="kbh-item"><kbd>Delete</kbd><span>ลบจุดที่เลือก</span></div>
              <div class="kbh-item"><kbd>Tab</kbd><span>สลับแท็บ</span></div>
            </div>
          </div>
          <div class="kbh-section">
            <h4>การทำงาน</h4>
            <div class="kbh-grid">
              <div class="kbh-item"><kbd>R</kbd><span>คำนวณเส้นทาง</span></div>
              <div class="kbh-item"><kbd>N</kbd><span>เริ่มนำทาง</span></div>
              <div class="kbh-item"><kbd>O</kbd><span>จัดลำดับ 2-opt</span></div>
              <div class="kbh-item"><kbd>A</kbd><span>เพิ่มจุดแวะ</span></div>
              <div class="kbh-item"><kbd>Q</kbd><span>วางจาก Clipboard</span></div>
              <div class="kbh-item"><kbd>S</kbd><span>บันทึกเส้นทาง</span></div>
              <div class="kbh-item"><kbd>C</kbd><span>ล้างเส้นทาง</span></div>
            </div>
          </div>
          <div class="kbh-section">
            <h4>แผนที่</h4>
            <div class="kbh-grid">
              <div class="kbh-item"><kbd>G</kbd><span>ไปตำแหน่ง GPS</span></div>
              <div class="kbh-item"><kbd>H</kbd><span>ซูมให้เห็นทุกจุด</span></div>
              <div class="kbh-item"><kbd>+</kbd><kbd>-</kbd><span>ซูมเข้า/ออก</span></div>
              <div class="kbh-item"><kbd>M</kbd><kbd>F</kbd><span>ซ่อน/แสดง sidebar</span></div>
              <div class="kbh-item"><kbd>T</kbd><span>เปิด/ปิด traffic</span></div>
              <div class="kbh-item"><kbd>D</kbd><span>โหมดกลางวัน/กลางคืน</span></div>
            </div>
          </div>
          <div class="kbh-section">
            <h4>อื่นๆ</h4>
            <div class="kbh-grid">
              <div class="kbh-item"><kbd>Shift</kbd>+<kbd>1</kbd>-<kbd>4</kbd><span>เลือกเส้นทางสำรอง</span></div>
              <div class="kbh-item"><kbd>E</kbd><span>สลับ EV/รถยนต์</span></div>
              <div class="kbh-item"><kbd>P</kbd><span>เปิด/ปิด POI</span></div>
              <div class="kbh-item"><kbd>V</kbd><span>เปิด/ปิดเสียง (นำทาง)</span></div>
              <div class="kbh-item"><kbd>L</kbd><span>ล็อค/ปลดล็อคติดตาม</span></div>
              <div class="kbh-item"><kbd>Esc</kbd><span>ปิด/ยกเลิก</span></div>
            </div>
          </div>
        </div>
        <div class="kbh-footer">
          <span>กด <kbd>?</kbd> เพื่อเปิด/ปิดหน้านี้</span>
        </div>
      </div>
    </div>
  {/if}

  <!-- Navigation Overlay -->
  {#if isNavigating}
    <div class="nav-overlay">

      <!-- Turn-by-Turn Navigation Display -->
      <div class="turn-by-turn-panel glass-card" class:off-route={isOffRoute}>
        {#if isOffRoute}
          <div class="off-route-warning">
            <span class="off-route-icon">⚠️</span>
            <div class="off-route-text">
              <div class="off-route-title">ออกนอกเส้นทาง!</div>
              <div class="off-route-detail">ห่าง {Math.round(offRouteDistance)} ม. - {autoRerouteEnabled ? 'กำลังคำนวณใหม่...' : 'กดปุ่มเพื่อคำนวณใหม่'}</div>
            </div>
            {#if !autoRerouteEnabled}
              <button class="reroute-btn" on:click={autoReroute}>🔄 คำนวณใหม่</button>
            {/if}
          </div>
        {:else}
          <div class="turn-instruction">
            <div class="turn-icon-wrap">
              <span class="turn-icon">{nextTurnIcon}</span>
            </div>
            <div class="turn-info">
              <div class="turn-text">{nextTurnInstruction}</div>
              <div class="turn-distance">อีก {formatDistance(nextTurnDistance)}</div>
            </div>
          </div>
        {/if}
      </div>

      <div class="nav-top-bar glass-card">
        <div class="nav-target-info">
          <div class="nav-target-label">มุ่งหน้าไป</div>
          <div class="nav-target-name">
            {#if currentTargetIndex < optimizedRoute?.optimized_order?.length}
              {optimizedRoute.optimized_order[currentTargetIndex].name}
            {:else}
              ถึงจุดหมายแล้ว
            {/if}
          </div>
          <div class="nav-eta">{formatDistance(distanceToNextPoint)} · {formatETA(estimatedArrivalTime)}</div>
        </div>
      </div>

      <!-- Curve Warning (below nav-top-bar, left side) -->
      {#if curveWarning?.active}
        <div class="curve-warning glass-card" class:sharp={curveWarning.severity === 'sharp'} class:hairpin={curveWarning.severity === 'hairpin'}>
          <div class="curve-icon">
            {#if curveWarning.direction === 'left'}↰{:else}↱{/if}
          </div>
          <div class="curve-info">
            <div class="curve-text">
              {curveWarning.severity === 'hairpin' ? '⚠️ โค้งหักศอก!' : curveWarning.severity === 'sharp' ? 'โค้งแรง' : 'ทางโค้ง'}
              {curveWarning.direction === 'left' ? 'ซ้าย' : 'ขวา'}
            </div>
            <div class="curve-distance">อีก {curveWarning.distance} ม.</div>
          </div>
        </div>
      {/if}

      <!-- Lane Guidance (below nav-top-bar, left side) -->
      {#if laneGuidance?.show}
        <div class="lane-guidance glass-card">
          <div class="lane-visual">
            <div class="lane" class:active={laneGuidance.lane === 'left'}></div>
            <div class="lane" class:active={laneGuidance.lane === 'center'}></div>
            <div class="lane" class:active={laneGuidance.lane === 'right'}></div>
          </div>
          <div class="lane-text">{laneGuidance.instruction}</div>
        </div>
      {/if}

      <!-- Right side: Speed + Compass + Lock -->
      <div class="nav-right-cluster">
        <div class="speed-display glass-card">
          <div class="speed-value">{Math.round(currentSpeed)}</div>
          <div class="speed-unit">km/h</div>
        </div>
        <div class="compass-widget glass-card" title="เข็มทิศ">
          <div class="compass-ring" style="transform: rotate({-compassHeading}deg)">
            <div class="compass-n">N</div>
            <div class="compass-e">E</div>
            <div class="compass-s">S</div>
            <div class="compass-w">W</div>
            <svg class="compass-needle" viewBox="0 0 40 40" width="40" height="40">
              <polygon points="20,4 16,22 20,19 24,22" fill="#ff4444"/>
              <polygon points="20,36 16,22 20,25 24,22" fill="#a0a0a0"/>
            </svg>
          </div>
          <div class="compass-heading-text">{Math.round(compassHeading)}° {compassDir}</div>
        </div>
        <button class="lock-btn glass-card" class:locked={isMapFollowing} on:click={() => { if (isMapFollowing) { isMapFollowing = false; map.getContainer().style.transform = 'rotate(0deg)'; } else { centerOnCurrentLocation(); } }}>
          {#if isMapFollowing}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>
          {/if}
        </button>
      </div>

      <div class="nav-bottom-panel glass-card">
        <div class="nav-stats">
          <div class="nav-stat">
            <div class="nav-stat-content"><div class="nav-stat-value">{formatDistance(remainingDistance)}</div><div class="nav-stat-label">เหลือ</div></div>
          </div>
          <div class="nav-stat">
            <div class="nav-stat-content"><div class="nav-stat-value">{formatTime(remainingTime)}</div><div class="nav-stat-label">เวลา</div></div>
          </div>
          <div class="nav-stat">
            <div class="nav-stat-content"><div class="nav-stat-value">{formatETA(estimatedArrivalTime)}</div><div class="nav-stat-label">ถึงเวลา</div></div>
          </div>
          <div class="nav-stat">
            <div class="nav-stat-content"><div class="nav-stat-value">{getSuccessCount()}/{getSuccessCount() + getRemainingPointsCount()}</div><div class="nav-stat-label">เป้าหมาย</div></div>
          </div>
        </div>

        <div class="nav-actions">
          <button class="nav-btn nav-btn-success" on:click={markDeliverySuccess} disabled={isProcessingDelivery || getRemainingPointsCount() === 0}>
            {#if isProcessingDelivery}<div class="spinner-small"></div>{:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>{/if}
            ถึงแล้ว
          </button>
          <button class="nav-btn nav-btn-skip" on:click={skipToNextPoint} disabled={isProcessingDelivery || getRemainingPointsCount() === 0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>
            ข้าม
          </button>
          <button class="nav-btn nav-btn-voice" class:active={voiceEnabled} on:click={toggleVoice}>
            {#if voiceEnabled}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>{:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>{/if}
          </button>
          <button class="nav-btn nav-btn-share" on:click={shareETA} title="แชร์เวลาถึง">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <button class="nav-btn nav-btn-stop" on:click={stopNavigation}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            หยุด
          </button>
        </div>
      </div>

    </div>
  {/if}

  <!-- Sidebar -->
  {#if !isNavigating}
    <aside class="sidebar" class:collapsed={!mobileSidebarOpen} class:desktop-collapsed={desktopSidebarCollapsed}>
      <!-- Mobile toggle handle -->
      <button class="sidebar-toggle" on:click={() => { mobileSidebarOpen = !mobileSidebarOpen; requestAnimationFrame(() => { if (map) map.invalidateSize(); }); setTimeout(() => { if (map) map.invalidateSize(); }, 50); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:flipped={mobileSidebarOpen}><path d="M6 9l6 6 6-6"/></svg>
        <span>{mobileSidebarOpen ? 'ซ่อนเมนู' : optimizedRoute ? `สรุป: ${(optimizedRoute.total_distance/1000).toFixed(1)} กม. · ${Math.round(optimizedRoute.total_time/60)} นาที` : `${allDeliveryPoints.length} จุดแวะ`}</span>
      </button>
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg></div>
          <div class="logo-text"><h1>Route Planning </h1><span>ระบบวางแผนเส้นทาง</span></div>
        </div>
        <div class="header-actions">
          <button class="icon-btn keyboard-help-btn" on:click={() => showKeyboardHelp = true} title="คีย์ลัด [?]">⌨️</button>
          <button class="icon-btn" on:click={toggleNightMode} title={nightMode ? 'เปลี่ยนเป็นโหมดสว่าง [D]' : 'เปลี่ยนเป็นโหมดมืด [D]'}>{nightMode ? '🌙' : '☀️'}</button>
          <button class="icon-btn" on:click={() => showAlerts = !showAlerts} title="การแจ้งเตือน">🔔{#if alerts.length > 0}<span class="badge">{alerts.length}</span>{/if}</button>
          <button class="icon-btn" on:click={() => showSettings = true} title="ตั้งค่า">⚙️</button>
        </div>
      </div>

      <div class="sidebar-scroll">

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
        <button class="btn btn-primary" on:click={optimizeRoute} disabled={isOptimizing || allDeliveryPoints.length < 1} title="คำนวณเส้นทาง [R]">
          {#if isOptimizing}<div class="spinner"></div><span>กำลังคำนวณ...</span>{:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg><span>คำนวณเส้นทาง ({allDeliveryPoints.length} จุด)</span>{/if}
        </button>
        {#if optimizedRoute}
          <button class="btn btn-navigate" on:click={startNavigation} title="เริ่มนำทาง [N]"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg><span>เริ่มนำทาง</span></button>
          {#if routeAlternatives.length > 1}
            <button class="btn btn-alt-routes" on:click={() => showRouteSelector = !showRouteSelector} title="เลือกเส้นทาง">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
              <span>เลือกเส้นทาง ({routeAlternatives.length})</span>
            </button>
          {/if}
          <button class="btn btn-save-route" on:click={saveCurrentRoute} title="บันทึกเส้นทาง [S]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><span>บันทึกเส้นทาง</span></button>
          <button class="btn btn-share" on:click={openShareQR} title="แชร์เส้นทาง QR"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>แชร์ QR</span></button>

          <button class="btn btn-ghost" on:click={() => { clearRoute(); clearAlternativeRouteLayers(); routeAlternatives = []; showRouteSelector = false; showRouteComparison = false; }} title="ล้างเส้นทาง [C]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg><span>ล้างเส้นทาง</span></button>
        {/if}
        {#if !optimizedRoute}
          <button class="btn btn-secondary" on:click={() => showAddForm = !showAddForm} title="เพิ่มจุดแวะ [A]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg><span>เพิ่มจุดแวะ</span></button>
          <button class="btn btn-ghost" on:click={toggleMultiSelect}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg><span>{isMultiSelectMode ? 'ยกเลิกเลือก' : 'เลือกหลายรายการ'}</span></button>
          <button class="btn {isDragMode ? 'btn-drag-active' : 'btn-ghost'}" on:click={toggleDragMode} disabled={deliveryPoints.length < 1}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 3-3 3M12 2L9 5l3 3M12 22l3-3-3-3M12 22l-3-3 3-3M2 12l3-3 3 3M2 12l3 3 3-3M22 12l-3-3-3 3M22 12l-3 3-3-3"/><circle cx="12" cy="12" r="1"/></svg>
            <span>{isDragMode ? 'ปิดย้ายจุด' : 'ย้ายจุดแวะ'}</span>
          </button>
          <button class="btn {isReorderMode ? 'btn-reorder-active' : 'btn-ghost'}" on:click={toggleReorderMode} disabled={isNavigating || deliveryPoints.length < 2}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18M3 12h18M3 17h18"/><path d="M7 4l-4 3 4 3"/><path d="M17 14l4 3-4 3"/></svg>
            <span>{isReorderMode ? 'ปิดลากเรียงลำดับ' : 'ลากเรียงลำดับ'}</span>
          </button>
          {#if manualOrder}
            <button class="btn btn-ghost" on:click={resetManualOrder}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
              <span>กลับลำดับอัตโนมัติ</span>
            </button>
          {/if}
          {#if deliveryPoints.length >= 3}
            <button class="btn btn-optimize-2opt" on:click={optimizePointOrder} disabled={isOptimizingOrder} title="จัดลำดับอัตโนมัติ 2-opt [O]">
              {#if isOptimizingOrder}
                <div class="spinner"></div>
                <span>กำลังจัดลำดับ... {optimizationProgress}%</span>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/><path d="M15 15l6 6"/></svg>
                <span>จัดลำดับอัตโนมัติ</span>
              {/if}
            </button>
            <label class="real-dist-toggle" class:disabled={isOptimizingOrder}>
              <input type="checkbox" bind:checked={useRealDistances} disabled={isOptimizingOrder} />
              <span class="toggle-switch">
                <span class="toggle-knob"></span>
              </span>
              <span class="toggle-label">
                <span class="toggle-text">ระยะทางจริง</span>
                <span class="toggle-hint">{useRealDistances ? '🛣️ API (แม่นยำ)' : '📐 Haversine (เร็ว)'}</span>
              </span>
            </label>
          {/if}
        {/if}
      </div>

      {#if showAddForm && !optimizedRoute}
        <div class="add-form-overlay">
          <div class="add-form glass-card">
            <div class="form-header"><h3>เพิ่มจุดแวะใหม่</h3><button class="close-btn" on:click={cancelAddForm}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg></button></div>
            <p class="form-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"/></svg>คลิกบนแผนที่เพื่อเลือกตำแหน่ง</p>
            <form on:submit|preventDefault={addDeliveryPoint}>
              <div class="form-group"><label>ชื่อสถานที่</label><input type="text" bind:value={newPoint.name} placeholder="สถานที่ ที่ต้องการจะคำนวณเส้นทาง" required /></div>
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

      <div class="tabs">
        <button class="tab" class:active={activeTab === 'points'} on:click={() => activeTab = 'points'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>จุดแวะ ({deliveryPoints.length})</button>
        <button class="tab" class:active={activeTab === 'route'} on:click={() => activeTab = 'route'} disabled={!optimizedRoute}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>เส้นทาง</button>
      </div>

      <div class="content-area">
        {#if activeTab === 'points'}
          <div class="points-list">
            {#if filteredPoints.length === 0}
              <div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg></div><h4>ยังไม่มีจุดแวะ</h4><p>คลิกบนแผนที่หรือกดปุ่ม "เพิ่มจุดแวะ"</p></div>
            {:else}
              {#each filteredPoints as point, i}
                {@const colors = getPriorityGradient(point.priority)}
                <div id="point-{point.id}" data-index={i} class="point-card" class:active={activePointId === point.id} class:keyboard-selected={selectedPointIndex === i} class:selected={selectedPoints.includes(point.id)} class:drag-source={isReorderMode && dragSourceIndex === i} class:drag-over={isReorderMode && dragOverIndex === i && dragSourceIndex !== i} draggable={isReorderMode} on:dragstart={(e) => isReorderMode && handleReorderDragStart(e, i)} on:dragover={(e) => isReorderMode && handleReorderDragOver(e, i)} on:drop={(e) => isReorderMode && handleReorderDrop(e, i)} on:dragend={() => isReorderMode && handleReorderDragEnd()} on:click={() => { if (isReorderMode) return; if (isMultiSelectMode) { togglePointSelection(point.id); } else { selectedPointIndex = i; activePointId = point.id; focusOnPoint(point.lat, point.lng); } }} on:keypress={(e) => e.key === 'Enter' && focusOnPoint(point.lat, point.lng)} role="button" tabindex="0">
                  {#if isReorderMode}<div class="drag-handle"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><circle cx="9" cy="15" r="1.5"/><circle cx="15" cy="15" r="1.5"/><circle cx="9" cy="20" r="1.5"/><circle cx="15" cy="20" r="1.5"/></svg></div>{/if}
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
        {:else if activeTab === 'route' && optimizedRoute}
          <div class="route-summary">
            <div class="summary-header">
              <h3>สรุปเส้นทาง</h3>
              <span class="route-badge" class:ev-badge={vehicleType === 'ev'}>
                {vehicleType === 'ev' ? '⚡ เส้นทาง EV' : '⛽ เส้นทางที่ดีที่สุด'}
              </span>
            </div>
            
            <div class="summary-stats">
              <div class="stat-card">
                <div class="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
                  </svg>
                </div>
                <div class="stat-value">{(optimizedRoute.total_distance / 1000).toFixed(1)}</div>
                <div class="stat-label">กิโลเมตร</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div class="stat-value">{Math.round(optimizedRoute.total_time / 60)}</div>
                <div class="stat-label">นาที</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                    <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                </div>
                <div class="stat-value">{optimizedRoute.optimized_order.filter((p: any) => p.id !== -1).length}</div>
                <div class="stat-label">จุดแวะ</div>
              </div>
              
              {#if vehicleType === 'fuel'}
                <div class="stat-card fuel">
                  <div class="stat-icon">⛽</div>
                  <div class="stat-value">฿{Math.round((optimizedRoute.total_distance / 1000) / KM_PER_LITER * currentFuelPrice)}</div>
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

            {#if vehicleType === 'fuel'}
              <div class="fuel-route-info">
                <div class="fuel-info-row">
                  <span>⛽ ปั๊ม:</span>
                  <strong>{getSelectedStationName()}</strong>
                </div>
                <div class="fuel-info-row">
                  <span>🛢️ ประเภท:</span>
                  <strong>{getSelectedFuelName()}</strong>
                </div>
                <div class="fuel-info-row">
                  <span>💰 ราคาน้ำมัน:</span>
                  <strong style="color: #00ff88">฿{currentFuelPrice.toFixed(2)}/ลิตร</strong>
                </div>
                <div class="fuel-info-row">
                  <span>⛽ ใช้น้ำมัน:</span>
                  <strong>{((optimizedRoute.total_distance / 1000) / KM_PER_LITER).toFixed(1)} ลิตร</strong>
                </div>
                <div class="fuel-info-row">
                  <span>📊 อัตราสิ้นเปลือง:</span>
                  <strong>{KM_PER_LITER} กม./ลิตร</strong>
                </div>
                
                {#if getCheapestStation() && getCheapestStation()?.label !== getSelectedStationName()}
                  <div class="cheapest-tip">
                    💡 ปั๊มถูกที่สุด: <strong>{getCheapestStation()?.label}</strong> (฿{getCheapestStation()?.price})
                    - ประหยัดได้ ฿{Math.round(((optimizedRoute.total_distance / 1000) / KM_PER_LITER) * (currentFuelPrice - parseFloat(getCheapestStation()?.price || '0')))}
                  </div>
                {/if}
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
            
            <!-- Trip Cost Summary -->
            <div class="trip-cost-card">
              <h4>💰 สรุปค่าใช้จ่าย</h4>
              <div class="cost-rows">
                {#if vehicleType === 'fuel'}
                  {@const fuelLiters = (optimizedRoute.total_distance / 1000) / KM_PER_LITER}
                  {@const fuelCost = Math.round(fuelLiters * currentFuelPrice)}
                  <div class="cost-row">
                    <span class="cost-label">⛽ ค่าน้ำมัน</span>
                    <span class="cost-value">฿{fuelCost.toLocaleString()}</span>
                  </div>
                  <div class="cost-row sub">
                    <span>{fuelLiters.toFixed(1)} ลิตร × ฿{currentFuelPrice.toFixed(2)}</span>
                  </div>
                {:else}
                  {@const evKwh = ((optimizedRoute.total_distance / 1000) / 100) * KWH_PER_100KM}
                  {@const evCost = Math.round(evKwh * ELECTRICITY_PRICE_PER_KWH)}
                  <div class="cost-row">
                    <span class="cost-label">⚡ ค่าไฟฟ้า</span>
                    <span class="cost-value">฿{evCost.toLocaleString()}</span>
                  </div>
                  <div class="cost-row sub">
                    <span>{evKwh.toFixed(1)} kWh × ฿{ELECTRICITY_PRICE_PER_KWH}</span>
                  </div>
                {/if}

                <div class="cost-row">
                  <span class="cost-label">🛣️ ค่าทางด่วน</span>
                  <span class="cost-value {tollCostEstimate > 0 ? '' : 'no-toll'}">{tollCostEstimate > 0 ? `฿${tollCostEstimate}` : 'ไม่มี ✅'}</span>
                </div>
                {#if tollCostEstimate > 0 && routeAlternatives[selectedRouteIndex]}
                  {@const expNames = getExpresswayNames(routeAlternatives[selectedRouteIndex])}
                  {#if expNames.length > 0}
                    <div class="cost-row sub"><span>ผ่าน: {expNames.join(', ')}</span></div>
                  {/if}
                {/if}

                <div class="cost-divider"></div>

                <!-- Total -->
                {#if vehicleType === 'fuel'}
                  {@const totalCost = Math.round(((optimizedRoute.total_distance / 1000) / KM_PER_LITER) * currentFuelPrice) + tollCostEstimate}
                  <div class="cost-row total">
                    <span class="cost-label">รวมทั้งหมด</span>
                    <span class="cost-value">฿{totalCost.toLocaleString()}</span>
                  </div>
                  <div class="cost-row sub">
                    <span>≈ ฿{(totalCost / Math.max(optimizedRoute.total_distance / 1000, 0.1)).toFixed(1)}/กม.</span>
                  </div>
                {:else}
                  {@const totalCostEV = Math.round((((optimizedRoute.total_distance / 1000) / 100) * KWH_PER_100KM) * ELECTRICITY_PRICE_PER_KWH) + tollCostEstimate}
                  <div class="cost-row total">
                    <span class="cost-label">รวมทั้งหมด</span>
                    <span class="cost-value">฿{totalCostEV.toLocaleString()}</span>
                  </div>
                  <div class="cost-row sub">
                    <span>≈ ฿{(totalCostEV / Math.max(optimizedRoute.total_distance / 1000, 0.1)).toFixed(1)}/กม.</span>
                  </div>
                {/if}
              </div>
            </div>

            <!-- Turn-by-Turn Preview -->
            {#if turnInstructions.length > 0}
              <div class="turn-preview-section">
                <h4>🧭 คำแนะนำเส้นทาง ({turnInstructions.length} ขั้นตอน)</h4>
                <div class="turn-preview-list">
                  {#each turnInstructions.slice(0, 8) as step, i}
                    <div class="turn-preview-item">
                      <span class="turn-preview-icon">{getTurnIcon(step.type, step.modifier)}</span>
                      <div class="turn-preview-info">
                        <span class="turn-preview-text">{getTurnText(step.type, step.modifier, step.name)}</span>
                        <span class="turn-preview-dist">{formatDistance(step.distance)}</span>
                      </div>
                    </div>
                  {/each}
                  {#if turnInstructions.length > 8}
                    <div class="turn-preview-more">...อีก {turnInstructions.length - 8} ขั้นตอน</div>
                  {/if}
                </div>
              </div>
            {/if}

            <div class="route-timeline">
              <h4>ลำดับการเดินทาง</h4>
              {#each optimizedRoute.optimized_order as point, i}
                {@const isStart = point.id === -1}
                {@const isCustomer = point.isCustomerOrder}
                <div class="timeline-item" class:start={isStart} class:customer={isCustomer} on:click={() => focusOnPoint(point.lat, point.lng)} on:keypress={(e) => e.key === 'Enter' && focusOnPoint(point.lat, point.lng)} role="button" tabindex="0">
                  <div class="timeline-marker"><span>{isStart ? '📍' : isCustomer ? '🛒' : i}</span></div>
                  <div class="timeline-content"><div class="timeline-label">{isStart ? 'ตำแหน่งของคุณ' : isCustomer ? '' : `จุดที่ ${i}`}</div><div class="timeline-name">{point.name}</div></div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      </div><!-- /.sidebar-scroll -->

      <div class="sidebar-footer"><span>Route Planning</span><span>ระบบเพิ่มประสิทธิภาพในการวางแผนเส้นทาง</span></div>
    </aside>
  {/if}

  <!-- Route Selector Overlay -->
  {#if showRouteSelector && routeAlternatives.length > 1 && !isNavigating}
    <div class="route-selector-overlay">
      <div class="route-selector-panel glass-card">
        <div class="route-selector-header">
          <h3>🗺️ เลือกเส้นทาง ({routeAlternatives.length} เส้นทาง)</h3>
          <button class="close-btn" on:click={() => showRouteSelector = false}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="route-selector-list">
          {#each routeAlternatives as alt, i}
            <button
              class="route-option-card"
              class:selected={selectedRouteIndex === i}
              on:click={() => { if (_lastStartPoint && _lastSortedPoints.length > 0) selectRoute(i, _lastStartPoint, _lastSortedPoints); }}
              style="border-left: 4px solid {alt.color}"
            >
              <div class="route-option-header">
                <span class="route-option-label" style="color: {alt.color}">{alt.label}</span>
                {#if i === 0}<span class="recommended-badge">แนะนำ</span>{/if}
              </div>
              <div class="route-option-stats">
                <div class="route-stat-item">
                  <span class="route-stat-icon">📏</span>
                  <span class="route-stat-val">{(alt.distance / 1000).toFixed(1)} กม.</span>
                </div>
                <div class="route-stat-item">
                  <span class="route-stat-icon">⏱️</span>
                  <span class="route-stat-val">{Math.round(alt.duration / 60)} นาที</span>
                </div>
                <div class="route-stat-item">
                  <span class="route-stat-icon">{getCostIcon()}</span>
                  <span class="route-stat-val">฿{Math.round(getFuelCostForRoute(alt.distance))}</span>
                </div>
              </div>
              <div class="route-option-tags">
                {#if alt.hasTolls}
                  <span class="route-tag toll">💰 ทางด่วน ~฿{alt.tollEstimate}</span>
                {:else}
                  <span class="route-tag no-toll">✅ ไม่มีทางด่วน</span>
                {/if}
                {#if showTraffic}
                  {@const traffic = getTrafficSummary(alt)}
                  <span class="route-tag" style="background: {traffic.color}20; color: {traffic.color}; border-color: {traffic.color}40">🚦 {traffic.label}</span>
                {/if}
                {#if i > 0}
                  {@const timeDiff = getTimeSaved(alt)}
                  {#if timeDiff > 0}
                    <span class="route-tag slower">+{Math.round(timeDiff / 60)} นาที</span>
                  {:else if timeDiff < 0}
                    <span class="route-tag faster">เร็วกว่า {Math.abs(Math.round(timeDiff / 60))} นาที</span>
                  {/if}
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Route Comparison Panel -->
  {#if showRouteComparison && routeAlternatives.length > 1}
    <div class="route-comparison-overlay" on:click={() => showRouteComparison = false} on:keypress={() => {}} role="button" tabindex="-1">
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="route-comparison-panel glass-card" on:click|stopPropagation role="dialog">
        <div class="comparison-panel-header">
          <h3>📊 เปรียบเทียบเส้นทาง</h3>
          <button class="close-btn" on:click={() => showRouteComparison = false}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="comparison-table">
          <div class="comparison-row header">
            <div class="comp-col label">เส้นทาง</div>
            <div class="comp-col">ระยะทาง</div>
            <div class="comp-col">เวลา</div>
            <div class="comp-col">ค่าเชื้อเพลิง</div>
            <div class="comp-col">ทางด่วน</div>
            {#if showTraffic}<div class="comp-col">การจราจร</div>{/if}
            <div class="comp-col">เลือก</div>
          </div>
          {#each routeAlternatives as alt, i}
            <div class="comparison-row" class:selected={selectedRouteIndex === i} style="border-left: 3px solid {alt.color}">
              <div class="comp-col label" style="color: {alt.color}">{alt.label}</div>
              <div class="comp-col">{(alt.distance / 1000).toFixed(1)} กม.</div>
              <div class="comp-col">{Math.round(alt.duration / 60)} นาที</div>
              <div class="comp-col">฿{Math.round(getFuelCostForRoute(alt.distance))}</div>
              <div class="comp-col">
                {#if alt.hasTolls}
                  <span style="color: #f59e0b">฿{alt.tollEstimate}</span>
                {:else}
                  <span style="color: #00ff88">ฟรี</span>
                {/if}
              </div>
              {#if showTraffic}
                {@const traffic = getTrafficSummary(alt)}
                <div class="comp-col"><span style="color: {traffic.color}">🚦 {traffic.label}</span></div>
              {/if}
              <div class="comp-col">
                <button class="comp-select-btn" class:active={selectedRouteIndex === i}
                  on:click={() => { const start = optimizedRoute?.optimized_order?.[0]; const points = optimizedRoute?.optimized_order?.filter((p: any) => p.id !== -1); if (start && points) selectRoute(i, start, points); showRouteComparison = false; }}
                >{selectedRouteIndex === i ? '✓ เลือกแล้ว' : 'เลือก'}</button>
              </div>
            </div>
          {/each}
        </div>
        <div class="comparison-summary">
          {#if routeAlternatives.length >= 2}
            {@const fastest = routeAlternatives.reduce((a, b) => a.duration < b.duration ? a : b)}
            {@const shortest = routeAlternatives.reduce((a, b) => a.distance < b.distance ? a : b)}
            {@const cheapest = routeAlternatives.reduce((a, b) => getFuelCostForRoute(a.distance) + a.tollEstimate < getFuelCostForRoute(b.distance) + b.tollEstimate ? a : b)}
            <div class="summary-badges">
              <span class="summary-badge" style="color: {fastest.color}">🚀 เร็วสุด: {fastest.label}</span>
              <span class="summary-badge" style="color: {cheapest.color}">💰 ถูกสุด: {cheapest.label}</span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Desktop Sidebar Toggle Button (fixed position) -->
  {#if !isNavigating}
    <button class="desktop-sidebar-toggle" class:sidebar-hidden={desktopSidebarCollapsed} on:click={() => { desktopSidebarCollapsed = !desktopSidebarCollapsed; const resizeMap = () => { if (map) map.invalidateSize({ animate: true }); }; requestAnimationFrame(resizeMap); setTimeout(resizeMap, 100); setTimeout(resizeMap, 200); setTimeout(resizeMap, 350); }} title={desktopSidebarCollapsed ? 'แสดงเมนู [M]' : 'ซ่อนเมนู [M]'}>
      {#if desktopSidebarCollapsed}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        <span>เมนู</span>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        <span>ซ่อน</span>
      {/if}
    </button>
  {/if}

  <div class="map-container" class:fullscreen={isNavigating}>
    <div id="map"></div>

    {#if !isNavigating}
      <div class="map-stats glass-card">
        <div class="map-stat"><span class="map-stat-value">{deliveryPoints.length}</span><span class="map-stat-label">จุดแวะ</span></div>
        <div class="map-stat"><span class="map-stat-value">{getSuccessCount()}</span><span class="map-stat-label">เสร็จแล้ว</span></div>
        <div class="map-stat weather"><span class="map-stat-value">{getWeatherIcon()} {weather.temp}°</span><span class="map-stat-label">อากาศ</span></div>
      </div>
    {/if}
    {#if !isNavigating && !optimizedRoute}
      <div class="map-info glass-card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>คลิกที่แผนที่เพื่อเพิ่มจุดแวะ</span></div>
    {/if}

    <!-- ==================== FLOATING PANELS ON MAP ==================== -->

    <!-- Floating Search Bar -->
    {#if !isNavigating}
      <div class="map-search-float glass-card">
        <div class="search-input-wrapper">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            type="text"
            class="search-input"
            placeholder="ค้นหาสถานที่..."
            bind:value={searchQuery}
            on:input={handleSearchInput}
            on:focus={() => { if (searchResults.length > 0) showSearchResults = true; }}
          />
          {#if searchQuery}
            <button class="search-clear" on:click={() => { searchQuery = ''; searchResults = []; showSearchResults = false; if (destinationMarker) { destinationMarker.remove(); destinationMarker = null; } directDestination = null; }}>×</button>
          {/if}
          {#if isSearching}
            <div class="search-spinner"></div>
          {/if}
        </div>
        {#if showSearchResults && searchResults.length > 0}
          <div class="search-dropdown">
            {#each searchResults as result}
              <button class="search-result-item" on:click={() => selectSearchResult(result)}>
                <span class="result-icon">📍</span>
                <div class="result-info">
                  <span class="result-name">{result.name}</span>
                  <span class="result-address">{result.address}</span>
                </div>
              </button>
            {/each}
          </div>
        {:else if !searchQuery && recentSearches.length > 0}
          <div class="search-dropdown recent-searches">
            <div class="recent-header">
              <span>🕐 ค้นหาล่าสุด</span>
              <button class="recent-clear-btn" on:click={clearRecentSearches}>ล้าง</button>
            </div>
            {#each recentSearches as recent}
              <button class="search-result-item" on:click={() => selectRecentSearch(recent)}>
                <span class="result-icon">🕐</span>
                <div class="result-info">
                  <span class="result-name">{recent.name}</span>
                  <span class="result-address">{recent.address}</span>
                </div>
              </button>
            {/each}
          </div>
        {/if}
        {#if directDestination}
          <div class="direct-nav-bar">
            <div class="direct-dest-info">
              <span class="dest-icon">📍</span>
              <span class="dest-name">{directDestination.name}</span>
            </div>
            <button class="btn btn-navigate-direct" on:click={navigateToSearchResult}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
              ปักหมุด
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Floating Route Preferences -->
    {#if !isNavigating}
      <div class="map-prefs-float glass-card">
        <div class="float-pref-chips">
          <button class="float-pref-chip" class:active={routePreference === 'fastest'} on:click={() => toggleRoutePreference('fastest')}>🚀 เร็วสุด</button>
          <button class="float-pref-chip" class:active={routePreference === 'no_tolls'} on:click={() => toggleRoutePreference('no_tolls')}>🚫 เลี่ยงด่วน</button>
          <button class="float-pref-chip" class:active={routePreference === 'no_highways'} on:click={() => toggleRoutePreference('no_highways')}>🏘️ เลี่ยงมอเตอร์เวย์</button>
        </div>
        <div class="float-pref-toggles">
          <button class="float-toggle-chip" class:active={showTraffic} on:click={toggleTraffic} title="แสดงการจราจร [T]">🚦</button>
          <button class="float-toggle-chip" class:active={showIncidentsPanel} on:click={toggleIncidentsPanel} title="เหตุการณ์จราจร">🚨</button>
          <button class="float-toggle-chip" class:active={autoRerouteEnabled} on:click={() => { autoRerouteEnabled = !autoRerouteEnabled; localStorage.setItem(getUserKey('autoRerouteEnabled'), String(autoRerouteEnabled)); }} title="คำนวณใหม่อัตโนมัติ">🔄</button>
          <button class="float-toggle-chip gps-refresh-btn" class:spinning={isRefreshingGps} on:click={refreshGpsPosition} title="รีเฟรช GPS (±{Math.round(accuracy)}m)">📍</button>
        </div>
      </div>

      <!-- Traffic Legend -->
      {#if showTraffic && optimizedRoute}
        {@const selectedAlt = routeAlternatives[selectedRouteIndex]}
        {@const stats = getTrafficStats(selectedAlt)}
        {@const summary = getTrafficSummary(selectedAlt)}
        <div class="traffic-legend glass-card">
          <div class="traffic-legend-header">
            <span class="traffic-legend-icon">🚦</span>
            <span class="traffic-legend-title">การจราจร</span>
            <span class="traffic-legend-summary" style="color: {summary.color}">{summary.label}</span>
          </div>
          <div class="traffic-legend-items">
            <div class="traffic-legend-item">
              <span class="traffic-legend-color" style="background: #00ff88"></span>
              <span class="traffic-legend-label">ไม่ติด</span>
              {#if stats.total > 0}
                <span class="traffic-legend-pct">{Math.round((stats.low / stats.total) * 100)}%</span>
              {/if}
            </div>
            <div class="traffic-legend-item">
              <span class="traffic-legend-color traffic-moderate" style="background: #f59e0b"></span>
              <span class="traffic-legend-label">ปานกลาง</span>
              {#if stats.total > 0}
                <span class="traffic-legend-pct">{Math.round((stats.moderate / stats.total) * 100)}%</span>
              {/if}
            </div>
            <div class="traffic-legend-item">
              <span class="traffic-legend-color traffic-heavy" style="background: #ef4444"></span>
              <span class="traffic-legend-label">รถติด</span>
              {#if stats.total > 0}
                <span class="traffic-legend-pct">{Math.round((stats.heavy / stats.total) * 100)}%</span>
              {/if}
            </div>
            <div class="traffic-legend-item">
              <span class="traffic-legend-color traffic-severe" style="background: #991b1b"></span>
              <span class="traffic-legend-label">ติดหนัก</span>
              {#if stats.total > 0}
                <span class="traffic-legend-pct">{Math.round((stats.severe / stats.total) * 100)}%</span>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Traffic Incidents Panel (เฉพาะบนเส้นทาง) -->
      {#if showIncidentsPanel}
        <div class="incidents-panel glass-card">
          <div class="incidents-header">
            <div class="incidents-title">
              <span class="incidents-icon">🚨</span>
              <span>เหตุการณ์บนเส้นทาง</span>
              {#if trafficIncidents.length > 0}
                <span class="incidents-badge">{trafficIncidents.length}</span>
              {/if}
            </div>
            <div class="incidents-actions">
              <button class="incidents-refresh" on:click={refreshIncidents} disabled={isLoadingIncidents || !optimizedRoute} title="รีเฟรช">
                {#if isLoadingIncidents}
                  <span class="spinner-tiny"></span>
                {:else}
                  🔄
                {/if}
              </button>
              <button class="incidents-close" on:click={() => { showIncidentsPanel = false; clearIncidentMarkers(); }}>✕</button>
            </div>
          </div>

          {#if !optimizedRoute}
            <div class="incidents-empty">
              <span class="empty-icon">🗺️</span>
              <span>กรุณาคำนวณเส้นทางก่อน</span>
            </div>
          {:else if trafficIncidents.length === 0}
            <div class="incidents-empty">
              {#if isLoadingIncidents}
                <div class="spinner-small"></div>
                <span>กำลังตรวจสอบเส้นทาง...</span>
              {:else}
                <span class="empty-icon">✅</span>
                <span>ไม่พบเหตุการณ์บนเส้นทาง</span>
                <button class="btn-check-incidents" on:click={refreshIncidents}>ตรวจสอบอีกครั้ง</button>
              {/if}
            </div>
          {:else}
            <div class="incidents-summary">
              ⚠️ พบ {trafficIncidents.length} เหตุการณ์ · ล่าช้ารวม ~{trafficIncidents.reduce((sum, i) => sum + (i.delay || 0), 0)} นาที
            </div>
            <div class="incidents-list">
              {#each trafficIncidents as incident, idx}
                <button class="incident-item" on:click={() => focusOnIncident(incident)}>
                  <div class="incident-icon-wrap" style="background: {getIncidentColor(incident.severity)}">
                    <span>{getIncidentIcon(incident.type)}</span>
                  </div>
                  <div class="incident-info">
                    <div class="incident-title-row">
                      <span class="incident-name">{incident.title}</span>
                      <span class="incident-severity severity-{incident.severity}">{
                        incident.severity === 'critical' ? 'วิกฤต' :
                        incident.severity === 'major' ? 'รุนแรง' :
                        incident.severity === 'moderate' ? 'ปานกลาง' : 'เล็กน้อย'
                      }</span>
                    </div>
                    <span class="incident-desc">{incident.description}</span>
                    {#if incident.delay}
                      <span class="incident-delay-tag">⏱️ ล่าช้า ~{incident.delay} นาที</span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}

          {#if lastIncidentFetch}
            <div class="incidents-footer">
              ตรวจสอบล่าสุด: {lastIncidentFetch.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Reroute Suggestion Modal -->
      {#if showRerouteModal}
        <div class="reroute-modal glass-card">
          <div class="reroute-icon">⚠️</div>
          <div class="reroute-content">
            <h4>แนะนำเปลี่ยนเส้นทาง</h4>
            <p>{rerouteReason}</p>
            <div class="reroute-incidents">
              {#each rerouteIncidents.slice(0, 3) as incident}
                <div class="reroute-incident-item">
                  <span>{getIncidentIcon(incident.type)}</span>
                  <span>{incident.title}</span>
                  {#if incident.delay}
                    <span class="delay-badge">+{incident.delay} นาที</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
          <div class="reroute-actions">
            <button class="btn-reroute-accept" on:click={acceptReroute}>
              🔄 เปลี่ยนเส้นทาง
            </button>
            <button class="btn-reroute-dismiss" on:click={dismissReroute}>
              ใช้เส้นทางเดิม
            </button>
          </div>
        </div>
      {/if}
    {/if}

    <!-- Floating Along-Route POI -->
    {#if optimizedRoute && !isNavigating}
      <div class="map-poi-float glass-card">
        <div class="poi-header">
          <button class="poi-search-btn" on:click={searchPOIsAlongRoute} disabled={isLoadingPOIs}>
            {isLoadingPOIs ? '⏳ กำลังค้นหา...' : '🔍 ค้นหาสถานที่บนเส้นทาง'}
          </button>
          {#if alongRoutePOIs.length > 0}
            <button class="poi-close-btn" on:click={closePOIPanel} title="ปิด">✕</button>
          {/if}
        </div>
        {#if alongRoutePOIs.length > 0}
          <div class="poi-filter-section">
            <span class="poi-filter-label">🎯 ท่องเที่ยว</span>
            <div class="poi-filter-chips">
              <button class="poi-chip attraction" class:active={activePOITypes.has('viewpoint')} on:click={() => togglePOIType('viewpoint')}>📸 จุดชมวิว</button>
              <button class="poi-chip attraction" class:active={activePOITypes.has('attraction')} on:click={() => togglePOIType('attraction')}>🏛️ ท่องเที่ยว</button>
              <button class="poi-chip attraction" class:active={activePOITypes.has('temple')} on:click={() => togglePOIType('temple')}>🏯 วัด</button>
              <button class="poi-chip attraction" class:active={activePOITypes.has('park')} on:click={() => togglePOIType('park')}>🌳 สวน</button>
              <button class="poi-chip attraction" class:active={activePOITypes.has('museum')} on:click={() => togglePOIType('museum')}>🎨 พิพิธภัณฑ์</button>
            </div>
          </div>
          <div class="poi-filter-section">
            <span class="poi-filter-label">🛎️ บริการ</span>
            <div class="poi-filter-chips">
              <button class="poi-chip" class:active={activePOITypes.has('gas')} on:click={() => togglePOIType('gas')}>⛽ ปั๊ม</button>
              <button class="poi-chip" class:active={activePOITypes.has('convenience')} on:click={() => togglePOIType('convenience')}>🏪 สะดวกซื้อ</button>
              <button class="poi-chip" class:active={activePOITypes.has('restaurant')} on:click={() => togglePOIType('restaurant')}>🍜 อาหาร</button>
              <button class="poi-chip" class:active={activePOITypes.has('cafe')} on:click={() => togglePOIType('cafe')}>☕ คาเฟ่</button>
              <button class="poi-chip" class:active={activePOITypes.has('ev_charging')} on:click={() => togglePOIType('ev_charging')}>⚡ ชาร์จ</button>
            </div>
          </div>
          <div class="poi-results-summary">
            พบ {alongRoutePOIs.filter(p => activePOITypes.has(p.type)).length} แห่ง บนเส้นทาง
          </div>
          <div class="poi-list-compact">
            {#each alongRoutePOIs.filter(p => activePOITypes.has(p.type)) as poi}
              <div class="poi-item" on:click={() => flyToPOI(poi)} on:keypress={() => {}} role="button" tabindex="0">
                <span class="poi-type-icon">{getPOIIcon(poi.type)}</span>
                <div class="poi-item-info">
                  <span class="poi-name">{poi.name || poi.tags?.brand || getPOILabel(poi.type)}</span>
                  <span class="poi-meta">{formatDistance(poi.distAlongRoute)} บนเส้นทาง · ห่าง {Math.round(poi.distFromRoute)} ม.</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Floating Vehicle Toggle -->
    {#if !isNavigating}
      <div class="map-vehicle-float glass-card">
        <button class="float-vehicle-btn" class:fuel={vehicleType === 'fuel'} class:ev={vehicleType === 'ev'} on:click={toggleVehicleType}>
          <span>{getVehicleIcon()}</span>
          <span class="float-vehicle-label">{vehicleType === 'fuel' ? 'น้ำมัน' : 'EV'}</span>
          {#if vehicleType === 'ev'}
            <span class="ev-charge-badge" style="background: {getEVBatteryColor()}">{evCurrentCharge}%</span>
          {:else}
            <span class="fuel-price-badge">฿{currentFuelPrice.toFixed(0)}</span>
          {/if}
        </button>
        {#if vehicleType === 'fuel' && oilPriceData}
          <div class="float-station-selects">
            <select bind:value={selectedStation} on:change={updateCurrentFuelPrice}>
              {#each stationOptions as station}
                <option value={station.value}>{station.label}</option>
              {/each}
            </select>
            <select bind:value={selectedFuelType} on:change={updateCurrentFuelPrice}>
              {#each getAvailableFuelTypes() as fuel}
                <option value={fuel.value}>{fuel.label}</option>
              {/each}
            </select>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Floating Saved Routes (if any) -->
    {#if !isNavigating && savedRoutes.length > 0}
      <div class="map-saved-float glass-card">
        <button class="float-saved-toggle" on:click={() => showSavedRoutes = !showSavedRoutes}>
          ⭐ บันทึก ({savedRoutes.length})
        </button>
        {#if showSavedRoutes}
          <div class="float-saved-list">
            {#each savedRoutes as route}
              <div class="float-saved-item" on:click={() => loadSavedRoute(route)} on:keypress={() => {}} role="button" tabindex="0">
                <span class="float-saved-name">{route.name}</span>
                <span class="float-saved-meta">{(route.distance / 1000).toFixed(1)} กม.</span>
                <span class="float-saved-del" on:click|stopPropagation={() => deleteSavedRoute(route.id)} on:keypress={() => {}} role="button" tabindex="0">×</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>

    /* ==================== OIL PRICE API STYLES ==================== */

/* Oil Price Header */
.oil-price-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.refresh-oil-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(0, 255, 136, 0.15);
  border: 1px solid rgba(0, 255, 136, 0.3);
  color: #00ff88;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.2s;
}

.refresh-oil-btn:hover:not(:disabled) {
  background: rgba(0, 255, 136, 0.25);
  transform: rotate(180deg);
}

.refresh-oil-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.oil-price-date {
  font-size: 12px;
  color: #71717a;
  margin-bottom: 12px;
  text-align: center;
  padding: 6px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

/* Oil Select Groups */
.oil-select-group {
  margin-bottom: 12px;
}

.oil-select-group label {
  display: block;
  font-size: 11px;
  color: #a1a1aa;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.oil-select-group select {
  width: 100%;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #e4e4e7;
  font-family: 'Kanit', sans-serif;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.oil-select-group select:hover {
  border-color: rgba(0, 255, 136, 0.4);
}

.oil-select-group select:focus {
  outline: none;
  border-color: #00ff88;
  box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1);
}

/* Current Oil Price Display */
.current-oil-price {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px;
  background: linear-gradient(135deg, rgba(0, 255, 136, 0.15) 0%, rgba(0, 204, 106, 0.1) 100%);
  border: 1px solid rgba(0, 255, 136, 0.3);
  border-radius: 10px;
  margin: 16px 0;
}

.current-oil-price .price-label {
  font-size: 13px;
  color: #a1a1aa;
}

.current-oil-price .price-value {
  font-size: 20px;
  font-weight: 700;
  color: #00ff88;
  font-family: 'JetBrains Mono', monospace;
}

/* Price Comparison */
.price-comparison {
  margin-top: 16px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.comparison-header {
  font-size: 12px;
  font-weight: 600;
  color: #a1a1aa;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.comparison-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.comparison-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  transition: all 0.2s;
}

.comparison-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.comparison-item.cheapest {
  background: rgba(0, 255, 136, 0.1);
  border: 1px solid rgba(0, 255, 136, 0.3);
}

.comparison-item.selected {
  background: rgba(102, 126, 234, 0.15);
  border: 1px solid rgba(102, 126, 234, 0.3);
}

.comparison-item .station-name {
  font-size: 13px;
  color: #e4e4e7;
  flex: 1;
}

.comparison-item .station-price {
  font-size: 14px;
  font-weight: 600;
  color: #00ff88;
  font-family: 'JetBrains Mono', monospace;
  margin-right: 10px;
}

.comparison-item.cheapest .station-price {
  color: #00ff88;
}

.cheapest-badge {
  font-size: 10px;
  padding: 3px 8px;
  background: #00ff88;
  color: #000;
  border-radius: 8px;
  font-weight: 600;
}

/* Cheapest Tip in Route Summary */
.cheapest-tip {
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(0, 255, 136, 0.06);
  border: 1px dashed rgba(0, 255, 136, 0.25);
  border-radius: 8px;
  font-size: 12px;
  color: #a1a1aa;
}

.cheapest-tip strong {
  color: #00ff88;
}

/* Fuel Price Badge in Quick Toggle */
.fuel-price-badge {
  padding: 4px 10px;
  background: rgba(0, 255, 136, 0.1);
  border-radius: 16px;
  font-size: 12px;
  font-weight: 600;
  color: #00ff88;
}

/* Quick Station Select */
.quick-station-select {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.quick-station-select select {
  flex: 1;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e4e4e7;
  font-family: 'Kanit', sans-serif;
  font-size: 12px;
  cursor: pointer;
}

.quick-station-select select:focus {
  outline: none;
  border-color: #00ff88;
}

/* Fuel Stat on Map */
.map-stat.fuel-stat {
  border-left: 2px solid #00ff88;
  padding-left: 10px;
}

.map-stat.fuel-stat .map-stat-value {
  color: #00ff88;
  font-size: 14px;
}

/* Spinner Tiny for refresh button */
.spinner-tiny {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 255, 136, 0.3);
  border-top-color: #00ff88;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Enhanced Vehicle Info Card for Fuel */
.vehicle-info-card.fuel {
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.2);
  padding: 16px;
  max-height: 500px;
  overflow-y: auto;
}

.vehicle-info-card.fuel::-webkit-scrollbar {
  width: 6px;
}

.vehicle-info-card.fuel::-webkit-scrollbar-track {
  background: transparent;
}

.vehicle-info-card.fuel::-webkit-scrollbar-thumb {
  background: rgba(0, 255, 136, 0.3);
  border-radius: 3px;
}

/* ==================== REORDER MODE ==================== */
.btn-reorder-active {
  background: #9333ea !important;
  color: #fff !important;
  border: 1px solid rgba(147, 51, 234, 0.5) !important;
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  min-width: 20px;
  color: rgba(147, 51, 234, 0.7);
  cursor: grab;
  margin-right: 4px;
}
.drag-handle:active { cursor: grabbing; }
.drag-handle svg { width: 16px; height: 16px; }

.point-card.drag-source {
  opacity: 0.4;
  border: 1px dashed rgba(147, 51, 234, 0.6) !important;
}

.point-card.drag-over {
  border-top: 3px solid #9333ea !important;
}

/* ==================== NIGHT MODE SELECTOR ==================== */
.night-mode-selector {
  display: flex;
  gap: 6px;
}

.night-mode-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  font-size: 0.7rem;
  transition: all 0.2s ease;
}

.night-mode-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.night-mode-btn.active {
  background: rgba(0, 255, 136, 0.1);
  border-color: rgba(0, 255, 136, 0.3);
  color: #00ff88;
}

/* ==================== DAY MODE OVERRIDES ==================== */
/* โทนครีมอุ่น — สบายตา + contrast ชัด */
.app-container.day-mode {
  background: linear-gradient(135deg, #d9d4cd, #d4cfc7, #cec9c1) !important;
  transition: background 0.3s ease;
}

.day-mode .sidebar {
  background: rgba(235, 230, 222, 0.97) !important;
  border-color: rgba(100, 80, 60, 0.1) !important;
  box-shadow: 2px 0 16px rgba(60, 45, 30, 0.1) !important;
}

.day-mode :global(.leaflet-tile-pane) {
  filter: brightness(0.92) saturate(0.8) sepia(0.05) !important;
}

.day-mode :global(.leaflet-container) {
  background: #cec9c1 !important;
}

.day-mode .glass-card {
  background: rgba(235, 230, 222, 0.94) !important;
  border-color: rgba(100, 80, 60, 0.1) !important;
  color: #1e1b18 !important;
}

.day-mode .point-card {
  background: rgba(242, 238, 232, 0.92) !important;
  border-color: rgba(100, 80, 60, 0.08) !important;
  color: #1e1b18 !important;
  box-shadow: 0 1px 4px rgba(60, 45, 30, 0.06) !important;
}

.day-mode .point-card:hover {
  background: rgba(248, 245, 240, 0.96) !important;
  box-shadow: 0 2px 8px rgba(60, 45, 30, 0.1) !important;
}

.day-mode .point-card.active {
  border-color: rgba(0, 150, 80, 0.5) !important;
  box-shadow: 0 0 0 1px rgba(0, 150, 80, 0.15), 0 2px 8px rgba(60, 45, 30, 0.1) !important;
}

.day-mode .sidebar-header,
.day-mode .logo-text h1 {
  color: #1e1b18 !important;
}

.day-mode .logo-text span {
  color: #6b6058 !important;
}

.day-mode .point-name {
  color: #1e1b18 !important;
}

.day-mode .point-address {
  color: #5c5349 !important;
}

.day-mode .tab {
  color: #6b6058 !important;
  border-color: transparent !important;
}

.day-mode .tab.active {
  color: #00875a !important;
  border-color: #00875a !important;
  background: rgba(0, 135, 90, 0.08) !important;
}

.day-mode .btn-ghost {
  background: rgba(242, 238, 232, 0.8) !important;
  color: #2a2520 !important;
  border-color: rgba(100, 80, 60, 0.12) !important;
}

.day-mode .btn-ghost:hover {
  background: rgba(248, 245, 240, 0.95) !important;
  border-color: rgba(100, 80, 60, 0.2) !important;
}

.day-mode .btn-secondary {
  background: rgba(0, 135, 90, 0.1) !important;
  color: #006a48 !important;
  border-color: rgba(0, 135, 90, 0.25) !important;
}

.day-mode .btn-primary {
  background: linear-gradient(135deg, #00875a, #006a48) !important;
  color: #fff !important;
  box-shadow: 0 2px 8px rgba(0, 135, 90, 0.25) !important;
}

.day-mode .action-buttons {
  border-color: rgba(100, 80, 60, 0.08) !important;
}

.day-mode .content-area {
  color: #1e1b18 !important;
}

.day-mode .settings-panel {
  background: rgba(240, 236, 228, 0.98) !important;
  color: #1e1b18 !important;
}

.day-mode .settings-section h4 {
  color: #1e1b18 !important;
}

.day-mode .settings-overlay {
  background: rgba(30, 25, 18, 0.35) !important;
}

.day-mode .icon-btn {
  background: rgba(242, 238, 232, 0.8) !important;
  color: #2a2520 !important;
}

.day-mode .icon-btn:hover {
  background: rgba(248, 245, 240, 0.95) !important;
}

.day-mode .sidebar-toggle {
  background: rgba(235, 230, 222, 0.95) !important;
  color: #2a2520 !important;
  border-color: rgba(100, 80, 60, 0.1) !important;
}

.day-mode .notification {
  background: rgba(242, 238, 232, 0.97) !important;
  color: #1e1b18 !important;
  border-color: rgba(100, 80, 60, 0.12) !important;
  box-shadow: 0 4px 16px rgba(60, 45, 30, 0.12) !important;
}

.day-mode .empty-state h4 {
  color: #2a2520 !important;
}
.day-mode .empty-state p {
  color: #6b6058 !important;
}

.day-mode .stat-card {
  background: rgba(242, 238, 232, 0.92) !important;
  border-color: rgba(100, 80, 60, 0.08) !important;
  color: #1e1b18 !important;
  box-shadow: 0 1px 4px rgba(60, 45, 30, 0.06) !important;
}

.day-mode .stat-value {
  color: #1e1b18 !important;
}

.day-mode .stat-label {
  color: #6b6058 !important;
}

.day-mode .multi-select-toolbar {
  background: rgba(242, 238, 232, 0.9) !important;
  color: #2a2520 !important;
  border-color: rgba(100, 80, 60, 0.08) !important;
}

.day-mode .sidebar-scroll {
  scrollbar-color: rgba(100, 80, 60, 0.18) transparent;
}

.day-mode .night-mode-btn {
  color: #5c5349;
  border-color: rgba(100, 80, 60, 0.12);
  background: rgba(242, 238, 232, 0.7);
}

.day-mode .night-mode-btn:hover {
  background: rgba(248, 245, 240, 0.9);
  color: #2a2520;
}

.day-mode .night-mode-btn.active {
  background: rgba(0, 135, 90, 0.1);
  border-color: rgba(0, 135, 90, 0.4);
  color: #006a48;
}

.day-mode .vehicle-type-btn {
  background: rgba(242, 238, 232, 0.7) !important;
  color: #5c5349 !important;
  border-color: rgba(100, 80, 60, 0.1) !important;
}

.day-mode .vehicle-type-btn.active {
  background: rgba(0, 135, 90, 0.1) !important;
  border-color: rgba(0, 135, 90, 0.4) !important;
  color: #006a48 !important;
}

.day-mode .toggle-setting span {
  color: #2a2520 !important;
}

.day-mode .toggle-btn {
  background: rgba(100, 80, 60, 0.15) !important;
}

.day-mode .toggle-btn.active {
  background: #00875a !important;
}

.day-mode .map-stats {
  background: rgba(235, 230, 222, 0.94) !important;
  color: #1e1b18 !important;
  border-color: rgba(100, 80, 60, 0.1) !important;
}

.day-mode .search-panel {
  background: rgba(235, 230, 222, 0.97) !important;
  color: #1e1b18 !important;
}

.day-mode .search-panel input {
  background: rgba(242, 238, 232, 0.9) !important;
  color: #1e1b18 !important;
  border-color: rgba(100, 80, 60, 0.12) !important;
}

.day-mode .search-panel input::placeholder {
  color: #8a7e74 !important;
}

.day-mode .delete-btn {
  color: #a09488 !important;
}

.day-mode .delete-btn:hover {
  color: #c0392b !important;
  background: rgba(192, 57, 43, 0.08) !important;
}

.day-mode .priority-tag {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
}

.day-mode .distance-tag {
  color: #5c5349 !important;
}

.day-mode .add-form .glass-card,
.day-mode .add-form-overlay .glass-card {
  background: rgba(240, 236, 228, 0.98) !important;
  color: #1e1b18 !important;
}

.day-mode input, .day-mode textarea, .day-mode select {
  background: rgba(242, 238, 232, 0.9) !important;
  color: #1e1b18 !important;
  border-color: rgba(100, 80, 60, 0.15) !important;
}

.day-mode .driver-card {
  background: rgba(242, 238, 232, 0.8) !important;
  color: #1e1b18 !important;
}

.day-mode .vehicle-info-card {
  background: rgba(242, 238, 232, 0.8) !important;
  color: #1e1b18 !important;
  border-color: rgba(100, 80, 60, 0.1) !important;
}

.day-mode .info-text {
  color: #2a2520 !important;
}
.day-mode .vehicle-adjust label { color: #5c5349; }
.day-mode .vehicle-adjust label strong { color: #006a48; }
.day-mode .adjust-range-hint { color: rgba(0,0,0,0.25); }

.day-mode .route-summary h3,
.day-mode .summary-header h3 {
  color: #1e1b18 !important;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .oil-price-header {
    flex-direction: row;
    gap: 10px;
  }
  
  .current-oil-price {
    flex-direction: column;
    gap: 8px;
    text-align: center;
  }
  
  .current-oil-price .price-value {
    font-size: 24px;
  }
  
  .comparison-list {
    max-height: 150px;
    overflow-y: auto;
  }
  
  .quick-station-select {
    flex-direction: column;
    gap: 6px;
  }
  
  .quick-station-select select {
    width: 100%;
  }
  
  .fuel-price-badge {
    font-size: 11px;
    padding: 3px 8px;
  }
}

@media (max-width: 480px) {
  .comparison-item {
    padding: 6px 8px;
  }
  
  .comparison-item .station-name {
    font-size: 12px;
  }
  
  .comparison-item .station-price {
    font-size: 12px;
  }
  
  .cheapest-badge {
    font-size: 9px;
    padding: 2px 6px;
  }
  
  .cheapest-tip {
    font-size: 11px;
    padding: 8px 10px;
  }
}
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { font-family: 'Kanit', sans-serif; background: #0a0a0f; color: #e4e4e7; overflow: hidden; }

  .app-container { display: flex; height: 100vh; width: 100vw; background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%); }

  .sidebar {
    width: 500px;
    background: rgba(15, 15, 25, 0.95);
    backdrop-filter: blur(20px);
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    flex-direction: column;
    z-index: 10;
    overflow: hidden;
    max-width: 100%;
    position: relative;
    transition: width 0.4s cubic-bezier(0.22, 1, 0.36, 1),
                border-right 0.3s ease;
    will-change: width, transform;
    transform: translateZ(0);
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
  }
  .sidebar-toggle { display: none; }

  /* Desktop sidebar toggle - fixed position */
  .desktop-sidebar-toggle {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    position: fixed;
    top: 50%;
    left: 500px;
    transform: translateY(-50%) translateZ(0);
    padding: 12px 8px;
    min-width: 44px;
    background: #00ff88;
    border: none;
    border-radius: 0 12px 12px 0;
    cursor: pointer;
    color: #0a0a0f;
    font-family: 'Kanit', sans-serif;
    font-size: 11px;
    font-weight: 600;
    z-index: 1500;
    transition: left 0.4s cubic-bezier(0.22, 1, 0.36, 1),
                transform 0.2s ease,
                background 0.2s ease;
    will-change: left, transform;
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
  }
  .desktop-sidebar-toggle:hover {
    background: #00e67a;
  }
  .desktop-sidebar-toggle svg { width: 24px; height: 24px; flex-shrink: 0; transition: transform 0.2s ease; }
  .desktop-sidebar-toggle span { white-space: nowrap; }

  /* When sidebar is hidden - move button to left edge */
  .desktop-sidebar-toggle.sidebar-hidden {
    left: 0;
  }

  /* Desktop collapsed state */
  .sidebar.desktop-collapsed {
    width: 0 !important;
    min-width: 0 !important;
    border-right: none;
  }
  .sidebar.desktop-collapsed > * {
    opacity: 0;
    visibility: hidden;
    transform: translateX(-20px);
    transition: opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1),
                visibility 0.25s ease,
                transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .sidebar:not(.desktop-collapsed) > * {
    opacity: 1;
    visibility: visible;
    transform: translateX(0);
    transition: opacity 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.1s,
                visibility 0.35s ease 0.1s,
                transform 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.1s;
  }
  .sidebar-header { padding: 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
  .sidebar-scroll { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; }
  .sidebar-scroll::-webkit-scrollbar { width: 6px; }
  .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
  .sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }

  .logo { display: flex; align-items: center; gap: 14px; }
  .logo-icon { width: 44px; height: 44px; background: #00ff88; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
  .logo-icon svg { width: 24px; height: 24px; color: #0a0a0f; }
  .logo-text h1 { font-size: 20px; font-weight: 700; color: #00ff88; }
  .logo-text span { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1.5px; }

  .stats-badge { display: flex; flex-direction: column; align-items: center; background: rgba(0, 255, 136, 0.08); border: 1px solid rgba(0, 255, 136, 0.15); border-radius: 10px; padding: 8px 16px; }
  .stats-number { font-size: 22px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .stats-label { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; }

  .action-buttons { padding: 16px 20px; display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
  .action-buttons .btn { flex: 1 1 calc(50% - 4px); min-width: 0; }

  .btn {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    padding: 14px 20px; border-radius: 12px;
    font-family: 'Kanit', sans-serif; font-size: 15px; font-weight: 500;
    cursor: pointer; border: none; outline: none;
    transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.25s cubic-bezier(0.22, 1, 0.36, 1),
                opacity 0.2s ease,
                background 0.2s ease;
    will-change: transform;
  }
  .btn svg { width: 20px; height: 20px; transition: transform 0.2s ease; }
  .btn:active:not(:disabled) { transform: scale(0.97); }
  .btn-primary { background: #00ff88; color: #0a0a0f; }
  .btn-primary:hover:not(:disabled) { background: #00e67a; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .btn-navigate { background: #3b82f6; color: white; }
  .btn-navigate:hover { background: #2563eb; }
  .btn-secondary { background: rgba(102, 126, 234, 0.15); color: #818cf8; border: 1px solid rgba(102, 126, 234, 0.3); }
  .btn-secondary:hover { background: rgba(102, 126, 234, 0.25); border-color: rgba(102, 126, 234, 0.5); }
  .btn-ghost { background: rgba(255, 255, 255, 0.05); color: #a1a1aa; border: 1px solid rgba(255, 255, 255, 0.1); }
  .btn-ghost:hover { background: rgba(255, 255, 255, 0.1); color: #e4e4e7; }
  .btn-drag-active { background: rgba(251, 146, 60, 0.2); color: #fb923c; border: 1px solid rgba(251, 146, 60, 0.5); }
  .btn-drag-active:hover { background: rgba(251, 146, 60, 0.3); border-color: rgba(251, 146, 60, 0.7); }

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
  .close-btn {
    width: 32px; height: 32px; border-radius: 8px;
    background: rgba(255, 255, 255, 0.05); border: none;
    color: #71717a; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
                background 0.2s ease,
                color 0.2s ease;
  }
  .close-btn:hover { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; transform: scale(1.1); }
  .close-btn:active { transform: scale(0.9); }
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
  .priority-btn.active { background: var(--btn-bg); border-color: rgba(255, 255, 255, 0.3); }
  .priority-num { font-size: 18px; font-weight: 700; color: #e4e4e7; }
  .priority-btn.active .priority-num { color: white; }
  .priority-label { font-size: 9px; color: #71717a; margin-top: 2px; }
  .priority-btn.active .priority-label { color: rgba(255, 255, 255, 0.8); }
  .form-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }

  /* Clean Tabs */
  .tabs {
    display: flex;
    gap: 8px;
    margin: 0 20px 16px;
    padding: 4px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 14px;
  }
  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 10px;
    background: transparent;
    border: none;
    color: #71717a;
    font-family: 'Kanit', sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .tab svg {
    width: 18px;
    height: 18px;
  }
  .tab:hover:not(:disabled) {
    color: #a1a1aa;
    background: rgba(255, 255, 255, 0.03);
  }
  .tab:active:not(:disabled) {
    transform: scale(0.98);
  }
  .tab.active {
    background: rgba(0, 255, 136, 0.1);
    color: #00ff88;
  }
  .tab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .content-area { flex: 1; overflow-y: auto; padding: 0 50px; }
  .content-area::-webkit-scrollbar { width: 6px; }
  .content-area::-webkit-scrollbar-track { background: transparent; }
  .content-area::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }

  /* Clean Empty State */
  .empty-state {
    text-align: center;
    padding: 48px 24px;
    margin: 10px;
  }
  .empty-icon {
    width: 80px;
    height: 80px;
    margin: 0 auto 20px;
    background: rgba(139, 92, 246, 0.08);
    border: 1px solid rgba(139, 92, 246, 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .empty-icon svg {
    width: 36px;
    height: 36px;
    color: #8b5cf6;
  }
  .empty-state h4 {
    font-size: 16px;
    font-weight: 600;
    color: #a1a1aa;
    margin-bottom: 8px;
  }
  .empty-state p {
    font-size: 13px;
    color: #71717a;
    line-height: 1.5;
  }

  /* Clean Points List */
  .points-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 20px;
  }
  .point-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
    cursor: pointer;
    position: relative;
    transition: all 0.2s ease;
  }
  .point-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 3px;
    height: 100%;
    background: #00ff88;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .point-card:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
  }
  .point-card:hover::before {
    opacity: 0.5;
  }
  .point-card:active {
    transform: scale(0.99);
  }
  .point-card.active {
    background: rgba(0, 255, 136, 0.06);
    border-color: rgba(0, 255, 136, 0.2);
  }
  .point-card.active::before {
    opacity: 1;
  }
  .point-number {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }
  .point-info {
    flex: 1;
    min-width: 0;
  }
  .point-info h4 {
    font-size: 15px;
    font-weight: 600;
    color: #f4f4f5;
    margin-bottom: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .point-info p {
    font-size: 12px;
    color: #71717a;
    margin-bottom: 10px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.5;
  }
  .point-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .priority-tag {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    color: white;
  }
  .distance-tag {
    font-size: 11px;
    color: #a1a1aa;
    background: rgba(255, 255, 255, 0.05);
    padding: 4px 10px;
    border-radius: 6px;
  }
  .delete-btn {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: transparent;
    border: 1px solid transparent;
    color: #52525b;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.25s ease;
    flex-shrink: 0;
  }
  .point-card:hover .delete-btn {
    opacity: 1;
  }
  .delete-btn:hover {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
    transform: scale(1.05);
  }
  .delete-btn svg {
    width: 18px;
    height: 18px;
  }

  /* Modern Route Summary */
  .route-summary {
    padding-bottom: 20px;
  }
  .summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  .summary-header h3 {
    font-size: 16px;
    font-weight: 600;
    color: #f4f4f5;
  }
  .route-badge {
    padding: 6px 14px;
    background: rgba(0, 255, 136, 0.1);
    border: 1px solid rgba(0, 255, 136, 0.2);
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    color: #00ff88;
  }
  .route-badge.ev-badge {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.2);
    color: #3b82f6;
  }
  .summary-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }
  .stat-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
    padding: 18px 14px;
    text-align: center;
    transition: all 0.2s ease;
  }
  .stat-card:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
  }
  .stat-icon {
    width: 44px;
    height: 44px;
    margin: 0 auto 12px;
    background: rgba(0, 255, 136, 0.08);
    border: 1px solid rgba(0, 255, 136, 0.15);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }
  .stat-icon svg {
    width: 22px;
    height: 22px;
    color: #00ff88;
  }
  .stat-value {
    font-size: 28px;
    font-weight: 700;
    color: #f4f4f5;
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    line-height: 1;
    margin-bottom: 4px;
  }
  .stat-label {
    font-size: 11px;
    color: #71717a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 500;
  }
  .stat-card.fuel {
    border-color: rgba(249, 115, 22, 0.15);
  }
  .stat-card.fuel .stat-icon {
    background: rgba(249, 115, 22, 0.08);
    border-color: rgba(249, 115, 22, 0.15);
  }
  .stat-card.fuel .stat-value {
    color: #fb923c;
  }
  .route-timeline h4 { font-size: 12px; font-weight: 600; color: #a1a1aa; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
  .timeline-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 10px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s; }
  .timeline-item:hover { background: rgba(255, 255, 255, 0.04); }
  .timeline-item.start .timeline-marker { background: #3b82f6; }
  .timeline-item.end .timeline-marker { background: #ff6b6b; }
  .timeline-marker { width: 32px; height: 32px; border-radius: 8px; background: #667eea; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: white; flex-shrink: 0; }
  .timeline-content { flex: 1; }
  .timeline-label { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .timeline-name { font-size: 14px; font-weight: 500; color: #e4e4e7; }

  .sidebar-footer { padding: 16px 24px; border-top: 1px solid rgba(255, 255, 255, 0.05); display: flex; justify-content: space-between; font-size: 11px; color: #52525b; flex-shrink: 0; }

  /* ==================== NEW FEATURES CSS ==================== */

  /* Header Actions */
  .header-actions { display: flex; gap: 8px; }
  .icon-btn {
    width: 40px; height: 40px; border-radius: 10px;
    background: rgba(255, 255, 255, 0.05); border: none;
    font-size: 18px; cursor: pointer; position: relative;
    transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
                background 0.2s ease,
                box-shadow 0.2s ease;
  }
  .icon-btn:hover { background: rgba(255, 255, 255, 0.1); transform: scale(1.05); }
  .icon-btn:active { transform: scale(0.95); }
  .icon-btn .badge { position: absolute; top: -4px; right: -4px; background: #ff6b6b; color: white; font-size: 10px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }

  /* Quick Stats */

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
  .vehicle-toggle-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 16px; border-radius: 10px; border: none; cursor: pointer; font-family: 'Kanit', sans-serif; font-size: 14px; font-weight: 500; transition: all 0.2s ease; }
  .vehicle-toggle-btn.fuel { background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.2); color: #00ff88; }
  .vehicle-toggle-btn.ev { background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); color: #3b82f6; }
  .vehicle-toggle-btn:hover { background: rgba(255, 255, 255, 0.05); }
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

  .vehicle-adjust { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .vehicle-adjust label { display: block; font-size: 13px; color: #a1a1aa; margin-bottom: 8px; }
  .vehicle-adjust label strong { color: #00ff88; font-size: 14px; }
  .adjust-range-hint { display: flex; justify-content: space-between; font-size: 10px; color: rgba(255,255,255,0.25); margin-top: 4px; }
  .ev-battery-setting { margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
  .ev-battery-setting label { display: block; font-size: 13px; color: #a1a1aa; margin-bottom: 10px; }
  .ev-slider { width: 100%; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.1); appearance: none; cursor: pointer; }
  .ev-slider::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #3b82f6; cursor: pointer; }
  .ev-range-info { margin-top: 12px; text-align: center; font-size: 14px; color: #71717a; }
  .ev-range-info strong { font-size: 16px; }

  /* EV Status Display during Navigation */
  .ev-status-display { position: absolute; right: 20px; bottom: 260px; padding: 12px; width: 130px; pointer-events: none; z-index: 1050; }
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
  .route-badge.ev-badge { background: rgba(59, 130, 246, 0.08); border-color: rgba(59, 130, 246, 0.15); color: #3b82f6; }

  /* EV Primary Button */
  .btn-primary.btn-ev { background: #3b82f6; color: white; }

  /* Stat Card EV */
  .stat-card.ev { border-color: rgba(59, 130, 246, 0.15); background: rgba(59, 130, 246, 0.05); }

  /* Responsive */
  @media (max-width: 768px) {
    .ev-status-display { bottom: 230px; right: 10px; width: 120px; padding: 10px; }
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
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);
    z-index: 2000; display: flex; align-items: center; justify-content: center;
    padding: 20px;
    animation: modalFadeIn 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes modalFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes modalSlideIn {
    from { opacity: 0; transform: translateY(-20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  
  /* Add Form Modal */
  .add-form-modal {
    width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; padding: 24px;
    background: rgba(15, 15, 25, 0.95); border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    animation: modalSlideIn 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  }
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
  .add-form-modal .priority-btn.active { background: var(--btn-bg); border-color: var(--btn-glow); }
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
    padding: 20px;
  }

  /* Responsive - tablet */
  @media (max-width: 1024px) {
    .settings-panel {
      max-width: 95%;
      padding: 20px;
    }
  }
  /* Responsive - mobile: full screen settings */
  @media (max-width: 768px) {
    .settings-overlay { padding: 0; align-items: stretch; }
    .settings-panel {
      max-width: 100%;
      width: 100%;
      max-height: 100vh;
      height: 100vh;
      border-radius: 0;
      padding: 16px;
      padding-bottom: 80px;
      -webkit-overflow-scrolling: touch;
    }
    .settings-header { position: sticky; top: 0; z-index: 1; background: rgba(15, 15, 25, 0.98); padding-bottom: 12px; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .settings-header h3 { font-size: 18px; }
    .settings-grid {
      grid-template-columns: 1fr;
      gap: 16px;
    }
    .settings-column { padding: 12px; gap: 16px; }
    .settings-section h4 { font-size: 12px; }
    .driver-card { padding: 12px; gap: 12px; }
    .driver-avatar { width: 42px; height: 42px; font-size: 20px; }
    .driver-name { font-size: 14px; }
    .vehicle-type-selector { gap: 8px; }
    .vehicle-type-btn { padding: 12px; gap: 6px; border-radius: 10px; }
    .vehicle-icon { font-size: 20px; }
    .vehicle-label { font-size: 12px; }
    .vehicle-info-card { padding: 12px; font-size: 13px; }
    .toggle-setting { padding: 10px 0; font-size: 14px; }
    .toggle-btn { width: 44px; height: 24px; border-radius: 12px; }
    .toggle-knob { width: 18px; height: 18px; }
    .toggle-btn.active .toggle-knob { left: 22px; }
    .info-grid { grid-template-columns: 1fr; gap: 8px; }
    .info-item { padding: 10px; }
    .settings-actions { flex-direction: column; gap: 8px; padding-top: 16px; }
    .settings-actions .btn { width: 100%; justify-content: center; padding: 14px; font-size: 14px; }
    .oil-select-group select { width: 100%; padding: 10px; font-size: 14px; }
    .ev-slider { height: 10px; }
    .ev-slider::-webkit-slider-thumb { width: 24px; height: 24px; }
    .ev-buttons { flex-direction: column; }
    .ev-buttons .btn { width: 100%; justify-content: center; }
  }
  /* Responsive - small phone */
  @media (max-width: 480px) {
    .settings-panel { padding: 12px; padding-bottom: 60px; }
    .settings-column { padding: 8px; gap: 12px; }
    .vehicle-type-selector { flex-direction: row; }
    .vehicle-type-btn { padding: 10px 8px; }
    .vehicle-icon { font-size: 18px; }
    .vehicle-label { font-size: 11px; }
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

  /* Alerts Backdrop */
  .alerts-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 1999; backdrop-filter: blur(4px); }
  /* Alerts Panel - Centered */
  .alerts-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 400px; max-width: calc(100% - 32px); max-height: 500px; z-index: 2000; overflow: hidden; display: flex; flex-direction: column; }
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

  /* Left cluster: speed + stats grouped together */
  .nav-right-cluster { position: absolute; right: 20px; bottom: 200px; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; z-index: 1050; }

  /* Speed Display */
  .speed-display { width: 100px; height: 100px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; position: relative; }
  .speed-value { font-size: 36px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; line-height: 1; }
  .speed-unit { font-size: 12px; color: #71717a; }
  /* Compass Widget */
  .compass-widget {
    width: 72px; height: 72px; border-radius: 50%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; pointer-events: none; position: relative;
    background: rgba(20, 20, 30, 0.85); border: 2px solid rgba(255, 255, 255, 0.1);
  }
  .compass-ring {
    width: 60px; height: 60px; position: relative; transition: transform 0.4s ease;
    display: flex; align-items: center; justify-content: center;
  }
  .compass-n, .compass-e, .compass-s, .compass-w {
    position: absolute; font-size: 10px; font-weight: 800;
    font-family: 'JetBrains Mono', monospace; line-height: 1;
  }
  .compass-n { top: 0; left: 50%; transform: translateX(-50%); color: #ff4444; }
  .compass-e { right: 1px; top: 50%; transform: translateY(-50%); color: #71717a; }
  .compass-s { bottom: 0; left: 50%; transform: translateX(-50%); color: #71717a; }
  .compass-w { left: 1px; top: 50%; transform: translateY(-50%); color: #71717a; }
  .compass-needle { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
  .compass-heading-text {
    position: absolute; bottom: -16px; left: 50%; transform: translateX(-50%);
    font-size: 10px; font-weight: 700; color: #a1a1aa; white-space: nowrap;
    font-family: 'JetBrains Mono', monospace;
  }

  /* Lock position button (always visible during nav) */
  .lock-btn { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); cursor: pointer; pointer-events: auto; background: rgba(30, 30, 40, 0.7); transition: all 0.3s ease; }
  .lock-btn svg { width: 20px; height: 20px; }
  .lock-btn:hover { background: rgba(59, 130, 246, 0.2); }
  .lock-btn.locked { color: #00ff88; border-color: rgba(0, 255, 136, 0.4); background: rgba(0, 255, 136, 0.12); box-shadow: 0 0 12px rgba(0, 255, 136, 0.2); }
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

  /* Nav ETA */
  .nav-eta { font-size: 12px; color: #a1a1aa; margin-top: 4px; }
  .nav-eta strong { color: #00ff88; }

  /* Additional Nav Buttons */
  .nav-btn-voice { background: rgba(168, 85, 247, 0.15); color: #c084fc; flex: 0 0 auto; width: 50px; border: 1px solid rgba(168, 85, 247, 0.2); }
  .nav-btn-voice:hover { background: rgba(168, 85, 247, 0.25); }
  .nav-btn-voice.active { background: rgba(0, 255, 136, 0.2); color: #00ff88; border-color: rgba(0, 255, 136, 0.3); }
  .nav-btn-share { background: rgba(59, 130, 246, 0.15); color: #60a5fa; flex: 0 0 auto; width: 44px; border: 1px solid rgba(59, 130, 246, 0.2); }
  .nav-btn-share:hover { background: rgba(59, 130, 246, 0.25); }
  .map-container { flex: 1; position: relative; overflow: hidden; transition: flex 0.35s cubic-bezier(0.4, 0, 0.2, 1); }
  .map-container.fullscreen { width: 100vw; }
  
  /* Map Stats - Top Left */
  .map-stats { position: absolute; top: 16px; left: 16px; z-index: 1001; display: flex; gap: 10px; padding: 10px 14px; border-radius: 12px; }
  .map-stat { text-align: center; padding: 4px 8px; }
  .map-stat-value { display: block; font-size: 18px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .map-stat-label { font-size: 10px; color: #71717a; text-transform: uppercase; }
  .map-stat.weather .map-stat-value { font-size: 16px; }
  #map { width: 100%; height: 100%; }
  :global(.leaflet-tile-pane) { filter: grayscale(1) invert(1) brightness(0.55); }
  .map-info { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 12px 18px; font-size: 13px; color: #a1a1aa; z-index: 999; white-space: nowrap; }
  .map-info svg { width: 18px; height: 18px; color: #00ff88; }

  .nav-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 1000; }
  .nav-top-bar { position: absolute; top: 120px; right: 20px; display: flex; align-items: center; gap: 20px; padding: 16px 24px; pointer-events: auto; z-index: 1050; max-width: calc(100% - 40px); }
  .nav-target-info { flex: 1; min-width: 0; }
  .nav-target-label { font-size: 11px; color: #00ff88; font-weight: 500; letter-spacing: 0.5px; }
  .nav-target-name { font-size: 18px; font-weight: 600; color: #e4e4e7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
  /* Waypoint Button */
  .nav-btn-waypoint { background: rgba(236, 72, 153, 0.15); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.2); flex: 0 0 auto; }
  .nav-btn-waypoint:hover { background: rgba(236, 72, 153, 0.25); }
  .nav-btn-waypoint.active { background: rgba(236, 72, 153, 0.35); color: #f9a8d4; border-color: rgba(236, 72, 153, 0.5); animation: pulse-waypoint 1.5s infinite; }
  @keyframes pulse-waypoint { 0%, 100% { box-shadow: 0 0 0 0 rgba(236, 72, 153, 0.3); } 50% { box-shadow: 0 0 0 6px rgba(236, 72, 153, 0); } }

  .nav-btn-stop { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }
  .nav-btn-stop:hover { background: rgba(255, 107, 107, 0.3); }

  .toast { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-radius: 14px; font-size: 14px; font-weight: 500; z-index: 9999; animation: toastIn 0.4s ease; backdrop-filter: blur(20px); white-space: nowrap; }
  @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(-20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  .toast-success { background: rgba(0, 255, 136, 0.15); border: 1px solid rgba(0, 255, 136, 0.3); color: #00ff88; }
  .toast-error { background: rgba(255, 107, 107, 0.15); border: 1px solid rgba(255, 107, 107, 0.3); color: #ff6b6b; }
  .toast-warning { background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; }
  .toast-icon { width: 24px; height: 24px; }
  .toast-icon svg { width: 100%; height: 100%; }
  .undo-btn { background: rgba(255, 255, 255, 0.15); color: inherit; border: 1px solid rgba(255, 255, 255, 0.25); padding: 4px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'Kanit', sans-serif; transition: background 0.2s; margin-left: 4px; }
  .undo-btn:hover { background: rgba(255, 255, 255, 0.25); }

  :global(.leaflet-container) { height: 100% !important; width: 100% !important; background: #0a0a0f; }
  :global(.leaflet-control-zoom) { border: none !important; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3) !important; }
  :global(.leaflet-control-zoom a) { background: rgba(15, 15, 25, 0.95) !important; color: #a1a1aa !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; backdrop-filter: blur(10px); }
  :global(.leaflet-control-zoom a:hover) { background: rgba(25, 25, 40, 0.95) !important; color: #e4e4e7 !important; }
  :global(.leaflet-control-zoom-in) { border-radius: 10px 10px 0 0 !important; }
  :global(.leaflet-control-zoom-out) { border-radius: 0 0 10px 10px !important; }

  :global(.marker-pin) { width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; color: white; font-family: 'Kanit', sans-serif; border: 3px solid rgba(255, 255, 255, 0.3); position: relative; transition: border-color 0.2s, transform 0.2s; }
  :global(.marker-pin.draggable) { border-color: #fb923c; cursor: grab; animation: drag-pulse 1.5s ease-in-out infinite; }
  :global(.marker-pin.draggable:active) { cursor: grabbing; transform: scale(1.15); }
  :global(.drag-hint) { position: absolute; top: -8px; right: -8px; width: 18px; height: 18px; background: #fb923c; border-radius: 50%; font-size: 10px; display: flex; align-items: center; justify-content: center; color: white; border: 2px solid rgba(0,0,0,0.3); }
  @keyframes drag-pulse { 0%, 100% { border-color: #fb923c; } 50% { border-color: #fdba74; } }
  :global(.route-pin) { width: 52px; height: 52px; font-size: 18px; }
  :global(.marker-label) { position: absolute; bottom: -24px; left: 50%; transform: translateX(-50%); background: rgba(0, 0, 0, 0.8); padding: 2px 8px; border-radius: 4px; font-size: 10px; white-space: nowrap; }
  :global(.target-label) { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important; animation: pulse-label 1.5s ease-in-out infinite; }
  @keyframes pulse-label { 0%, 100% { transform: translateX(-50%) scale(1); } 50% { transform: translateX(-50%) scale(1.1); } }
  :global(.current-target) { animation: pulse-target 1.5s ease-in-out infinite; }
  /* ===== Start Location Marker (route calculated) ===== */
  :global(.start-loc-marker) {
    position: relative; width: 48px; height: 48px;
    display: flex; align-items: center; justify-content: center;
  }
  :global(.start-loc-core) {
    position: absolute; width: 24px; height: 24px;
    background: #00ff88;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 0 10px rgba(0,255,136,0.8), 0 0 24px rgba(0,255,136,0.35);
    z-index: 10;
    display: flex; align-items: center; justify-content: center;
  }
  :global(.start-loc-core svg) { filter: drop-shadow(0 1px 1px rgba(0,0,0,0.2)); }
  :global(.start-loc-ripple) {
    position: absolute; width: 24px; height: 24px;
    border: 2px solid rgba(0,255,136,0.6);
    border-radius: 50%;
    animation: start-ripple 2.5s ease-out infinite;
    z-index: 1;
  }
  :global(.start-loc-ripple-2) { animation-delay: 1.25s; }
  @keyframes start-ripple {
    0% { width: 24px; height: 24px; opacity: 0.7; }
    100% { width: 56px; height: 56px; opacity: 0; }
  }
  :global(.start-loc-label) {
    position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%);
    background: rgba(0,255,136,0.9);
    padding: 1px 8px; border-radius: 6px;
    font-size: 9px; font-weight: 600; white-space: nowrap;
    color: #0a2015; font-family: 'Kanit', sans-serif;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    z-index: 11;
  }
  @keyframes pulse-target { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
  :global(.arrived) { opacity: 0.6; }
  :global(.pulse-marker) { width: 48px; height: 48px; background: radial-gradient(circle, rgba(0, 255, 136, 0.6) 0%, rgba(0, 255, 136, 0) 70%); border-radius: 50%; animation: pulse 1.5s ease-out infinite; position: relative; }
  :global(.pulse-marker::after) { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; background: #00ff88; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 20px rgba(0, 255, 136, 0.6); }
  @keyframes pulse { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(2); opacity: 0; } }

  /* ===== Clean Location Dot ===== */
  :global(.my-loc-wrapper) {
    position: relative;
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
  }
  :global(.my-loc-dot) {
    position: absolute;
    width: 16px; height: 16px;
    background: #00ff88;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 0 10px rgba(0,255,136,0.8), 0 0 24px rgba(0,255,136,0.35);
    z-index: 10;
  }
  :global(.heading-arrow) {
    position: absolute;
    top: 0; left: 50%;
    transform-origin: center 20px;
    width: 0; height: 0;
    border-left: 7px solid transparent;
    border-right: 7px solid transparent;
    border-bottom: 14px solid #00ff88;
    margin-left: -7px;
    filter: drop-shadow(0 0 4px rgba(0,255,136,0.7));
    transition: transform 0.3s ease, opacity 0.3s;
    z-index: 5;
  }
  :global(.loc-pulse-ring) {
    position: absolute;
    width: 16px; height: 16px;
    border: 2px solid rgba(0,255,136,0.6);
    border-radius: 50%;
    animation: loc-pulse 2.5s ease-out infinite;
    z-index: 1;
  }
  :global(.loc-pulse-ring-2) { animation-delay: 1.25s; }
  @keyframes loc-pulse {
    0% { width: 16px; height: 16px; opacity: 0.7; }
    100% { width: 48px; height: 48px; opacity: 0; }
  }

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
    .sidebar { width: 100%; height: auto; max-height: 55vh; min-height: 200px; border-right: none; border-bottom: 1px solid rgba(255,255,255,0.1); overflow-y: auto; }
    .map-container { flex: 1; height: 60vh; min-height: 300px; position: relative; overflow: hidden; }
    #map { position: absolute; inset: 0; width: 100%; height: 100%; }
    .sidebar-content { padding: 12px; }
    .point-card { padding: 12px; }
    .nav-bottom-panel { max-width: 95%; padding: 16px; }
    .nav-stats { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .nav-stat { padding: 10px; }
    .nav-stat-value { font-size: 16px; }
    .nav-stat-icon { width: 40px; height: 40px; }
    .map-stats { flex-wrap: wrap; gap: 8px; padding: 10px; }
    .nav-top-bar { top: 110px; right: 15px; padding: 14px 20px; min-width: auto; }
    .nav-target-name { font-size: 16px; max-width: 240px; }
    .nav-right-cluster { right: 15px; bottom: 190px; }
    .speed-display { width: 85px; height: 85px; }
    .speed-value { font-size: 30px; }
    .lock-btn { width: 40px; height: 40px; }
    .alerts-panel { width: calc(100% - 60px); max-width: 400px; }
    .settings-panel { max-width: 95%; }
    .today-stats { gap: 8px; padding: 5px 10px; }
  }
  
  /* Mobile */
  @media (max-width: 768px) {
    .app-container { flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden; }

    /* Sidebar: collapsible on mobile */
    .sidebar {
      width: 100%;
      height: auto;
      max-height: 55vh;
      border-right: none;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      overflow: hidden;
      flex-shrink: 0;
      transition: max-height 0.35s cubic-bezier(0.22, 1, 0.36, 1),
                  border-bottom 0.2s ease;
      will-change: max-height;
    }
    .sidebar.collapsed {
      max-height: 38px !important;
      overflow: hidden !important;
      min-height: 0 !important;
    }
    .sidebar.collapsed > *:not(.sidebar-toggle) {
      opacity: 0;
      transform: translateY(-10px);
      transition: opacity 0.15s ease, transform 0.15s ease;
      pointer-events: none;
    }
    .sidebar:not(.collapsed) > *:not(.sidebar-toggle) {
      opacity: 1;
      transform: translateY(0);
      transition: opacity 0.25s ease 0.1s, transform 0.25s ease 0.1s;
    }
    .sidebar.desktop-collapsed { width: 100% !important; } /* ยกเลิก desktop-collapsed บน mobile */
    .desktop-sidebar-toggle { display: none !important; } /* ซ่อนปุ่ม desktop toggle บน mobile */
    .sidebar-toggle {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; padding: 10px 16px; border: none; background: rgba(15, 15, 25, 0.98);
      color: #a1a1aa; font-size: 12px; font-family: 'Kanit', sans-serif; cursor: pointer;
      border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
      transition: background 0.2s ease, color 0.2s ease;
    }
    .sidebar-toggle:active { background: rgba(0, 255, 136, 0.1); }
    .sidebar-toggle svg {
      width: 16px; height: 16px;
      transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .sidebar-toggle svg.flipped { transform: rotate(180deg); }
    .sidebar-toggle span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sidebar-header { padding: 10px 14px; flex-shrink: 0; }
    .sidebar-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; min-height: 0; }

    .map-container { flex: 1; width: 100%; position: relative; overflow: hidden; min-height: 0; }
    #map { position: absolute; inset: 0; width: 100% !important; height: 100% !important; }

    /* Header compact */
    .sidebar-header .logo h1 { font-size: 16px; }
    .sidebar-header .logo span { font-size: 9px; }
    .logo-icon { width: 32px; height: 32px; }
    .logo-icon svg { width: 18px; height: 18px; }
    .logo { gap: 10px; }
    .icon-btn { width: 34px; height: 34px; font-size: 14px; }

    /* Action buttons: horizontal scroll */
    .action-buttons { flex-direction: row; flex-wrap: wrap; gap: 6px; padding: 8px 14px; }
    .action-buttons .btn { flex: 1 1 calc(50% - 3px); min-width: 0; justify-content: center; padding: 10px 8px; font-size: 12px; }
    .action-buttons .btn svg { width: 16px; height: 16px; flex-shrink: 0; }
    .action-buttons .btn span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Tabs compact */
    .tabs { gap: 4px; margin: 0 10px 12px; padding: 4px; }
    .tab { padding: 10px 14px; font-size: 12px; white-space: nowrap; flex-shrink: 0; border-radius: 10px; }
    .tab svg { width: 16px; height: 16px; }

    /* Cards compact */
    .point-card { padding: 12px 14px; margin-bottom: 8px; border-radius: 14px; }
    .point-number { width: 38px; height: 38px; font-size: 15px; border-radius: 12px; }
    .stat-card { padding: 16px 12px; border-radius: 14px; }
    .stat-icon { width: 42px; height: 42px; margin-bottom: 10px; }
    .stat-value { font-size: 26px; }
    .point-name { font-size: 13px; }
    .point-address { font-size: 11px; }
    /* Route Summary - full width, 4 columns on mobile */
    .route-summary { padding: 0 4px 12px; }
    .summary-header { margin-bottom: 10px; flex-wrap: wrap; gap: 6px; }
    .summary-header h3 { font-size: 15px; }
    .route-badge { font-size: 10px; padding: 4px 10px; }
    .summary-stats { grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
    .stat-card { padding: 10px 6px; border-radius: 10px; background: rgba(0, 255, 136, 0.04); border: 1px solid rgba(0, 255, 136, 0.12); }
    .stat-icon { width: 28px; height: 28px; margin-bottom: 4px; border-radius: 8px; }
    .stat-icon svg { width: 16px; height: 16px; }
    .stat-value { font-size: 20px; font-weight: 800; color: #00ff88; }
    .stat-label { font-size: 9px; color: #a1a1aa; }
    .stat-card.fuel .stat-value, .stat-card.ev .stat-value { color: #f59e0b; }
    /* Timeline compact */
    .timeline-item { padding: 10px; gap: 10px; }
    .timeline-marker { width: 30px; height: 30px; font-size: 12px; border-radius: 8px; }
    .timeline-name { font-size: 13px; }
    .timeline-label { font-size: 10px; }

    /* Add Form Mobile */
    .add-form-overlay { display: contents; }
    .add-form { margin: 0 10px 10px; padding: 12px; }
    .add-form .form-header { margin-bottom: 8px; }
    .add-form .form-header h3 { font-size: 14px; }
    .add-form .close-btn { width: 28px; height: 28px; }
    .add-form .form-hint { font-size: 10px; padding: 6px 8px; margin-bottom: 8px; }
    .add-form .form-group { margin-bottom: 8px; }
    .add-form .form-group label { font-size: 11px; margin-bottom: 3px; }
    .add-form .form-group input, .add-form .form-group textarea { padding: 8px 10px; font-size: 13px; }
    .add-form .form-group textarea { min-height: 36px; }
    .add-form .coords-group { grid-template-columns: 1fr 1fr; gap: 6px; }
    .add-form .priority-selector { gap: 4px; justify-content: center; }
    .add-form .priority-btn { min-width: 46px; max-width: 58px; padding: 6px 2px; }
    .add-form .priority-num { font-size: 13px; }
    .add-form .priority-label { font-size: 7px; }
    .add-form .form-actions { flex-direction: row; gap: 6px; margin-top: 8px; }
    .add-form .form-actions .btn { flex: 1; padding: 10px; font-size: 12px; }

    /* Map overlays */
    .map-stats { position: absolute; top: auto; bottom: 12px; left: 8px; right: auto; width: auto; max-width: calc(100% - 16px); flex-wrap: wrap; gap: 4px; padding: 6px 8px; z-index: 1000; }
    .map-stat { padding: 2px 4px; }
    .map-stat-value { font-size: 13px; }
    .map-stat-label { font-size: 8px; }
    .map-info { position: absolute; bottom: 4px; left: 50%; right: auto; width: auto; max-width: calc(100% - 16px); transform: translateX(-50%); padding: 4px 8px; font-size: 9px; z-index: 999; }

    /* ===== Navigation Mode Mobile ===== */
    .nav-overlay { position: fixed; inset: 0; z-index: 1500; }

    /* Turn instruction - top right, compact */
    .turn-by-turn-panel { right: 8px; left: auto; min-width: auto; max-width: calc(100% - 16px); top: 10px; padding: 10px 14px; }
    .turn-icon-wrap { width: 36px; height: 36px; }
    .turn-icon { font-size: 20px; }
    .turn-text { font-size: 13px; }
    .turn-distance { font-size: 11px; }

    /* Target bar - below turn */
    .nav-top-bar { position: absolute; top: 85px; right: 8px; left: auto; width: auto; max-width: calc(100% - 16px); padding: 10px 14px; min-width: auto; gap: 12px; }
    .nav-target-label { font-size: 9px; }
    .nav-target-name { font-size: 14px; max-width: 200px; }
    .nav-eta { font-size: 12px; }
    .nav-distance-value { font-size: 16px; }
    .nav-distance-badge { padding: 8px 12px; }

    /* Speed + Lock - right side */
    .nav-right-cluster { right: 8px; bottom: 200px; gap: 6px; }
    .speed-display { width: 64px; height: 64px; }
    .speed-value { font-size: 22px; }
    .speed-unit { font-size: 9px; }
    .compass-widget { width: 52px; height: 52px; }
    .compass-ring { width: 42px; height: 42px; }
    .compass-n, .compass-e, .compass-s, .compass-w { font-size: 8px; }
    .compass-needle { width: 28px; height: 28px; }
    .compass-heading-text { font-size: 8px; bottom: -14px; }
    .lock-btn { width: 36px; height: 36px; }
    .lock-btn svg { width: 16px; height: 16px; }

    /* Bottom panel - full width, compact */
    .nav-bottom-panel { position: absolute; padding: 10px; left: 8px; right: 8px; width: auto; transform: none; max-width: none; bottom: 8px; }
    .nav-stats { grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
    .nav-stat { padding: 6px 4px; gap: 0; flex-direction: column; align-items: center; text-align: center; }
    .nav-stat-icon { display: none; }
    .nav-stat-value { font-size: 14px; }
    .nav-stat-label { font-size: 9px; }
    .nav-actions { flex-wrap: nowrap; gap: 6px; }
    .nav-btn { padding: 10px 6px; font-size: 11px; flex: 1 1 auto; min-width: 0; white-space: nowrap; }
    .nav-btn svg { width: 16px; height: 16px; }
    .nav-btn-success, .nav-btn-skip { flex: 1 1 30%; }
    .nav-btn-voice, .nav-btn-share, .nav-btn-stop { flex: 0 0 auto; width: 40px; }
    .nav-btn-share svg { width: 14px; height: 14px; }

    /* History Panel */

    /* Modals */
    .alerts-panel { position: fixed; width: calc(100% - 24px); left: 50%; top: 50%; transform: translate(-50%, -50%); max-height: 70vh; z-index: 2000; }
    .settings-panel { width: calc(100% - 32px); max-width: none; }
    .settings-grid { grid-template-columns: 1fr; }

    /* Popups */
    :global(.custom-popup) { min-width: 170px; max-width: 250px; }
    :global(.ev-popup) { min-width: 190px; max-width: 270px; }

    /* Charging Stops */
    .charging-stops-section { padding: 8px; }
    .charging-stop-card { padding: 8px; }
    .stop-number-badge { width: 32px; height: 32px; font-size: 13px; }

    /* Search */
    .search-results { left: 8px; right: 8px; }
    .search-dropdown { left: 8px; right: 8px; }
  }

  /* Small Mobile */
  @media (max-width: 480px) {
    .app-container { height: 100vh; height: 100dvh; }
    .sidebar { max-height: 40vh; min-height: 90px; }
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
    
    /* Route Summary - 2 cols on very small screens */
    .summary-stats { grid-template-columns: repeat(2, 1fr); gap: 6px; }
    .stat-card { padding: 10px 8px; }
    .stat-value { font-size: 22px; }
    .stat-label { font-size: 9px; }

    /* Map Stats Small Mobile - bottom left */
    .map-stats { top: auto; bottom: 8px; padding: 5px 6px; gap: 3px; }
    .map-stat { padding: 2px 4px; }
    .map-stat-value { font-size: 12px; }
    .map-stat-label { font-size: 7px; }
    
    /* Navigation Small Mobile */
    .nav-right-cluster { right: 6px; bottom: 170px; }
    .speed-display { width: 56px; height: 56px; }
    .speed-value { font-size: 18px; }
    .speed-unit { font-size: 8px; }
    .today-stats { gap: 4px; padding: 3px 6px; }
    .today-stat .stat-value { font-size: 12px; }
    .nav-bottom-panel { padding: 8px; left: 6px; right: 6px; bottom: 6px; }
    .nav-stats { grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 8px; }
    .nav-stat { padding: 4px 2px; }
    .nav-stat-value { font-size: 12px; }
    .nav-stat-label { font-size: 8px; }
    .nav-actions { gap: 4px; }
    .nav-btn { padding: 8px 4px; font-size: 10px; min-width: 0; }
    .nav-btn-success, .nav-btn-skip { flex: 1 1 30%; }

    /* History Panel Small Mobile */
    

    /* Nav top bar small */
    .nav-top-bar { top: 90px; right: 8px; padding: 10px; min-width: auto; }
    .nav-target-name { font-size: 13px; max-width: 160px; }
    .nav-target-label { font-size: 9px; }
    .nav-eta { font-size: 11px; }

    /* Lock btn small */
    .lock-btn { width: 34px; height: 34px; }
    .lock-btn svg { width: 14px; height: 14px; }

    /* Turn-by-turn small */
    .turn-by-turn-panel { right: 8px; max-width: calc(100% - 16px); padding: 8px 12px; }

    /* Alerts small */
    .alerts-panel { width: calc(100% - 20px); }

    /* Settings small */
    .settings-panel { width: calc(100% - 20px); }
    .settings-grid { grid-template-columns: 1fr; }

    /* Popups small */
    :global(.custom-popup) { min-width: 160px; max-width: 220px; }
    :global(.ev-popup) { min-width: 180px; max-width: 240px; }
    :global(.popup-content h4) { font-size: 13px; }
    :global(.popup-content p) { font-size: 11px; }
  }

  /* Landscape Mobile */
  @media (max-height: 500px) and (orientation: landscape) {
    .app-container { flex-direction: row; }
    .sidebar { width: 280px; height: 100vh; max-height: 100vh; border-right: 1px solid rgba(255,255,255,0.1); border-bottom: none; }
    .map-container { height: 100vh; flex: 1; }
    .nav-right-cluster { bottom: 120px; right: 10px; }
    .speed-display { width: 60px; height: 60px; }
    .speed-value { font-size: 20px; }
    .nav-bottom-panel { bottom: 10px; padding: 10px; }
    .nav-stats { grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .nav-stat { padding: 6px; }
    .nav-stat-icon { width: 30px; height: 30px; }
    .nav-stat-value { font-size: 12px; }
    .nav-actions { gap: 6px; }
    .nav-btn { padding: 8px; }
    .lock-btn { width: 34px; height: 34px; }
    .turn-by-turn-panel { right: 10px; min-width: auto; max-width: 300px; padding: 8px 12px; }
    .nav-top-bar { top: 90px; right: 10px; padding: 10px; min-width: auto; }
    .nav-target-name { font-size: 13px; max-width: 180px; }
    .alerts-panel { width: calc(100% - 40px); max-width: 360px; }
  }
  /* ==================== เพิ่มเติมสำหรับ Database Integration ==================== */

/* Today Stats Panel - compact, below speed display */
.today-stats {
  display: flex;
  gap: 12px;
  padding: 6px 12px;
  pointer-events: none;
  border-radius: 20px !important;
}

.today-stat {
  display: flex;
  align-items: center;
  gap: 4px;
}

.today-stat .stat-icon {
  font-size: 14px;
}

.today-stat .stat-value {
  font-size: 16px;
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
    padding: 4px 8px;
    gap: 8px;
  }

  .today-stat .stat-value {
    font-size: 14px;
  }

  .nav-right-cluster {
    right: 10px;
    bottom: 180px;
  }
}

@media (max-width: 480px) {
  .today-stats {
    padding: 4px 6px;
    gap: 6px;
  }

  .today-stat .stat-icon {
    font-size: 12px;
  }
  
  .today-stat .stat-value {
    font-size: 14px;
  }
  
  .today-stat .stat-label {
    font-size: 8px;
  }

  .curve-warning {
    top: 155px;
    left: 10px;
    right: auto;
    min-width: 150px;
    padding: 10px 12px;
  }

  .curve-icon {
    font-size: 24px;
  }

  .curve-text {
    font-size: 12px;
  }

  .lane-guidance {
    top: 205px;
    left: 10px;
    padding: 8px 10px;
  }

  .lane {
    width: 12px;
    height: 24px;
  }

  .lane-text {
    font-size: 12px;
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
  /* Oil Price Section in Right Column */
.settings-section .oil-price-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  border-bottom: none;
  padding-bottom: 0;
}

.settings-section .oil-price-header h4 {
  margin: 0;
  font-size: 14px;
  color: #00ff88;
}

/* ปรับ Right Column ให้รองรับ scroll */
.settings-column:last-child {
  max-height: 500px;
  overflow-y: auto;
}

.settings-column:last-child::-webkit-scrollbar {
  width: 6px;
}

.settings-column:last-child::-webkit-scrollbar-track {
  background: transparent;
}

.settings-column:last-child::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.settings-column:last-child::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
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

/* ==================== ADVANCED NAVIGATION CSS ==================== */

/* Search Section */
.search-section {
  padding: 12px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  position: relative;
}
.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 12px;
  width: 18px;
  height: 18px;
  color: #52525b;
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 12px 40px 12px 38px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: #e4e4e7;
  font-family: 'Kanit', sans-serif;
  font-size: 14px;
  transition: all 0.2s;
}
.search-input:focus {
  outline: none;
  border-color: #00ff88;
  box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1);
}
.search-input::placeholder { color: #52525b; }
.search-clear {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  color: #71717a;
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
}
.search-spinner {
  position: absolute;
  right: 36px;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(0, 255, 136, 0.3);
  border-top-color: #00ff88;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.search-dropdown {
  position: absolute;
  top: calc(100% - 4px);
  left: 24px;
  right: 24px;
  background: rgba(15, 15, 25, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  max-height: 280px;
  overflow-y: auto;
  z-index: 200;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}
.search-result-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  color: #e4e4e7;
  font-family: 'Kanit', sans-serif;
  transition: background 0.15s;
}
.search-result-item:hover { background: rgba(0, 255, 136, 0.08); }
.search-result-item:last-child { border-bottom: none; }
.result-icon { font-size: 16px; margin-top: 2px; }
.result-info { display: flex; flex-direction: column; min-width: 0; }
.result-name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result-address { font-size: 11px; color: #71717a; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* Direct Navigation Bar */
.direct-nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding: 10px 14px;
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 10px;
}
.direct-dest-info { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.dest-icon { font-size: 16px; }
.dest-name { font-size: 13px; font-weight: 500; color: #00ff88; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.btn-navigate-direct {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  border: none;
  border-radius: 8px;
  color: white;
  font-family: 'Kanit', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.btn-navigate-direct svg { width: 16px; height: 16px; }
.btn-navigate-direct:hover { transform: translateY(-1px); }

/* Route Preferences */
.route-preferences {
  padding: 12px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.pref-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.pref-title { font-size: 13px; font-weight: 600; color: #a1a1aa; }
.pref-toggle {
  background: rgba(255, 165, 2, 0.15);
  border: 1px solid rgba(255, 165, 2, 0.3);
  border-radius: 8px;
  color: #ffa502;
  font-family: 'Kanit', sans-serif;
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
}
/* Collapsible Preferences */
.pref-header-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 0;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-family: 'Kanit', sans-serif;
}
.pref-header-btn:hover { opacity: 0.85; }
.pref-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pref-active-label {
  padding: 3px 10px;
  background: rgba(0, 255, 136, 0.12);
  border: 1px solid rgba(0, 255, 136, 0.25);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  color: #00ff88;
}
.pref-chevron {
  font-size: 10px;
  color: #71717a;
  transition: transform 0.2s;
}
.pref-chevron.open { transform: rotate(180deg); }
.pref-body {
  padding-top: 8px;
  animation: slideIn 0.2s ease;
}
/* Saved Routes Inline */
.saved-inline {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.saved-inline-header {
  font-size: 12px;
  font-weight: 600;
  color: #ffa502;
  margin-bottom: 8px;
}
.saved-inline .saved-route-card {
  margin-bottom: 6px;
}
.pref-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.pref-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #a1a1aa;
  font-family: 'Kanit', sans-serif;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.pref-chip:hover { background: rgba(255, 255, 255, 0.1); }
.pref-chip.active {
  background: rgba(0, 255, 136, 0.15);
  border-color: rgba(0, 255, 136, 0.4);
  color: #00ff88;
}
.pref-toggles {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pref-toggle-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 12px;
  color: #a1a1aa;
}
.toggle-btn.mini { width: 40px; height: 22px; border-radius: 11px; }
.toggle-btn.mini .toggle-knob { width: 16px; height: 16px; top: 3px; left: 3px; }
.toggle-btn.mini.active .toggle-knob { left: 21px; }

/* Saved Routes */
.saved-routes-panel {
  padding: 12px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  max-height: 200px;
  overflow-y: auto;
}
.saved-header h4 { font-size: 14px; font-weight: 600; color: #ffa502; margin-bottom: 10px; }
.saved-empty { text-align: center; padding: 16px; color: #71717a; font-size: 13px; }
.saved-list { display: flex; flex-direction: column; gap: 8px; }
.saved-route-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}
.saved-route-card:hover { background: rgba(255, 255, 255, 0.06); }
.saved-route-info { flex: 1; min-width: 0; }
.saved-route-name { font-size: 13px; font-weight: 500; color: #e4e4e7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.saved-route-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #71717a; margin-top: 4px; }
.saved-toll-badge { padding: 2px 6px; background: rgba(255, 165, 2, 0.2); border-radius: 4px; color: #ffa502; font-size: 10px; }
.saved-delete-btn { background: none; border: none; font-size: 14px; cursor: pointer; opacity: 0.5; }
.saved-delete-btn:hover { opacity: 1; }

/* Button Variants */
.btn-alt-routes {
  background: rgba(102, 126, 234, 0.15);
  color: #818cf8;
  border: 1px solid rgba(102, 126, 234, 0.3);
}
.btn-alt-routes:hover { background: rgba(102, 126, 234, 0.25); }
.btn-save-route {
  background: rgba(255, 165, 2, 0.15);
  color: #ffa502;
  border: 1px solid rgba(255, 165, 2, 0.3);
}
.btn-save-route:hover { background: rgba(255, 165, 2, 0.25); }
.btn-share {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  border: 1px solid rgba(59, 130, 246, 0.3);
}
.btn-share:hover { background: rgba(59, 130, 246, 0.25); }

/* Share Route QR Modal */
.share-qr-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: modalFadeIn 0.3s ease;
}
.share-qr-modal {
  width: 90%;
  max-width: 360px;
  padding: 0;
  border-radius: 20px;
  overflow: hidden;
  animation: modalSlideIn 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.share-qr-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.1) 100%);
  border-bottom: 1px solid rgba(59, 130, 246, 0.2);
}
.share-qr-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #e4e4e7;
}
.share-qr-body {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.qr-code-container {
  background: white;
  padding: 16px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}
.qr-code-img {
  display: block;
  width: 200px;
  height: 200px;
}
.share-qr-hint {
  font-size: 13px;
  color: #a1a1aa;
  text-align: center;
  margin: 0;
}
.share-qr-actions {
  display: flex;
  gap: 10px;
  width: 100%;
}
.share-qr-actions .btn {
  flex: 1;
  justify-content: center;
}

/* Turn-by-Turn Panel */
.turn-by-turn-panel {
  position: absolute;
  top: 36px;
  right: 20px;
  padding: 14px 20px;
  pointer-events: auto;
  min-width: 300px;
  max-width: 420px;
  z-index: 1100;
  transition: all 0.3s;
}
.turn-by-turn-panel.off-route {
  border-color: rgba(255, 107, 107, 0.5);
  background: rgba(255, 107, 107, 0.1);
  animation: pulse-offroute 1s infinite;
}
@keyframes pulse-offroute {
  0%, 100% { box-shadow: 0 0 20px rgba(255, 107, 107, 0.3); }
  50% { box-shadow: 0 0 40px rgba(255, 107, 107, 0.6); }
}
.turn-instruction {
  display: flex;
  align-items: center;
  gap: 14px;
}
.turn-icon-wrap { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 14px; background: rgba(0, 255, 136, 0.1); flex-shrink: 0; transition: all 0.3s; }
.turn-icon-wrap.pulse-approaching { background: rgba(0, 255, 136, 0.2); animation: turn-pulse 1s ease-in-out infinite; }
.turn-icon { font-size: 28px; }
.turn-info { flex: 1; }
.turn-text { font-size: 16px; font-weight: 600; color: #e4e4e7; }
.turn-distance { font-size: 13px; color: #71717a; margin-top: 2px; display: flex; align-items: center; gap: 8px; }
.turn-soon-badge { font-size: 10px; font-weight: 700; color: #fbbf24; background: rgba(251, 191, 36, 0.15); padding: 2px 8px; border-radius: 10px; animation: badge-blink 1.2s ease-in-out infinite; }
.turn-approaching { border-color: rgba(0, 255, 136, 0.3) !important; box-shadow: 0 0 20px rgba(0, 255, 136, 0.1) !important; }

@keyframes turn-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes badge-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

/* Curve Warning */
.curve-warning {
  position: absolute;
  top: 190px;
  left: 20px;
  padding: 12px 16px;
  z-index: 1090;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 180px;
  border: 1px solid rgba(251, 191, 36, 0.3);
  background: rgba(251, 191, 36, 0.1);
  animation: curveSlideIn 0.3s ease;
}

@keyframes curveSlideIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

.curve-warning.sharp {
  border-color: rgba(249, 115, 22, 0.4);
  background: rgba(249, 115, 22, 0.15);
}

.curve-warning.hairpin {
  border-color: rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.15);
  animation: curveSlideIn 0.3s ease, curvePulse 0.8s ease-in-out infinite;
}

@keyframes curvePulse {
  0%, 100% { box-shadow: 0 0 10px rgba(239, 68, 68, 0.3); }
  50% { box-shadow: 0 0 25px rgba(239, 68, 68, 0.6); }
}

.curve-icon {
  font-size: 32px;
  font-weight: bold;
  color: #fbbf24;
}

.curve-warning.sharp .curve-icon { color: #f97316; }
.curve-warning.hairpin .curve-icon { color: #ef4444; }

.curve-info { flex: 1; }

.curve-text {
  font-size: 14px;
  font-weight: 600;
  color: #fbbf24;
}

.curve-warning.sharp .curve-text { color: #f97316; }
.curve-warning.hairpin .curve-text { color: #ef4444; }

.curve-distance {
  font-size: 12px;
  color: #a1a1aa;
  margin-top: 2px;
}

/* Lane Guidance */
.lane-guidance {
  position: absolute;
  top: 240px;
  left: 20px;
  padding: 10px 14px;
  z-index: 1090;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(59, 130, 246, 0.3);
  background: rgba(59, 130, 246, 0.1);
}

.lane-visual {
  display: flex;
  gap: 4px;
}

.lane {
  width: 16px;
  height: 32px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.3s ease;
}

.lane.active {
  background: #3b82f6;
  border-color: #3b82f6;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
  animation: lanePulse 1s ease-in-out infinite;
}

@keyframes lanePulse {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.1); }
}

.lane-text {
  font-size: 14px;
  font-weight: 600;
  color: #3b82f6;
}

/* Route Progress Strip */
.nav-route-progress-strip {
  position: absolute; top: 36px; left: 50%; transform: translateX(-50%);
  width: calc(100% - 40px); max-width: 600px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
  border-radius: 0 0 12px 12px;
  display: flex; align-items: center; gap: 12px;
  pointer-events: none; z-index: 1010;
}
.route-progress-track { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; position: relative; overflow: visible; }
.route-progress-fill { height: 100%; background: linear-gradient(90deg, #00ff88, #06b6d4); border-radius: 2px; transition: width 1s ease; }
.route-progress-cursor { position: absolute; top: 50%; width: 10px; height: 10px; background: #00ff88; border: 2px solid white; border-radius: 50%; transform: translate(-50%, -50%); transition: left 1s ease; box-shadow: 0 0 8px rgba(0, 255, 136, 0.5); }
.route-progress-info { display: flex; gap: 10px; font-family: 'Kanit', sans-serif; font-size: 11px; color: #a1a1aa; white-space: nowrap; }
.route-progress-pct { color: #00ff88; font-weight: 600; }
.route-progress-eta { color: #e4e4e7; }

/* Next Turn Marker on Map */
:global(.next-turn-marker-container) { background: none !important; border: none !important; }
:global(.next-turn-pulse) { position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }
:global(.next-turn-ring) { position: absolute; width: 36px; height: 36px; border-radius: 50%; border: 2px solid rgba(0, 255, 136, 0.5); animation: turn-ring-pulse 2s ease-out infinite; }
:global(.next-turn-dot) { width: 10px; height: 10px; border-radius: 50%; background: #00ff88; box-shadow: 0 0 10px rgba(0, 255, 136, 0.6); }
@keyframes turn-ring-pulse { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(2); opacity: 0; } }

/* Route Flow Animation */
:global(.route-flow-line) { animation: route-flow 1.5s linear infinite; }
@keyframes route-flow { to { stroke-dashoffset: -32; } }

/* Celebration Overlay */
.celebration-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  z-index: 10000; pointer-events: none;
  display: flex; align-items: center; justify-content: center;
  animation: celebration-fade 3s ease forwards;
}
.celebration-content { text-align: center; position: relative; }
.celebration-confetti { position: absolute; top: 50%; left: 50%; width: 0; height: 0; }
.confetti-piece {
  position: absolute; width: 8px; height: 8px; border-radius: 2px;
  background: var(--color); opacity: 0;
  animation: confetti-burst 2s ease-out calc(var(--i) * 0.05s) forwards;
}
.celebration-check {
  width: 80px; height: 80px; margin: 0 auto 16px;
  background: rgba(0, 255, 136, 0.15); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  animation: check-pop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
.celebration-check svg { width: 44px; height: 44px; }
.check-path { stroke-dasharray: 30; stroke-dashoffset: 30; animation: check-draw 0.6s ease 0.3s forwards; }
.celebration-text { font-family: 'Kanit', sans-serif; font-size: 24px; font-weight: 700; color: #00ff88; text-shadow: 0 2px 20px rgba(0, 255, 136, 0.4); }
.celebration-name { font-family: 'Kanit', sans-serif; font-size: 14px; color: #a1a1aa; margin-top: 4px; }

@keyframes celebration-fade { 0% { opacity: 0; } 10% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
@keyframes check-pop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
@keyframes check-draw { to { stroke-dashoffset: 0; } }
@keyframes confetti-burst {
  0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
  100% {
    transform: translate(
      calc(cos(calc(var(--i) * 18deg)) * 150px),
      calc(sin(calc(var(--i) * 18deg)) * 150px - 50px)
    ) rotate(calc(var(--i) * 90deg));
    opacity: 0;
  }
}

/* Driving Score Card */
.driving-score-card {
  position: relative; width: 64px; height: 64px; padding: 0;
  display: flex; align-items: center; justify-content: center;
}
.score-ring { width: 60px; height: 60px; position: absolute; }
.score-text { text-align: center; z-index: 1; }
.score-number { font-size: 18px; font-weight: 800; font-family: 'JetBrains Mono', monospace; line-height: 1; }
.score-label { font-size: 8px; color: #a1a1aa; margin-top: 1px; }

/* Break Reminder */
.break-reminder-overlay {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.break-reminder { padding: 30px; text-align: center; max-width: 340px; }
.break-icon { font-size: 48px; margin-bottom: 12px; }
.break-title { font-size: 20px; font-weight: 700; color: #e4e4e7; margin-bottom: 6px; }
.break-subtitle { font-size: 13px; color: #a1a1aa; margin-bottom: 20px; line-height: 1.5; }
.break-actions { display: flex; gap: 10px; }
.break-btn { flex: 1; padding: 12px; border: none; border-radius: 12px; font-family: 'Kanit', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; }
.break-btn-rest { background: #00ff88; color: #0a0a0a; }
.break-btn-dismiss { background: rgba(255, 255, 255, 0.1); color: #a1a1aa; }

/* Hazard Menu */
.hazard-menu {
  position: absolute; bottom: 220px; right: 20px;
  padding: 16px; z-index: 1100; width: 200px;
}
.hazard-menu-title { font-size: 13px; font-weight: 600; color: #e4e4e7; margin-bottom: 10px; text-align: center; }
.hazard-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
.hazard-option {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 4px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;
  background: rgba(255, 255, 255, 0.03); cursor: pointer; color: #e4e4e7;
  font-family: 'Kanit', sans-serif; font-size: 10px; transition: all 0.15s;
}
.hazard-option:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.15); }
.hazard-close { width: 100%; padding: 8px; border: none; border-radius: 8px; background: rgba(255, 255, 255, 0.06); color: #a1a1aa; font-family: 'Kanit', sans-serif; font-size: 12px; cursor: pointer; }
:global(.hazard-marker-container) { background: none !important; border: none !important; }
:global(.hazard-marker) {
  width: 34px; height: 34px; border-radius: 50%;
  background: rgba(245, 158, 11, 0.9); display: flex; align-items: center; justify-content: center;
  font-size: 16px; box-shadow: 0 2px 10px rgba(245, 158, 11, 0.5);
  animation: hazard-pulse 2s ease-in-out infinite;
}
@keyframes hazard-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }

/* Nav button hazard */
.nav-btn-hazard { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.nav-btn-hazard:hover { background: rgba(245, 158, 11, 0.25); }

/* Trip Summary Modal */
.trip-summary-overlay {
  position: fixed; inset: 0; z-index: 5000;
  background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  animation: fade-in 0.3s ease;
}
.trip-summary-card {
  background: rgba(20, 20, 32, 0.98); border-radius: 20px;
  padding: 28px; width: 90%; max-width: 380px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  animation: slide-up 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.trip-summary-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.trip-score-circle { position: relative; width: 70px; height: 70px; flex-shrink: 0; }
.trip-score-circle svg { width: 100%; height: 100%; }
.trip-score-num {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 800; font-family: 'JetBrains Mono', monospace;
  color: var(--score-color, #00ff88);
}
.trip-header-title { font-size: 18px; font-weight: 700; color: #e4e4e7; }
.trip-header-label { font-size: 13px; font-weight: 600; margin-top: 2px; }
.trip-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.trip-stat { text-align: center; padding: 12px 6px; background: rgba(255, 255, 255, 0.03); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.06); }
.trip-stat-val { font-size: 22px; font-weight: 800; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; }
.trip-stat-lbl { font-size: 10px; color: #71717a; margin-top: 2px; }
.trip-details { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.trip-detail-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; background: rgba(255, 255, 255, 0.02); border-radius: 8px;
  font-size: 13px; color: #a1a1aa;
}
.trip-detail-val { font-weight: 600; font-family: 'JetBrains Mono', monospace; }
.trip-close-btn {
  width: 100%; padding: 14px; border: none; border-radius: 14px;
  background: linear-gradient(135deg, #00ff88, #00cc6a); color: #0a0a0a;
  font-family: 'Kanit', sans-serif; font-size: 15px; font-weight: 700;
  cursor: pointer; transition: all 0.2s;
}
.trip-close-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3); }

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes slide-up { from { opacity: 0; transform: translateY(30px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }

/* Current Road Name */
.current-road-bar {
  position: absolute; top: 90px; left: 50%; transform: translateX(-50%);
  padding: 4px 16px; z-index: 1040;
  background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
  border-radius: 20px; pointer-events: none;
}
.road-name {
  font-size: 12px; font-weight: 500; color: #d4d4d8;
  font-family: 'Kanit', sans-serif; white-space: nowrap;
}

/* Compass */
.compass-card {
  display: flex; align-items: center; gap: 4px; padding: 6px 10px !important;
}
.compass-arrow { transition: transform 0.3s ease; line-height: 0; }
.compass-label { font-size: 12px; font-weight: 700; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; min-width: 20px; text-align: center; }

/* Speed Sparkline */
.speed-chart { padding: 4px 6px !important; width: 64px; height: 32px; }
.speed-chart svg { width: 100%; height: 100%; }

/* Km Distance Markers */
:global(.km-marker-container) { background: none !important; border: none !important; }
:global(.km-marker) {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(0, 0, 0, 0.6); border: 1.5px solid rgba(0, 255, 136, 0.4);
  color: #00ff88; font-size: 9px; font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  display: flex; align-items: center; justify-content: center;
}

/* Undo Delivery Button */
.undo-delivery-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; padding: 10px; margin-bottom: 12px;
  background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 10px; color: #f59e0b;
  font-family: 'Kanit', sans-serif; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.2s; animation: undo-flash 2s ease infinite;
}
.undo-delivery-btn:hover { background: rgba(245, 158, 11, 0.2); }
@keyframes undo-flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

/* Per-Point ETA List */
.eta-list {
  position: absolute; top: 120px; right: 20px; z-index: 1030;
  padding: 10px 12px !important; max-width: 200px; pointer-events: auto;
}
.eta-list-title { font-size: 10px; color: #71717a; margin-bottom: 6px; font-weight: 600; }
.eta-list-item {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 11px;
}
.eta-list-item:last-child { border-bottom: none; }
.eta-list-item.current-target { color: #00ff88; }
.eta-order {
  width: 18px; height: 18px; border-radius: 50%;
  background: rgba(255, 255, 255, 0.06); display: flex;
  align-items: center; justify-content: center;
  font-size: 9px; font-weight: 700; flex-shrink: 0;
}
.current-target .eta-order { background: rgba(0, 255, 136, 0.15); }
.eta-name { flex: 1; color: #d4d4d8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.eta-time { color: #a1a1aa; font-family: 'JetBrains Mono', monospace; font-size: 10px; flex-shrink: 0; }
.current-target .eta-time { color: #00ff88; }

/* Off-Route Warning */
.off-route-warning {
  display: flex;
  align-items: center;
  gap: 14px;
}
.off-route-icon { font-size: 32px; animation: shake 0.5s infinite; }
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}
.off-route-text { flex: 1; }
.off-route-title { font-size: 16px; font-weight: 700; color: #ff6b6b; }
.off-route-detail { font-size: 12px; color: #a1a1aa; }
.reroute-btn {
  padding: 8px 16px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  border: none;
  border-radius: 8px;
  color: white;
  font-family: 'Kanit', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

/* Route Selector Overlay */
.route-selector-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  z-index: 1500;
  padding: 20px;
  display: flex;
  align-items: flex-start;
  padding-top: 60px;
}
.route-selector-panel {
  width: 100%;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  padding: 20px;
  margin-top: 120px;
  background: rgba(15, 15, 25, 0.98) !important;
}
.route-selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.route-selector-header h3 { font-size: 16px; font-weight: 600; color: #e4e4e7; }
.route-selector-list { display: flex; flex-direction: column; gap: 10px; }
.route-option-card {
  width: 100%;
  padding: 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  font-family: 'Kanit', sans-serif;
  color: #e4e4e7;
}
.route-option-card:hover { background: rgba(255, 255, 255, 0.06); }
.route-option-card.selected {
  background: rgba(0, 255, 136, 0.08);
  border-color: rgba(0, 255, 136, 0.3);
}
.route-option-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.route-option-label { font-size: 14px; font-weight: 600; }
.recommended-badge {
  padding: 2px 8px;
  background: linear-gradient(135deg, #00ff88, #00cc6a);
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
  color: #000;
}
.route-option-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}
.route-stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.route-stat-icon { font-size: 14px; }
.route-stat-val { font-weight: 600; font-family: 'JetBrains Mono', monospace; }
.route-option-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.route-tag {
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
}
.route-tag.toll { background: rgba(255, 165, 2, 0.2); color: #ffa502; }
.route-tag.no-toll { background: rgba(0, 255, 136, 0.15); color: #00ff88; }
.route-tag.slower { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
.route-tag.faster { background: rgba(0, 255, 136, 0.15); color: #00ff88; }

/* Route Comparison Overlay */
.route-comparison-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.route-comparison-panel {
  width: 100%;
  max-width: 900px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px;
  background: rgba(15, 15, 25, 0.98) !important;
}
.comparison-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.comparison-panel-header h3 { font-size: 18px; font-weight: 600; }
.comparison-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.comparison-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1fr 1fr 1fr;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  align-items: center;
}
.comparison-row.header {
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
  color: #71717a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
.comparison-row:not(.header) {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.2s;
}
.comparison-row:not(.header):hover { background: rgba(255, 255, 255, 0.05); }
.comparison-row.selected { background: rgba(0, 255, 136, 0.08); border-color: rgba(0, 255, 136, 0.2); }
.comp-col { font-size: 13px; color: #e4e4e7; }
.comp-col.label { font-weight: 600; }
.comp-select-btn {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #a1a1aa;
  font-family: 'Kanit', sans-serif;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.comp-select-btn:hover { background: rgba(0, 255, 136, 0.15); color: #00ff88; }
.comp-select-btn.active { background: rgba(0, 255, 136, 0.2); border-color: #00ff88; color: #00ff88; }
.comparison-summary { margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.summary-badges { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.summary-badge { font-size: 13px; font-weight: 500; padding: 6px 12px; background: rgba(255, 255, 255, 0.03); border-radius: 8px; }

/* Route Alternative Labels on Map */
:global(.route-label-marker) { background: none !important; border: none !important; }
:global(.route-alt-label) {
  padding: 8px 14px;
  border-radius: 12px;
  text-align: center;
  color: white;
  font-family: 'Kanit', sans-serif;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: all 0.2s;
  pointer-events: auto;
}
:global(.route-alt-label:hover) { transform: scale(1.05); }
:global(.alt-label-text) { display: block; font-size: 12px; font-weight: 600; }
:global(.alt-label-info) { display: block; font-size: 11px; opacity: 0.9; }
:global(.alt-toll-badge) { display: block; font-size: 10px; margin-top: 4px; padding: 2px 6px; background: rgba(0, 0, 0, 0.3); border-radius: 6px; }
:global(.alt-no-toll) { display: block; font-size: 10px; margin-top: 4px; }

/* Alternative Route Label (on map after calculation) */
:global(.gmap-alt-label) {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 8px;
  text-align: center;
  font-family: 'Kanit', sans-serif;
  background: rgba(15, 15, 25, 0.9);
  backdrop-filter: blur(10px);
  border-left: 3px solid var(--alt-color, #3b82f6);
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.15s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
}
:global(.gmap-alt-label:hover) {
  background: rgba(25, 25, 40, 0.95);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
  transform: translateY(-1px);
}
:global(.gmap-alt-name) {
  font-size: 12px;
  font-weight: 600;
  color: var(--alt-color, #3b82f6);
  line-height: 1.4;
}
:global(.gmap-alt-sub) {
  font-size: 10px;
  color: #9ca3af;
  line-height: 1.3;
}

/* Navigation Alternative Labels (during navigation) */
:global(.nav-alt-label) {
  display: inline-block;
  padding: 5px 10px;
  border-radius: 8px;
  text-align: center;
  font-family: 'Kanit', sans-serif;
  background: rgba(15, 15, 25, 0.88);
  backdrop-filter: blur(8px);
  border-left: 3px solid;
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.15s ease;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
}
:global(.nav-alt-label:hover) {
  background: rgba(25, 25, 40, 0.95);
  transform: translateY(-1px);
}
:global(.nav-alt-name) {
  display: block;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
}
:global(.nav-alt-info) {
  display: block;
  font-size: 9px;
  color: #9ca3af;
  line-height: 1.3;
}

/* Custom Waypoint Markers */
:global(.custom-waypoint-marker) { background: none !important; border: none !important; }
:global(.waypoint-pin) { position: relative; display: flex; flex-direction: column; align-items: center; cursor: grab; }
:global(.waypoint-pin:active) { cursor: grabbing; }
:global(.waypoint-dot) { width: 18px; height: 18px; border-radius: 50%; background: linear-gradient(135deg, #ec4899, #db2777); border: 3px solid white; box-shadow: 0 0 10px rgba(236, 72, 153, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3); transition: transform 0.2s; }
:global(.waypoint-pin:hover .waypoint-dot) { transform: scale(1.2); }
:global(.waypoint-label) { position: absolute; top: 22px; left: 50%; transform: translateX(-50%); background: rgba(15, 15, 25, 0.9); color: #f472b6; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-family: 'Kanit', sans-serif; font-weight: 600; white-space: nowrap; border: 1px solid rgba(236, 72, 153, 0.3); pointer-events: none; }

/* Search Pin */
:global(.search-pin) {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 28px;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4));
}
:global(.search-pin-label) {
  margin-top: -4px;
  padding: 3px 10px;
  background: rgba(15, 15, 25, 0.95);
  border: 1px solid rgba(0, 255, 136, 0.3);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #00ff88;
  white-space: nowrap;
  font-family: 'Kanit', sans-serif;
}

/* Trip Cost Summary Card */
.trip-cost-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 14px;
  margin-top: 10px;
}
.trip-cost-card h4 { font-size: 0.85rem; margin-bottom: 10px; color: rgba(255,255,255,0.9); }
.cost-rows { display: flex; flex-direction: column; gap: 6px; }
.cost-row { display: flex; justify-content: space-between; align-items: center; }
.cost-row.sub { justify-content: flex-end; }
.cost-row.sub span { font-size: 0.7rem; color: rgba(255,255,255,0.4); }
.cost-label { font-size: 0.78rem; color: rgba(255,255,255,0.7); }
.cost-value { font-size: 0.85rem; font-weight: 600; color: #00ff88; }
.cost-value.no-toll { color: rgba(255,255,255,0.5); font-weight: 400; }
.cost-divider { border-top: 1px dashed rgba(255,255,255,0.1); margin: 6px 0; }
.cost-row.total .cost-label { font-size: 0.88rem; font-weight: 600; color: rgba(255,255,255,0.95); }
.cost-row.total .cost-value { font-size: 1.05rem; font-weight: 700; color: #00ff88; }

/* Day mode - Trip Cost */
.day-mode .trip-cost-card { background: rgba(242,238,232,0.9); border-color: rgba(100,80,60,0.1); }
.day-mode .trip-cost-card h4 { color: #1e1b18; }
.day-mode .cost-label { color: #5c5349; }
.day-mode .cost-value { color: #00875a; }
.day-mode .cost-value.no-toll { color: #8a7e74; }
.day-mode .cost-row.sub span { color: #8a7e74; }
.day-mode .cost-divider { border-color: rgba(100,80,60,0.12); }
.day-mode .cost-row.total .cost-label { color: #1e1b18; }
.day-mode .cost-row.total .cost-value { color: #006a48; }

/* Turn Preview in Route Summary */
.turn-preview-section {
  margin-bottom: 20px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
}
.turn-preview-section h4 {
  font-size: 13px;
  font-weight: 600;
  color: #a1a1aa;
  margin-bottom: 12px;
}
.turn-preview-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.turn-preview-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
}
.turn-preview-icon { font-size: 18px; width: 28px; text-align: center; }
.turn-preview-info { flex: 1; display: flex; justify-content: space-between; align-items: center; }
.turn-preview-text { font-size: 13px; color: #e4e4e7; }
.turn-preview-dist { font-size: 11px; color: #71717a; font-family: 'JetBrains Mono', monospace; }
.turn-preview-more { text-align: center; font-size: 12px; color: #71717a; padding: 6px; }

/* Multi-stop Progress Dots */
.stop-dots-bar {
  display: flex; align-items: center; gap: 0;
  padding: 6px 16px; margin: 4px auto; width: fit-content;
  max-width: 90%;
}
.stop-dot {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 700; flex-shrink: 0;
  transition: all 0.3s ease;
}
.stop-dot.done {
  background: rgba(0, 255, 136, 0.2); border: 2px solid #00ff88;
}
.stop-dot.current {
  background: rgba(59, 130, 246, 0.2); border: 2px solid #3b82f6;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);
  animation: dot-current-pulse 1.5s ease-in-out infinite;
}
.stop-dot.pending {
  background: rgba(255, 255, 255, 0.05); border: 2px solid rgba(255, 255, 255, 0.15);
  color: #71717a;
}
.dot-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  background: #3b82f6;
  animation: dot-inner-pulse 1s ease-in-out infinite;
}
.dot-num { font-family: 'JetBrains Mono', monospace; }
.stop-line {
  flex: 1; min-width: 12px; max-width: 40px; height: 2px;
  background: rgba(255, 255, 255, 0.1);
  transition: background 0.3s;
}
.stop-line.done { background: rgba(0, 255, 136, 0.4); }
@keyframes dot-current-pulse { 0%, 100% { box-shadow: 0 0 6px rgba(59, 130, 246, 0.3); } 50% { box-shadow: 0 0 14px rgba(59, 130, 246, 0.6); } }
@keyframes dot-inner-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.3); opacity: 0.6; } }

/* Speed Zone Arc on Speedometer */
.speed-arc {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  pointer-events: none;
}

/* G-Force + Altitude + Fuel Efficiency */
.gforce-alt {
  padding: 6px 10px !important; display: flex; flex-direction: column; gap: 4px;
}
.gforce-row {
  display: flex; align-items: center; gap: 6px;
}
.gforce-label {
  font-size: 11px; font-weight: 800; color: #a1a1aa;
  font-family: 'JetBrains Mono', monospace; min-width: 12px;
}
.gforce-bar-bg {
  flex: 1; height: 6px; border-radius: 3px;
  background: rgba(255, 255, 255, 0.06); overflow: hidden;
}
.gforce-bar-fill {
  height: 100%; border-radius: 3px;
  transition: width 0.3s ease, background 0.3s ease;
}
.gforce-val {
  font-size: 11px; font-weight: 700;
  font-family: 'JetBrains Mono', monospace; min-width: 32px; text-align: right;
}
.alt-row {
  display: flex; align-items: center; gap: 6px; font-size: 11px;
}
.alt-icon { font-size: 12px; }
.alt-val {
  font-family: 'JetBrains Mono', monospace; font-weight: 600;
  color: #d4d4d8;
}
.fuel-eff {
  margin-left: auto; font-family: 'JetBrains Mono', monospace;
  font-weight: 600; color: #f59e0b; font-size: 10px;
}

/* Nearby Amenities Panel */
.amenities-panel {
  position: absolute; bottom: 200px; left: 20px; z-index: 1060;
  padding: 12px !important; width: 200px; max-width: calc(100% - 40px);
}
.amenities-title {
  font-size: 12px; font-weight: 600; color: #e4e4e7;
  margin-bottom: 8px; text-align: center;
}
.amenities-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;
  margin-bottom: 8px;
}
.amenity-btn {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 8px 4px; border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px; background: rgba(255, 255, 255, 0.03);
  cursor: pointer; color: #e4e4e7; font-family: 'Kanit', sans-serif;
  font-size: 10px; transition: all 0.15s;
}
.amenity-btn:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.15); }
.amenity-loading {
  text-align: center; font-size: 11px; color: #a1a1aa;
  padding: 8px 0; animation: blink 1s ease-in-out infinite;
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.amenity-results {
  display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;
}
.amenity-result {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px;
  cursor: pointer; font-family: 'Kanit', sans-serif; color: #e4e4e7;
  transition: all 0.15s;
}
.amenity-result:hover { background: rgba(0, 255, 136, 0.08); border-color: rgba(0, 255, 136, 0.2); }
.amenity-name {
  font-size: 11px; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 120px;
}
.amenity-dist {
  font-size: 10px; color: #71717a; font-family: 'JetBrains Mono', monospace;
  flex-shrink: 0;
}
.amenity-close {
  width: 100%; padding: 6px; border: none; border-radius: 6px;
  background: rgba(255, 255, 255, 0.06); color: #a1a1aa;
  font-family: 'Kanit', sans-serif; font-size: 11px; cursor: pointer;
}

/* Nav Action Buttons - Notify & Amenity */
.nav-btn-notify { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.nav-btn-notify:hover { background: rgba(59, 130, 246, 0.25); }
.nav-btn-amenity { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
.nav-btn-amenity:hover { background: rgba(168, 85, 247, 0.25); }

/* ==================== RESPONSIVE - ADVANCED FEATURES ==================== */

@media (max-width: 1024px) {
  .route-selector-overlay { width: 350px; padding-top: 40px; }
}

@media (max-width: 768px) {
  .search-section { padding: 8px 16px; }
  .search-input { padding: 10px 36px 10px 34px; font-size: 13px; }
  .route-preferences { padding: 8px 16px; }
  .pref-chips { gap: 4px; }
  .pref-chip { font-size: 11px; padding: 5px 8px; }
  .pref-toggles { gap: 4px; }
  .pref-toggle-item { font-size: 11px; }
  .route-selector-overlay {
    width: 100%;
    padding: 10px;
    padding-top: 30px;
    background: rgba(0, 0, 0, 0.7);
  }
  .route-selector-panel { padding: 14px; }
  .route-option-stats { gap: 10px; flex-wrap: wrap; }
  .turn-by-turn-panel {
    min-width: auto;
    max-width: calc(100% - 30px);
    right: 10px;
    left: auto;
    padding: 10px 14px;
  }
  .turn-icon { font-size: 24px; }
  .turn-icon-wrap { width: 40px; height: 40px; border-radius: 12px; }
  .turn-text { font-size: 14px; }
  .nav-route-progress-strip { top: 34px; padding: 4px 10px; }
  .route-progress-info { font-size: 10px; }
  .celebration-text { font-size: 20px; }
  .speed-limit-warning { top: 40px; right: 10px; padding: 8px 12px; }
  .speed-warning-icon { font-size: 24px; }
  .speed-warning-text { font-size: 12px; }
  .saved-routes-panel { padding: 8px 16px; max-height: 150px; }
  .comparison-row { grid-template-columns: 1.2fr 1fr 1fr 1fr; }
  .comparison-row .comp-col:nth-child(5),
  .comparison-row .comp-col:nth-child(6) { display: none; }
  .route-comparison-panel { padding: 16px; max-width: 95%; }
  .direct-nav-bar { flex-direction: column; gap: 8px; }
  .btn-navigate-direct { width: 100%; justify-content: center; }
}

@media (max-width: 480px) {
  .pref-chips { flex-direction: column; }
  .pref-chip { width: 100%; justify-content: center; }
  .route-option-stats { flex-direction: column; gap: 4px; }
  .turn-by-turn-panel { top: 30px; padding: 8px 12px; }
  .turn-icon { font-size: 20px; }
  .turn-text { font-size: 12px; }
  .turn-distance { font-size: 11px; }
  .comparison-row { grid-template-columns: 1fr 1fr 1fr; gap: 6px; padding: 8px 10px; }
  .comparison-row .comp-col:nth-child(4) { display: none; }
}

/* ==================== FLOATING MAP PANELS ==================== */

/* Floating Search Bar - Top Right */
.map-search-float {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 1002;
  width: 380px;
  max-width: calc(100% - 32px);
  padding: 10px 14px;
  border-radius: 14px;
}
.map-search-float .search-input {
  background: rgba(0, 0, 0, 0.5);
  border-color: rgba(255, 255, 255, 0.15);
}
.map-search-float .search-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  border-radius: 12px;
}
.map-search-float .direct-nav-bar {
  margin-top: 8px;
}

/* Recent Searches */
.recent-searches {
  padding: 8px 0;
}
.recent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px 8px;
  font-size: 12px;
  color: #a1a1aa;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 4px;
}
.recent-clear-btn {
  background: none;
  border: none;
  color: #ef4444;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Kanit', sans-serif;
}
.recent-clear-btn:hover {
  background: rgba(239, 68, 68, 0.15);
}

/* Floating Route Preferences - Left side below map-stats */
.map-prefs-float {
  position: absolute;
  top: 110px;
  left: 16px;
  z-index: 1000;
  padding: 6px 8px;
  border-radius: 24px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
}
.float-pref-chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  align-items: center;
}
.float-pref-chip {
  padding: 5px 10px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #a1a1aa;
  font-family: 'Kanit', sans-serif;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.float-pref-chip:hover { background: rgba(255, 255, 255, 0.12); color: #e4e4e7; }
.float-pref-chip.active {
  background: rgba(0, 255, 136, 0.18);
  border-color: rgba(0, 255, 136, 0.4);
  color: #00ff88;
}
.float-pref-toggles {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: 2px;
  padding-left: 6px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}
.float-toggle-chip {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.float-toggle-chip:hover { background: rgba(255, 255, 255, 0.12); }
.float-toggle-chip.active {
  background: rgba(0, 255, 136, 0.18);
  border-color: rgba(0, 255, 136, 0.4);
  box-shadow: 0 0 8px rgba(0, 255, 136, 0.2);
}
.float-toggle-chip.gps-refresh-btn.spinning {
  animation: spin-gps 1s linear infinite;
}
@keyframes spin-gps {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Floating Vehicle Toggle */
.map-vehicle-float {
  position: absolute;
  bottom: 30px;
  right: 70px;
  z-index: 1000;
  padding: 6px;
  border-radius: 12px;
}
.float-vehicle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: #e4e4e7;
  font-family: 'Kanit', sans-serif;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.float-vehicle-btn:hover { background: rgba(255, 255, 255, 0.1); }
.float-vehicle-btn.fuel { border-color: rgba(255, 165, 2, 0.3); }
.float-vehicle-btn.ev { border-color: rgba(59, 130, 246, 0.3); }
.float-vehicle-label { font-weight: 500; }
.float-station-selects {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
.float-station-selects select {
  flex: 1;
  padding: 5px 8px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #e4e4e7;
  font-family: 'Kanit', sans-serif;
  font-size: 11px;
}

/* Floating Saved Routes */
.map-saved-float {
  position: absolute;
  bottom: 30px;
  left: 16px;
  z-index: 1000;
  padding: 4px;
  border-radius: 10px;
}
.float-saved-toggle {
  padding: 6px 14px;
  background: rgba(255, 165, 2, 0.12);
  border: 1px solid rgba(255, 165, 2, 0.25);
  border-radius: 8px;
  color: #ffa502;
  font-family: 'Kanit', sans-serif;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.float-saved-toggle:hover { background: rgba(255, 165, 2, 0.2); }
.float-saved-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  max-height: 180px;
  overflow-y: auto;
}
.float-saved-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: #e4e4e7;
  font-family: 'Kanit', sans-serif;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.float-saved-item:hover { background: rgba(0, 255, 136, 0.08); }
.float-saved-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.float-saved-meta { font-size: 10px; color: #71717a; white-space: nowrap; }
.float-saved-del {
  background: none;
  border: none;
  color: #71717a;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.float-saved-del:hover { color: #ff6b6b; }

/* ==================== ALONG-ROUTE POI ==================== */
.map-poi-float {
  position: absolute;
  top: 110px;
  right: 16px;
  z-index: 1000;
  padding: 10px;
  border-radius: 14px;
  max-width: 340px;
  font-family: 'Kanit', sans-serif;
}
.poi-header {
  display: flex;
  gap: 6px;
  align-items: center;
}
.poi-close-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}
.poi-close-btn:hover {
  background: rgba(239, 68, 68, 0.25);
}
.poi-search-btn {
  width: 100%;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(0, 255, 136, 0.12);
  border: 1px solid rgba(0, 255, 136, 0.3);
  color: #00ff88;
  font-size: 13px;
  font-family: 'Kanit', sans-serif;
  cursor: pointer;
  transition: all 0.2s;
}
.poi-search-btn:hover { background: rgba(0, 255, 136, 0.22); }
.poi-search-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.poi-filter-chips {
  display: flex;
  gap: 4px;
  margin: 8px 0;
  flex-wrap: wrap;
}
.poi-chip {
  padding: 4px 10px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #a1a1aa;
  font-size: 11px;
  font-family: 'Kanit', sans-serif;
  cursor: pointer;
  transition: all 0.2s;
}
.poi-chip.active {
  background: rgba(0, 255, 136, 0.18);
  border-color: rgba(0, 255, 136, 0.4);
  color: #00ff88;
}
.poi-chip.attraction {
  background: rgba(168, 85, 247, 0.1);
  border-color: rgba(168, 85, 247, 0.2);
  color: #c4b5fd;
}
.poi-chip.attraction.active {
  background: rgba(168, 85, 247, 0.25);
  border-color: rgba(168, 85, 247, 0.5);
  color: #a855f7;
}
.poi-filter-section {
  margin-bottom: 8px;
}
.poi-filter-label {
  font-size: 10px;
  color: #71717a;
  margin-bottom: 4px;
  display: block;
}
.poi-results-summary {
  font-size: 11px;
  color: #a1a1aa;
  margin-bottom: 6px;
}
.poi-list-compact {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.poi-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.poi-item:hover { background: rgba(255, 255, 255, 0.06); }
.poi-type-icon { font-size: 18px; flex-shrink: 0; }
.poi-item-info { display: flex; flex-direction: column; min-width: 0; }
.poi-name {
  font-size: 12px;
  color: #e4e4e7;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.poi-meta {
  font-size: 10px;
  color: #71717a;
}
:global(.poi-marker-wrap) { background: none !important; border: none !important; }
:global(.poi-pin) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50% 50% 50% 4px;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
  font-size: 16px;
  cursor: pointer;
  transform: rotate(-45deg);
}
:global(.poi-pin) > * { transform: rotate(45deg); }
:global(.poi-pin.gas) { background: linear-gradient(135deg, #f97316, #ea580c); }
:global(.poi-pin.convenience) { background: linear-gradient(135deg, #22c55e, #16a34a); }
:global(.poi-pin.restaurant) { background: linear-gradient(135deg, #ef4444, #dc2626); }
:global(.poi-pin.cafe) { background: linear-gradient(135deg, #a16207, #92400e); }
:global(.poi-pin.ev_charging) { background: linear-gradient(135deg, #3b82f6, #2563eb); }
:global(.poi-pin.viewpoint) { background: linear-gradient(135deg, #ec4899, #db2777); }
:global(.poi-pin.attraction) { background: linear-gradient(135deg, #a855f7, #9333ea); }
:global(.poi-pin.temple) { background: linear-gradient(135deg, #f59e0b, #d97706); }
:global(.poi-pin.park) { background: linear-gradient(135deg, #10b981, #059669); }
:global(.poi-pin.museum) { background: linear-gradient(135deg, #6366f1, #4f46e5); }
:global(.poi-popup) { font-family: 'Kanit', sans-serif; }
:global(.poi-popup-header) { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
:global(.poi-popup-meta p) { margin: 2px 0; font-size: 12px; color: #d4d4d8; }

/* ==================== RESPONSIVE - FLOATING PANELS ==================== */
@media (max-width: 1024px) {
  .map-search-float { width: 340px; top: 12px; right: 12px; }
  .map-prefs-float { top: 68px; left: 12px; padding: 6px; }
  .float-pref-chip { font-size: 10px; padding: 4px 8px; }
  .float-toggle-chip { width: 28px; height: 28px; font-size: 12px; }
}

@media (max-width: 768px) {
  .map-search-float { left: 10px; right: 10px; width: auto; top: 10px; padding: 8px 10px; }
  .map-prefs-float {
    top: auto;
    bottom: 80px;
    left: 10px;
    right: auto;
    max-width: calc(100% - 90px);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .float-pref-chips { flex-wrap: nowrap; }
  .float-pref-chip { font-size: 10px; padding: 4px 7px; }
  .map-poi-float { top: 90px; right: 10px; max-width: 300px; }
  .map-vehicle-float { bottom: 20px; right: 10px; }
  .map-saved-float { bottom: 20px; left: 10px; max-width: calc(100% - 90px); }
}

@media (max-width: 480px) {
  .map-search-float { left: 8px; right: 8px; width: auto; top: 8px; padding: 6px 8px; }
  .map-search-float .search-input { padding: 8px 32px 8px 30px; font-size: 12px; }
  .map-prefs-float {
    bottom: 65px;
    left: 8px;
    right: 8px;
    max-width: none;
    padding: 4px 6px;
    overflow-x: auto;
  }
  .float-pref-chip { font-size: 9px; padding: 3px 6px; }
  .float-toggle-chip { width: 26px; height: 26px; font-size: 11px; }
  .map-poi-float { top: 80px; right: 8px; max-width: 280px; padding: 8px; }
  .poi-list-compact { display: none; }
  .poi-results-summary { display: none; }
  .poi-chip { font-size: 10px; padding: 3px 8px; }
  .map-vehicle-float { bottom: 14px; }
  .map-saved-float { bottom: 14px; max-width: calc(100% - 80px); }
}

/* ==================== TRAFFIC LEGEND ==================== */
.traffic-legend {
  position: absolute;
  top: 160px;
  left: 16px;
  z-index: 1000;
  padding: 10px 14px;
  border-radius: 16px;
  min-width: 140px;
}
.traffic-legend-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.traffic-legend-icon { font-size: 14px; }
.traffic-legend-title {
  font-size: 12px;
  font-weight: 600;
  color: #e4e4e7;
  flex: 1;
}
.traffic-legend-summary {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
}
.traffic-legend-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.traffic-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.traffic-legend-color {
  width: 20px;
  height: 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.traffic-legend-color.traffic-moderate {
  background: repeating-linear-gradient(
    90deg,
    #f59e0b 0px,
    #f59e0b 6px,
    transparent 6px,
    transparent 10px
  ) !important;
}
.traffic-legend-color.traffic-heavy,
.traffic-legend-color.traffic-severe {
  box-shadow: 0 0 8px var(--glow-color, currentColor);
}
.traffic-legend-color.traffic-heavy { --glow-color: #ef4444; }
.traffic-legend-color.traffic-severe { --glow-color: #991b1b; }
.traffic-legend-label {
  font-size: 11px;
  color: #a1a1aa;
  flex: 1;
}
.traffic-legend-pct {
  font-size: 10px;
  color: #71717a;
  font-weight: 500;
}

/* ==================== TRAFFIC INCIDENTS ==================== */
.incidents-panel {
  position: absolute;
  bottom: 15px;
  left: 16px;
  z-index: 1050;
  width: 300px;
  max-height: 300px;
  padding: 0;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.incidents-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.incidents-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #e4e4e7;
}

.incidents-icon { font-size: 16px; }

.incidents-badge {
  background: #ef4444;
  color: white;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}

.incidents-actions {
  display: flex;
  gap: 6px;
}

.incidents-refresh,
.incidents-close {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #a1a1aa;
  transition: all 0.2s ease;
}

.incidents-refresh:hover,
.incidents-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e4e4e7;
}


.incidents-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 30px 20px;
  color: #71717a;
  font-size: 13px;
}

.incidents-empty .empty-icon {
  font-size: 28px;
  margin-bottom: 4px;
}

.btn-check-incidents {
  margin-top: 10px;
  padding: 8px 16px;
  background: rgba(0, 255, 136, 0.1);
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 8px;
  color: #00ff88;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-check-incidents:hover {
  background: rgba(0, 255, 136, 0.15);
}

.incidents-summary {
  padding: 10px 14px;
  background: rgba(251, 191, 36, 0.1);
  border-bottom: 1px solid rgba(251, 191, 36, 0.15);
  font-size: 12px;
  font-weight: 500;
  color: #fbbf24;
}

.incident-delay-tag {
  display: inline-block;
  margin-top: 4px;
  padding: 2px 8px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 4px;
  font-size: 10px;
  color: #f87171;
}

.incidents-list {
  flex: 1;
  overflow-y: auto;
  max-height: 280px;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 255, 136, 0.3) transparent;
}

.incidents-list::-webkit-scrollbar {
  width: 5px;
}

.incidents-list::-webkit-scrollbar-track {
  background: transparent;
}

.incidents-list::-webkit-scrollbar-thumb {
  background: rgba(0, 255, 136, 0.3);
  border-radius: 3px;
}

.incidents-list::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 255, 136, 0.5);
}

.incident-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.incident-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.incident-item.on-route {
  background: rgba(251, 191, 36, 0.08);
  border-left: 3px solid #fbbf24;
}

.incident-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}

.incident-info {
  flex: 1;
  min-width: 0;
}

.incident-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.incident-name {
  font-size: 13px;
  font-weight: 600;
  color: #e4e4e7;
}

.incident-severity {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 6px;
}

.incident-severity.severity-critical {
  background: rgba(220, 38, 38, 0.2);
  color: #dc2626;
}

.incident-severity.severity-major {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.incident-severity.severity-moderate {
  background: rgba(249, 115, 22, 0.2);
  color: #f97316;
}

.incident-severity.severity-minor {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
}

.incident-desc {
  font-size: 11px;
  color: #a1a1aa;
  display: block;
  margin-bottom: 4px;
}

.incident-meta {
  display: flex;
  gap: 10px;
  font-size: 10px;
  color: #71717a;
}

.incidents-footer {
  padding: 8px 14px;
  text-align: center;
  font-size: 10px;
  color: #52525b;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

/* Incident Markers on Map */
.incident-marker { background: none !important; border: none !important; }

.incident-pin {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  animation: incidentPulse 2s ease-in-out infinite;
}

@keyframes incidentPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.incident-icon { font-size: 16px; }

.incident-popup {
  min-width: 200px;
}

.incident-popup-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px 8px 0 0;
  color: white;
  font-weight: 600;
}

.incident-popup-icon { font-size: 16px; }
.incident-popup-title { font-size: 13px; }

.incident-popup-content {
  padding: 10px 12px;
}

.incident-popup-content p {
  font-size: 12px;
  color: #a1a1aa;
  margin-bottom: 8px;
}

.incident-popup-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: #71717a;
}

.incident-popup-time {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 10px;
  color: #52525b;
}

.spinner-small {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: #00ff88;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Mobile adjustments */
@media (max-width: 768px) {
  .incidents-panel {
    width: calc(100% - 32px);
    max-width: 360px;
    right: 16px;
    top: 70px;
  }
}

@media (max-width: 768px) {
  .incidents-panel {
    bottom: 80px;
    left: 10px;
    width: 280px;
    max-height: 300px;
  }
}

@media (max-width: 480px) {
  .incidents-panel {
    width: calc(100% - 16px);
    left: 8px;
    bottom: 70px;
    max-height: 250px;
  }

  .reroute-modal {
    width: calc(100% - 32px);
  }
}

/* Reroute Suggestion Modal */
.reroute-modal {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2000;
  width: 320px;
  padding: 20px;
  border-radius: 16px;
  text-align: center;
  animation: modalPop 0.3s ease;
}

@keyframes modalPop {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

.reroute-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.reroute-content h4 {
  font-size: 16px;
  font-weight: 600;
  color: #f4f4f5;
  margin-bottom: 6px;
}

.reroute-content p {
  font-size: 13px;
  color: #fbbf24;
  margin-bottom: 12px;
}

.reroute-incidents {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.reroute-incident-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 8px;
  font-size: 12px;
  color: #e4e4e7;
}

.reroute-incident-item .delay-badge {
  margin-left: auto;
  padding: 2px 6px;
  background: rgba(239, 68, 68, 0.2);
  border-radius: 4px;
  font-size: 10px;
  color: #f87171;
}

.reroute-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-reroute-accept {
  padding: 12px;
  background: #00ff88;
  border: none;
  border-radius: 10px;
  color: #0a0a0f;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-reroute-accept:hover {
  background: #00e67a;
}

.btn-reroute-dismiss {
  padding: 10px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: #a1a1aa;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-reroute-dismiss:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e4e4e7;
}

/* ==================== 2-OPT OPTIMIZATION ==================== */
.btn-optimize-2opt {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
  color: white;
}
.btn-optimize-2opt:hover:not(:disabled) {
  background: linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%);
  transform: translateY(-1px);
}
.btn-optimize-2opt:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Real Distance Toggle Switch */
.real-dist-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 10px 14px;
  user-select: none;
  flex: 1 1 calc(50% - 4px);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(109, 40, 217, 0.05) 100%);
  border-radius: 12px;
  border: 1px solid rgba(139, 92, 246, 0.2);
  transition: all 0.3s ease;
}
.real-dist-toggle:hover {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(109, 40, 217, 0.1) 100%);
  border-color: rgba(139, 92, 246, 0.4);
  transform: translateY(-1px);
}
.real-dist-toggle.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
.real-dist-toggle input[type="checkbox"] {
  display: none;
}
.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  background: rgba(113, 113, 122, 0.4);
  border-radius: 12px;
  transition: all 0.3s ease;
  flex-shrink: 0;
}
.real-dist-toggle input:checked + .toggle-switch {
  background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.4);
}
.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  background: white;
  border-radius: 50%;
  transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}
.real-dist-toggle input:checked + .toggle-switch .toggle-knob {
  left: 23px;
}
.toggle-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.toggle-text {
  font-size: 12px;
  font-weight: 600;
  color: #e4e4e7;
  white-space: nowrap;
}
.toggle-hint {
  font-size: 10px;
  color: #a1a1aa;
  white-space: nowrap;
}
.real-dist-toggle input:checked ~ .toggle-label .toggle-hint {
  color: #c4b5fd;
}

/* Optimization Result Modal */
.optimization-result-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.optimization-result-modal {
  max-width: 360px;
  width: 100%;
  border-radius: 20px;
  overflow: hidden;
  animation: modalSlideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes modalSlideUp {
  from { opacity: 0; transform: translateY(30px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.opt-result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.opt-result-icon { font-size: 24px; }
.opt-result-header h3 {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
  color: #e4e4e7;
  margin: 0;
}
.opt-close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  border: none;
  color: #a1a1aa;
  cursor: pointer;
  transition: all 0.2s;
}
.opt-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}
.opt-close-btn svg { width: 16px; height: 16px; }

.opt-result-body {
  padding: 24px 20px;
}
.opt-comparison {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 20px;
}
.opt-before, .opt-after {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.opt-label {
  font-size: 11px;
  color: #71717a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.opt-value {
  font-size: 20px;
  font-weight: 700;
  color: #e4e4e7;
}
.opt-before .opt-value { color: #ef4444; }
.opt-after .opt-value { color: #00ff88; }
.opt-arrow {
  font-size: 24px;
  color: #71717a;
}

.opt-improvement {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  color: #00ff88;
}
.opt-improvement:not(.positive) {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  color: #a1a1aa;
}
.opt-improvement-icon { font-size: 18px; }
.opt-saved {
  font-size: 12px;
  font-weight: 400;
  color: #71717a;
}

.opt-result-footer {
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: center;
}
.opt-result-footer .btn {
  min-width: 100px;
}

/* Traffic Legend Responsive */
@media (max-width: 768px) {
  .traffic-legend {
    top: auto;
    bottom: 140px;
    left: 10px;
    min-width: 120px;
    padding: 8px 10px;
  }
  .traffic-legend-header { margin-bottom: 6px; padding-bottom: 6px; }
  .traffic-legend-title { font-size: 11px; }
  .traffic-legend-items { gap: 4px; }
  .traffic-legend-label { font-size: 10px; }
}

@media (max-width: 480px) {
  .traffic-legend {
    bottom: 120px;
    left: 8px;
    padding: 6px 8px;
    min-width: 100px;
  }
  .traffic-legend-icon { font-size: 12px; }
  .traffic-legend-title { font-size: 10px; }
  .traffic-legend-color { width: 16px; height: 5px; }
  .traffic-legend-label { font-size: 9px; }
  .traffic-legend-pct { font-size: 9px; }

  .optimization-result-modal { max-width: 320px; }
  .opt-result-header { padding: 12px 16px; }
  .opt-result-body { padding: 20px 16px; }
  .opt-value { font-size: 18px; }
}

/* ==================== QUICK ADD FROM CLIPBOARD ==================== */
.quick-add-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: modalFadeIn 0.2s ease;
}
.quick-add-modal {
  max-width: 450px;
  width: 100%;
  border-radius: 20px;
  overflow: hidden;
  animation: modalSlideIn 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.qa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.qa-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.qa-icon { font-size: 20px; }
.qa-title h3 {
  font-size: 16px;
  font-weight: 600;
  color: #e4e4e7;
  margin: 0;
}
.qa-body {
  padding: 20px;
}
.qa-input-preview {
  margin-bottom: 16px;
}
.qa-label {
  display: block;
  font-size: 11px;
  color: #71717a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}
.qa-input-text {
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  font-size: 13px;
  color: #a1a1aa;
  max-height: 60px;
  overflow-y: auto;
  word-break: break-all;
}
.qa-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 30px;
  color: #a1a1aa;
}
.qa-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid rgba(0, 255, 136, 0.2);
  border-top-color: #00ff88;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.qa-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  color: #ef4444;
}
.qa-error-icon { font-size: 18px; }
.qa-results-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}
.qa-results-hint {
  font-size: 11px;
  color: #71717a;
  text-align: center;
  padding: 4px 0 8px;
}
.qa-result {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.qa-result:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.15);
}
.qa-result.selected {
  background: rgba(0, 255, 136, 0.1);
  border-color: rgba(0, 255, 136, 0.4);
  box-shadow: 0 0 0 2px rgba(0, 255, 136, 0.15);
}
.qa-result-number {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #a1a1aa;
  flex-shrink: 0;
}
.qa-result.selected .qa-result-number {
  background: rgba(0, 255, 136, 0.2);
  color: #00ff88;
}
.qa-result-info {
  flex: 1;
  min-width: 0;
}
.qa-result-name {
  font-size: 14px;
  font-weight: 600;
  color: #e4e4e7;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qa-result-address {
  font-size: 11px;
  color: #a1a1aa;
  margin-bottom: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.qa-result-coords {
  font-size: 10px;
  color: #71717a;
  font-family: 'JetBrains Mono', monospace;
}
.qa-result.selected .qa-result-coords {
  color: #00ff88;
}
.qa-result-check {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 255, 136, 0.2);
  border-radius: 50%;
  color: #00ff88;
  font-size: 14px;
  flex-shrink: 0;
}
.qa-footer {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.qa-footer .btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.qa-footer .btn kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: inherit;
  opacity: 0.7;
}

@media (max-width: 480px) {
  .quick-add-modal { max-width: 95%; }
  .qa-header { padding: 12px 16px; }
  .qa-body { padding: 16px; }
  .qa-footer { padding: 12px 16px; }
  .qa-footer .btn { padding: 10px 12px; font-size: 13px; }
}

/* ==================== KEYBOARD HELP MODAL ==================== */
.keyboard-help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: modalFadeIn 0.25s ease;
}
.keyboard-help-modal {
  max-width: 600px;
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  border-radius: 20px;
  animation: modalSlideIn 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.kbh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.kbh-header h3 {
  font-size: 18px;
  font-weight: 600;
  color: #e4e4e7;
  margin: 0;
}
.kbh-body {
  padding: 16px 20px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.kbh-section h4 {
  font-size: 12px;
  font-weight: 600;
  color: #00ff88;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(0, 255, 136, 0.2);
}
.kbh-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kbh-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #a1a1aa;
}
.kbh-item kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 22px;
  padding: 0 6px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  color: #e4e4e7;
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.3);
}
.kbh-item span {
  flex: 1;
  color: #d4d4d8;
}
.kbh-footer {
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  text-align: center;
  font-size: 12px;
  color: #71717a;
}
.kbh-footer kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: #e4e4e7;
  margin: 0 2px;
}

@media (max-width: 600px) {
  .kbh-body {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .keyboard-help-modal { max-width: 95%; }
}

/* Point card selected state */
.point-card.keyboard-selected {
  background: rgba(59, 130, 246, 0.15) !important;
  border-color: rgba(59, 130, 246, 0.5) !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3), inset 0 0 20px rgba(59, 130, 246, 0.1) !important;
}
</style>