<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto, beforeNavigate } from '$app/navigation';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import type { TurnInstruction, DeliveryRecord, ChargingStation, OilPriceData, RoutePOI, RecentSearch, SavedRoute, TrafficIncident, VehicleType } from '$lib/types';
  import { getDistance, formatDistance, formatTime, formatETA, escapeHtml, withTimeout, calculateBearing } from '$lib/utils/geo';
  import { getTurnIcon, getTurnText, extractTurnInstructions, detectTollRoad, estimateTollCost } from '$lib/utils/navigation';
  import { getEVConsumptionAtSpeed as _getEVConsumptionAtSpeed, getEVConsumptionForRoute as _getEVConsumptionForRoute, getPriorityGradient, getPriorityLabel } from '$lib/utils/vehicle';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import AlertsPanel from '$lib/components/AlertsPanel.svelte';
  import NavigationOverlay from '$lib/components/NavigationOverlay.svelte';
  import SearchPanel from '$lib/components/SearchPanel.svelte';
  import AIChatPanel from '$lib/components/AIChatPanel.svelte';
  import AIRouteSuggestion from '$lib/components/AIRouteSuggestion.svelte';
  import type { AIRouteSuggestionData, AIChatContext } from '$lib/types';
  import { callOSRMDirect, callOSRMTable, callOSRMNearest, callOSRMMatch } from '$lib/utils/osrm';

  // Silence all console output in production
  if (browser) {
    const noop = () => {};
    console.log = noop;
    console.warn = noop;
    console.error = noop;
    console.info = noop;
    console.debug = noop;
  }

  let currentUser: any = null;

  const ENC_TABLE = ['K@','$V','Rj','X!','B~','Qm','@S','H$','Dz','L!','N~','We','F@','$T','J!','~M'];
  const DEC_TABLE: Record<string, string> = {};
  ENC_TABLE.forEach((p, i) => { DEC_TABLE[p.toLowerCase()] = i.toString(16); });
  const FK = [0xD3ADB33F,0xCAF3BAB3,0xF00DDECA,0xACEDFACE,0x8BADF00D,0xDEFEC8ED,0xC0FFEE42,0xBAAAAAAD];
  function _fr(h: number, k: number): number {
    let v = Math.imul(h ^ k, 0x45d9f3b) >>> 0;
    v = (v ^ (v >>> 16)) >>> 0;
    v = Math.imul(v, 0x119de1f3) >>> 0;
    return (v ^ (v >>> 16)) >>> 0;
  }
  function encodeUserId(id: number): string {
    let L = (id ^ 0xA5C3E1F7) >>> 0;
    let R = (Math.imul(id, 0x01000193) ^ 0x3C5A7B9D) >>> 0;
    for (const k of FK) { const f = _fr(R, k); [L, R] = [R, (L ^ f) >>> 0]; }
    const hex = L.toString(16).padStart(8, '0') + R.toString(16).padStart(8, '0');
    let s = '';
    for (const c of hex) s += ENC_TABLE[parseInt(c, 16)];
    return s;
  }
  function decodeUserId(hash: string): number {
    try {
      if (!hash || hash.length !== 32) return -1;
      let hex = '';
      for (let i = 0; i < 32; i += 2) {
        const d = DEC_TABLE[hash.substring(i, i + 2).toLowerCase()];
        if (d === undefined) return -1;
        hex += d;
      }
      let L = parseInt(hex.substring(0, 8), 16) >>> 0;
      let R = parseInt(hex.substring(8, 16), 16) >>> 0;
      if (isNaN(L) || isNaN(R)) return -1;
      for (let i = FK.length - 1; i >= 0; i--) { const f = _fr(L, FK[i]); [L, R] = [(R ^ f) >>> 0, L]; }
      const id = (L ^ 0xA5C3E1F7) >>> 0;
      const chk = (Math.imul(id, 0x01000193) ^ 0x3C5A7B9D) >>> 0;
      if (R !== chk) return -1;
      return id > 0 ? id : -1;
    } catch { return -1; }
  }

  function logout() {
    // Stop session timeout
    cleanupSessionTimeout();
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
    // Destroy globe
    disposeGlobe();
    // Destroy map
    if (map) { try { map.off(); map.remove(); } catch(e) {} map = null; }
    // Clear all user-dependent in-memory state (prevent data leaking to next user)
    deliveryPoints = [];
    optimizedRoute = null;
    routeAlternatives = [];
    markers = [];
    chargingStations = [];
    chargingStationMarkers = [];
    deliveryHistory = [];
    alongRoutePOIs = [];
    poiMarkers = [];
    mapPOIMarkers = [];
    if (weatherRadarLayer && map) { try { map.removeLayer(weatherRadarLayer); } catch(e) {} }
    weatherRadarLayer = null;
    showWeatherRadar = false;
    _gpsTraceBuffer = [];
    _matchedPosition = null;
    _poiElements.clear();
    _fetchedRegions.clear();
    _visibleMarkers.clear();
    oilPriceData = null;
    currentLocation = null;
    currentLocationMarker = null;
    headingMarkerElement = null;
    cachedRouteCoords = [];
    lastRouteIndex = 0;
    currentSpeed = 0;
    maxSpeed = 0;
    lastPosition = null;
    avgSpeedSamples = [];
    turnInstructions = [];
    alerts = [];
    selectedPoints = [];
    // Clear all user-specific localStorage keys (BEFORE nulling currentUser)
    const userId = currentUser?.id || 'guest';
    currentUser = null;
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
  const API_URL = 'https://backendrouteoptimization-production.up.railway.app/api';

  let newPoint = { name: '', address: '', lat: 13.7563, lng: 100.5018, priority: 3 };
  let isOptimizing = false;
  let showAddForm = false;
  let addPointMode = false;
  let clickMarker: any = null;

  let notification = { show: false, message: '', type: 'success' as 'success' | 'error' | 'warning' };
  let activeTab: 'points' | 'route' = 'points';
  let activePointId: number | null = null;
  let isNavigating = false;
  let mobileSidebarOpen = false;
  let mobileContentExpanded = false;
  let desktopSidebarCollapsed = false;
  let isDragMode = false;
  let lastDragUndo: { pointId: number; pointIndex: number; name: string; oldName: string; oldLat: number; oldLng: number; oldAddress?: string } | null = null;

  // Reorder mode (drag to reorder in sidebar)
  let isReorderMode = false;
  let manualOrder = false;
  let dragSourceIndex: number | null = null;
  let dragOverIndex: number | null = null;

  // ==================== GPS VARIABLES - COPIED FROM ORIGINAL ====================
  let currentLocation: { lat: number; lng: number; heading?: number | null; speed?: number | null } | null = null;
  let currentLocationMarker: any = null;
  let headingMarkerElement: HTMLElement | null = null;
  let watchId: number | null = null;
  let continuousWatchId: number | null = null; // Always-on GPS tracking for marker
  let isMapFollowing = true; // auto-follow mode like Google Maps
  let _programmaticZoom = false; // flag to distinguish user zoom from code zoom
  let currentHeading: number | null = null; // GPS heading in degrees
  let _deviceCompassHeading: number | null = null; // เข็มทิศจากเซ็นเซอร์มือถือ
  let _compassListenerAdded = false;
  let _nonNavBeamTarget = 0; // beam heading target (non-navigation)
  let _nonNavBeamCurrent = 0; // beam heading current (non-navigation, smoothed)
  let _nonNavBeamRaf: number | null = null; // rAF for non-nav beam
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
  let _navMarkerState = ''; // perf: skip marker rebuild when state unchanged
  let _lastAppliedRotation = 0; // perf: skip map rotation when < 2deg diff
  let _userMapRotation = 0; // user gesture rotation (degrees)
  let _gestureStartAngle = 0;
  let _gestureBaseRotation = 0;
  let _isGestureRotating = false;
  let _navIntervalTick = 0; // perf: stagger heavy funcs in nav interval
  let _lastCurveRouteIdx = 0; // perf: skip curve detect until moved 50 route pts
  let _headingUpMode = true; // heading-up map rotation during navigation

  // Smooth animation (Google Maps-like 60fps interpolation)
  let animFrameId: number | null = null;
  let _animFrameCount = 0;
  let animPrevLat = 0, animPrevLng = 0;
  let animTargetLat = 0, animTargetLng = 0;
  let animCurrentLat = 0, animCurrentLng = 0;
  let animPrevHeading = 0, animTargetHeading = 0, animCurrentHeading = 0;
  let animStartTime = 0;
  let animDuration = 1000;
  let animReady = false;
  let lastGpsTimestamp = 0;

  // ETA & Time
  let estimatedArrivalTime: Date | null = null;
  let navigationStartTime: Date | null = null;
  let elapsedTime = 0;

  // Weather (mock)
  let weather = { temp: 32, condition: 'sunny', humidity: 65 };


  // ==================== OIL PRICE API ====================
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
        oilPriceFailCount = 0; // Reset on success
        updateCurrentFuelPrice();
        showNotification(`อัปเดตราคาน้ำมันแล้ว (${data.response.date})`, 'success');
      } else {
        throw new Error('Invalid API response');
      }
    } catch (err) {
      oilPriceFailCount++;
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

  // Fuel estimation
  let fuelConsumption = 0;
  let fuelCostEstimate = 0;
  let KM_PER_LITER = 15;

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
  let evCurrentConsumptionRate = 15; // dynamic kWh/100km based on speed
  let evTripEnergyUsed = 0; // cumulative kWh used during current trip
  let _lastEnergyLat = 0;
  let _lastEnergyLng = 0;

  // Voice navigation
  let voiceEnabled = true;

  // Settings panel
  let showSettings = false;
  let showLogoutConfirm = false;

  // Multi-select
  let selectedPoints: number[] = [];
  let isMultiSelectMode = false;

  let deliveryHistory: DeliveryRecord[] = [];

  let batteryLevel = 100;
  let isCharging = false;
  let chargingStations: ChargingStation[] = [];
  let chargingStationMarkers: any[] = [];
  let showChargingStations = true;
  let isLoadingStations = false;
  let selectedChargingStation: ChargingStation | null = null;
  let routeChargingStops: ChargingStation[] = [];

  // ==================== MAP POI (สถานที่บนแผนที่) ====================
  let mapPOIMarkers: any[] = [];
  let mapPOIAbortController: AbortController | null = null;
  let _mapPOITimer: any = null;
  let _lastPOIBounds = '';
  let isLoadingMapPOIs = false;
  // เก็บ POI elements ทั้งหมดที่เคย fetch ไว้ (dedupe by id)
  const _poiElements = new Map<number, any>(); // element.id → element
  let _poiFetching = false;
  const OVERPASS_SERVERS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ];
  let _overpassServerIdx = 0;

  // ==================== ALONG-ROUTE POI ====================
  let alongRoutePOIs: RoutePOI[] = [];
  let poiMarkers: any[] = [];
  let showPOIOverlay = false;
  let showPOIModal = false;
  let selectedPOIMarker: any = null;
  let activePOITypes: Set<string> = new Set(['gas', 'convenience', 'restaurant', 'cafe', 'ev_charging', 'viewpoint', 'attraction', 'temple', 'park', 'museum']);
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

  // ==================== PATH PROTECTION ====================
  // Reactive: URL param เปลี่ยน → เขียน URL กลับเงียบ ๆ (ไม่ remount, แผนที่ไม่พัง)
  $: if (browser && currentUser?.id && $page.params.id) {
    if (decodeUserId($page.params.id) !== currentUser.id) {
      window.history.replaceState(window.history.state, '', `/User/${encodeUserId(currentUser.id)}`);
    }
  }

  // beforeNavigate: บล็อก client-side navigation ไป User อื่น
  beforeNavigate(({ to, cancel }) => {
    if (!currentUser?.id || !to?.url) return;
    const pathname = to.url.pathname;
    if (pathname === '/') return;
    if (pathname.startsWith('/User/')) {
      const targetHash = pathname.split('/')[2];
      if (targetHash && decodeUserId(targetHash) !== currentUser.id) {
        cancel();
      }
    }
  });

  // perf: alias only (no copy)
  $: filteredPoints = deliveryPoints;

  // perf: pre-compute point distances (avoid Haversine in #each template per GPS update)
  $: pointDistances = currentLocation
    ? deliveryPoints.map(p => getDistance(currentLocation.lat, currentLocation.lng, p.lat, p.lng))
    : [];

  $: {
    const distanceKm = remainingDistance / 1000;
    if (vehicleType === 'fuel') {
      fuelConsumption = distanceKm / KM_PER_LITER;
      fuelCostEstimate = fuelConsumption * currentFuelPrice;
    } else {
      // Dynamic EV consumption: use route avg speed for remaining estimate
      const estRate = remainingTime > 0
        ? getEVConsumptionForRoute(remainingDistance, remainingTime)
        : getEVConsumptionAtSpeed(currentSpeed > 3 ? currentSpeed : 60);
      evCurrentConsumptionRate = isNavigating
        ? getEVConsumptionAtSpeed(currentSpeed > 1 ? currentSpeed : 60)
        : estRate;
      evEnergyConsumption = (distanceKm / 100) * estRate;
      evCostEstimate = evEnergyConsumption * ELECTRICITY_PRICE_PER_KWH;
      evRemainingRange = (evCurrentCharge / 100) * evRangePerCharge;
      const energyUsedPercent = (evEnergyConsumption / evBatteryCapacity) * 100;
      evBatteryAfterTrip = Math.max(0, evCurrentCharge - energyUsedPercent);
    }
  }

  // perf: direct alias instead of .map(spread) - User page has no customer system
  $: allDeliveryPoints = deliveryPoints;

  // AI Chat context (reactive - updates when points/route/nav changes)
  $: aiChatContext = {
    totalPoints: allDeliveryPoints.length,
    completedPoints: deliveryHistory.filter((d: any) => d.status === 'success').length,
    remainingPoints: allDeliveryPoints.length - deliveryHistory.filter((d: any) => d.status === 'success').length,
    hasRoute: !!optimizedRoute,
    isNavigating,
    routeDistance: optimizedRoute?.distance,
    routeDuration: optimizedRoute?.duration,
    vehicleType,
    pointNames: allDeliveryPoints.map((p: any) => p.name).join(', ')
  } as AIChatContext;

  // Resize map when settings/addForm opens/closes (sidebar hides/shows)
  $: if (browser && map) { showSettings; showAddForm; desktopSidebarCollapsed; mobileSidebarOpen; setTimeout(() => map?.invalidateSize(), 300); }

  let alerts: { id: number; type: string; message: string; time: Date }[] = [];
  let showAlerts = false;
  let gpsStatus: 'excellent' | 'good' | 'weak' | 'poor' = 'good';

  // ==================== ADVANCED NAVIGATION FEATURES ====================

  // Route Alternatives
  let routeAlternatives: any[] = [];
  let selectedRouteIndex = 0;
  let showRouteSelector = false;
  let alternativeRouteLayers: any[] = [];
  const routeColors = ['#22c55e', '#60a5fa', '#fbbf24', '#c084fc', '#f87171', '#2dd4bf', '#fb923c', '#f472b6'];
  const altRouteColors = ['#60a5fa', '#fbbf24', '#c084fc', '#f87171', '#2dd4bf', '#fb923c', '#f472b6'];
  const routeLabels = ['เส้นทางที่เร็วที่สุด', 'เส้นทางทางเลือก', 'เส้นทาง 3', 'เส้นทาง 4', 'เส้นทาง 5', 'เส้นทาง 6', 'เส้นทาง 7', 'เส้นทาง 8', 'เส้นทาง 9', 'เส้นทาง 10', 'เส้นทาง 11', 'เส้นทาง 12'];

  // Toll & Expressway Options
  let avoidTollRoads = false;
  let avoidExpressways = false;
  let routePreference: 'fastest' | 'shortest' | 'no_tolls' | 'no_highways' = 'fastest';
  let tollCostEstimate = 0;

  // Custom Start Point
  let useCustomStartPoint = false;
  let customStartPoint: { lat: number; lng: number; name: string } | null = null;
  let showStartPointPicker = false;
  let customStartMarker: any = null;
  let startPointSearchQuery = '';
  let startPointResults: any[] = [];
  let startSearchTimer: any = null;
  let isSearchingStartPoint = false;
  let isDataLoaded = false;

  // Globe Mode (3D Earth view when zoomed out)
  let globeMode = false;
  let globeRenderer: any = null;
  let globeScene: any = null;
  let globeCamera: any = null;
  let globeControls: any = null;
  let globeEarth: any = null;
  let globeClouds: any = null;
  let globeUserMarker: any = null;
  let globeUserPulse: any = null;
  let globeAnimId = 0;
  let globeReady = false;
  let globeInitializing = false;
  let _exitingGlobe = false;
  let globeError = '';
  let globeViewLabel = '';
  let globeShootingStars: any[] = [];
  let globeDeliveryMarkers: any[] = [];
  let _globeDeliveryPointIds: number[] = [];
  let _globeTHREE: any = null;

  // Camera rotation (leaflet-rotate — สองนิ้วหมุน)
  let camAngle = 0;
  let camActive = false;

  // Traffic
  let showTraffic = false;
  let trafficLayers: any[] = [];

  // Weather Radar (RainViewer)
  let showWeatherRadar = false;
  let weatherRadarLayer: any = null;

  // OSRM Match — GPS trace buffer
  let _gpsTraceBuffer: [number, number][] = []; // [lng, lat][]
  let _lastMatchTime = 0;
  let _matchedPosition: { lat: number; lng: number } | null = null;

  // Off-Route Detection & Auto-Rerouting
  let isOffRoute = false;
  let offRouteThreshold = 150; // meters
  let autoRerouteEnabled = true;
  let lastRerouteTime = 0;
  let rerouteCooldown = 15000; // 15 seconds
  let offRouteDistance = 0;
  let consecutiveOffRouteCount = 0;
  let offRouteRequiredCount = 2;
  let rerouteCount = 0;
  let isAutoRerouting = false;
  let lastVoiceTime = 0;
  let lastSpokenStepIndex = -1;
  let lastSpokenThreshold = '';
  let oilPriceFailCount = 0;

  // Session Timeout (30 นาที)
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  let sessionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let lastActivityTime = Date.now();

  function resetSessionTimer() {
    lastActivityTime = Date.now();
    if (sessionTimeoutTimer) clearTimeout(sessionTimeoutTimer);
    sessionTimeoutTimer = setTimeout(() => {
      showNotification('หมดเวลาใช้งาน กรุณาเข้าสู่ระบบใหม่', 'warning');
      setTimeout(() => logout(), 1500);
    }, SESSION_TIMEOUT);
  }

  function setupSessionTimeout() {
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(evt => window.addEventListener(evt, resetSessionTimer, { passive: true }));
    resetSessionTimer();
  }

  function cleanupSessionTimeout() {
    if (sessionTimeoutTimer) { clearTimeout(sessionTimeoutTimer); sessionTimeoutTimer = null; }
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(evt => window.removeEventListener(evt, resetSessionTimer));
  }

  function setupMapRotation() {}

  // ═══ Device Compass — เข็มทิศจากเซ็นเซอร์มือถือ (real-time, ทำงานแม้ยืนอยู่กับที่) ═══
  function _onDeviceOrientation(e: any) {
    let alpha: number | null = null;
    if (e.webkitCompassHeading !== undefined) {
      // iOS: webkitCompassHeading = degrees from north (0-360), already correct
      alpha = e.webkitCompassHeading;
    } else if (e.alpha !== null && e.absolute) {
      // Android absolute: alpha = degrees from north (reversed)
      alpha = (360 - e.alpha) % 360;
    } else if (e.alpha !== null) {
      alpha = (360 - e.alpha) % 360;
    }
    if (alpha !== null && !isNaN(alpha)) {
      if (_deviceCompassHeading !== null) {
        let diff = ((alpha - _deviceCompassHeading + 540) % 360) - 180;
        // Dead-zone: ละเว้น noise เล็กๆ (< 1.5°)
        if (Math.abs(diff) < 1.5) return;
        // Heavy smoothing เพื่อกัน sensor jitter (alpha 0.12)
        _deviceCompassHeading = ((_deviceCompassHeading + diff * 0.12) + 360) % 360;
      } else {
        _deviceCompassHeading = alpha;
      }
      // ใช้ GPS heading เป็นหลักเมื่อเคลื่อนที่เร็ว, device compass เมื่อช้า/หยุดนิ่ง
      const useCompass = !(currentSpeed > 5 && currentHeading !== null);
      if (useCompass) {
        compassHeading = _deviceCompassHeading;
        const dirs = ['N','NE','E','SE','S','SW','W','NW'];
        compassDir = dirs[Math.round(_deviceCompassHeading / 45) % 8];
      }
      // Real-time beam target จาก compass (ไม่ต้องรอ GPS 1Hz)
      if (useCompass && _deviceCompassHeading !== null) {
        if (isNavigating && animReady) {
          // อัพเดต target เท่านั้น — animation loop จะ lerp ให้ลื่น
          animTargetHeading = _deviceCompassHeading;
        } else if (!isNavigating) {
          // ไม่ได้ navigate: ใช้ _nonNavBeamTarget ให้ animation loop จัดการ
          _nonNavBeamTarget = _deviceCompassHeading;
        }
      }
    }
  }

  function startDeviceCompass() {
    if (_compassListenerAdded) return;
    // iOS 13+ ต้องขอ permission
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      (DeviceOrientationEvent as any).requestPermission().then((state: string) => {
        if (state === 'granted') {
          window.addEventListener('deviceorientationabsolute', _onDeviceOrientation, true);
          window.addEventListener('deviceorientation', _onDeviceOrientation, true);
          _compassListenerAdded = true;
          startNonNavBeamLoop();
        }
      }).catch(() => {});
    } else {
      window.addEventListener('deviceorientationabsolute', _onDeviceOrientation, true);
      window.addEventListener('deviceorientation', _onDeviceOrientation, true);
      _compassListenerAdded = true;
      startNonNavBeamLoop();
    }
  }

  function stopDeviceCompass() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('deviceorientationabsolute', _onDeviceOrientation, true);
      window.removeEventListener('deviceorientation', _onDeviceOrientation, true);
    }
    _compassListenerAdded = false;
    _deviceCompassHeading = null;
    stopNonNavBeamLoop();
  }

  // Smooth beam rotation loop สำหรับตอนไม่ navigate (lerp 60fps แทน direct set)
  function startNonNavBeamLoop() {
    if (_nonNavBeamRaf !== null) return;
    function tick() {
      _nonNavBeamRaf = requestAnimationFrame(tick);
      if (isNavigating || !headingMarkerElement) return;
      // Lerp heading smoothly
      let diff = ((_nonNavBeamTarget - _nonNavBeamCurrent + 540) % 360) - 180;
      if (Math.abs(diff) < 0.3) return; // ไม่ขยับถ้าเปลี่ยนน้อยมาก
      _nonNavBeamCurrent = ((_nonNavBeamCurrent + diff * 0.08) + 360) % 360;
      const beam = headingMarkerElement.querySelector('.heading-beam') as HTMLElement;
      if (beam) {
        beam.style.transform = `rotate(${_nonNavBeamCurrent}deg)`;
        beam.style.opacity = '1';
      }
    }
    tick();
  }
  function stopNonNavBeamLoop() {
    if (_nonNavBeamRaf !== null) {
      cancelAnimationFrame(_nonNavBeamRaf);
      _nonNavBeamRaf = null;
    }
  }

  function resetMapRotation() {
    _userMapRotation = 0;
    _lastAppliedRotation = 0;
    if (map && (map as any).setBearing) {
      (map as any).setBearing(0);
    }
  }

  // ═══ Globe Mode: Three.js 3D Earth ═══
  async function initGlobe() {
    if (globeInitializing || globeReady) return;
    globeInitializing = true;
    try {
      let threeModule: any, controlsModule: any;
      try {
        [threeModule, controlsModule] = await Promise.all([
          import('three'),
          import('three/addons/controls/OrbitControls.js')
        ]);
      } catch(importErr) {
        [threeModule, controlsModule] = await Promise.all([
          import('three'),
          import('three/examples/jsm/controls/OrbitControls.js')
        ]);
      }
      const THREE = threeModule as any;
      _globeTHREE = THREE;
      const OrbitControls = (controlsModule as any).OrbitControls;
      const container = document.getElementById('globe-container');
      if (!container) {
        globeError = 'Container not found';
        globeInitializing = false;
        return;
      }

      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      // Scene
      const scene = new THREE.Scene();
      globeScene = scene;

      // Camera — on mobile push camera further back so globe appears smaller
      const isMobile = w < 768;
      const fov = isMobile ? 62 : 50;
      const camZ = isMobile ? 4.8 : 2.8;
      const camera: any = new THREE.PerspectiveCamera(fov, w / h, 0.1, 1000);
      camera.position.set(0, isMobile ? 0.15 : 0.3, camZ);
      globeCamera = camera;

      // Renderer
      const renderer: any = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000005, 1);
      container.appendChild(renderer.domElement as HTMLCanvasElement);
      globeRenderer = renderer;

      // Lighting
      scene.add(new THREE.AmbientLight(0xffffff, 2.5));

      // Stars — 2500 ดวง + random sizes
      const starsGeo = new THREE.BufferGeometry();
      const starPos: number[] = [];
      const starSizes: number[] = [];
      for (let i = 0; i < 2500; i++) {
        const r = 50;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        starPos.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
        starSizes.push(0.05 + Math.random() * 0.15);
      }
      starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
      starsGeo.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));
      scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, sizeAttenuation: true })) as any);

      // Shooting stars — pool of 5
      globeShootingStars = [];
      for (let i = 0; i < 5; i++) {
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(6); // 2 points
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
        const line = new THREE.Line(geo, mat);
        scene.add(line);
        globeShootingStars.push({ line, active: false, timer: Math.random() * 500, speed: 0, dir: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, life: 0 });
      }

      // Earth — satellite texture (ESRI World Imagery)
      const earthGeo = new THREE.SphereGeometry(1, 64, 64);
      const earthMat = new THREE.MeshBasicMaterial({ color: 0x0a1628 });
      const earth: any = new THREE.Mesh(earthGeo, earthMat);
      scene.add(earth);
      globeEarth = earth;

      // Cloud layer — procedural texture, slightly above earth
      try {
        const cloudCanvas = generateCloudTexture(1024);
        const cloudTex = new THREE.CanvasTexture(cloudCanvas);
        cloudTex.wrapS = THREE.RepeatWrapping;
        const cloudGeo = new THREE.SphereGeometry(1.015, 48, 48);
        const cloudMat = new THREE.MeshBasicMaterial({
          map: cloudTex, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.FrontSide
        });
        const clouds: any = new THREE.Mesh(cloudGeo, cloudMat);
        scene.add(clouds);
        globeClouds = clouds;
      } catch(_) {}

      // Atmosphere — 1 ชั้น (backside glow)
      const atmosGeo = new THREE.SphereGeometry(1.12, 32, 32);
      const atmosMat = new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec3 vNormal; void main() { float rim = 1.0 - dot(vNormal, vec3(0,0,1)); float i = pow(rim, 3.0); gl_FragColor = vec4(0.0, 0.0, 0.0, smoothstep(0.0, 1.0, i) * 0.9); }`,
        side: THREE.BackSide,
        blending: THREE.NormalBlending,
        transparent: true,
        depthWrite: false
      });
      scene.add(new THREE.Mesh(atmosGeo, atmosMat) as any);

      // Rim edge — เส้นขอบชัดรอบลูกโลก
      const rimGeo = new THREE.SphereGeometry(1.015, 64, 64);
      const rimMat = new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vNormal; varying vec3 vViewDir; void main() { vNormal = normalize(normalMatrix * normal); vec4 mvPos = modelViewMatrix * vec4(position, 1.0); vViewDir = normalize(-mvPos.xyz); gl_Position = projectionMatrix * mvPos; }`,
        fragmentShader: `varying vec3 vNormal; varying vec3 vViewDir; void main() { float rim = 1.0 - max(dot(vNormal, vViewDir), 0.0); float edge = smoothstep(0.8, 1.0, rim); gl_FragColor = vec4(0.15, 0.18, 0.22, edge * 0.15); }`,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide
      });
      scene.add(new THREE.Mesh(rimGeo, rimMat) as any);

      // OrbitControls (drag to rotate globe)
      const controls = new OrbitControls(camera, renderer.domElement as HTMLElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.enablePan = false;
      controls.minDistance = 1.5;
      controls.maxDistance = isMobile ? 8 : 6;
      controls.rotateSpeed = 0.5;
      controls.zoomSpeed = 0.8;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;
      globeControls = controls;

      // Zoom-in detection → transition back to flat map
      controls.addEventListener('change', () => {
        if (_exitingGlobe || !globeCamera) return;
        if (globeCamera.position.length() <= 1.55) {
          _exitingGlobe = true;
          const ll = getGlobeCenterLatLng();
          if (ll) exitGlobeMode(ll);
          setTimeout(() => { _exitingGlobe = false; }, 1500);
        }
      });

      // Click on delivery marker → zoom in to that point
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      renderer.domElement.addEventListener('click', (e: MouseEvent) => {
        if (_exitingGlobe || !globeCamera || globeDeliveryMarkers.length === 0) return;
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, globeCamera);
        const hits = raycaster.intersectObjects(globeDeliveryMarkers, true);
        if (hits.length > 0) {
          // Find the root marker (parent with userData.pointId)
          let obj = hits[0].object;
          while (obj.parent && !obj.userData?.pointId) obj = obj.parent;
          if (obj.userData?.lat != null) {
            _exitingGlobe = true;
            exitGlobeMode({ lat: obj.userData.lat, lng: obj.userData.lng });
            // Zoom closer to the point after globe exit
            setTimeout(() => {
              if (map) map.setView([obj.userData.lat, obj.userData.lng], 14, { animate: true });
              _exitingGlobe = false;
            }, 600);
          }
        }
      });

      // Resize handler — ทั้ง window resize และ container resize (sidebar toggle)
      const onGlobeResize = () => {
        if (!container || !globeCamera || !globeRenderer) return;
        const nw = container.clientWidth, nh = container.clientHeight;
        if (nw <= 0 || nh <= 0) return;
        globeCamera.aspect = nw / nh;
        globeCamera.updateProjectionMatrix();
        globeRenderer.setSize(nw, nh);
      };
      (window as any).__globeResizeHandler = onGlobeResize;
      window.addEventListener('resize', onGlobeResize);
      // ResizeObserver จับ sidebar toggle ที่ไม่ trigger window resize
      const globeRO = new ResizeObserver(() => onGlobeResize());
      globeRO.observe(container);
      (window as any).__globeResizeObserver = globeRO;

      // Place user location marker on globe
      updateGlobeUserMarker(THREE);
      // Place delivery point markers on globe
      updateGlobeDeliveryMarkers(THREE);

      globeReady = true;
      globeInitializing = false;
      animateGlobe();

      // Apply texture to earth
      function applyEarthTexture(tex: any) {
        if (!tex || !globeEarth) return;
        globeEarth.material.map = tex;
        globeEarth.material.color.set(0xffffff);
        globeEarth.material.needsUpdate = true;
      }

      // Progressive: zoom 1 ก่อน (4 tiles, ทันที) → zoom 3 ตาม (64 tiles, คมชัด)
      loadGlobeTexture(THREE, 1).then((lowTex) => {
        applyEarthTexture(lowTex);
        loadGlobeTexture(THREE, 3).then((hdTex) => {
          applyEarthTexture(hdTex);
        }).catch(() => {});
      }).catch(() => {});

    } catch(e: any) {
      globeError = String(e?.message || 'Unknown error');
      globeInitializing = false;
    }
  }

  let _globeFrameCount = 0;
  function animateGlobe() {
    if (!globeReady || !globeMode) return;
    globeAnimId = requestAnimationFrame(animateGlobe);
    globeControls?.update();

    // หมุนเมฆช้าๆ
    if (globeClouds) {
      globeClouds.rotation.y += 0.00012;
    }

    // Shooting stars animation
    for (const star of globeShootingStars) {
      if (!star.active) {
        star.timer--;
        if (star.timer <= 0) {
          // Activate: random position in sky, random direction
          const angle = Math.random() * Math.PI * 2;
          const elev = 0.3 + Math.random() * 0.5;
          const r = 8 + Math.random() * 12;
          star.pos = { x: Math.cos(angle) * r, y: elev * r * 0.5 + 2, z: Math.sin(angle) * r };
          const da = angle + Math.PI * 0.6 + Math.random() * 0.8;
          star.dir = { x: Math.cos(da) * 0.4, y: -0.1 - Math.random() * 0.15, z: Math.sin(da) * 0.4 };
          star.speed = 0.6 + Math.random() * 0.4;
          star.life = 40 + Math.random() * 40;
          star.active = true;
          star.line.material.opacity = 0.8;
        }
      } else {
        star.pos.x += star.dir.x * star.speed;
        star.pos.y += star.dir.y * star.speed;
        star.pos.z += star.dir.z * star.speed;
        star.life--;
        star.line.material.opacity = Math.max(0, star.life / 40) * 0.8;
        const p = star.line.geometry.attributes.position.array;
        p[0] = star.pos.x; p[1] = star.pos.y; p[2] = star.pos.z;
        p[3] = star.pos.x - star.dir.x * 1.5; p[4] = star.pos.y - star.dir.y * 1.5; p[5] = star.pos.z - star.dir.z * 1.5;
        star.line.geometry.attributes.position.needsUpdate = true;
        if (star.life <= 0) {
          star.active = false;
          star.timer = 200 + Math.random() * 600; // 3-13 วินาทีก่อนดาวตกดวงต่อไป
          star.line.material.opacity = 0;
        }
      }
    }

    // Pulse user marker (green glow effect)
    if (globeUserPulse) {
      const t = Date.now() * 0.003;
      const s = 1 + 0.4 * Math.sin(t);
      globeUserPulse.scale.set(s, s, s);
      globeUserPulse.material.opacity = 0.25 + 0.25 * Math.sin(t);
      const outer = globeUserPulse.children[0];
      if (outer) {
        const s2 = 1 + 0.5 * Math.sin(t * 0.7 + 1);
        outer.scale.set(s2, s2, s2);
        outer.material.opacity = 0.08 + 0.1 * Math.sin(t * 0.7);
      }
    }
    // Glow on dot
    if (globeUserMarker?.children[0]) {
      globeUserMarker.children[0].material.opacity = 0.2 + 0.15 * Math.sin(Date.now() * 0.004);
    }
    // Update label every 30 frames; rebuild delivery markers every 60 frames
    if (++_globeFrameCount % 30 === 0) updateGlobeViewLabel();
    if (_globeFrameCount % 60 === 0 && _globeTHREE) updateGlobeDeliveryMarkers(_globeTHREE);
    if (globeRenderer && globeScene && globeCamera) {
      globeRenderer.render(globeScene, globeCamera);
    }
  }

  async function loadGlobeTexture(THREE: any, zoom = 3): Promise<any> {
    try {
      const n = Math.pow(2, zoom);
      const tileSize = 256;
      const merc = document.createElement('canvas');
      merc.width = n * tileSize;
      merc.height = n * tileSize;
      const ctx = merc.getContext('2d')!;
      ctx.fillStyle = '#0a1628';
      ctx.fillRect(0, 0, merc.width, merc.height);

      const tiles: { tx: number; ty: number }[] = [];
      for (let ty = 0; ty < n; ty++) {
        for (let tx = 0; tx < n; tx++) tiles.push({ tx, ty });
      }
      // โหลดทุก tile พร้อมกัน (ESRI World Imagery — ภาพถ่ายดาวเทียม)
      const loaded = await Promise.allSettled(tiles.map(({ tx, ty }) => new Promise<{tx: number, ty: number, img: HTMLImageElement}>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve({ tx, ty, img });
        img.onerror = () => reject();
        img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
      })));

      // วาดลง canvas เป็น batch + yield ทุก 16 tiles ไม่ให้ block animation
      let drawn = 0;
      for (const r of loaded) {
        if (r.status === 'fulfilled') {
          ctx.drawImage(r.value.img, r.value.tx * tileSize, r.value.ty * tileSize);
          if (++drawn % 16 === 0) await new Promise(r => setTimeout(r, 0));
        }
      }

      // yield ก่อน mercator conversion (heavy)
      await new Promise(r => setTimeout(r, 0));
      const eq = mercatorToEquirect(merc);
      const texture = new THREE.CanvasTexture(eq);
      texture.colorSpace = THREE.SRGBColorSpace;
      try { texture.anisotropy = globeRenderer?.capabilities?.getMaxAnisotropy() ?? 16; } catch(_) { texture.anisotropy = 16; }
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      return texture;
    } catch(_) {
      return null;
    }
  }

  function mercatorToEquirect(src: HTMLCanvasElement): HTMLCanvasElement {
    const srcW = src.width, srcH = src.height;
    const srcCtx = src.getContext('2d')!;
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH);
    const outW = srcW, outH = Math.round(srcW / 2);
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const outCtx = out.getContext('2d')!;
    const outData = outCtx.createImageData(outW, outH);
    // Uint32Array for 4x faster pixel copy
    const srcU32 = new Uint32Array(srcData.data.buffer);
    const outU32 = new Uint32Array(outData.data.buffer);
    const MAX_LAT = 85.05112878 * Math.PI / 180;
    const maxMercY = Math.log(Math.tan(Math.PI / 4 + MAX_LAT / 2));
    // Pre-compute srcY lookup per row
    for (let oy = 0; oy < outH; oy++) {
      const lat = (0.5 - oy / outH) * Math.PI;
      const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
      const mercY = Math.log(Math.tan(Math.PI / 4 + clamped / 2));
      const srcY = Math.min(srcH - 1, Math.max(0, Math.round((0.5 - mercY / (2 * maxMercY)) * srcH)));
      const srcRow = srcY * srcW;
      const outRow = oy * outW;
      // Copy entire row at once (same x mapping)
      outU32.set(srcU32.subarray(srcRow, srcRow + outW), outRow);
    }
    // Set alpha to 255 for all pixels
    const outBytes = outData.data;
    for (let i = 3; i < outBytes.length; i += 4) outBytes[i] = 255;
    outCtx.putImageData(outData, 0, 0);
    return out;
  }

  // Generate procedural cloud texture on canvas
  function generateCloudTexture(size: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = size; c.height = size / 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, c.width, c.height);
    // Layered white blobs to simulate clouds
    for (let layer = 0; layer < 3; layer++) {
      const count = 120 + layer * 60;
      for (let i = 0; i < count; i++) {
        const x = Math.random() * c.width;
        const y = Math.random() * c.height;
        const rx = 20 + Math.random() * 80;
        const ry = 10 + Math.random() * 30;
        const alpha = 0.02 + Math.random() * 0.06;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rx);
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Band of clouds near equator/tropics
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * c.width;
      const band = (0.3 + Math.random() * 0.4) * c.height;
      const rx = 30 + Math.random() * 60;
      const ry = 5 + Math.random() * 15;
      const grad = ctx.createRadialGradient(x, band, 0, x, band, rx);
      grad.addColorStop(0, 'rgba(255,255,255,0.04)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x, band, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }

  function getGlobeCenterLatLng(): { lat: number; lng: number } | null {
    if (!globeCamera) return null;
    const pos = globeCamera.position;
    const dir = { x: -pos.x, y: -pos.y, z: -pos.z };
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    dir.x /= len; dir.y /= len; dir.z /= len;
    const lat = Math.asin(dir.y) * 180 / Math.PI;
    const phi = Math.atan2(dir.z, -dir.x);
    let lng = phi * 180 / Math.PI - 180;
    lng = ((lng + 540) % 360) - 180;
    return { lat, lng };
  }

  function setGlobeViewLatLng(lat: number, lng: number) {
    if (!globeCamera || !globeControls) return;
    const phi = (lng + 180) * Math.PI / 180;
    const theta = (90 - lat) * Math.PI / 180;
    const r = globeCamera.position.length() || 2.8;
    const x = -Math.cos(phi) * Math.sin(theta) * r;
    const y = Math.cos(theta) * r;
    const z = Math.sin(phi) * Math.sin(theta) * r;
    globeCamera.position.set(x, y, z);
    globeCamera.lookAt(0, 0, 0);
    globeControls.update();
  }

  // Convert lat/lng to 3D point on globe surface (radius slightly above 1.0)
  function latLngToGlobe3D(lat: number, lng: number, r: number = 1.01): { x: number; y: number; z: number } {
    const phi = (lng + 180) * Math.PI / 180;
    const theta = (90 - lat) * Math.PI / 180;
    return {
      x: -Math.cos(phi) * Math.sin(theta) * r,
      y: Math.cos(theta) * r,
      z: Math.sin(phi) * Math.sin(theta) * r
    };
  }

  // Place user's GPS marker on the globe
  function updateGlobeUserMarker(THREE: any) {
    if (!globeScene || !currentLocation) return;
    const pos = latLngToGlobe3D(currentLocation.lat, currentLocation.lng, 1.012);

    if (!globeUserMarker) {
      // Green glowing dot
      const dotGeo = new THREE.SphereGeometry(0.02, 24, 24);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
      globeUserMarker = new THREE.Mesh(dotGeo, dotMat);
      globeScene.add(globeUserMarker);

      // Inner glow sphere (additive blend)
      const glowGeo = new THREE.SphereGeometry(0.035, 24, 24);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      globeUserMarker.add(glowMesh);

      // Pulse ring
      const ringGeo = new THREE.RingGeometry(0.03, 0.06, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
      globeUserPulse = new THREE.Mesh(ringGeo, ringMat);
      globeScene.add(globeUserPulse);

      // Outer pulse ring (larger, fainter)
      const outerRingGeo = new THREE.RingGeometry(0.06, 0.09, 48);
      const outerRingMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.15, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
      const outerPulse = new THREE.Mesh(outerRingGeo, outerRingMat);
      outerPulse.name = 'outerPulse';
      globeUserPulse.add(outerPulse);
    }

    globeUserMarker.position.set(pos.x, pos.y, pos.z);
    globeUserPulse.position.set(pos.x, pos.y, pos.z);
    // Orient ring to face outward from globe center
    globeUserPulse.lookAt(0, 0, 0);
  }

  // Place delivery point markers on the globe
  function updateGlobeDeliveryMarkers(THREE: any) {
    if (!globeScene) return;
    const currentIds = deliveryPoints.map((p: any) => p.id).sort().join(',');
    const cachedIds = _globeDeliveryPointIds.join(',');
    if (currentIds === cachedIds && globeDeliveryMarkers.length > 0) return;

    // Remove old markers
    for (const m of globeDeliveryMarkers) {
      globeScene.remove(m);
      m.geometry?.dispose();
      m.material?.dispose();
      if (m.children) {
        for (const c of m.children) { c.geometry?.dispose(); c.material?.dispose(); }
      }
    }
    globeDeliveryMarkers = [];
    _globeDeliveryPointIds = deliveryPoints.map((p: any) => p.id).sort();

    for (const pt of deliveryPoints) {
      if (!pt.lat || !pt.lng) continue;
      const pos = latLngToGlobe3D(pt.lat, pt.lng, 1.012);

      // Orange sphere marker
      const dotGeo = new THREE.SphereGeometry(0.012, 16, 16);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xff6b35 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(pos.x, pos.y, pos.z);
      dot.userData = { pointId: pt.id, lat: pt.lat, lng: pt.lng, name: pt.name || '' };

      // Glow sphere (additive blend)
      const glowGeo = new THREE.SphereGeometry(0.02, 16, 16);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      dot.add(glow);

      globeScene.add(dot);
      globeDeliveryMarkers.push(dot);
    }
  }

  // Get rough location name from lat/lng
  function getGlobeRegionName(lat: number, lng: number): string {
    // Thailand
    if (lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106) return 'ประเทศไทย';
    // Southeast Asia
    if (lat >= -10 && lat <= 25 && lng >= 92 && lng <= 141) return 'เอเชียตะวันออกเฉียงใต้';
    // East Asia
    if (lat >= 20 && lat <= 55 && lng >= 100 && lng <= 150) return 'เอเชียตะวันออก';
    // South Asia
    if (lat >= 5 && lat <= 40 && lng >= 60 && lng <= 97) return 'เอเชียใต้';
    // Middle East
    if (lat >= 12 && lat <= 42 && lng >= 25 && lng <= 63) return 'ตะวันออกกลาง';
    // Europe
    if (lat >= 35 && lat <= 72 && lng >= -25 && lng <= 45) return 'ยุโรป';
    // Africa
    if (lat >= -35 && lat <= 37 && lng >= -18 && lng <= 52) return 'แอฟริกา';
    // North America
    if (lat >= 15 && lat <= 72 && lng >= -170 && lng <= -50) return 'อเมริกาเหนือ';
    // South America
    if (lat >= -56 && lat <= 15 && lng >= -82 && lng <= -34) return 'อเมริกาใต้';
    // Oceania
    if (lat >= -50 && lat <= 0 && lng >= 110 && lng <= 180) return 'โอเชียเนีย';
    // Poles
    if (lat > 66) return 'อาร์กติก';
    if (lat < -66) return 'แอนตาร์กติกา';
    // Ocean areas
    return `${lat.toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${lng.toFixed(1)}°${lng >= 0 ? 'E' : 'W'}`;
  }

  // Update globe view label (called from animation loop)
  function updateGlobeViewLabel() {
    const ll = getGlobeCenterLatLng();
    if (ll) {
      globeViewLabel = getGlobeRegionName(ll.lat, ll.lng);
    }
  }

  function goToMyLocationOnGlobe() {
    if (!currentLocation) return;
    setGlobeViewLatLng(currentLocation.lat, currentLocation.lng);
  }

  function enterGlobeMode() {
    globeMode = true;
    globeError = '';
    if (!globeReady && !globeInitializing) {
      // Wait a frame for Svelte to update DOM, then init Three.js
      requestAnimationFrame(() => {
        setTimeout(() => {
          initGlobe().then(() => {
            if (map && globeReady && globeMode) {
              const c = map.getCenter();
              setGlobeViewLatLng(c.lat, c.lng);
            }
          }).catch((e: any) => {
            globeError = String(e?.message || e);
          });
        }, 50);
      });
      // Timeout fallback: if globe doesn't init within 15s, exit
      setTimeout(() => {
        if (globeMode && !globeReady) {
          globeError = 'โหลดไม่สำเร็จ';
          globeMode = false;
          globeInitializing = false;
        }
      }, 15000);
    } else if (globeReady) {
      if (map) {
        const c = map.getCenter();
        setGlobeViewLatLng(c.lat, c.lng);
      }
      animateGlobe();
    }
  }

  function exitGlobeMode(latLng: { lat: number; lng: number }) {
    globeMode = false;
    cancelAnimationFrame(globeAnimId);
    globeAnimId = 0;
    if (map) {
      map.setView([latLng.lat, latLng.lng], 5, { animate: false });
    }
  }

  function disposeGlobe() {
    globeReady = false;
    cancelAnimationFrame(globeAnimId);
    globeAnimId = 0;
    if (globeRenderer) {
      globeRenderer.dispose();
      const canvas = globeRenderer.domElement;
      canvas?.parentNode?.removeChild(canvas);
    }
    globeScene = null;
    globeCamera = null;
    globeControls = null;
    globeRenderer = null;
    globeEarth = null;
    globeClouds = null;
    globeShootingStars = [];
    // Clean up delivery markers from scene
    for (const m of globeDeliveryMarkers) {
      m.geometry?.dispose(); m.material?.dispose();
      if (m.children) { for (const c of m.children) { c.geometry?.dispose(); c.material?.dispose(); } }
    }
    globeDeliveryMarkers = [];
    _globeDeliveryPointIds = [];
    _globeTHREE = null;
    globeInitializing = false;
    const rh = (window as any).__globeResizeHandler;
    if (rh) { window.removeEventListener('resize', rh); delete (window as any).__globeResizeHandler; }
    const ro = (window as any).__globeResizeObserver;
    if (ro) { ro.disconnect(); delete (window as any).__globeResizeObserver; }
  }

  // Turn-by-Turn Navigation
  let turnInstructions: TurnInstruction[] = [];
  let currentStepIndex = 0;
  let nextTurnDistance = 0;
  let nextTurnInstruction = '';
  let nextTurnIcon = '';

  // Search (state moved to SearchPanel component)
  let isSearchFocused = false;
  let evAbortController: AbortController | null = null;
  let poiAbortController: AbortController | null = null;
  let destinationMarker: any = null;
  let directDestination: { lat: number; lng: number; name: string; address: string } | null = null;

  // Saved/Favorite Routes
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

  // AI Route Planning
  let aiAvailable = false;
  let showAISuggestion = false;
  let aiSuggestion: AIRouteSuggestionData | null = null;
  let isAIPlanning = false;
  let aiChatOpen = false;

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
    } catch (_) {}
  }

  function clearRouteState() {
    if (browser) sessionStorage.removeItem(getUserKey('routeState'));
  }

  function restoreRouteState(): boolean {
    if (!browser) return false;
    try {
      const saved = sessionStorage.getItem(getUserKey('routeState'));
      if (!saved) return false;
      const state = JSON.parse(saved);
      if (!state.alts?.length || !state.start) return false;
      // Clear all existing layers before restoring to prevent duplicates
      clearAlternativeRouteLayers();
      clearTrafficLayers();
      if (routeLayer) { try { map.removeLayer(routeLayer); } catch (e) {} routeLayer = null; }
      routeAlternatives = state.alts;
      selectRoute(state.idx || 0, state.start, state.pts || [], true);
      return true;
    } catch (_) { return false; }
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
    } catch (_) {}
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
    } catch (_) {}
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
    } catch (_) {
      showNotification('โหลดข้อมูลไม่สำเร็จ', 'error');
    }
  }

  function displayPoints() {
    if (!L || !map) return;
    if (optimizedRoute) return; // route markers already displayed
    markers.forEach(m => m.remove());
    markers = [];
    deliveryPoints.forEach((point, i) => {
      const colors = getPriorityGradient(point.priority);
      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: `custom-marker${isDragMode ? ' drag-mode' : ''}`,
          html: `<div class="marker-pin${isDragMode ? ' draggable' : ''}" style="background: ${colors.bg}; box-shadow: 0 0 20px ${colors.glow};"><span>${i + 1}</span>${isDragMode ? '<div class="drag-hint">✥</div>' : ''}<div class="marker-name-label">${escapeHtml(point.name)}</div></div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        }),
        draggable: isDragMode,
        bubblingMouseEvents: true
      }).addTo(map);
      marker.bindPopup(`<div class="custom-popup"><div class="popup-accent" style="background: ${colors.bg}"></div><div class="popup-header"><div class="popup-badge" style="background: ${colors.bg}">${i + 1}</div><div class="popup-header-text"><h4>${escapeHtml(point.name)}</h4><span class="popup-tag" style="color: ${colors.glow}">P${point.priority}</span></div></div><div class="popup-content"><p>${escapeHtml(point.address)}</p></div></div>`, { className: 'dark-popup', maxWidth: 320 });
      marker.on('dragend', async () => {
        const pos = marker.getLatLng();
        const oldLat = point.lat, oldLng = point.lng;
        const oldAddress = point.address;
        deliveryPoints[i] = { ...deliveryPoints[i], lat: pos.lat, lng: pos.lng };
        deliveryPoints = [...deliveryPoints];

        // ดึงชื่อ+ที่อยู่ใหม่จาก reverse geocoding
        let newAddress = oldAddress;
        let newName = point.name;
        const geoResult = await reverseGeocode(pos.lat, pos.lng);
        if (geoResult) {
          newName = geoResult.name;
          newAddress = geoResult.address;
          deliveryPoints[i] = { ...deliveryPoints[i], name: newName, address: newAddress };
          deliveryPoints = [...deliveryPoints];
        }

        try {
          const res = await fetch(`${API_URL}/points/${point.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName, lat: pos.lat, lng: pos.lng, address: newAddress, user_id: currentUser?.id, table: 'users' })
          });
          if (!res.ok) throw new Error();
          lastDragUndo = { pointId: point.id, pointIndex: i, name: newName, oldName: point.name, oldLat, oldLng, oldAddress };
          showNotification(`ย้ายไปยัง "${newName}" สำเร็จ`, 'success');
          displayPoints(); // อัปเดต popup ด้วยที่อยู่ใหม่
          if (optimizedRoute) await optimizeRoute();
        } catch {
          deliveryPoints[i] = { ...deliveryPoints[i], name: point.name, lat: oldLat, lng: oldLng, address: oldAddress };
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
    const { pointId, pointIndex, name, oldName, oldLat, oldLng, oldAddress } = lastDragUndo;
    lastDragUndo = null;
    try {
      const updateData: any = { name: oldName, lat: oldLat, lng: oldLng, user_id: currentUser?.id, table: 'users' };
      if (oldAddress) updateData.address = oldAddress;

      const res = await fetch(`${API_URL}/points/${pointId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      if (!res.ok) throw new Error();

      const pointUpdate: any = { name: oldName, lat: oldLat, lng: oldLng };
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

  let isAddingPoint = false;
  async function addDeliveryPoint() {
    if (isAddingPoint) return;
    if (!newPoint.name.trim() || !newPoint.address.trim()) {
      showNotification('กรุณากรอกข้อมูลให้ครบ', 'error');
      return;
    }
    // Duplicate check: same lat/lng already exists
    const dup = deliveryPoints.find(p => Math.abs(p.lat - newPoint.lat) < 0.0001 && Math.abs(p.lng - newPoint.lng) < 0.0001);
    if (dup) {
      showNotification(`จุด "${dup.name}" อยู่ตำแหน่งเดียวกันแล้ว`, 'warning');
      return;
    }
    isAddingPoint = true;
    try {
      // Snap to nearest road (graceful — uses original coords if fails)
      try {
        const snapped = await callOSRMNearest(newPoint.lng, newPoint.lat);
        if (snapped.distance < 500) { // only snap if within 500m of a road
          newPoint = { ...newPoint, lat: parseFloat(snapped.lat.toFixed(6)), lng: parseFloat(snapped.lng.toFixed(6)) };
          // Update click marker position
          if (clickMarker && map) clickMarker.setLatLng([newPoint.lat, newPoint.lng]);
        }
      } catch (_) { /* OSRM Nearest failed — use original coords */ }
      const payload = { ...newPoint, user_id: currentUser?.id || null };
      const res = await fetch(`${API_URL}/points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data || data.error || !res.ok) throw new Error(data?.error || 'เพิ่มไม่สำเร็จ');
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
    } finally {
      isAddingPoint = false;
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
      if (optimizedRoute) {
        clearRoute();
        clearAlternativeRouteLayers();
        routeAlternatives = [];
        showRouteSelector = false;
        showRouteComparison = false;
      }
      showNotification('ลบสำเร็จ', 'success');
    } catch (err) {
      showNotification('ลบไม่สำเร็จ', 'error');
    }
  }

  // Fetch with auto-retry (fixes TLS 425 Too Early on first request to a new origin)
  async function fetchRetry(url: string, opts?: RequestInit): Promise<Response> {
    try { return await fetch(url, opts); }
    catch (_) {
      await new Promise(r => setTimeout(r, 300));
      return fetch(url, opts);
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('ไม่สามารถคำนวณเส้นทางได้');
    return data;
  }

  // ==================== OSRM with Mapbox Fallback ====================
  async function routeWithOSRMFallback(waypoints: string, options?: { steps?: boolean; exclude?: string[] }, signal?: AbortSignal): Promise<any> {
    // If exclude options are set, OSRM doesn't support them → go straight to Mapbox
    if (options?.exclude && options.exclude.length > 0) {
      return callOSRMProxy(waypoints, { steps: options.steps, exclude: options.exclude }, signal);
    }
    // Try OSRM first (fast, free)
    try {
      return await callOSRMDirect(waypoints, { steps: options?.steps }, signal);
    } catch (e: any) {
      // Don't fallback if the caller aborted
      if (signal?.aborted) throw e;
      // Fallback to Mapbox
      return callOSRMProxy(waypoints, { steps: options?.steps }, signal);
    }
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
      const key = `${Math.round(route.distance / 100)}-${Math.round(route.duration / 15)}`;
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
      { exclude: ['toll', 'motorway'], label: 'เลี่ยงด่วน+มอเตอร์เวย์' },
      { exclude: ['ferry'], label: 'เลี่ยงเรือข้ามฟาก' },
      { exclude: ['toll', 'ferry'], label: 'เลี่ยงด่วน+เรือข้ามฟาก' },
      { exclude: ['motorway', 'ferry'], label: 'เลี่ยงมอเตอร์เวย์+เรือข้ามฟาก' },
      { exclude: ['toll', 'motorway', 'ferry'], label: 'เลี่ยงทั้งหมด' }
    ];

    const annot = showTraffic ? 'congestion' : undefined;

    if (points.length <= 2) {
      // === Single segment — 8 calls with alternatives for maximum route variety ===
      const results = await Promise.allSettled(
        excludeConfigs.map(cfg => callOSRMProxy(waypoints, { steps: true, alternatives: true, exclude: cfg.exclude, annotations: annot }, signal))
      );
      results.forEach((res, ci) => {
        if (res.status !== 'fulfilled' || !res.value.routes) return;
        const suffix = excludeConfigs[ci].label ? ` (${excludeConfigs[ci].label})` : '';
        res.value.routes.forEach((r: any) => {
          const label = allRoutes.length === 0 ? 'เส้นทางเร็วที่สุด' : `เส้นทาง ${allRoutes.length + 1}${suffix}`;
          const clr = allRoutes.length === 0 ? routeColors[0] : altRouteColors[(allRoutes.length - 1) % altRouteColors.length];
          addIfUnique(r, label, clr, excludeConfigs[ci].exclude || []);
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
            const key = `${Math.round(route.distance / 100)}-${Math.round(route.duration / 15)}`;
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

      // Strategy 1-7: fixed strategies
      const strategies: { name: string; pick: (segs: any[][]) => (any | null)[] }[] = [
        { name: 'เส้นทางเร็วที่สุด', pick: segs => segs.map(s => s[0]) },
        { name: 'เส้นทางสั้นที่สุด', pick: segs => segs.map(s => [...s].sort((a, b) => a.distance - b.distance)[0]) },
        { name: 'เลี่ยงทางด่วน', pick: segs => segs.map(s => s.find(r => r._exclude?.includes('toll')) || s[0]) },
        { name: 'เลี่ยงมอเตอร์เวย์', pick: segs => segs.map(s => s.find(r => r._exclude?.includes('motorway')) || s[0]) },
        { name: 'เลี่ยงด่วน+มอเตอร์เวย์', pick: segs => segs.map(s => s.find(r => r._exclude?.includes('toll') && r._exclude?.includes('motorway')) || s[0]) },
        { name: 'เลี่ยงเรือข้ามฟาก', pick: segs => segs.map(s => s.find(r => r._exclude?.includes('ferry')) || s[0]) },
        { name: 'เลี่ยงทั้งหมด', pick: segs => segs.map(s => s.find(r => r._exclude?.includes('toll') && r._exclude?.includes('motorway') && r._exclude?.includes('ferry')) || s[0]) },
      ];

      for (const st of strategies) {
        try {
          const picks = st.pick(segAlts);
          if (picks.every(Boolean)) {
            const stitched = stitchRoutes(picks);
            const clr2 = allRoutes.length === 0 ? routeColors[0] : altRouteColors[(allRoutes.length - 1) % altRouteColors.length];
            addIfUnique(stitched, st.name, clr2, stitched._exclude);
          }
        } catch {}
      }

      // Strategy 6+: per-segment variations — swap alt into one segment, keep others fastest
      for (let s = 0; s < segments.length; s++) {
        const maxAlts = segAlts[s].length;
        for (let a = 1; a < maxAlts; a++) {
          const picks = segAlts.map((seg, idx) => idx === s ? seg[a] : seg[0]);
          if (picks.every(Boolean)) {
            const stitched = stitchRoutes(picks);
            const label = `เส้นทาง ${allRoutes.length + 1} (ช่วง ${s + 1} ทางเลือก)`;
            const clr3 = allRoutes.length === 0 ? routeColors[0] : altRouteColors[(allRoutes.length - 1) % altRouteColors.length];
            addIfUnique(stitched, label, clr3, stitched._exclude);
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
        return { weight: baseWeight + 1, opacity: 0.9 };
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
        // Finish current segment
        segCoords.push(nextCoord);
        const opts = getTrafficLineOptions(currentLevel, weight);

        const line = L.polyline(segCoords, {
          color: currentColor,
          weight: opts.weight,
          opacity: opts.opacity,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 0,
          dashArray: opts.dashArray
        }).addTo(map);
        trafficLayers.push(line);

        // Start new segment from overlap point
        segCoords = [nextCoord];
        currentLevel = level;
        currentColor = color;
      }
    }

    // Draw last segment
    if (segCoords.length >= 2) {
      const opts = getTrafficLineOptions(currentLevel, weight);

      const line = L.polyline(segCoords, {
        color: currentColor,
        weight: opts.weight,
        opacity: opts.opacity,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 0,
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
      // Redraw main route at full opacity (was 0.3 when traffic was on)
      if (optimizedRoute) displayOptimizedRoute();
    }
  }

  async function toggleWeatherRadar() {
    if (showWeatherRadar) {
      // Turn off
      if (weatherRadarLayer && map) { map.removeLayer(weatherRadarLayer); }
      weatherRadarLayer = null;
      showWeatherRadar = false;
      return;
    }
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const data = await res.json();
      const past = data?.radar?.past;
      if (!past || past.length === 0) { showNotification('ไม่มีข้อมูลเรดาร์ฝน', 'warning'); return; }
      const latest = past[past.length - 1];
      const ts = latest.path; // e.g. "/v2/radar/1234567890"
      if (weatherRadarLayer && map) { map.removeLayer(weatherRadarLayer); }
      weatherRadarLayer = L.tileLayer(`https://tilecache.rainviewer.com${ts}/256/{z}/{x}/{y}/4/1_1.png`, {
        opacity: 0.45,
        zIndex: 500,
        attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>'
      });
      if (map) weatherRadarLayer.addTo(map);
      showWeatherRadar = true;
    } catch (err) {
      showNotification('โหลดเรดาร์ฝนไม่สำเร็จ', 'error');
    }
  }

  // ขนาดเส้นตาม zoom — บางลงเมื่อซูมออก
  function getRouteWeight(zoom?: number): { main: number; mainSel: number } {
    const z = zoom ?? map?.getZoom?.() ?? 14;
    if (z >= 16) return { main: 6, mainSel: 6.5 };
    if (z >= 14) return { main: 5.5, mainSel: 6 };
    if (z >= 13) return { main: 5, mainSel: 5.5 };
    if (z >= 12) return { main: 4.5, mainSel: 5 };
    if (z >= 10) return { main: 3, mainSel: 3.5 };
    if (z >= 7)  return { main: 2, mainSel: 2.5 };
    return { main: 1.5, mainSel: 1.8 };
  }

  function updateRouteWeights() {
    if (!map) return;
    const w = getRouteWeight();
    alternativeRouteLayers.forEach((layer: any) => {
      if (!layer.setStyle || !layer.options) return;
      if (layer.options._isRoute) {
        layer.setStyle({ weight: layer.options._isSelected ? w.mainSel : w.main });
      }
    });
    if (routeLayer) routeLayer.setStyle({ weight: w.mainSel });
    if (remainingRouteLayer) remainingRouteLayer.setStyle?.({ weight: w.mainSel });
    // Nav alternative layers
    navAlternativeLayers.forEach((layer: any) => {
      if (!layer.setStyle || !layer.options) return;
      if (layer.options._isRoute) layer.setStyle({ weight: w.main });
    });
  }

  function displayAllRouteAlternatives(startPoint: any, sortedPoints: any[]) {
    clearAlternativeRouteLayers();
    const w = getRouteWeight();
    const selected = routeAlternatives[selectedRouteIndex];
    if (!selected?.geometry?.coordinates) return;
    const selectedCoords: [number, number][] = selected.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);

    // 1) วาดเส้นเขียว (selected) เต็มเส้น — opacity 1
    const greenLine = L.polyline(selectedCoords, {
      color: '#00ff88', weight: w.mainSel, opacity: 1,
      lineCap: 'round', lineJoin: 'round', smoothFactor: 0,
      _isSelected: true, _isRoute: true
    } as any).addTo(map);
    greenLine.on('click', () => selectRoute(selectedRouteIndex, startPoint, sortedPoints));

    // 2) วาดเส้นเลือกเฉพาะส่วนที่แยก (diverging) — ไม่ทับเส้นเขียว
    let altClrIdx = 0;
    routeAlternatives.forEach((alt, idx) => {
      if (idx === selectedRouteIndex) return;
      if (!alt.geometry?.coordinates) return;
      const altCoords: [number, number][] = alt.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
      const color = altRouteColors[altClrIdx++ % altRouteColors.length];
      const divergingSections = getDivergingSections(altCoords, selectedCoords);
      if (divergingSections.length === 0) return;

      divergingSections.forEach(section => {
        if (section.length < 2) return;
        const line = L.polyline(section, {
          color: color, weight: w.main, opacity: 0.7,
          lineCap: 'round', lineJoin: 'round', smoothFactor: 0, _isRoute: true
        } as any).addTo(map);
        line.on('click', () => selectRoute(idx, startPoint, sortedPoints));
        const hit = L.polyline(section, { color: 'transparent', weight: 30, opacity: 0 }).addTo(map);
        hit.on('click', () => selectRoute(idx, startPoint, sortedPoints));
        alternativeRouteLayers.push(line, hit);
      });

      // Label ที่ส่วนแยกยาวที่สุด
      const longestSection = divergingSections.reduce((a, b) => a.length > b.length ? a : b);
      const midIdx = Math.floor(longestSection.length / 2);
      const labelMarker = L.marker(longestSection[midIdx], {
        icon: L.divIcon({
          className: 'route-label-marker',
          html: `<div class="route-alt-label" style="background: ${color}; opacity: 0.85">
            <span class="alt-label-text">${alt.label}</span>
            <span class="alt-label-info">${(alt.distance / 1000).toFixed(1)} กม. · ${Math.round(alt.duration / 60)} นาที</span>
            ${alt.hasTolls ? '<span class="alt-toll-badge">💰 ทางด่วน ~฿' + alt.tollEstimate + '</span>' : '<span class="alt-no-toll">✅ ไม่มีทางด่วน</span>'}
          </div>`,
          iconSize: [200, 70], iconAnchor: [100, 35]
        })
      }).addTo(map);
      labelMarker.on('click', () => selectRoute(idx, startPoint, sortedPoints));
      alternativeRouteLayers.push(labelMarker);
      altLabelMarkers.push(labelMarker);
    });

    // เส้นเขียวต้องอยู่บนสุดเสมอ
    greenLine.bringToFront();
    alternativeRouteLayers.push(greenLine);

    // Label visibility ตาม zoom
    if (altLabelMarkers.length > 0) {
      map.on('zoomend', updateAltLabelVisibility);
      updateAltLabelVisibility();
    }
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
      if (zoom >= 15) {
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      } else if (zoom >= 14) {
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

    let navAltClrIdx = 0;
    routeAlternatives.forEach((alt, idx) => {
      if (idx === selectedRouteIndex) return;
      if (!alt.geometry?.coordinates) return;

      const altCoords: [number, number][] = alt.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
      const color = altRouteColors[navAltClrIdx++ % altRouteColors.length];
      const divergingSections = getDivergingSections(altCoords, mainCoords);

      if (divergingSections.length === 0) return;

      const sectionLayers: any[] = [];
      const dw = getRouteWeight();
      divergingSections.forEach(section => {
        if (section.length < 2) return;
        const line = L.polyline(section, {
          color: color, weight: dw.main, opacity: 0.55, lineCap: 'round', lineJoin: 'round', smoothFactor: 0, _isRoute: true
        } as any).addTo(map);
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

      const tollInfo = alt.hasTolls ? `<span class="nav-alt-toll">🚧 ทางด่วน ~฿${alt.tollEstimate}</span>` : `<span class="nav-alt-free">✅ ไม่มีทางด่วน</span>`;
      const labelMarker = L.marker(labelPoint, {
        icon: L.divIcon({
          className: 'route-label-marker',
          html: `<div class="nav-alt-label" style="border-color: ${color}">
            <span class="nav-alt-name" style="color: ${color}">${alt.label}</span>
            <span class="nav-alt-info">${timeLabel} · ${(alt.distance / 1000).toFixed(1)} กม.</span>
            ${tollInfo}
          </div>`,
          iconSize: [180, 55], iconAnchor: [90, 28]
        })
      }).addTo(map);
      navAlternativeLayers.push(labelMarker);
      altLabelMarkers.push(labelMarker);

      const allLines = sectionLayers.filter((_, i) => i % 2 === 0);
      const switchHandler = () => switchNavRoute(idx);
      const highlight = () => { allLines.forEach(l => l.setStyle({ opacity: 1 })); };
      const unhighlight = () => { allLines.forEach(l => l.setStyle({ opacity: 0.45 })); };
      sectionLayers.forEach(l => { l.on('click', switchHandler); l.on('mouseover', highlight); l.on('mouseout', unhighlight); });
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

    // Clear and redraw only main route (no alternatives after selection)
    clearAllRouteLayers();
    clearNavAlternativeLayers();
    updateRouteDisplayForNavigation();
    updateNavigationMarkers();

    // Show detailed route info
    const distKm = (alt.distance / 1000).toFixed(1);
    const timeMin = Math.round(alt.duration / 60);
    let info = `เปลี่ยนเส้นทาง: ${alt.label} · ${distKm} กม. · ${timeMin} นาที`;
    if (alt.hasTolls) info += ` · ทางด่วน ~฿${alt.tollEstimate}`;
    else info += ' · ไม่มีทางด่วน';
    showNotification(info, alt.hasTolls ? 'warning' : 'success');
    speak(`เปลี่ยนไป${alt.label} ระยะทาง ${distKm} กิโลเมตร ${timeMin} นาที ${alt.hasTolls ? 'มีทางด่วน' : 'ไม่มีทางด่วน'}`);
  }

  // ==================== MANUAL WAYPOINT (จุดผ่านทาง) ====================

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

      const data = await routeWithOSRMFallback(waypointCoords, { steps: true, exclude: getExcludeOptions() });

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
      // Reset alternatives to current single route
      routeAlternatives = [{
        index: 0, geometry: data.routes[0].geometry, distance: data.routes[0].distance, duration: data.routes[0].duration,
        legs: data.routes[0].legs || [], hasTolls: detectTollRoad(data.routes[0]), tollEstimate: estimateTollCost(data.routes[0]),
        label: 'เส้นทางปัจจุบัน', color: routeColors[0], excludeUsed: getExcludeOptions()
      }];
      selectedRouteIndex = 0;

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
    let altColorIdx = 0;

    routeAlternatives.forEach((alt, idx) => {
      if (idx === selectedRouteIndex) return;
      if (!alt.geometry?.coordinates) return;

      const altCoords: [number, number][] = alt.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
      const color = altRouteColors[altColorIdx++ % altRouteColors.length];
      const divergingSections = getDivergingSections(altCoords, mainCoords);
      if (divergingSections.length === 0) return;

      const sectionLayers: any[] = [];
      divergingSections.forEach(section => {
        if (section.length < 2) return;
        const rw = getRouteWeight();
        const line = L.polyline(section, { color, weight: rw.main, opacity: 0.55, lineCap: 'round', lineJoin: 'round', smoothFactor: 0, _isRoute: true } as any).addTo(map);
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

      const highlight = () => { allLines.forEach(l => l.setStyle({ opacity: 1 })); };
      const unhighlight = () => { allLines.forEach(l => l.setStyle({ opacity: 0.45 })); };
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
    // Skip off-route check for first 8 seconds (GPS settling period)
    if (Date.now() - navigationStartTime.getTime() < 8000) return;
    // Skip if GPS accuracy is too poor (> 100m) - would trigger false off-route
    if (accuracy > 100) return;
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
    if (isAutoRerouting) return false; // Prevent concurrent reroutes
    isAutoRerouting = true;
    try {
      const remainingPoints = optimizedRoute.optimized_order.filter((p: any) => p.id !== -1 && !arrivedPoints.includes(optimizedRoute.optimized_order.indexOf(p)));
      if (remainingPoints.length === 0) {
        showNotification('ถึงจุดหมายแล้ว!', 'success');
        stopNavigation();
        return false;
      }
      const sortedPoints = sortByNearestNeighbor(currentLocation, remainingPoints);
      // Include custom waypoints if any
      const waypointCoords = [
        `${currentLocation.lng},${currentLocation.lat}`,
        ...customWaypoints.map(w => `${w.lng},${w.lat}`),
        ...sortedPoints.map((p: any) => `${p.lng},${p.lat}`)
      ].join(';');
      // Single fastest route - no alternatives, just go
      const exclude = getExcludeOptions();
      const data = await routeWithOSRMFallback(waypointCoords, { steps: true, exclude: exclude.length > 0 ? exclude : undefined });
      const mainRoute = data.routes[0];
      if (!mainRoute?.geometry?.coordinates) {
        showNotification('ข้อมูลเส้นทางไม่ถูกต้อง', 'error');
        return false;
      }
      optimizedRoute = {
        route: { geometry: mainRoute.geometry },
        total_distance: mainRoute.distance,
        total_time: mainRoute.duration,
        optimized_order: [{ ...currentLocation, name: 'ตำแหน่งปัจจุบัน', address: 'ตำแหน่งของคุณ', id: -1 }, ...sortedPoints]
      };
      turnInstructions = extractTurnInstructions(mainRoute);
      currentStepIndex = 0;
      lastSpokenStepIndex = -1;
      lastSpokenThreshold = '';
      arrivalAnnounced = false;
      arrivalProximityAnnounced = false;
      lastArrivalDist = Infinity;
      updateNextTurnInfo();
      remainingDistance = mainRoute.distance;
      remainingTime = mainRoute.duration;
      currentTargetIndex = 1;
      arrivedPoints = [0];
      // Re-cache route coordinates after reroute
      cachedRouteCoords = mainRoute.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
      lastRouteIndex = 0;
      lastDrawnRouteIndex = -1;
      // Update single route (no alternatives)
      const hasTolls = detectTollRoad(mainRoute);
      const tollEstimate = estimateTollCost(mainRoute);
      routeAlternatives = [{
        index: 0, geometry: mainRoute.geometry, distance: mainRoute.distance, duration: mainRoute.duration,
        legs: mainRoute.legs || [], hasTolls, tollEstimate,
        label: 'เส้นทางใหม่', color: routeColors[0], excludeUsed: exclude
      }];
      selectedRouteIndex = 0;
      clearAllRouteLayers();
      clearNavAlternativeLayers();
      updateRouteDisplayForNavigation();
      updateNavigationMarkers();
      isOffRoute = false;
      offRouteDistance = 0;
      consecutiveOffRouteCount = 0;
      // Reset heading rotation to prevent stale heading causing map spin
      _lastAppliedRotation = 0;
      if (map) {
        resetMapRotation();
      }
      // Build route info notification with toll & incident warnings
      const distKm = (mainRoute.distance / 1000).toFixed(1);
      const timeMin = Math.round(mainRoute.duration / 60);
      let routeInfo = `เส้นทางใหม่: ${distKm} กม. · ${timeMin} นาที`;
      if (hasTolls) routeInfo += ` · 🚧 ทางด่วน ~฿${tollEstimate}`;
      else routeInfo += ' · ✅ ไม่มีทางด่วน';
      // Check for incidents on new route
      if (incidentsOnRoute.length > 0) {
        routeInfo += ` · ⚠️ ${incidentsOnRoute.length} เหตุการณ์บนเส้นทาง`;
      }
      showNotification(routeInfo, hasTolls || incidentsOnRoute.length > 0 ? 'warning' : 'success');
      let speakText = `คำนวณเส้นทางใหม่ ระยะทาง ${distKm} กิโลเมตร ${timeMin} นาที`;
      speakText += hasTolls ? ' มีทางด่วน' : ' ไม่มีทางด่วน';
      if (incidentsOnRoute.length > 0) speakText += ` มี ${incidentsOnRoute.length} เหตุการณ์บนเส้นทาง`;
      speak(speakText);
      return true;
    } catch (err) {
      showNotification('คำนวณเส้นทางใหม่ไม่สำเร็จ', 'error');
      return false;
    } finally {
      isAutoRerouting = false;
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

  // ==================== FETCH WITH TIMEOUT HELPER ====================
  async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const { timeout = 10000, ...fetchOptions } = options;
    const controller = fetchOptions.signal ? undefined : new AbortController();
    const signal = fetchOptions.signal || controller?.signal;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const res = await fetch(url, { ...fetchOptions, signal });
      if (timeoutId) clearTimeout(timeoutId);
      return res;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal?.aborted) throw err;
      await new Promise(r => setTimeout(r, 300));
      return fetch(url, { ...fetchOptions, signal });
    }
  }

  // searchPlace + handleSearchInput moved to SearchPanel component

  // Reverse geocode: แปลงพิกัดเป็นที่อยู่
  async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; address: string } | null> {
    try {
      const params = new URLSearchParams({
        lat: String(lat), lon: String(lng),
        format: 'json', addressdetails: '1', 'accept-language': 'th'
      });
      params.set('endpoint', 'reverse');
      const res = await fetchWithTimeout(`/api/geocode?${params.toString()}`, {
        timeout: 8000
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
    } catch (err: any) {
      if (err.name === 'AbortError') return null;
      return null;
    }
  }

  function selectSearchResult(result: any) {
    if (map) map.flyTo([result.lat, result.lng], 16, { duration: 0.8 });
    if (destinationMarker) destinationMarker.remove();
    destinationMarker = L.marker([result.lat, result.lng], {
      icon: L.divIcon({
        className: 'search-result-marker',
        html: `<div class="search-pin">📍<div class="search-pin-label">${escapeHtml(result.name)}</div></div>`,
        iconSize: [40, 50], iconAnchor: [20, 50]
      })
    }).addTo(map);
    directDestination = { lat: result.lat, lng: result.lng, name: result.name, address: result.address };
  }

  // loadRecentSearches, saveRecentSearches, addToRecentSearches, selectRecentSearch, clearRecentSearches moved to SearchPanel component

  async function navigateToSearchResult() {
    if (!directDestination) return;
    newPoint = { name: directDestination.name, address: directDestination.address || directDestination.name, lat: directDestination.lat, lng: directDestination.lng, priority: 1 };
    try {
      await addDeliveryPoint();
      // Clear destination marker + state
      if (destinationMarker) { destinationMarker.remove(); destinationMarker = null; }
      directDestination = null;
    } catch (err) {
      showNotification('ไม่สามารถนำทางได้', 'error');
    }
  }

  // ==================== DIRECT A→B NAVIGATION ====================

  async function directNavigate(destination: { lat: number; lng: number; name: string }) {
    try {
      const startPoint = await getStartPoint();
      const waypoints = `${startPoint.lng},${startPoint.lat};${destination.lng},${destination.lat}`;

      // Use fetchRouteAlternatives for consistent multi-route fetching
      const routes = await fetchRouteAlternatives(waypoints);

      routeAlternatives = routes.map((route: any, index: number) => {
        const hasTolls = detectTollRoad(route);
        const baseLabel = route._label || routeLabels[index] || `เส้นทาง ${index + 1}`;
        return {
          index, geometry: route.geometry, distance: route.distance, duration: route.duration,
          legs: route.legs || [], steps: extractTurnInstructions(route),
          hasTolls, tollEstimate: estimateTollCost(route),
          label: hasTolls ? `${baseLabel} (ทางด่วน)` : baseLabel,
          color: route._color || routeColors[index % routeColors.length],
          excludeUsed: route._exclude || []
        };
      });
      const startData = { ...startPoint, name: useCustomStartPoint && customStartPoint ? customStartPoint.name : 'ตำแหน่งปัจจุบัน', address: 'จุดเริ่มต้น', id: -1 };
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
    // If we have delivery points, recalculate route with new preferences
    else if (allDeliveryPoints.length > 0) {
      optimizeRoute();
    }
  }

  // ==================== ROUTE COMPARISON HELPERS ====================

  function getTimeSaved(alt: any, baseIndex: number = 0): number {
    if (!routeAlternatives[baseIndex]) return 0;
    return alt.duration - routeAlternatives[baseIndex].duration;
  }

  function getFuelCostForRoute(distanceMeters: number, durationSeconds?: number): number {
    const distKm = distanceMeters / 1000;
    if (vehicleType === 'fuel') {
      return (distKm / KM_PER_LITER) * currentFuelPrice;
    }
    const rate = getEVConsumptionForRoute(distanceMeters, durationSeconds);
    return ((distKm / 100) * rate) * ELECTRICITY_PRICE_PER_KWH;
  }

  async function optimizeRoute() {
    if (isOptimizing) return; // Prevent concurrent calls
    if (allDeliveryPoints.length < 1) {
      showNotification('ต้องมีอย่างน้อย 1 จุดแวะ', 'error');
      return;
    }
    isOptimizing = true;
    if (routeAbortController) routeAbortController.abort();
    routeAbortController = new AbortController();
    const signal = routeAbortController.signal;
    try {
      const startPoint = await getStartPoint();
      const sortedPoints = manualOrder
        ? [...allDeliveryPoints]
        : sortByNearestNeighbor(startPoint, [...allDeliveryPoints]);
      const waypoints = [`${startPoint.lng},${startPoint.lat}`, ...sortedPoints.map((p: any) => `${p.lng},${p.lat}`)].join(';');

      const routes = await fetchRouteAlternatives(waypoints, signal);

      routeAlternatives = routes.map((route: any, index: number) => {
        const hasTolls = detectTollRoad(route);
        const baseLabel = route._label || routeLabels[index] || `เส้นทาง ${index + 1}`;
        return {
          index, geometry: route.geometry, distance: route.distance, duration: route.duration,
          legs: route.legs || [],
          hasTolls, tollEstimate: estimateTollCost(route),
          label: hasTolls ? `${baseLabel} (ทางด่วน)` : baseLabel,
          color: route._color || routeColors[index % routeColors.length],
          excludeUsed: route._exclude || []
        };
      });

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
      // Reset add point mode and hide sidebar after successful route calculation
      if (addPointMode) { addPointMode = false; if (map) map.getContainer().style.cursor = ''; if (clickMarker) { clickMarker.remove(); clickMarker = null; } }
      if (typeof window !== 'undefined' && window.innerWidth <= 1024) {
        mobileSidebarOpen = false;
      } else {
        desktopSidebarCollapsed = true;
      }
      smoothMapResize();
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

  // Build real distance matrix using OSRM Table API (1 call for NxN matrix)
  async function buildRealDistanceMatrix(points: { lat: number; lng: number }[]): Promise<number[][]> {
    const n = points.length;
    const coords = points.map(p => `${p.lng},${p.lat}`).join(';');

    try {
      optimizationProgress = 60;
      const table = await callOSRMTable(coords);
      optimizationProgress = 90;

      const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const dist = table.distances[i][j];
          // null = unreachable → fallback to Haversine
          matrix[i][j] = dist != null ? dist : getDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
        }
      }
      optimizationProgress = 100;
      return matrix;
    } catch {
      // OSRM Table failed entirely → fallback to pair-by-pair via Mapbox
      const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
      const pairs: { i: number; j: number }[] = [];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          pairs.push({ i, j });
        }
      }
      const batchSize = 5;
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
        optimizationProgress = Math.round((completed / pairs.length) * 50) + 50;
      }
      return matrix;
    }
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
      const startPoint = await getStartPoint();

      // Build points array with start at index 0
      const points = [startPoint, ...allDeliveryPoints.map(p => ({ lat: p.lat, lng: p.lng }))];

      optimizationProgress = 10;

      // Original order (user's current order)
      const originalTour = [0, ...allDeliveryPoints.map((_: any, i: number) => i + 1)];

      // Step 1: Get initial tour from nearest neighbor
      const nnOrder = sortByNearestNeighbor(startPoint, [...allDeliveryPoints]);
      const initialTour = [0, ...nnOrder.map((p: any) => allDeliveryPoints.findIndex((dp: any) => dp.id === p.id) + 1).filter(idx => idx > 0)];

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

      // Calculate before distance (user's original order, NOT nearest neighbor)
      const beforeDistance = calculateTourDistance(originalTour, matrix);

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
      showNotification(err.message || 'จัดลำดับไม่สำเร็จ', 'error');
    } finally {
      isOptimizingOrder = false;
      optimizationProgress = 0;
    }
  }

  // ==================== AI ROUTE PLANNING ====================
  async function requestAIRouteOptimization() {
    if (allDeliveryPoints.length < 2) {
      showNotification('ต้องมีอย่างน้อย 2 จุดส่งเพื่อใช้ AI วางแผน', 'warning');
      return;
    }
    isAIPlanning = true;
    showAISuggestion = true;
    aiSuggestion = null;

    try {
      const startPoint = await getStartPoint();
      const pointsData = allDeliveryPoints.map((p: any) => ({
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        priority: p.priority || 3,
        address: p.address || ''
      }));

      const res = await fetch('/api/ai/route-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: pointsData,
          startLocation: startPoint,
          currentTime: new Date().toLocaleString('th-TH'),
          vehicleType
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'AI ไม่ตอบสนอง' }));
        throw new Error(err.error || `AI error: ${res.status}`);
      }

      aiSuggestion = await res.json();
    } catch (err: any) {
      showNotification(err.message || 'AI วางแผนไม่สำเร็จ', 'error');
      showAISuggestion = false;
    } finally {
      isAIPlanning = false;
    }
  }

  function applyAISuggestion(event: CustomEvent<{ order: number[] }>) {
    const { order } = event.detail;
    if (!order || order.length === 0) return;

    const newOrder = order
      .map(idx => allDeliveryPoints[idx - 1])
      .filter(Boolean);

    if (newOrder.length > 0) {
      deliveryPoints = newOrder;
      manualOrder = true;
      displayPoints();
      showNotification('ใช้ลำดับ AI แล้ว! กด "คำนวณเส้นทาง" เพื่อดูเส้นทาง', 'success');
      speak('ใช้ลำดับจาก AI เรียบร้อยแล้ว');

      if (optimizedRoute) {
        optimizeRoute();
      }
    }
    showAISuggestion = false;
    aiSuggestion = null;
  }

  // ==================== GPS FUNCTIONS - COPIED EXACTLY FROM ORIGINAL ====================
  function getCurrentLocationAsStart(): Promise<{ lat: number; lng: number }> {
    const inner = new Promise<{ lat: number; lng: number }>((resolve, reject) => {
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
    return withTimeout(inner, 20000, 'GPS location');
  }

  // จุดเริ่มต้น: GPS หรือกำหนดเอง
  async function getStartPoint(): Promise<{ lat: number; lng: number }> {
    if (useCustomStartPoint || showStartPointPicker) {
      if (customStartPoint) {
        return { lat: customStartPoint.lat, lng: customStartPoint.lng };
      }
      throw new Error('กรุณากำหนดจุดเริ่มต้นก่อนคำนวณเส้นทาง');
    }
    return getCurrentLocationAsStart();
  }

  async function searchStartPoint(query: string) {
    if (!query.trim() || query.trim().length < 2) { startPointResults = []; return; }
    isSearchingStartPoint = true;
    try {
      const res = await fetch(`/api/geocode?endpoint=search&format=json&q=${encodeURIComponent(query)}&countrycodes=th&limit=5&accept-language=th`);
      const data = await res.json();
      startPointResults = data.map((r: any) => ({
        lat: parseFloat(r.lat), lng: parseFloat(r.lon),
        name: r.display_name.split(',').slice(0, 2).join(','),
        fullName: r.display_name
      }));
    } catch { startPointResults = []; }
    isSearchingStartPoint = false;
  }

  function setCustomStartFromSearch(result: { lat: number; lng: number; name: string }) {
    useCustomStartPoint = true;
    customStartPoint = result;
    localStorage.setItem(getUserKey('customStartPoint'), JSON.stringify(result));
    showStartPointPicker = false;
    startPointResults = [];
    startPointSearchQuery = '';
    // ซ่อน GPS blue dot + accuracy circle
    if (currentLocationMarker && map) {
      try { map.removeLayer(currentLocationMarker); } catch(_){}
      currentLocationMarker = null;
    }
    // วาง marker จุดเริ่มต้นแบบเด่น (คล้าย GPS blue dot แต่สีเขียว)
    if (customStartMarker) { try { map.removeLayer(customStartMarker); } catch(_){} }
    if (map && L) {
      customStartMarker = L.marker([result.lat, result.lng], {
        icon: L.divIcon({
          className: 'custom-start-marker',
          html: `<div class="custom-start-wrapper">
            <div class="custom-start-pulse"></div>
            <div class="custom-start-pulse custom-start-pulse-2"></div>
            <div class="custom-start-dot"></div>
            <div class="custom-start-label">${escapeHtml(result.name)}</div>
          </div>`,
          iconSize: [44, 44], iconAnchor: [22, 22]
        }),
        zIndexOffset: 1000,
        interactive: true
      }).addTo(map);
      map.setView([result.lat, result.lng], 14);
    }
  }

  function clearCustomStartPoint() {
    useCustomStartPoint = false;
    customStartPoint = null;
    localStorage.removeItem(getUserKey('customStartPoint'));
    showStartPointPicker = false;
    startPointResults = [];
    startPointSearchQuery = '';
    if (customStartMarker) { try { map.removeLayer(customStartMarker); } catch(_){} customStartMarker = null; }
    // คืน GPS blue dot
    if (currentLocation && map && L && !currentLocationMarker) {
      currentLocationMarker = L.marker([currentLocation.lat, currentLocation.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="my-loc-wrapper"><div class="loc-pulse-ring"></div><div class="loc-pulse-ring loc-pulse-ring-2"></div><div class="heading-beam" style="transform: rotate(0deg); opacity: 0;"></div><div class="my-loc-dot"></div><div class="custom-start-label start-label-gps">ตำแหน่งปัจจุบัน</div></div>`,
          iconSize: [40, 40], iconAnchor: [20, 20]
        }),
        zIndexOffset: 1000, interactive: false
      }).addTo(map);
      headingMarkerElement = currentLocationMarker.getElement();
    }
  }

  function onStartPointSearchInput() {
    if (startSearchTimer) clearTimeout(startSearchTimer);
    startSearchTimer = setTimeout(() => searchStartPoint(startPointSearchQuery), 600);
  }

  function displayOptimizedRoute() {
    if (!L || !map || !optimizedRoute?.route?.geometry) return;
    lockRotation();
    if (routeLayer) routeLayer.remove();
    clearTrafficLayers();
    const coords = optimizedRoute.route.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    const w = getRouteWeight(map.getZoom());
    // Only reduce opacity if traffic data actually exists (legs with congestion)
    const selectedAlt = routeAlternatives[selectedRouteIndex];
    const hasTrafficData = showTraffic && selectedAlt?.legs?.some((l: any) => l?.annotation?.congestion);
    routeLayer = L.polyline(coords, { color: '#00ff88', weight: w.mainSel, opacity: hasTrafficData ? 0.3 : 1, lineCap: 'round', lineJoin: 'round', smoothFactor: 0 }).addTo(map);
    // Draw traffic overlay on top of base route
    if (hasTrafficData) {
      drawTrafficPolyline(selectedAlt, w.mainSel, 1);
    }
    map.fitBounds(routeLayer.getBounds(), { padding: [80, 80] });
    // Keep GPS blue dot as real-time current location (don't remove it)
    markers.forEach(m => m.remove());
    markers = [];
    optimizedRoute.optimized_order.forEach((point: any, i: number) => {
      const isStart = i === 0;
      const isCurrentLocation = isStart && point.id === -1;

      // Skip GPS start point — use blue dot instead (but show custom start)
      if (isCurrentLocation && !useCustomStartPoint) return;

      // Custom start point → marker เด่นสีเขียว
      if (isCurrentLocation && useCustomStartPoint) {
        // customStartMarker แสดงอยู่แล้ว ไม่ต้องสร้างซ้ำ
        return;
      }

      const gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      const glow = '#667eea';
      const markerHtml = `<div class="marker-pin route-pin" style="background: ${gradient}; box-shadow: 0 0 25px ${glow};"><span>${i}</span><div class="marker-name-label">${escapeHtml(point.name)}</div></div>`;

      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: 'route-marker',
          html: markerHtml,
          iconSize: [52, 52],
          iconAnchor: [26, 26]
        })
      }).addTo(map);
      const popupGradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      marker.bindPopup(`<div class="custom-popup"><div class="popup-accent" style="background: ${popupGradient}"></div><div class="popup-header"><div class="popup-badge" style="background: ${popupGradient}">${i}</div><div class="popup-header-text"><h4>${escapeHtml(point.name)}</h4><span class="popup-tag" style="color: #818cf8">จุดแวะ</span></div></div><div class="popup-content"><p>${escapeHtml(point.address)}</p></div></div>`, { className: 'dark-popup' });
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
    clearAllPOI();
    optimizedRoute = null;
    arrivedPoints = [];
    currentTargetIndex = 0;
    clearRouteState();
    displayPoints();
    unlockRotation();
  }

  function startNavigation() {
    if (!optimizedRoute) return;
    if (!navigator.geolocation) {
      showNotification('เบราว์เซอร์ไม่รองรับ GPS', 'error');
      return;
    }

    isNavigating = true;
    _userMapRotation = 0;
    startDeviceCompass(); // เปิดเข็มทิศเซ็นเซอร์
    currentTargetIndex = 1;
    arrivedPoints = [0];

    remainingDistance = optimizedRoute.total_distance;
    remainingTime = optimizedRoute.total_time;
    navigationStartTime = new Date();
    elapsedTime = 0;
    maxSpeed = 0;
    avgSpeedSamples = [];
    _gpsTraceBuffer = [];
    _matchedPosition = null;
    _lastMatchTime = 0;
    lastArrivalDist = Infinity;
    lastDrawnRouteIndex = -1;
    evTripEnergyUsed = 0;
    _lastEnergyLat = 0;
    _lastEnergyLng = 0;

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

    // Start smooth 60fps animation loop (Google Maps-like)
    animReady = false;
    lastGpsTimestamp = 0;
    animCurrentLat = currentLocation?.lat || 0;
    animCurrentLng = currentLocation?.lng || 0;
    animCurrentHeading = 0;
    if (map) map.getContainer().style.transition = 'none';
    startSmoothLoop();

    // perf: reset state tracking for fresh nav session
    _navMarkerState = '';
    _navIntervalTick = 0;
    _lastCurveRouteIdx = 0;
    _lastAppliedRotation = 0;
    _headingUpMode = true; // heading-up rotation on by default
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

    // Detect manual map drag/zoom to disable auto-follow (Google Maps behavior)
    map.off('dragstart'); // prevent duplicate handlers on re-entry
    map.off('zoomstart');
    map.on('dragstart', () => { isMapFollowing = false; });
    map.on('zoomstart', () => { if (!_programmaticZoom) isMapFollowing = false; });

    if (navigationInterval) { clearInterval(navigationInterval); navigationInterval = null; }
    // perf: stagger functions - not everything needs 2s frequency
    navigationInterval = setInterval(() => {
      _navIntervalTick++;
      updateNavigationInfo();
      updateETA();
      if (_navIntervalTick % 3 === 0) updateFuelEstimate();  // every 6s
      if (_navIntervalTick % 5 === 0) updateStatistics();     // every 10s
      // detectCurvesOnRoute: only when moved 50+ route points
      if (Math.abs(lastRouteIndex - _lastCurveRouteIdx) >= 50) {
        _lastCurveRouteIdx = lastRouteIndex;
        detectCurvesOnRoute();
      }
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

    lastDeliveryUndo = null;

    setTimeout(() => { map.invalidateSize(); }, 100);
  }

  async function stopNavigation() {
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
    if (traveledLayer) {
      traveledLayer.remove();
      traveledLayer = null;
    }
    if (remainingRouteLayer) {
      remainingRouteLayer.remove();
      remainingRouteLayer = null;
    }
    // Clean up map drag listener, nav alternatives, and custom waypoints
    stopSmoothLoop();
    stopDeviceCompass();
    _headingUpMode = true; // reset for next navigation session
    if (map) {
      map.off('dragstart');
      map.off('zoomstart');
      map.off('click', onMapClickWaypoint);
      map.getContainer().style.cursor = '';
      resetMapRotation();
      _lastAppliedRotation = 0;
    }
    _gpsTraceBuffer = [];
    _matchedPosition = null;
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
    isAutoRerouting = false;
    cachedRouteCoords = [];
    lastRouteIndex = 0;
    avgSpeedSamples = [];
    evTripEnergyUsed = 0;
    _lastEnergyLat = 0;
    _lastEnergyLng = 0;
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

    clearRoute();
    clearAlternativeRouteLayers();
    routeAlternatives = [];
    showRouteSelector = false;
    showRouteComparison = false;

    // Show current location blue dot after stopping (with heading beam)
    if (currentLocation && map) {
      const hdeg = _deviceCompassHeading !== null ? _deviceCompassHeading : (currentHeading !== null ? currentHeading : 0);
      const hasHeading = _deviceCompassHeading !== null || currentHeading !== null;
      currentLocationMarker = L.marker([currentLocation.lat, currentLocation.lng], {
        icon: L.divIcon({
          className: '',
          html: `
            <div class="my-loc-wrapper">
              <div class="loc-pulse-ring"></div>
              <div class="loc-pulse-ring loc-pulse-ring-2"></div>
              <div class="heading-beam" style="transform: rotate(${hdeg}deg); opacity: ${hasHeading ? 1 : 0};"></div>
              <div class="my-loc-dot"></div>
              <div class="custom-start-label start-label-gps">ตำแหน่งปัจจุบัน</div>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        }),
        zIndexOffset: 1000,
        interactive: false
      }).addTo(map);
      headingMarkerElement = currentLocationMarker.getElement();
      _nonNavBeamCurrent = hdeg;
      _nonNavBeamTarget = hdeg;
      // Restart compass + beam loop หลังหยุดนำทาง
      startDeviceCompass();
      map.setView([currentLocation.lat, currentLocation.lng], 16);
    }
    showNotification('หยุดนำทางแล้ว', 'success');
  }

  // ===== Smooth 60fps interpolation + route prediction (better than Google Maps) =====
  function startSmoothLoop() {
    if (animFrameId !== null) return;
    function tick() {
      animFrameId = requestAnimationFrame(tick);
      if (!isNavigating || !animReady) return;
      const now = performance.now();
      const elapsed = now - animStartTime;
      const t = Math.min(elapsed / animDuration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

      // Heading: always chase target independently (compass updates at 60Hz)
      // alpha 0.08 = smooth & stable, ไม่กระตุกตาม sensor noise
      animCurrentHeading = lerpAngle(animCurrentHeading, animTargetHeading, 0.08);

      if (t < 1) {
        // Phase 1: Smooth interpolation to GPS-snapped target
        animCurrentLat = animPrevLat + (animTargetLat - animPrevLat) * ease;
        animCurrentLng = animPrevLng + (animTargetLng - animPrevLng) * ease;
      } else if (currentSpeed > 5 && cachedRouteCoords.length > 1 && lastRouteIndex < cachedRouteCoords.length - 2) {
        // Phase 2: Predict forward along route using speed (continuous movement)
        const extraSec = (elapsed - animDuration) / 1000;
        const maxPredict = Math.min((currentSpeed / 3.6) * extraSec, 40); // max 40m ahead (reduced to prevent snap-back)
        let walked = 0;
        let idx = lastRouteIndex;
        let predicted = false;
        while (idx < cachedRouteCoords.length - 2 && walked < maxPredict) {
          const dLat = (cachedRouteCoords[idx + 1][0] - cachedRouteCoords[idx][0]) * 111320;
          const dLng = (cachedRouteCoords[idx + 1][1] - cachedRouteCoords[idx][1]) * 108000;
          const segLen = Math.sqrt(dLat * dLat + dLng * dLng);
          if (segLen < 0.1) { idx++; continue; }
          if (walked + segLen >= maxPredict) {
            const frac = (maxPredict - walked) / segLen;
            animCurrentLat = cachedRouteCoords[idx][0] + (cachedRouteCoords[idx + 1][0] - cachedRouteCoords[idx][0]) * frac;
            animCurrentLng = cachedRouteCoords[idx][1] + (cachedRouteCoords[idx + 1][1] - cachedRouteCoords[idx][1]) * frac;
            // Heading from route direction (only when moving fast with GPS heading)
            if (currentSpeed > 5 && currentHeading !== null) {
              const routeHeading = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
              animTargetHeading = routeHeading;
            }
            predicted = true;
            break;
          }
          walked += segLen;
          idx++;
        }
        if (!predicted) {
          animCurrentLat = animTargetLat;
          animCurrentLng = animTargetLng;
        }
      }

      // Move blue dot marker smoothly
      if (currentLocationMarker) {
        currentLocationMarker.setLatLng([animCurrentLat, animCurrentLng]);
      }
      // Rotate heading beam smoothly (compensate for map bearing rotation)
      if (headingMarkerElement) {
        const beam = headingMarkerElement.querySelector('.heading-beam') as HTMLElement;
        if (beam) {
          const mapBearing = (map as any).getBearing?.() || 0;
          beam.style.transform = `rotate(${animCurrentHeading - mapBearing}deg)`;
          beam.style.opacity = (currentHeading !== null || _deviceCompassHeading !== null) ? '1' : '0';
        }
      }
      // Update route line start to follow blue dot in real-time (every 4th frame ~15fps)
      if (remainingRouteLayer && cachedRouteCoords.length > 0 && _animFrameCount % 4 === 0) {
        const coords = remainingRouteLayer.getLatLngs();
        if (coords.length > 1) {
          coords[0] = L.latLng(animCurrentLat, animCurrentLng);
          remainingRouteLayer.setLatLngs(coords);
        }
      }
      _animFrameCount++;
      // Smooth map follow + heading-up rotation (Google Maps-like)
      if (isMapFollowing && map) {
        map.panTo([animCurrentLat, animCurrentLng], { animate: false });
        // Heading-up: rotate map so direction of travel points UP
        if (_headingUpMode && (map as any).setBearing && currentSpeed > 3 && (currentHeading !== null || _deviceCompassHeading !== null)) {
          const curBearing = (map as any).getBearing() || 0;
          const bearingDiff = Math.abs(((animCurrentHeading - curBearing + 540) % 360) - 180);
          if (bearingDiff > 1) {
            const smoothBearing = lerpAngle(curBearing, animCurrentHeading, 0.1);
            (map as any).setBearing(smoothBearing);
          }
        }
      }
    }
    tick();
  }

  function stopSmoothLoop() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    animReady = false;
  }

  function lerpAngle(from: number, to: number, t: number): number {
    let diff = ((to - from + 540) % 360) - 180;
    return (from + diff * t + 360) % 360;
  }

  // ⚠️ CRITICAL: updatePosition - ENHANCED WITH SMOOTH TRACKING & HEADING
  function updatePosition(position: GeolocationPosition) {
    const { latitude, longitude, accuracy: acc, heading, speed: gpsSpeed } = position.coords;
    currentLocation = { lat: latitude, lng: longitude, heading, speed: gpsSpeed };
    accuracy = acc;
    // Update heading from GPS or calculate from movement (with smoothing)
    if (heading !== null && heading !== undefined && !isNaN(heading) && gpsSpeed && gpsSpeed > 1) {
      // Smooth heading with low-pass filter to prevent jitter
      if (currentHeading !== null) {
        let diff = ((heading - currentHeading + 540) % 360) - 180;
        // Reject impossibly fast heading changes (> 90deg between updates at low speed)
        if (Math.abs(diff) > 90 && gpsSpeed < 5) {
          // Dampen heavily - likely GPS noise
          currentHeading = ((currentHeading + diff * 0.1) + 360) % 360;
        } else {
          currentHeading = ((currentHeading + diff * 0.4) + 360) % 360;
        }
      } else {
        currentHeading = heading;
      }
    } else if (lastPosition && gpsSpeed && gpsSpeed > 1) {
      // Calculate heading from consecutive positions (for laptops without compass)
      const dLat = latitude - lastPosition.lat;
      const dLng = longitude - lastPosition.lng;
      if (Math.abs(dLat) > 0.00003 || Math.abs(dLng) > 0.00003) {
        const newHeading = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
        if (currentHeading !== null) {
          let diff = ((newHeading - currentHeading + 540) % 360) - 180;
          currentHeading = ((currentHeading + diff * 0.3) + 360) % 360;
        } else {
          currentHeading = newHeading;
        }
      }
    } else if (_deviceCompassHeading !== null) {
      // Fallback: ใช้เข็มทิศเซ็นเซอร์ตอนยืนอยู่กับที่/ช้า
      // compass handler smooth ไว้แล้ว (alpha 0.5) ไม่ต้อง smooth ซ้ำ
      currentHeading = _deviceCompassHeading;
    }
    // อัพเดท compass heading จาก GPS heading (เมื่อเคลื่อนที่เร็ว)
    if (currentHeading !== null && currentSpeed > 5) {
      compassHeading = currentHeading;
      const dirs = ['N','NE','E','SE','S','SW','W','NW'];
      compassDir = dirs[Math.round(currentHeading / 45) % 8];
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
    // EV: accumulate actual energy used based on GPS distance × speed-dependent rate
    if (isNavigating && vehicleType === 'ev' && _lastEnergyLat !== 0) {
      const deltaKm = getDistance(_lastEnergyLat, _lastEnergyLng, latitude, longitude);
      if (deltaKm > 0.005 && deltaKm < 2) { // 5m to 2km sanity
        const rateAtSpeed = getEVConsumptionAtSpeed(currentSpeed);
        evTripEnergyUsed += deltaKm * (rateAtSpeed / 100);
      }
    }
    if (isNavigating && vehicleType === 'ev') {
      _lastEnergyLat = latitude;
      _lastEnergyLng = longitude;
    }
    // OSRM Match — buffer GPS trace & periodically snap to road
    if (isNavigating && currentSpeed > 3) {
      _gpsTraceBuffer.push([longitude, latitude]);
      if (_gpsTraceBuffer.length > 15) _gpsTraceBuffer.shift();
      const now = Date.now();
      if (_gpsTraceBuffer.length >= 3 && now - _lastMatchTime > 5000) {
        _lastMatchTime = now;
        callOSRMMatch(_gpsTraceBuffer).then(result => {
          if (result.coordinates.length > 0) {
            const last = result.coordinates[result.coordinates.length - 1];
            const mLat = last[1], mLng = last[0];
            // Validate: reject matched position if behind current route progress
            if (cachedRouteCoords.length > 1 && lastRouteIndex < cachedRouteCoords.length) {
              let bestIdx = lastRouteIndex;
              let bestDist = Infinity;
              const sEnd = Math.min(cachedRouteCoords.length, lastRouteIndex + 30);
              for (let si = Math.max(0, lastRouteIndex - 3); si < sEnd; si++) {
                const d = getDistance(mLat, mLng, cachedRouteCoords[si][0], cachedRouteCoords[si][1]);
                if (d < bestDist) { bestDist = d; bestIdx = si; }
              }
              // Only accept if at or ahead of current progress
              if (bestIdx >= lastRouteIndex - 1) {
                _matchedPosition = { lat: mLat, lng: mLng };
              }
              // else: stale match behind us — ignore
            } else {
              _matchedPosition = { lat: mLat, lng: mLng };
            }
          }
        }).catch(() => { /* Match failed — ignore, use raw GPS */ });
      }
    }
    // Update nearest route index FIRST (fresh for all subsequent functions)
    if (isNavigating && cachedRouteCoords.length > 0) {
      findNearestPointIndex(cachedRouteCoords, { lat: latitude, lng: longitude });
    }
    updateCurrentLocationMarker();
    updateRouteDisplayForNavigation();
    updateNavigationMarkers();
    checkArrival();
    handleOffRouteDetection();
    updateTurnByTurnProgress();
    checkSpeedAlert();
    // Set smooth animation targets (60fps loop handles all visuals)
    if (isNavigating && map) {
      // Adapt animation speed to GPS update rate
      const now = performance.now();
      if (lastGpsTimestamp > 0) {
        animDuration = Math.min(Math.max(now - lastGpsTimestamp, 500), 2000);
      }
      lastGpsTimestamp = now;

      // Use OSRM Match position if available (already snapped to road network)
      let snapLat = _matchedPosition ? _matchedPosition.lat : latitude;
      let snapLng = _matchedPosition ? _matchedPosition.lng : longitude;
      // Smart route snapping: accuracy-weighted (trust route more when GPS is poor)
      if (cachedRouteCoords.length > 1) {
        const nearIdx = lastRouteIndex;
        const distToRoute = getDistance(latitude, longitude, cachedRouteCoords[nearIdx][0], cachedRouteCoords[nearIdx][1]);
        // Snap threshold scales with GPS accuracy (poor GPS = more aggressive snap)
        const snapThreshold = Math.max(30, Math.min(acc * 1.5, 200));
        if (distToRoute < snapThreshold && nearIdx < cachedRouteCoords.length - 1) {
          const [lat1, lng1] = cachedRouteCoords[nearIdx];
          const [lat2, lng2] = cachedRouteCoords[nearIdx + 1];
          const dx = lat2 - lat1, dy = lng2 - lng1;
          const len2 = dx * dx + dy * dy;
          if (len2 > 0) {
            const t = Math.max(0, Math.min(1, ((latitude - lat1) * dx + (longitude - lng1) * dy) / len2));
            const projLat = lat1 + t * dx;
            const projLng = lng1 + t * dy;
            // Blend: poor GPS accuracy → snap harder to route
            const snapWeight = Math.min(acc / 30, 1); // 0 = perfect GPS, 1 = poor GPS
            snapLat = latitude * (1 - snapWeight) + projLat * snapWeight;
            snapLng = longitude * (1 - snapWeight) + projLng * snapWeight;
          }
        }
      }

      // Outlier rejection: reject GPS jumps that are impossibly far
      if (animReady) {
        const jumpDist = getDistance(animCurrentLat, animCurrentLng, snapLat, snapLng);
        const timeSec = animDuration / 1000;
        const maxJump = Math.max((currentSpeed / 3.6) * timeSec * 4, 200); // 4x speed or 200m min
        if (jumpDist > maxJump && jumpDist > 500) {
          // GPS jumped impossibly far - extend animation duration to smooth it
          animDuration = Math.min(animDuration * 2, 3000);
        }
      }

      // Anti-warp: prevent snap position going backward along route direction
      if (animReady && cachedRouteCoords.length > 1 && lastRouteIndex < cachedRouteCoords.length - 1) {
        const routeDirLat = cachedRouteCoords[lastRouteIndex + 1][0] - cachedRouteCoords[lastRouteIndex][0];
        const routeDirLng = cachedRouteCoords[lastRouteIndex + 1][1] - cachedRouteCoords[lastRouteIndex][1];
        const moveLat = snapLat - animCurrentLat;
        const moveLng = snapLng - animCurrentLng;
        // Dot product: negative = backward movement along route
        const dot = moveLat * routeDirLat + moveLng * routeDirLng;
        if (dot < 0 && currentSpeed > 3) {
          // Snap would go backward — hold current position until GPS catches up
          snapLat = animCurrentLat;
          snapLng = animCurrentLng;
        }
      }

      // Set interpolation targets
      animPrevLat = animReady ? animCurrentLat : snapLat;
      animPrevLng = animReady ? animCurrentLng : snapLng;
      animPrevHeading = animReady ? animCurrentHeading : (currentHeading || 0);
      animTargetLat = snapLat;
      animTargetLng = snapLng;
      animTargetHeading = currentHeading !== null ? currentHeading : animPrevHeading;
      animStartTime = performance.now();
      animReady = true;

      // Auto-zoom (only when following)
      if (isMapFollowing) {
        const targetZoom = getAutoZoom(currentSpeed);
        const cZoom = map.getZoom();
        if (Math.abs(cZoom - targetZoom) > 0.5) {
          _programmaticZoom = true;
          map.setZoom(targetZoom, { animate: true });
          _programmaticZoom = false;
        }
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

  function handleGeoError(error: GeolocationPositionError) {
    let msg = 'ไม่สามารถระบุตำแหน่งได้';
    if (error.code === 1) {
      msg = 'กรุณาอนุญาตการเข้าถึง GPS';
      // Permission denied - stop the navigation watch to prevent repeated errors
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    }
    if (error.code === 2) msg = 'ไม่สามารถระบุตำแหน่งได้';
    if (error.code === 3) msg = 'หมดเวลาการระบุตำแหน่ง';
    showNotification(msg, 'error');

    gpsStatus = 'poor';
  }

  function updateCurrentLocationMarker() {
    if (!L || !map || !currentLocation) return;
    // ถ้าใช้จุดเริ่มต้นแบบกำหนดเอง ไม่ต้องแสดง GPS marker
    if (useCustomStartPoint || showStartPointPicker) return;
    const headingDeg = currentHeading !== null ? currentHeading : (_deviceCompassHeading !== null ? _deviceCompassHeading : 0);
    const showHeading = currentHeading !== null || _deviceCompassHeading !== null;

    if (currentLocationMarker) {
      currentLocationMarker.setLatLng([currentLocation.lat, currentLocation.lng]);
      if (headingMarkerElement) {
        const beam = headingMarkerElement.querySelector('.heading-beam') as HTMLElement;
        if (beam) {
          beam.style.transform = `rotate(${headingDeg}deg)`;
          beam.style.opacity = showHeading ? '1' : '0';
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
              <div class="heading-beam" style="transform: rotate(${headingDeg}deg); opacity: ${showHeading ? 1 : 0};"></div>
              <div class="my-loc-dot"></div>
              <div class="custom-start-label start-label-gps">ตำแหน่งปัจจุบัน</div>
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
    // perf: skip full rebuild if state unchanged (currentTarget + arrived list)
    const stateKey = `${currentTargetIndex}_${arrivedPoints.join(',')}`;
    if (stateKey === _navMarkerState && markers.length > 0) return;
    _navMarkerState = stateKey;
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

      // Skip GPS start point — blue dot แสดงอยู่แล้ว ไม่ต้องซ้อน marker
      if (isStart && !useCustomStartPoint) return;

      let gradient, glow;
      if (isArrived) { gradient = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'; glow = '#6b7280'; }
      else if (isCurrent) { gradient = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'; glow = '#f59e0b'; }
      else if (isStart) { gradient = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)'; glow = '#00ff88'; }
      else { gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; glow = '#667eea'; }

      const displayNumber = isArrived ? '✓' : i;
      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: 'route-marker',
          html: `<div class="marker-pin route-pin ${isArrived ? 'arrived' : ''} ${isCurrent ? 'current-target' : ''}" style="background: ${gradient}; box-shadow: 0 0 25px ${glow};"><span>${displayNumber}</span><div class="marker-name-label">${escapeHtml(point.name)}</div>${isCurrent ? '<div class="marker-label target-label">เป้าหมาย</div>' : ''}</div>`,
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

  // Progressive search: forward-only (O(1) amortized)
  // NEVER goes backward — prevents blue dot warping to passed positions
  function findNearestPointIndex(coords: [number, number][], location: { lat: number; lng: number }): number {
    if (!coords.length) return 0;
    const searchRadius = 50;
    // Forward-only search from current index (no backward = no warp)
    const start = lastRouteIndex;
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
    if (nearestIndex === end - 1 && end < coords.length) {
      const wideEnd = Math.min(coords.length, nearestIndex + 200);
      for (let i = end; i < wideEnd; i++) {
        const dist = getDistance(location.lat, location.lng, coords[i][0], coords[i][1]);
        if (dist < minDist) {
          minDist = dist;
          nearestIndex = i;
        }
      }
    }
    // Monotonic: index only increases (backward = off-route → reroute handles it)
    lastRouteIndex = nearestIndex;
    return lastRouteIndex;
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
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
      } catch (_) {}

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
          <div class="popup-accent" style="background: ${color}"></div>
          <div class="incident-popup-header">
            <div class="popup-badge" style="background: ${color}">${icon}</div>
            <span class="incident-popup-title">${escapeHtml(incident.title)}</span>
          </div>
          <div class="incident-popup-content">
            <p>${escapeHtml(incident.description)}</p>
            <div class="incident-popup-meta">
              <span>📍 ${escapeHtml(incident.road)}</span>
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
    const startIndex = lastRouteIndex;
    // Use animated position for smooth route-following connection to blue dot
    const dotLat = animReady ? animCurrentLat : (currentLocation?.lat || 0);
    const dotLng = animReady ? animCurrentLng : (currentLocation?.lng || 0);
    // Only redraw if moved at least 1 route point
    if (Math.abs(startIndex - lastDrawnRouteIndex) < 1 && lastDrawnRouteIndex >= 0) return;
    lastDrawnRouteIndex = startIndex;
    const nw = getRouteWeight(map.getZoom());
    if (traveledLayer) {
      traveledLayer.remove(); traveledLayer = null;
    }
    const remainingCoords = cachedRouteCoords.slice(startIndex);
    if (remainingCoords.length > 1) {
      // Prepend animated blue dot position for seamless connection
      const displayCoords: [number, number][] = [[dotLat, dotLng] as [number, number], ...remainingCoords];
      if (remainingRouteLayer) {
        remainingRouteLayer.setLatLngs(displayCoords);
        remainingRouteLayer.setStyle({ weight: nw.mainSel });
      } else {
        if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
        remainingRouteLayer = L.polyline(displayCoords, { color: '#00ff88', weight: nw.mainSel, opacity: 1, lineCap: 'round', lineJoin: 'round', smoothFactor: 0 }).addTo(map);
      }
    }
  }

  function clearAllRouteLayers() {
    if (!map) return;
    try {
      if (remainingRouteLayer) map.removeLayer(remainingRouteLayer);
      if (routeLayer) map.removeLayer(routeLayer);
      if (traveledLayer) map.removeLayer(traveledLayer);
    } catch (e) {}
    remainingRouteLayer = routeLayer = traveledLayer = null;
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

      // Single fastest route - no alternatives
      const exclude = getExcludeOptions();
      const data = await routeWithOSRMFallback(waypointCoords, { steps: true, exclude: exclude.length > 0 ? exclude : undefined });
      const mainRoute = data.routes[0];
      if (!mainRoute?.geometry?.coordinates) throw new Error('No route');

      optimizedRoute = {
        route: { geometry: mainRoute.geometry },
        total_distance: mainRoute.distance,
        total_time: mainRoute.duration,
        optimized_order: [{ ...currentLocation, name: 'ตำแหน่งปัจจุบัน', address: 'ตำแหน่งของคุณ', id: -1 }, ...sortedPoints]
      };
      const hasTolls = detectTollRoad(mainRoute);
      const tollEstimate = estimateTollCost(mainRoute);
      routeAlternatives = [{
        index: 0, geometry: mainRoute.geometry, distance: mainRoute.distance, duration: mainRoute.duration,
        legs: mainRoute.legs || [], hasTolls, tollEstimate,
        label: 'เส้นทางใหม่', color: routeColors[0], excludeUsed: exclude
      }];
      selectedRouteIndex = 0;
      // อัพเดท turn-by-turn instructions จากเส้นทางใหม่
      turnInstructions = extractTurnInstructions(mainRoute);
      currentStepIndex = 0;
      lastSpokenStepIndex = -1;
      lastSpokenThreshold = '';
      arrivalAnnounced = false;
      arrivalProximityAnnounced = false;
      lastArrivalDist = Infinity;
      updateNextTurnInfo();

      remainingDistance = mainRoute.distance;
      remainingTime = mainRoute.duration;
      currentTargetIndex = 1;
      arrivedPoints = [0];

      // Re-cache route coordinates for the new route
      cachedRouteCoords = mainRoute.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
      lastRouteIndex = 0;
      lastDrawnRouteIndex = -1;

      clearAllRouteLayers();
      clearNavAlternativeLayers();
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
    } catch (err) {
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


  function updateFuelEstimate() {
    const distanceKm = remainingDistance / 1000;
    if (vehicleType === 'fuel') {
      fuelConsumption = distanceKm / KM_PER_LITER;
      fuelCostEstimate = fuelConsumption * currentFuelPrice;
    } else {
      const estRate = remainingTime > 0
        ? getEVConsumptionForRoute(remainingDistance, remainingTime)
        : getEVConsumptionAtSpeed(currentSpeed > 3 ? currentSpeed : 60);
      evCurrentConsumptionRate = getEVConsumptionAtSpeed(currentSpeed > 1 ? currentSpeed : 60);
      evEnergyConsumption = (distanceKm / 100) * estRate;
      evCostEstimate = evEnergyConsumption * ELECTRICITY_PRICE_PER_KWH;
      evRemainingRange = (evCurrentCharge / 100) * evRangePerCharge;
      const energyUsedPercent = ((evTripEnergyUsed + evEnergyConsumption) / evBatteryCapacity) * 100;
      evBatteryAfterTrip = Math.max(0, evCurrentCharge - energyUsedPercent);
    }
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
    // ค้นหาปั๊ม/สถานีชาร์จใหม่ตาม vehicleType
    if (optimizedRoute) autoSearchStations();
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
    // Cancel previous EV search
    if (evAbortController) { evAbortController.abort(); }
    evAbortController = new AbortController();
    const signal = evAbortController.signal;
    isLoadingStations = true;
    try {
      const res = await fetchWithTimeout(`${API_URL}/ev-stations/nearby?lat=${searchLat}&lng=${searchLng}&radius=100&limit=20&user_id=${currentUser?.id || ''}`, {
        signal, timeout: 12000
      });
      if (signal.aborted) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal.aborted) return;

      if (data.error) throw new Error(data.error);
      if (!Array.isArray(data)) throw new Error('Invalid response');

      chargingStations = data;
      displayChargingStationMarkers();
      showNotification(`พบ ${chargingStations.length} สถานีชาร์จ`, 'success');
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      showNotification('ไม่สามารถโหลดสถานีชาร์จได้ ลองใหม่อีกครั้ง', 'error');
    } finally {
      if (!signal.aborted) isLoadingStations = false;
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
          <div class="popup-accent" style="background: linear-gradient(135deg, #10b981, #059669)"></div>
          <div class="ev-popup-header">
            <div class="popup-badge" style="background: linear-gradient(135deg, #10b981, #059669)">⚡</div>
            <div class="popup-header-text">
              <h4>${escapeHtml(station.name)}</h4>
              <span class="ev-status ${station.isOperational ? 'online' : 'offline'}">${station.isOperational ? '🟢 เปิดให้บริการ' : '🔴 ปิดให้บริการ'}</span>
            </div>
          </div>
          <div class="ev-popup-content">
            <p class="ev-address">📍 ${escapeHtml(station.address)}</p>
            ${station.operator ? `<p class="ev-operator">🏢 ${escapeHtml(station.operator)}</p>` : ''}
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
      const startPoint = await getStartPoint();
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
          minChargeAtArrival: 15,
          user_id: currentUser?.id,
          table: 'users'
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  // Speed-dependent EV consumption model (physics-based)
  function getEVConsumptionAtSpeed(speedKmh: number): number {
    return _getEVConsumptionAtSpeed(speedKmh, KWH_PER_100KM);
  }

  function getEVConsumptionForRoute(distanceMeters: number, durationSeconds?: number): number {
    return _getEVConsumptionForRoute(distanceMeters, durationSeconds || 0, KWH_PER_100KM);
  }

  function getEVBatteryColor(): string {
    if (evCurrentCharge > 50) return '#00ff88';
    if (evCurrentCharge > 20) return '#ffa502';
    return '#ff6b6b';
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
    // perf: only run re-renders when navigating (not idle)
    extraFeaturesInterval = setInterval(() => {
      if (isNavigating) {
        updateStatistics();
        updateETA();
        updateFuelEstimate();
      }
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

  function getRemainingPointsCount(): number {
    if (!optimizedRoute) return allDeliveryPoints.length;
    return optimizedRoute.optimized_order.filter((p: any) => p.id !== -1).length;
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

    const params = new URLSearchParams();
    if (currentUser?.id) params.append('user_id', String(currentUser.id));
    params.append('table', 'users');
    const qs = params.toString();
    for (const id of selectedPoints) {
      try {
        await fetch(`${API_URL}/points/${id}?${qs}`, { method: 'DELETE' });
      } catch (_) {}
    }
    
    await loadDeliveryPoints();
    selectedPoints = [];
    isMultiSelectMode = false;
    if (optimizedRoute) {
      clearRoute();
      clearAlternativeRouteLayers();
      routeAlternatives = [];
      showRouteSelector = false;
      showRouteComparison = false;
    }
    showNotification(`ลบจุดสำเร็จ`, 'success');
  }


  // ═══ Camera rotation — leaflet-rotate จัดการทั้งหมด ═══
  function resetCamView() {
    if (isNavigating) {
      // Toggle heading-up / north-up mode during navigation
      _headingUpMode = !_headingUpMode;
      if (!_headingUpMode) {
        if (map && (map as any).setBearing) (map as any).setBearing(0);
        camAngle = 0;
        camActive = false;
      }
      return;
    }
    if (map && (map as any).setBearing) {
      (map as any).setBearing(0);
    }
    camAngle = 0;
    camActive = false;
  }

  function setupCamRotateListener() {
    if (!map) return;
    map.on('rotate' as any, () => {
      const bearing = (map as any).getBearing?.() || 0;
      camAngle = bearing;
      camActive = Math.abs(bearing) > 0.5;
    });
  }

  // ล็อค/ปลดล็อค rotation ตามสถานะเส้นทาง
  function lockRotation() {
    // Reset bearing to 0 directly (don't trigger heading-up toggle via resetCamView)
    if (map && (map as any).setBearing) {
      (map as any).setBearing(0);
    }
    camAngle = 0;
    camActive = false;
    if (map && (map as any).touchRotate) {
      (map as any).touchRotate.disable();
    }
  }
  function unlockRotation() {
    if (map && (map as any).touchRotate) {
      (map as any).touchRotate.enable();
    }
  }

  function centerOnCurrentLocation() {
    if (currentLocation && map) {
      isMapFollowing = true;
      if (isNavigating) _headingUpMode = true; // re-enable heading-up on recenter
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
    // Cancel previous POI search
    if (poiAbortController) { poiAbortController.abort(); }
    poiAbortController = new AbortController();
    const signal = poiAbortController.signal;
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

      const res = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal, timeout: 30000
      });
      if (signal.aborted) return;
      if (!res.ok) throw new Error(`Overpass API error: HTTP ${res.status}`);
      const data = await res.json();
      if (signal.aborted) return;

      if (!data.elements || !Array.isArray(data.elements)) {
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
        else if (tags.historic) poiType = 'attraction';
        else if (tags.leisure === 'park') poiType = 'park';
        else continue;

        const match = matchPOIToRoute(lat, lon, coords);
        if (match.distFromRoute <= POI_MAX_DIST) {
          pois.push({
            id: String(el.id),
            type: poiType,
            name: tags['name:th'] || tags.name || tags.alt_name || tags.official_name || tags.brand || tags.description || '',
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
      const MIN_SPACING: Record<string, number> = { gas: 20000, convenience: 10000 };
      const lastDist: Record<string, number> = {};
      const spacedPois = pois.filter(p => {
        const minDist = MIN_SPACING[p.type];
        if (!minDist) return true; // ไม่จำกัดประเภทอื่น
        const prev = lastDist[p.type];
        if (prev !== undefined && (p.distAlongRoute - prev) < minDist) return false;
        lastDist[p.type] = p.distAlongRoute;
        return true;
      });
      alongRoutePOIs = spacedPois;
      displayPOIMarkers();
      showPOIModal = true;

      const attractionCount = spacedPois.filter(p => ['viewpoint', 'attraction', 'temple', 'park', 'museum'].includes(p.type)).length;
      showNotification(`พบ ${spacedPois.length} สถานที่ (${attractionCount} ที่เที่ยว)`, 'success');
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      showNotification('ค้นหาสถานที่ล้มเหลว ลองใหม่อีกครั้ง', 'error');
    } finally {
      if (!signal.aborted) isLoadingPOIs = false;
    }
  }

  async function searchEVAlongRoute() {
    if (!optimizedRoute?.route?.geometry?.coordinates) {
      showNotification('ยังไม่มีเส้นทาง กรุณาคำนวณเส้นทางก่อน', 'error');
      return;
    }
    // Cancel previous EV search
    if (evAbortController) { evAbortController.abort(); }
    evAbortController = new AbortController();
    const signal = evAbortController.signal;
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
      const res = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal, timeout: 20000
      });
      if (signal.aborted) return;
      if (!res.ok) throw new Error(`Overpass API error: HTTP ${res.status}`);
      const data = await res.json();
      if (signal.aborted) return;

      if (!data.elements || !Array.isArray(data.elements) || !data.elements.length) {
        showNotification('ไม่พบสถานีชาร์จบนเส้นทาง', 'warning');
        return;
      }

      let count = 0;
      for (const el of data.elements) {
        if (!el.lat || !el.lon) continue;
        const match = matchPOIToRoute(el.lat, el.lon, coords);
        if (match.distFromRoute > POI_MAX_DIST) continue;
        const existsAlready = chargingStations.some(s => Math.abs(s.lat - el.lat) < 0.0005 && Math.abs(s.lng - el.lon) < 0.0005);
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
      if (err.name === 'AbortError') return;
      showNotification('ค้นหาสถานีชาร์จบนเส้นทางล้มเหลว ลองใหม่', 'error');
    } finally {
      if (!signal.aborted) isLoadingStations = false;
    }
  }

  async function autoSearchStations() {
    if (!optimizedRoute?.route?.geometry?.coordinates) return;
    clearAllPOI();
    if (vehicleType === 'fuel') {
      await searchPOIsAlongRoute();
    } else {
      await searchEVAlongRoute();
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

  function getAlongRoutePoiMinZoom(totalCount: number): number {
    if (totalCount <= 5) return 12;
    if (totalCount <= 15) return 14;
    if (totalCount <= 30) return 15;
    return 16;
  }

  function displayPOIMarkers() {
    clearPOIMarkers();
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
    if (!map || !L) return;
    showPOIModal = false;
    clearSelectedPOI();

    // สร้าง selected marker แบบ poi-pin แต่ใหญ่กว่า + มี label
    selectedPOIMarker = L.marker([poi.lat, poi.lng], {
      icon: L.divIcon({
        className: 'selected-poi-marker-wrap',
        html: `<div class="poi-pin selected-poi-pin ${poi.type}">${getPOIIcon(poi.type)}<div class="poi-pin-label selected-poi-label">${escapeHtml(poi.name || getPOILabel(poi.type))}</div><div class="selected-poi-close" onclick="window.__clearSelectedPOI && window.__clearSelectedPOI()">✕</div></div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 44]
      }),
      zIndexOffset: 2000
    }).addTo(map);

    // ลงทะเบียน global callback สำหรับปุ่มยกเลิก
    (window as any).__clearSelectedPOI = () => clearSelectedPOI();

    map.flyTo([poi.lat, poi.lng], 17, { duration: 0.8 });
  }

  function clearSelectedPOI() {
    if (selectedPOIMarker && map) { try { map.removeLayer(selectedPOIMarker); } catch(_) {} selectedPOIMarker = null; }
    if (typeof window !== 'undefined' && (window as any).__clearSelectedPOI) { delete (window as any).__clearSelectedPOI; }
  }

  function closePOIPanel() {
    showPOIModal = false;
  }

  function clearAllPOI() {
    clearPOIMarkers();
    clearSelectedPOI();
    alongRoutePOIs = [];
    showPOIModal = false;
  }

  // ==================== MAP POI — สถานที่บนแผนที่ (ซูมใกล้แล้วกดดูได้) ====================

  // Importance: 1=landmark (ห้าง,โรงพยาบาล,มหาวิท), 2=major (ธนาคาร,วัด,ปั๊ม,โรงเรียน), 3=medium (ร้านอาหาร,เซเว่น), 4=small (ร้านค้าเล็ก,ATM,อาคาร)
  // Min zoom ที่แสดง: 1→14, 2→15, 3→16, 4→17
  function getPoiMinZoom(tags: any): number {
    // Landmark — เห็นตั้งแต่ไกล
    if (tags.amenity === 'hospital') return 14;
    if (tags.amenity === 'university' || tags.amenity === 'college') return 14;
    if (tags.shop === 'mall' || tags.shop === 'department_store') return 14;
    if (tags.tourism === 'attraction' || tags.tourism === 'museum') return 14;
    if (tags.amenity === 'marketplace') return 14;
    if (tags.leisure === 'park') return 14;
    if (tags.amenity === 'bus_station') return 14;
    // Brand ดังๆ — เห็นระดับกลาง
    const bn = (tags.brand || tags.name || '').toLowerCase();
    if (bn.includes('big c') || bn.includes('บิ๊กซี') || bn.includes('lotus') || bn.includes('โลตัส') || bn.includes('makro') || bn.includes('แม็คโคร') || bn.includes('central') || bn.includes('เซ็นทรัล') || bn.includes('tesco')) return 14;
    // Major — เห็น zoom 15
    if (tags.amenity === 'fuel') return 15;
    if (tags.amenity === 'school' || tags.amenity === 'kindergarten') return 15;
    if (tags.amenity === 'bank') return 15;
    if (tags.amenity === 'place_of_worship') return 15;
    if (tags.amenity === 'police' || tags.amenity === 'fire_station') return 15;
    if (tags.tourism === 'hotel' || tags.building === 'hotel') return 15;
    if (tags.amenity === 'cinema') return 15;
    if (tags.amenity === 'charging_station') return 15;
    if (tags.amenity === 'post_office') return 15;
    if (bn.includes('ptt') || bn.includes('shell') || bn.includes('caltex') || bn.includes('bangchak') || bn.includes('บางจาก')) return 15;
    // Medium — เห็น zoom 16
    if (tags.amenity === 'restaurant' || tags.amenity === 'food_court' || tags.amenity === 'fast_food') return 16;
    if (tags.amenity === 'cafe') return 16;
    if (tags.shop === 'convenience' || tags.shop === 'supermarket') return 16;
    if (tags.amenity === 'pharmacy' || tags.amenity === 'clinic') return 16;
    if (tags.amenity === 'library') return 16;
    if (bn.includes('7-eleven') || bn.includes('เซเว่น') || bn.includes('starbucks') || bn.includes('mcdonald') || bn.includes('kfc') || bn.includes('family mart') || bn.includes('แฟมิลี่มาร์ท')) return 16;
    // Small — ต้องซูมใกล้
    return 17;
  }

  // showIcon: true = แสดง emoji/logo เต็มตัว (สถานที่สำคัญ), false = จุดกลมสีเฉยๆ (สถานที่เล็ก)
  function getMapPOIIcon(tags: any): { icon: string; color: string; brandLogo?: string; showIcon: boolean } {
    const bn = (tags.brand || tags.name || '').toLowerCase();

    // ร้านดังๆ — ใช้ตัวอักษร logo + สีร้าน (แสดง icon เสมอ)
    if (bn.includes('7-eleven') || bn.includes('เซเว่น')) return { icon: '🏪', color: '#00875f', brandLogo: '7', showIcon: true };
    if (bn.includes('family mart') || bn.includes('แฟมิลี่มาร์ท')) return { icon: '🏪', color: '#00a651', brandLogo: 'FM', showIcon: true };
    if (bn.includes('lotus') || bn.includes('โลตัส')) return { icon: '🛒', color: '#e31837', brandLogo: 'L', showIcon: true };
    if (bn.includes('big c') || bn.includes('บิ๊กซี')) return { icon: '🛒', color: '#e31837', brandLogo: 'BC', showIcon: true };
    if (bn.includes('makro') || bn.includes('แม็คโคร')) return { icon: '🛒', color: '#003399', brandLogo: 'M', showIcon: true };
    if (bn.includes('tops') || bn.includes('ท็อปส์')) return { icon: '🛒', color: '#00a94f', brandLogo: 'T', showIcon: true };
    if (bn.includes('central') || bn.includes('เซ็นทรัล')) return { icon: '🛍️', color: '#c8102e', brandLogo: 'CW', showIcon: true };
    if (bn.includes('starbucks') || bn.includes('สตาร์บัคส์')) return { icon: '☕', color: '#00704A', brandLogo: 'SB', showIcon: true };
    if (bn.includes('mcdonald') || bn.includes('แมคโดนัลด์')) return { icon: '🍔', color: '#FFC72C', brandLogo: 'Mc', showIcon: true };
    if (bn.includes('kfc')) return { icon: '🍗', color: '#e4002b', brandLogo: 'KFC', showIcon: true };
    if (bn.includes('pizza company') || bn.includes('เดอะ พิซซ่า')) return { icon: '🍕', color: '#d4213d', brandLogo: 'PC', showIcon: true };
    if (bn.includes('pizza hut')) return { icon: '🍕', color: '#ee3a23', brandLogo: 'PH', showIcon: true };
    if (bn.includes('burger king')) return { icon: '🍔', color: '#ff8732', brandLogo: 'BK', showIcon: true };
    if (bn.includes('ptt') || bn.includes('ปตท')) return { icon: '⛽', color: '#00529b', brandLogo: 'PTT', showIcon: true };
    if (bn.includes('shell') || bn.includes('เชลล์')) return { icon: '⛽', color: '#fbce07', brandLogo: 'SH', showIcon: true };
    if (bn.includes('caltex') || bn.includes('คาลเท็กซ์')) return { icon: '⛽', color: '#e31937', brandLogo: 'CT', showIcon: true };
    if (bn.includes('bangchak') || bn.includes('บางจาก')) return { icon: '⛽', color: '#006838', brandLogo: 'BJ', showIcon: true };
    if (bn.includes('cafe amazon') || bn.includes('คาเฟ่อเมซอน')) return { icon: '☕', color: '#006633', brandLogo: 'CA', showIcon: true };
    if (bn.includes('robinson') || bn.includes('โรบินสัน')) return { icon: '🛍️', color: '#1a1a1a', brandLogo: 'RB', showIcon: true };
    if (bn.includes('the mall') || bn.includes('เดอะมอลล์')) return { icon: '🛍️', color: '#8B0000', brandLogo: 'TM', showIcon: true };

    // สถานที่สำคัญ — แสดง emoji icon (showIcon: true)
    if (tags.amenity === 'fuel') return { icon: '⛽', color: '#f97316', showIcon: true };
    if (tags.amenity === 'hospital') return { icon: '🏥', color: '#dc2626', showIcon: true };
    if (tags.amenity === 'school' || tags.amenity === 'kindergarten') return { icon: '🏫', color: '#2563eb', showIcon: true };
    if (tags.amenity === 'university' || tags.amenity === 'college') return { icon: '🎓', color: '#1e40af', showIcon: true };
    if (tags.amenity === 'restaurant' || tags.amenity === 'food_court') return { icon: '🍜', color: '#ef4444', showIcon: true };
    if (tags.amenity === 'fast_food') return { icon: '🍔', color: '#f97316', showIcon: true };
    if (tags.amenity === 'cafe') return { icon: '☕', color: '#92400e', showIcon: true };
    if (tags.amenity === 'bank') return { icon: '🏦', color: '#4a148c', showIcon: true };
    if (tags.amenity === 'pharmacy') return { icon: '💊', color: '#16a34a', showIcon: true };
    if (tags.amenity === 'clinic' || tags.amenity === 'doctors') return { icon: '🩺', color: '#ef4444', showIcon: true };
    if (tags.amenity === 'place_of_worship') return { icon: tags.religion === 'buddhist' ? '🛕' : '⛪', color: '#d97706', showIcon: true };
    if (tags.amenity === 'police') return { icon: '👮', color: '#1e3a5f', showIcon: true };
    if (tags.amenity === 'fire_station') return { icon: '🚒', color: '#dc2626', showIcon: true };
    if (tags.amenity === 'cinema') return { icon: '🎬', color: '#7c3aed', showIcon: true };
    if (tags.amenity === 'marketplace') return { icon: '🏬', color: '#ea580c', showIcon: true };
    if (tags.amenity === 'bus_station') return { icon: '🚌', color: '#0284c7', showIcon: true };
    if (tags.amenity === 'charging_station') return { icon: '⚡', color: '#3b82f6', showIcon: true };
    if (tags.amenity === 'post_office') return { icon: '📮', color: '#dc2626', showIcon: true };
    if (tags.shop === 'convenience') return { icon: '🏪', color: '#22c55e', showIcon: true };
    if (tags.shop === 'supermarket') return { icon: '🛒', color: '#16a34a', showIcon: true };
    if (tags.shop === 'mall' || tags.shop === 'department_store') return { icon: '🛍️', color: '#c026d3', showIcon: true };
    if (tags.tourism === 'hotel' || tags.building === 'hotel') return { icon: '🏨', color: '#7c3aed', showIcon: true };
    if (tags.tourism === 'attraction') return { icon: '🏛️', color: '#d97706', showIcon: true };
    if (tags.tourism === 'museum') return { icon: '🎨', color: '#6366f1', showIcon: true };
    if (tags.leisure === 'park' || tags.leisure === 'garden') return { icon: '🌳', color: '#16a34a', showIcon: true };

    // สถานที่เล็ก — จุดกลมสีเฉยๆ (showIcon: false)
    if (tags.amenity === 'bar' || tags.amenity === 'pub') return { icon: '🍺', color: '#a16207', showIcon: false };
    if (tags.amenity === 'atm') return { icon: '💳', color: '#7c3aed', showIcon: false };
    if (tags.amenity === 'library') return { icon: '📚', color: '#059669', showIcon: false };
    if (tags.amenity === 'parking') return { icon: '🅿️', color: '#2563eb', showIcon: false };
    if (tags.amenity === 'toilets') return { icon: '🚻', color: '#6b7280', showIcon: false };
    if (tags.tourism === 'guest_house' || tags.tourism === 'hostel') return { icon: '🛏️', color: '#8b5cf6', showIcon: false };
    if (tags.tourism === 'viewpoint') return { icon: '📸', color: '#ec4899', showIcon: false };
    if (tags.tourism === 'information') return { icon: 'ℹ️', color: '#0ea5e9', showIcon: false };
    if (tags.leisure === 'sports_centre' || tags.leisure === 'fitness_centre') return { icon: '🏋️', color: '#0d9488', showIcon: false };
    if (tags.leisure === 'swimming_pool') return { icon: '🏊', color: '#0ea5e9', showIcon: false };
    if (tags.leisure === 'playground') return { icon: '🎠', color: '#f59e0b', showIcon: false };
    if (tags.shop === 'clothes' || tags.shop === 'fashion') return { icon: '👗', color: '#ec4899', showIcon: false };
    if (tags.shop === 'electronics') return { icon: '📱', color: '#3b82f6', showIcon: false };
    if (tags.shop === 'hardware') return { icon: '🔧', color: '#78716c', showIcon: false };
    if (tags.shop === 'bakery') return { icon: '🥖', color: '#d97706', showIcon: false };
    if (tags.shop === 'hairdresser' || tags.shop === 'beauty') return { icon: '💇', color: '#ec4899', showIcon: false };
    if (tags.shop === 'car_repair' || tags.shop === 'car') return { icon: '🚗', color: '#6b7280', showIcon: false };
    if (tags.shop === 'motorcycle') return { icon: '🏍️', color: '#78716c', showIcon: false };
    if (tags.shop === 'laundry') return { icon: '🧺', color: '#60a5fa', showIcon: false };
    if (tags.shop) return { icon: '🛒', color: '#6b7280', showIcon: false };
    if (tags.office === 'government') return { icon: '🏛️', color: '#1e3a5f', showIcon: false };
    if (tags.office) return { icon: '🏢', color: '#6b7280', showIcon: false };
    if (tags.building === 'apartments' || tags.building === 'residential') return { icon: '🏠', color: '#78716c', showIcon: false };
    if (tags.building === 'commercial' || tags.building === 'retail') return { icon: '🏬', color: '#6b7280', showIcon: false };
    if (tags.building === 'industrial') return { icon: '🏭', color: '#52525b', showIcon: false };
    if (tags.building) return { icon: '🏗️', color: '#6b7280', showIcon: false };
    return { icon: '📍', color: '#6b7280', showIcon: false };
  }

  function getMapPOIType(tags: any): string {
    if (tags.amenity === 'fuel') return 'ปั๊มน้ำมัน';
    if (tags.shop === 'convenience') return 'ร้านสะดวกซื้อ';
    if (tags.shop === 'supermarket') return 'ซูเปอร์มาร์เก็ต';
    if (tags.amenity === 'restaurant') return 'ร้านอาหาร';
    if (tags.amenity === 'fast_food') return 'ฟาสต์ฟู้ด';
    if (tags.amenity === 'food_court') return 'ศูนย์อาหาร';
    if (tags.amenity === 'cafe') return 'คาเฟ่';
    if (tags.amenity === 'bar' || tags.amenity === 'pub') return 'บาร์';
    if (tags.amenity === 'charging_station') return 'สถานีชาร์จ EV';
    if (tags.amenity === 'bank') return 'ธนาคาร';
    if (tags.amenity === 'atm') return 'ตู้ ATM';
    if (tags.amenity === 'hospital') return 'โรงพยาบาล';
    if (tags.amenity === 'clinic' || tags.amenity === 'doctors') return 'คลินิก';
    if (tags.amenity === 'pharmacy') return 'ร้านยา';
    if (tags.amenity === 'school') return 'โรงเรียน';
    if (tags.amenity === 'kindergarten') return 'โรงเรียนอนุบาล';
    if (tags.amenity === 'university') return 'มหาวิทยาลัย';
    if (tags.amenity === 'college') return 'วิทยาลัย';
    if (tags.amenity === 'place_of_worship') return tags.religion === 'buddhist' ? 'วัด' : 'ศาสนสถาน';
    if (tags.amenity === 'cinema') return 'โรงหนัง';
    if (tags.amenity === 'library') return 'ห้องสมุด';
    if (tags.amenity === 'marketplace') return 'ตลาด';
    if (tags.amenity === 'bus_station') return 'สถานีขนส่ง';
    if (tags.amenity === 'fire_station') return 'สถานีดับเพลิง';
    if (tags.amenity === 'post_office') return 'ไปรษณีย์';
    if (tags.amenity === 'police') return 'สถานีตำรวจ';
    if (tags.amenity === 'parking') return 'ที่จอดรถ';
    if (tags.tourism === 'hotel' || tags.building === 'hotel') return 'โรงแรม';
    if (tags.tourism === 'guest_house') return 'เกสต์เฮาส์';
    if (tags.tourism === 'hostel') return 'โฮสเทล';
    if (tags.tourism === 'attraction') return 'สถานที่ท่องเที่ยว';
    if (tags.tourism === 'museum') return 'พิพิธภัณฑ์';
    if (tags.tourism === 'viewpoint') return 'จุดชมวิว';
    if (tags.tourism === 'information') return 'จุดข้อมูลท่องเที่ยว';
    if (tags.leisure === 'park') return 'สวนสาธารณะ';
    if (tags.leisure === 'sports_centre') return 'ศูนย์กีฬา';
    if (tags.leisure === 'fitness_centre') return 'ฟิตเนส';
    if (tags.shop === 'mall' || tags.shop === 'department_store') return 'ห้างสรรพสินค้า';
    if (tags.shop === 'clothes' || tags.shop === 'fashion') return 'ร้านเสื้อผ้า';
    if (tags.shop === 'electronics') return 'ร้านอิเล็กทรอนิกส์';
    if (tags.shop === 'hardware') return 'ร้านวัสดุก่อสร้าง';
    if (tags.shop === 'bakery') return 'ร้านเบเกอรี่';
    if (tags.shop === 'hairdresser' || tags.shop === 'beauty') return 'ร้านเสริมสวย';
    if (tags.shop === 'car_repair') return 'อู่ซ่อมรถ';
    if (tags.shop === 'car') return 'ร้านขายรถ';
    if (tags.shop === 'motorcycle') return 'ร้านมอเตอร์ไซค์';
    if (tags.shop === 'laundry') return 'ร้านซักผ้า';
    if (tags.shop) return 'ร้านค้า';
    if (tags.office === 'government') return 'หน่วยงานราชการ';
    if (tags.office) return 'สำนักงาน';
    return 'สถานที่';
  }

  function buildPOIPopupHTML(tags: any): string {
    const name = escapeHtml(tags['name:th'] || tags.name || tags.alt_name || tags.brand || '');
    const type = getMapPOIType(tags);
    const { icon, color, brandLogo } = getMapPOIIcon(tags);
    const addr = escapeHtml([tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ') || '');
    const phone = escapeHtml(tags.phone || tags['contact:phone'] || '');
    const hours = escapeHtml(tags.opening_hours || '');
    const website = tags.website || tags['contact:website'] || '';
    const cuisine = escapeHtml(tags.cuisine || '');

    const iconHtml = brandLogo
      ? `<span class="mpoi-icon" style="background:${color};color:#fff;font-weight:800;font-size:12px;">${escapeHtml(brandLogo)}</span>`
      : `<span class="mpoi-icon" style="background:${color}22;">${icon}</span>`;

    let html = `<div class="map-poi-popup">`;
    html += `<div class="mpoi-header">${iconHtml}<div class="mpoi-info"><strong class="mpoi-name">${name || type}</strong><span class="mpoi-type">${type}</span></div></div>`;
    if (addr) html += `<div class="mpoi-row">📍 ${addr}</div>`;
    if (phone) html += `<div class="mpoi-row"><a href="tel:${escapeHtml(phone)}">📞 ${phone}</a></div>`;
    if (hours) html += `<div class="mpoi-row">🕐 ${hours}</div>`;
    if (cuisine) html += `<div class="mpoi-row">🍽️ ${cuisine}</div>`;
    if (website) html += `<div class="mpoi-row"><a href="${escapeHtml(website)}" target="_blank" rel="noopener">🌐 เว็บไซต์</a></div>`;
    html += `</div>`;
    return html;
  }

  function clearMapPOIs() {
    mapPOIMarkers.forEach(m => { try { map.removeLayer(m); } catch(_) {} });
    mapPOIMarkers = [];
  }

  // Fetch POI สำหรับ bbox จาก Overpass (1 request ต่อ viewport)
  // จำ bbox ที่เคย fetch แล้ว (ไม่ซ้ำ) — key = bbox rounded to 0.01°
  const _fetchedRegions = new Set<string>();
  // เก็บ marker ที่แสดงอยู่ — key = element id
  const _visibleMarkers = new Map<number, any>();

  async function fetchPOIForBounds(bbox: string, signal: AbortSignal): Promise<boolean> {
    if (_poiFetching) return false;
    _poiFetching = true;
    const query = `[out:json][timeout:8];nwr["name"](${bbox});out center body 500;`;
    for (let attempt = 0; attempt < OVERPASS_SERVERS.length; attempt++) {
      if (signal.aborted) { _poiFetching = false; return false; }
      const url = OVERPASS_SERVERS[(_overpassServerIdx + attempt) % OVERPASS_SERVERS.length];
      // Fetch with 8s timeout
      const timeoutId = setTimeout(() => { if (!signal.aborted) mapPOIAbortController?.abort(); }, 8000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal
        });
        clearTimeout(timeoutId);
        if (signal.aborted) { _poiFetching = false; return false; }
        if (!res.ok) {
          _overpassServerIdx = (_overpassServerIdx + 1) % OVERPASS_SERVERS.length;
          continue;
        }
        const data = await res.json();
        if (signal.aborted) { _poiFetching = false; return false; }
        const elements = data.elements || [];
        for (const el of elements) {
          if (el.id && el.tags) _poiElements.set(el.id, el);
        }
        if (_poiElements.size > 15000) {
          const keys = [..._poiElements.keys()];
          for (let i = 0; i < keys.length - 12000; i++) _poiElements.delete(keys[i]);
        }
        _poiFetching = false;
        return true;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') { _poiFetching = false; return false; }
        _overpassServerIdx = (_overpassServerIdx + 1) % OVERPASS_SERVERS.length;
        continue;
      }
    }
    _poiFetching = false;
    return false;
  }

  // Smart render — เฉพาะ add/remove ที่เปลี่ยน (ไม่กระพริบ)
  function renderVisiblePOIs() {
    if (!map || !L) return;
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    if (zoom < 14) {
      clearMapPOIs();
      _visibleMarkers.clear();
      return;
    }

    const shouldShow = new Set<number>();
    for (const el of _poiElements.values()) {
      const lat = el.lat || el.center?.lat;
      const lon = el.lon || el.center?.lon;
      if (!lat || !lon || !el.tags) continue;
      if (!bounds.contains([lat, lon])) continue;
      if (zoom < getPoiMinZoom(el.tags)) continue;
      shouldShow.add(el.id);
    }

    // Remove markers ที่ไม่ควรแสดงแล้ว
    for (const [id, marker] of _visibleMarkers) {
      if (!shouldShow.has(id)) {
        map.removeLayer(marker);
        _visibleMarkers.delete(id);
        const idx = mapPOIMarkers.indexOf(marker);
        if (idx >= 0) mapPOIMarkers.splice(idx, 1);
      }
    }

    // Add markers ใหม่ที่ยังไม่มี
    for (const id of shouldShow) {
      if (_visibleMarkers.has(id)) continue;
      const el = _poiElements.get(id);
      if (!el) continue;
      const lat = el.lat || el.center?.lat;
      const lon = el.lon || el.center?.lon;
      const tags = el.tags;
      const name = tags['name:th'] || tags.name || tags.brand || tags.operator || '';
      const { icon, color, brandLogo, showIcon } = getMapPOIIcon(tags);
      const displayName = escapeHtml(name || getMapPOIType(tags));
      const shortName = displayName.length > 14 ? displayName.substring(0, 12) + '…' : displayName;

      let markerHtml: string;
      if (brandLogo) {
        markerHtml = `<div class="mpoi-circle mpoi-brand" style="background:${color};"><span class="mpoi-c-brand">${escapeHtml(brandLogo)}</span></div>`;
      } else if (showIcon) {
        markerHtml = `<div class="mpoi-circle mpoi-important"><span class="mpoi-c-icon">${icon}</span></div>`;
      } else {
        markerHtml = `<div class="mpoi-circle mpoi-small"><span class="mpoi-c-icon">${icon}</span></div>`;
      }
      if (zoom >= 17 && name) {
        markerHtml += `<span class="mpoi-c-name">${shortName}</span>`;
      }

      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'map-poi-pin-wrap',
          html: `<div class="mpoi-dot-wrap">${markerHtml}</div>`,
          iconSize: [0, 0],
          iconAnchor: [14, 14]
        }),
        zIndexOffset: 500
      }).addTo(map);
      marker.bindPopup(buildPOIPopupHTML(tags), { maxWidth: 280, className: 'map-poi-popup-container' });
      mapPOIMarkers.push(marker);
      _visibleMarkers.set(id, marker);
    }
  }

  function getBoundsRegionKey(bounds: any): string {
    // Round to 0.01° grid (~1km) — ถ้าเคย fetch แล้วไม่ fetch ซ้ำ
    return `${Math.floor(bounds.getSouth()*100)},${Math.floor(bounds.getWest()*100)},${Math.ceil(bounds.getNorth()*100)},${Math.ceil(bounds.getEast()*100)}`;
  }

  async function loadMapPOIs() {
    if (!map || !L) return;
    const zoom = map.getZoom();

    if (zoom < 14) {
      clearMapPOIs();
      _visibleMarkers.clear();
      _lastPOIBounds = '';
      return;
    }

    const bounds = map.getBounds();
    const regionKey = getBoundsRegionKey(bounds);

    // แสดง cached data ทันที
    renderVisiblePOIs();

    // ถ้า region นี้เคย fetch แล้ว → ไม่ต้อง fetch อีก
    if (_fetchedRegions.has(regionKey)) return;

    // Abort fetch เก่า
    if (mapPOIAbortController) mapPOIAbortController.abort();
    mapPOIAbortController = new AbortController();
    const signal = mapPOIAbortController.signal;

    const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.15;
    const padLng = (bounds.getEast() - bounds.getWest()) * 0.15;
    const bbox = `${(bounds.getSouth() - padLat).toFixed(5)},${(bounds.getWest() - padLng).toFixed(5)},${(bounds.getNorth() + padLat).toFixed(5)},${(bounds.getEast() + padLng).toFixed(5)}`;

    isLoadingMapPOIs = true;
    const ok = await fetchPOIForBounds(bbox, signal);
    if (!signal.aborted) {
      isLoadingMapPOIs = false;
      if (ok) {
        _fetchedRegions.add(regionKey);
        // จำกัด regions cache ไม่เกิน 200
        if (_fetchedRegions.size > 200) {
          const first = _fetchedRegions.values().next().value;
          if (first) _fetchedRegions.delete(first);
        }
        renderVisiblePOIs();
      }
    }
  }

  function onMapMoveForPOI() {
    if (_mapPOITimer) clearTimeout(_mapPOITimer);
    renderVisiblePOIs(); // cached ทันที
    _mapPOITimer = setTimeout(loadMapPOIs, 500); // fetch หลัง 500ms
  }

  // ==================== TILE PREFETCH ====================
  let _prefetchAbort: AbortController | null = null;
  const _prefetchedTiles = new Set<string>();

  function latLngToTile(lat: number, lng: number, z: number) {
    const n = Math.pow(2, z);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
  }

  // สร้าง tile queue แบบ spiral (กลาง→ขอบ) — โหลดที่ใกล้ก่อน
  function spiralTiles(cx: number, cy: number, radius: number): {dx: number, dy: number}[] {
    const result: {dx: number, dy: number}[] = [{dx: 0, dy: 0}];
    for (let r = 1; r <= radius; r++) {
      for (let i = -r; i < r; i++) result.push({dx: i, dy: -r});   // top
      for (let i = -r; i < r; i++) result.push({dx: r, dy: i});    // right
      for (let i = r; i > -r; i--) result.push({dx: i, dy: r});    // bottom
      for (let i = r; i > -r; i--) result.push({dx: -r, dy: i});   // left
    }
    return result;
  }

  function prefetchTiles(mapRef: any) {
    if (!mapRef) return;
    _prefetchAbort?.abort();
    _prefetchAbort = new AbortController();
    const signal = _prefetchAbort.signal;
    const center = mapRef.getCenter();
    const curZoom = mapRef.getZoom();
    const subs = 'abcd';
    const queue: string[] = [];

    // Prefetch zoom ±1 พอประมาณ (OSM tiles)
    const zoomConfigs = [
      { z: curZoom,     radius: 3 },  // ปัจจุบัน
      { z: curZoom - 1, radius: 3 },  // ซูมออก 1
      { z: curZoom + 1, radius: 3 },  // ซูมเข้า 1
      { z: curZoom - 2, radius: 2 },
      { z: curZoom + 2, radius: 2 },
    ];

    for (const { z, radius } of zoomConfigs) {
      if (z < 2 || z > 19) continue;
      const ct = latLngToTile(center.lat, center.lng, z);
      const n = Math.pow(2, z);
      const spiral = spiralTiles(ct.x, ct.y, radius);
      for (const { dx, dy } of spiral) {
        const tx = ((ct.x + dx) % n + n) % n;
        const ty = ct.y + dy;
        if (ty < 0 || ty >= n) continue;
        const key = `${z}/${tx}/${ty}`;
        if (_prefetchedTiles.has(key)) continue;
        _prefetchedTiles.add(key);
        const s = subs[(tx + ty) % 3]; // OSM uses a/b/c subdomains
        queue.push(`https://${s}.tile.openstreetmap.org/${z}/${tx}/${ty}.png`);
      }
    }

    if (queue.length === 0) return;

    // โหลดเบื้องหลัง batch 6 ทุก 80ms
    let idx = 0;
    function loadBatch() {
      if (signal.aborted || idx >= queue.length) return;
      const batch = queue.slice(idx, idx + 6);
      idx += 6;
      batch.forEach(url => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
      });
      setTimeout(loadBatch, 80);
    }
    loadBatch();
  }

  // ==================== SHARE ROUTE QR ====================
  function openInGoogleMaps() {
    if (!optimizedRoute || allDeliveryPoints.length < 1) {
      showNotification('ยังไม่มีเส้นทาง กรุณาคำนวณเส้นทางก่อน', 'warning');
      return;
    }

    const points = manualOrder ? [...allDeliveryPoints] : [...allDeliveryPoints];
    const origin = currentLocation
      ? `${currentLocation.lat},${currentLocation.lng}`
      : `${points[0].lat},${points[0].lng}`;
    const destination = `${points[points.length - 1].lat},${points[points.length - 1].lng}`;

    // Google Maps รองรับ waypoints คั่นด้วย |
    const waypoints = points.length > 2
      ? points.slice(0, -1).map((p: any) => `${p.lat},${p.lng}`).join('|')
      : points.length === 2 && currentLocation
        ? `${points[0].lat},${points[0].lng}`
        : '';

    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    if (waypoints) url += `&waypoints=${waypoints}`;
    url += '&travelmode=driving';

    window.open(url, '_blank');
    showNotification('เปิดใน Google Maps แล้ว', 'success');
  }

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
        notes: `ถึงจุดหมายแล้ว - ${new Date().toLocaleString('th-TH')}`
      };

      if (currentUser?.id) payload.user_id = Number(currentUser.id);
      if (currentUser?.name) payload.user_name = String(currentUser.name);

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
        addAlert('delivery', `ถึงจุดหมายแล้ว: ${deliveredPoint.name}`);
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

        params.set('endpoint', 'search');
        const res = await fetch(`/api/geocode?${params.toString()}`);
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
      } catch (_) {}
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
          params.set('endpoint', 'search');
          const res = await fetch(`/api/geocode?${params.toString()}`);
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
        } catch (_) {}
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

  let isQuickAdding = false;
  async function confirmQuickAdd() {
    if (isQuickAdding || !quickAddResult || !currentUser?.id) return;
    // Duplicate check
    const dup = deliveryPoints.find(p => Math.abs(p.lat - quickAddResult.lat) < 0.0001 && Math.abs(p.lng - quickAddResult.lng) < 0.0001);
    if (dup) {
      showNotification(`จุด "${dup.name}" อยู่ตำแหน่งเดียวกันแล้ว`, 'warning');
      closeQuickAdd();
      return;
    }
    isQuickAdding = true;
    try {
      const payload = {
        user_id: currentUser.id,
        name: quickAddResult.name,
        address: quickAddResult.address,
        lat: quickAddResult.lat,
        lng: quickAddResult.lng,
        priority: 3
      };
      const res = await fetch(`${API_URL}/points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to add point');

      const data = await res.json();
      if (data && !data.error) {
        await loadDeliveryPoints();
        showNotification(`เพิ่ม "${quickAddResult.name}" สำเร็จ`, 'success');
        if (map && L) {
          map.setView([quickAddResult.lat, quickAddResult.lng], 15, { animate: true });
        }
      }
    } catch (err) {
      showNotification('เพิ่มจุดไม่สำเร็จ', 'error');
    } finally {
      isQuickAdding = false;
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

  function smoothMapResize() {
    if (!map) return;
    setTimeout(() => { if (map) map.invalidateSize(); }, 300);
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
          smoothMapResize();
        }
        break;
      case 't': // เปิด/ปิด traffic
        e.preventDefault();
        toggleTraffic();
        break;
      case 'a': // เพิ่มจุดแวะ
        if (!optimizedRoute && !isNavigating) {
          e.preventDefault();
          showAddForm = !showAddForm;
        }
        break;
      case 'escape': // ปิด modal / หยุดนำทาง / ยกเลิกการเลือก
        e.preventDefault();
        if (showLogoutConfirm) showLogoutConfirm = false;
        else if (showKeyboardHelp) showKeyboardHelp = false;
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
          smoothMapResize();
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
    // Register tile cache Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/tile-sw.js').catch(() => {});
    }

    const userStr = localStorage.getItem('user');
    if (!userStr) { goto('/'); return; }
    try {
      currentUser = JSON.parse(userStr);
    } catch (_) {
      localStorage.removeItem('user');
      goto('/');
      return;
    }
    if (!currentUser || !currentUser.id) { localStorage.removeItem('user'); goto('/'); return; }

    // 🔄 ตรวจสอบ role - redirect ไปหน้าที่ถูกต้อง
    if (currentUser.role) {
      const role = currentUser.role.toLowerCase();
      if (role === 'admin') { goto(`/Admin/${currentUser.id}`); return; }
      if (role === 'driver') { goto(`/User/${currentUser.id}`); return; }
      if (role === 'customer') { goto(`/factory/${currentUser.id}`); return; }
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

    const savedCustomStart = localStorage.getItem(getUserKey('customStartPoint'));
    if (savedCustomStart) {
      try {
        const parsed = JSON.parse(savedCustomStart);
        if (parsed && parsed.lat && parsed.lng && parsed.name) {
          useCustomStartPoint = true;
          customStartPoint = parsed;
        }
      } catch (_) {}
    }
    const savedAutoReroute = localStorage.getItem(getUserKey('autoRerouteEnabled'));
    if (savedAutoReroute !== null) autoRerouteEnabled = savedAutoReroute === 'true';
    const savedSpeedAlert = localStorage.getItem(getUserKey('speedAlertEnabled'));
    if (savedSpeedAlert !== null) speedAlertEnabled = savedSpeedAlert === 'true';
    const savedTraffic = localStorage.getItem(getUserKey('showTraffic'));
    if (savedTraffic !== null) showTraffic = savedTraffic === 'true';
    loadSavedRoutes();

    // URL ไม่ตรง → แก้ URL เงียบ ๆ (ไม่ goto, ไม่ remount)
    const urlId = $page.params.id;
    if (decodeUserId(urlId) !== currentUser.id) {
      window.history.replaceState(window.history.state, '', `/User/${encodeUserId(currentUser.id)}`);
    }

    try {
      // Start GPS + Leaflet + leaflet-rotate in parallel for fastest load
      const gpsPromise = new Promise<{lat: number, lng: number} | null>((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
        );
      });

      const [leafletModule, , userPos] = await Promise.all([
        import('leaflet'),
        import('leaflet/dist/leaflet.css'),
        gpsPromise
      ]);
      L = leafletModule;
      (window as any).L = L;
      // leaflet-rotate — ต้องโหลดก่อนสร้าง map เพื่อ patch L.Map.prototype
      await import('leaflet-rotate').catch(() => {});

      // Center on user's current position if available, otherwise Bangkok
      const initLat = userPos?.lat ?? 13.7465;
      const initLng = userPos?.lng ?? 100.5348;
      const initZoom = userPos ? 16 : 12;

      map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        zoomSnap: 1,
        zoomDelta: 1,
        wheelDebounceTime: 40,
        wheelPxPerZoomLevel: 80,
        minZoom: 2,
        maxZoom: 19,
        worldCopyJump: true,
        maxBounds: [[-85, -Infinity], [85, Infinity]],
        maxBoundsViscosity: 0.8,
        fadeAnimation: true,
        zoomAnimation: true,
        markerZoomAnimation: true,
        inertia: true,
        inertiaDeceleration: 3000,
        inertiaMaxSpeed: 2000,
        easeLinearity: 0.25,
        // leaflet-rotate — สองนิ้วหมุนแผนที่
        rotate: true,
        touchRotate: true,
        rotateControl: false,
        bearing: 0
      } as any).setView([initLat, initLng], initZoom);

      // ═══ Tile Layer — OSM Standard + CSS dark filter (รายละเอียดเยอะ) ═══
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        subdomains: 'abc',
        maxNativeZoom: 19,
        maxZoom: 20,
        keepBuffer: 6,
        updateWhenZooming: true,
        updateWhenIdle: false,
        updateInterval: 100,
        className: 'main-tiles'
      }).addTo(map);

      // ═══ Background tile prefetch — โหลดต่อเนื่อง ═══
      map.on('movestart zoomstart', () => { _prefetchAbort?.abort(); });
      map.on('moveend zoomend', () => { setTimeout(() => prefetchTiles(map), 800); });
      setTimeout(() => prefetchTiles(map), 500);

      // ═══ Camera rotation listener (leaflet-rotate) ═══
      setupCamRotateListener();

      // Set current location immediately if GPS succeeded
      if (userPos) {
        currentLocation = { lat: userPos.lat, lng: userPos.lng };
        updateCurrentLocationMarker();
      }

      // เปิดเข็มทิศเซ็นเซอร์ (ใช้แสดงทิศตอนยืนอยู่กับที่)
      startDeviceCompass();

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
              } else if (_deviceCompassHeading !== null) {
                currentHeading = _deviceCompassHeading;
              }
              updateCurrentLocationMarker();
            }
          },
          (err) => {
            // Permission denied - stop trying
            if (err.code === 1) {
              if (continuousWatchId !== null) {
                navigator.geolocation.clearWatch(continuousWatchId);
                continuousWatchId = null;
              }
              showNotification('กรุณาอนุญาตการเข้าถึง GPS', 'error');
            }
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
        );
      }

      // Robust map resize (perf: single delayed call instead of 5)
      setTimeout(() => map?.invalidateSize(), 400);

      resizeHandler = () => { setTimeout(() => map?.invalidateSize(), 100); };
      window.addEventListener('resize', resizeHandler);

      const onZoomEnd = () => {
        updateRouteWeights();
        if (alongRoutePOIs.length > 0) displayPOIMarkers();
        // Zoom-dependent marker scaling (mobile)
        const z = map.getZoom();
        const scale = z >= 17 ? 1 : z >= 15 ? 0.85 : z >= 13 ? 0.7 : z >= 11 ? 0.55 : 0.4;
        document.getElementById('map')?.style.setProperty('--marker-scale', String(scale));
        const labelScale = z >= 16 ? 1 : z >= 14 ? 0.85 : z >= 12 ? 0.7 : z >= 10 ? 0.55 : 0.4;
        document.getElementById('map')?.style.setProperty('--start-label-scale', String(labelScale));
        // Globe mode — 3D Earth when zoomed out
        const shouldGlobe = z <= 3;
        if (shouldGlobe && !globeMode) {
          enterGlobeMode();
        } else if (!shouldGlobe && globeMode) {
          globeMode = false;
          cancelAnimationFrame(globeAnimId);
          globeAnimId = 0;
        }
      };
      map.on('zoomend', onZoomEnd);
      (window as any).__onZoomEnd = onZoomEnd;

      // Map POI — ปิดไว้ (ลด network requests ให้ map โหลดเร็วขึ้น)
      // map.on('moveend', onMapMoveForPOI);
      // map.on('zoomend', onMapMoveForPOI);

      map.on('click', (e: any) => {
        if (isNavigating) return;
        if (!addPointMode) return;
        if (clickMarker) { try { clickMarker.remove(); } catch(_){} clickMarker = null; }
        const lat = parseFloat(e.latlng.lat.toFixed(6));
        const lng = parseFloat(e.latlng.lng.toFixed(6));
        newPoint = { ...newPoint, lat, lng };
        clickMarker = L.marker([lat, lng], {
          icon: L.divIcon({ className: 'click-marker', html: `<div class="pulse-marker"></div>`, iconSize: [48, 48], iconAnchor: [24, 24] })
        }).addTo(map);
        showAddForm = true;
      });

      // Load data in parallel with timeout (won't hang if API is down)
      const results = await Promise.allSettled([
        withTimeout(loadDeliveryPoints(), 15000, 'loadDeliveryPoints'),
        withTimeout(loadTodayStats(), 15000, 'loadTodayStats'),
        withTimeout(loadDeliveryHistory(), 15000, 'loadDeliveryHistory'),
        withTimeout(fetchOilPrices(), 15000, 'fetchOilPrices')
      ]);
      isDataLoaded = true;
      const failedCount = results.filter(r => r.status === 'rejected').length;
      if (failedCount > 0) {
        if (failedCount < 4) showNotification(`โหลดข้อมูลบางส่วนไม่สำเร็จ (${failedCount} รายการ)`, 'warning');
        else showNotification('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', 'error');
      }
      initExtraFeatures();
      initVoiceNavigation();

      // Check AI availability
      fetch('/api/ai/chat').then(r => r.json()).then(d => { aiAvailable = d.available === true; }).catch(() => {});

      // Restore custom start point marker (page refresh)
      if (useCustomStartPoint && customStartPoint && map && L) {
        if (customStartMarker) { try { map.removeLayer(customStartMarker); } catch(_){} }
        customStartMarker = L.marker([customStartPoint.lat, customStartPoint.lng], {
          icon: L.divIcon({
            className: 'custom-start-marker',
            html: `<div class="custom-start-wrapper">
              <div class="custom-start-pulse"></div>
              <div class="custom-start-pulse custom-start-pulse-2"></div>
              <div class="custom-start-dot"></div>
              <div class="custom-start-label">${escapeHtml(customStartPoint.name)}</div>
            </div>`,
            iconSize: [44, 44], iconAnchor: [22, 22]
          }),
          zIndexOffset: 1000,
          interactive: true
        }).addTo(map);
      }

      // Restore route from previous session (page refresh)
      if (restoreRouteState()) {
        showNotification('กู้คืนเส้นทางที่คำนวณไว้แล้ว', 'success');
      }

      // Keyboard shortcuts
      window.addEventListener('keydown', handleKeyboardShortcuts);

      // Session timeout (30 นาที ไม่ active → logout)
      setupSessionTimeout();

      // Map rotation gesture (two-finger mobile / shift+drag desktop)
      setupMapRotation();

      // popstate + visibilitychange — จับ browser back/forward
      const pathGuard = () => {
        if (!currentUser?.id) return;
        const expected = `/User/${encodeUserId(currentUser.id)}`;
        if (window.location.pathname !== expected) {
          window.history.replaceState(window.history.state, '', expected);
        }
      };
      const visHandler = () => { if (!document.hidden) pathGuard(); };
      window.addEventListener('popstate', pathGuard);
      document.addEventListener('visibilitychange', visHandler);
      (window as any).__pathGuard = pathGuard;
      (window as any).__visHandler = visHandler;

      oilPriceInterval = setInterval(() => {
        if (oilPriceFailCount >= 3) {
          if (oilPriceInterval) { clearInterval(oilPriceInterval); oilPriceInterval = null; }
          return;
        }
        fetchOilPrices();
      }, 1800000);
    } catch (error) {
      showNotification('ไม่สามารถโหลดแผนที่ได้', 'error');
    }
  });

  onDestroy(() => {
    if (browser && (window as any).__pathGuard) {
      window.removeEventListener('popstate', (window as any).__pathGuard);
      (window as any).__pathGuard = null;
    }
    if (browser && (window as any).__visHandler) {
      document.removeEventListener('visibilitychange', (window as any).__visHandler);
      (window as any).__visHandler = null;
    }
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
    if (_mapPOITimer) clearTimeout(_mapPOITimer);
    if (mapPOIAbortController) mapPOIAbortController.abort();
    clearMapPOIs();
    if (map) {
      map.off('moveend', onMapMoveForPOI);
      if ((window as any).__onZoomEnd) { map.off('zoomend', (window as any).__onZoomEnd); (window as any).__onZoomEnd = null; }
      map.remove(); map = null;
    }
  });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://tile.openstreetmap.org">
  <link rel="preconnect" href="https://a.tile.openstreetmap.org">
  <link rel="preconnect" href="https://b.tile.openstreetmap.org">
  <link rel="preconnect" href="https://c.tile.openstreetmap.org">
  <title>ผู้ใช้ทั่วไป | Route Optimization</title>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</svelte:head>

<div class="app-container">
  <!-- Settings Panel -->
  <SettingsPanel
    bind:show={showSettings}
    {userInfo}
    bind:vehicleType
    {voiceEnabled}
    bind:KM_PER_LITER
    bind:ELECTRICITY_PRICE_PER_KWH
    bind:KWH_PER_100KM
    bind:evCurrentCharge
    {evRemainingRange}
    {evCurrentConsumptionRate}
    {currentFuelPrice}
    {oilPriceData}
    {isLoadingOilPrice}
    bind:selectedStation
    bind:selectedFuelType
    {showChargingStations}
    {isLoadingStations}
    {chargingStations}
    {optimizedRoute}
    {getUserKey}
    on:saveVehicleSettings={saveVehicleSettings}
    on:toggleVoice={toggleVoice}
    on:fetchOilPrices={fetchOilPrices}
    on:updateFuelPrice={updateCurrentFuelPrice}
    on:toggleChargingStations={toggleChargingStations}
    on:loadNearbyChargingStations={loadNearbyChargingStations}
    on:searchEVAlongRoute={searchEVAlongRoute}
    on:searchGasAlongRoute={searchPOIsAlongRoute}
    on:clearChargingStations={clearChargingStations}
    on:exportRouteData={exportRouteData}
    on:logout={() => showLogoutConfirm = true}
  />


  <!-- Alerts Panel -->
  <AlertsPanel
    bind:show={showAlerts}
    {alerts}
    on:clearAlerts={clearAlerts}
    on:dismissAlert={(e) => dismissAlert(e.detail.id)}
  />

  <!-- Logout Confirmation -->
  {#if showLogoutConfirm}
    <div class="logout-backdrop" on:click={() => showLogoutConfirm = false} role="presentation"></div>
    <div class="logout-modal">
      <div class="logout-glow"></div>
      <div class="logout-icon-wrap">
        <div class="logout-icon-ring r1"></div>
        <div class="logout-icon-ring r2"></div>
        <div class="logout-icon-core">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </div>
      </div>
      <h3 class="logout-title">ออกจากระบบ</h3>
      <p class="logout-desc">คุณต้องการออกจากระบบใช่หรือไม่?<br><span class="logout-sub">ข้อมูลเส้นทางที่บันทึกไว้จะถูกล้าง</span></p>
      <div class="logout-actions">
        <button class="logout-btn-cancel" on:click={() => showLogoutConfirm = false}>ยกเลิก</button>
        <button class="logout-btn-confirm" on:click={logout}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          ออกจากระบบ
        </button>
      </div>
    </div>
  {/if}

  <!-- Notification Toast -->
  {#if notification.show}
    <div class="toast" class:toast-success={notification.type === 'success'} class:toast-error={notification.type === 'error'} class:toast-warning={notification.type === 'warning'}>
      <div class="toast-glow"></div>
      <div class="toast-icon-wrap">
        {#if notification.type === 'success'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        {:else if notification.type === 'warning'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
        {/if}
      </div>
      <span class="toast-msg">{notification.message}</span>
      {#if lastDragUndo && notification.type === 'success'}
        <button class="undo-btn" on:click={undoDragPoint}>เลิกทำ</button>
      {/if}
      <button class="toast-close" on:click={() => notification.show = false}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
      <div class="toast-progress"></div>
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
          <button class="btn btn-primary" on:click={confirmQuickAdd} disabled={!quickAddResult || quickAddLoading || isQuickAdding}>
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
  <NavigationOverlay
    {isNavigating}
    {isOffRoute}
    {offRouteDistance}
    {autoRerouteEnabled}
    {nextTurnIcon}
    {nextTurnInstruction}
    {nextTurnDistance}
    {currentTargetIndex}
    {optimizedRoute}
    {distanceToNextPoint}
    {estimatedArrivalTime}
    {curveWarning}
    {laneGuidance}
    {currentSpeed}
    {compassHeading}
    {compassDir}
    {isMapFollowing}
    {remainingDistance}
    {remainingTime}
    {isProcessingDelivery}
    {voiceEnabled}
    successCount={getSuccessCount()}
    remainingPointsCount={getRemainingPointsCount()}
    onAutoReroute={autoReroute}
    onToggleMapFollow={() => { if (isMapFollowing) { isMapFollowing = false; resetMapRotation(); } else { centerOnCurrentLocation(); } }}
    onMarkDeliverySuccess={markDeliverySuccess}
    onSkipToNextPoint={skipToNextPoint}
    onToggleVoice={toggleVoice}
    onShareETA={shareETA}
    onStopNavigation={stopNavigation}
  />

  <!-- Sidebar -->
  {#if !isNavigating && !aiChatOpen}
    <aside class="sidebar" class:collapsed={!mobileSidebarOpen || showSettings || showAddForm} class:desktop-collapsed={desktopSidebarCollapsed || showSettings || showAddForm}>
      <!-- Mobile toggle handle -->
      <button class="sidebar-toggle" on:click={() => { mobileSidebarOpen = !mobileSidebarOpen; if (!mobileSidebarOpen) mobileContentExpanded = false; smoothMapResize(); }}>
        {#if mobileSidebarOpen}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="flipped"><path d="M6 9l6 6 6-6"/></svg>
          <span class="toggle-text">ซ่อนเมนู</span>
        {:else if optimizedRoute}
          <div class="collapsed-summary">
            <div class="cs-stat"><span class="cs-val">{(optimizedRoute.total_distance/1000).toFixed(1)}</span><span class="cs-unit">กม.</span></div>
            <div class="cs-divider"></div>
            <div class="cs-stat">
              {#if optimizedRoute.total_time >= 3600}
                <span class="cs-val">{Math.floor(optimizedRoute.total_time / 3600)}:{String(Math.round((optimizedRoute.total_time % 3600) / 60)).padStart(2, '0')}</span><span class="cs-unit">ชม.</span>
              {:else}
                <span class="cs-val">{Math.round(optimizedRoute.total_time/60)}</span><span class="cs-unit">นาที</span>
              {/if}
            </div>
            <div class="cs-divider"></div>
            <div class="cs-stat"><span class="cs-val">{optimizedRoute.optimized_order.filter((p) => p.id !== -1).length}</span><span class="cs-unit">จุด</span></div>
            <div class="cs-divider"></div>
            <div class="cs-stat">{#if vehicleType === 'fuel'}<span class="cs-val cs-cost">฿{Math.round((optimizedRoute.total_distance / 1000) / KM_PER_LITER * currentFuelPrice)}</span><span class="cs-unit">น้ำมัน</span>{:else}<span class="cs-val cs-cost">฿{Math.round(evCostEstimate)}</span><span class="cs-unit">ค่าไฟ</span>{/if}</div>
            {#if tollCostEstimate > 0}
              <div class="cs-divider"></div>
              <div class="cs-stat"><span class="cs-val cs-cost">฿{Math.round(tollCostEstimate)}</span><span class="cs-unit">ค่าผ่านทาง</span></div>
            {/if}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="cs-arrow"><path d="M6 9l6 6 6-6"/></svg>
          </div>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          <span>{allDeliveryPoints.length} จุดแวะ</span>
        {/if}
      </button>
      <div class="sidebar-header">
        {#if !isNavigating}
        <div class="logo desktop-only">
          <div class="logo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg></div>
          <div class="logo-text"><h1>Route Planing</h1><span>วางแผนเส้นทาง</span></div>
        </div>
        <div class="header-start-point mobile-only">
          <div class="start-options">
            <button class="start-opt {!showStartPointPicker && !useCustomStartPoint ? 'active' : ''}" class:disabled-route={!!optimizedRoute} on:click={() => { if (optimizedRoute) { showNotification('ยกเลิกเส้นทางก่อนเปลี่ยนจุดเริ่มต้น', 'warning'); return; } clearCustomStartPoint(); }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
              GPS
            </button>
            <button class="start-opt {showStartPointPicker || useCustomStartPoint ? 'active' : ''}" class:disabled-route={!!optimizedRoute} on:click={() => { if (optimizedRoute) { showNotification('ยกเลิกเส้นทางก่อนเปลี่ยนจุดเริ่มต้น', 'warning'); return; } showStartPointPicker = !showStartPointPicker; if (showStartPointPicker) { if (currentLocationMarker && map) { try { map.removeLayer(currentLocationMarker); } catch(_){} currentLocationMarker = null; } } else if (!useCustomStartPoint) { clearCustomStartPoint(); } }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>
              กำหนดเอง
            </button>
          </div>
          {#if useCustomStartPoint && customStartPoint}
            <div class="start-selected">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="#00ff88" stroke="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
              <span class="start-name">{customStartPoint.name}</span>
              <button class="start-clear" on:click={clearCustomStartPoint} title="ล้าง">✕</button>
            </div>
          {/if}
        </div>
        {:else}
        <div class="logo">
          <div class="logo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg></div>
          <div class="logo-text"><h1>Route Planing</h1><span>นำทางอยู่...</span></div>
        </div>
        {/if}
        <div class="header-actions">
          <button class="icon-btn keyboard-help-btn" on:click={() => showKeyboardHelp = true} title="คีย์ลัด [?]">⌨️</button>
          <button class="icon-btn" on:click={() => showAlerts = !showAlerts} title="การแจ้งเตือน">🔔{#if alerts.length > 0}<span class="badge">{alerts.length}</span>{/if}</button>
          <button class="icon-btn" on:click={() => { showSettings = true; smoothMapResize(); }} title="ตั้งค่า">⚙️</button>
        </div>
      </div>

      <div class="sidebar-scroll">

      {#if isMultiSelectMode}
        <div class="multi-select-toolbar">
          <div class="mst-left">
            <div class="mst-count" class:has-selected={selectedPoints.length > 0}>
              <span class="mst-num">{selectedPoints.length}</span>
            </div>
            <span class="mst-label">{selectedPoints.length > 0 ? `เลือกแล้ว ${selectedPoints.length} จุด` : 'เลือกจุดที่ต้องการ'}</span>
          </div>
          <div class="mst-actions">
            <button class="mst-btn" on:click={selectAllPoints} title="เลือกทั้งหมด">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>
            </button>
            <button class="mst-btn" on:click={deselectAllPoints} title="ยกเลิกทั้งหมด">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
            </button>
            <button class="mst-btn delete" on:click={deleteSelectedPoints} disabled={selectedPoints.length === 0} title="ลบที่เลือก ({selectedPoints.length})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
            <div class="mst-divider"></div>
            <button class="mst-btn close" on:click={toggleMultiSelect} title="ปิด">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      {/if}

      <div class="action-buttons">
        {#if !isNavigating}
        <div class="header-start-point desktop-only">
          <div class="start-options">
            <button class="start-opt {!showStartPointPicker && !useCustomStartPoint ? 'active' : ''}" class:disabled-route={!!optimizedRoute} on:click={() => { if (optimizedRoute) { showNotification('ยกเลิกเส้นทางก่อนเปลี่ยนจุดเริ่มต้น', 'warning'); return; } clearCustomStartPoint(); }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
              GPS
            </button>
            <button class="start-opt {showStartPointPicker || useCustomStartPoint ? 'active' : ''}" class:disabled-route={!!optimizedRoute} on:click={() => { if (optimizedRoute) { showNotification('ยกเลิกเส้นทางก่อนเปลี่ยนจุดเริ่มต้น', 'warning'); return; } showStartPointPicker = !showStartPointPicker; if (showStartPointPicker) { if (currentLocationMarker && map) { try { map.removeLayer(currentLocationMarker); } catch(_){} currentLocationMarker = null; } } else if (!useCustomStartPoint) { clearCustomStartPoint(); } }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>
              กำหนดเอง
            </button>
          </div>
          {#if useCustomStartPoint && customStartPoint}
            <div class="start-selected">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="#00ff88" stroke="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
              <span class="start-name">{customStartPoint.name}</span>
              <button class="start-clear" on:click={clearCustomStartPoint} title="ล้าง">✕</button>
            </div>
          {/if}
        </div>
        {/if}
        <button class="btn btn-primary" on:click={optimizeRoute} disabled={isOptimizing || allDeliveryPoints.length < 1 || ((showStartPointPicker || useCustomStartPoint) && !customStartPoint)} title="คำนวณเส้นทาง [R]">
          {#if isOptimizing}<div class="spinner"></div><span>กำลังคำนวณ...</span>{:else if (showStartPointPicker || useCustomStartPoint) && !customStartPoint}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg><span>เลือกจุดเริ่มต้นก่อน</span>{:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg><span>คำนวณเส้นทาง ({allDeliveryPoints.length} จุด)</span>{/if}
        </button>
        {#if optimizedRoute}
          <button class="btn btn-navigate" on:click={startNavigation} title="เริ่มนำทาง [N]"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg><span>เริ่มนำทาง</span></button>
          {#if routeAlternatives.length > 1}
            <button class="btn btn-alt-routes" on:click={() => { showRouteSelector = !showRouteSelector; if (showRouteSelector) mobileSidebarOpen = false; }} title="เลือกเส้นทาง">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
              <span>เลือกเส้นทาง ({routeAlternatives.length})</span>
            </button>
          {/if}
          <button class="btn btn-save-route" on:click={saveCurrentRoute} title="บันทึกเส้นทาง [S]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><span>บันทึกเส้นทาง</span></button>
          <button class="btn btn-share" on:click={openShareQR} title="แชร์เส้นทาง QR"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>แชร์ QR</span></button>
          <button class="btn btn-google-maps" on:click={openInGoogleMaps} title="เปิดใน Google Maps">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
            <span>Google Maps</span>
          </button>

          <button class="btn btn-ghost" on:click={() => { clearRoute(); clearAlternativeRouteLayers(); routeAlternatives = []; showRouteSelector = false; showRouteComparison = false; }} title="ล้างเส้นทาง [C]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg><span>ล้างเส้นทาง</span></button>
        {/if}
        {#if !optimizedRoute}
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
          {#if aiAvailable && deliveryPoints.length >= 2}
            <button class="btn btn-ai-plan" on:click={requestAIRouteOptimization} disabled={isAIPlanning} title="AI วางแผนเส้นทาง">
              {#if isAIPlanning}
                <div class="spinner"></div>
                <span>AI กำลังวิเคราะห์...</span>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z"/></svg>
                <span>AI วางแผน</span>
              {/if}
            </button>
          {/if}
        {/if}
      </div>

      <div class="tabs">
        <button class="tab" class:active={activeTab === 'points' && mobileContentExpanded} on:click={() => { if (activeTab === 'points' && mobileContentExpanded) { mobileContentExpanded = false; } else { activeTab = 'points'; mobileContentExpanded = true; } }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>จุดแวะ ({deliveryPoints.length})<svg class="tab-chevron" class:tab-chevron-up={activeTab === 'points' && mobileContentExpanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>
        <button class="tab" class:active={activeTab === 'route' && mobileContentExpanded} on:click={() => { if (activeTab === 'route' && mobileContentExpanded) { mobileContentExpanded = false; } else { activeTab = 'route'; mobileContentExpanded = true; } }} disabled={!optimizedRoute}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>เส้นทาง<svg class="tab-chevron" class:tab-chevron-up={activeTab === 'route' && mobileContentExpanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>
      </div>

      <div class="content-area" class:content-collapsed={!mobileContentExpanded}>
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
                  </div>
                  <div class="point-meta">
                    <span class="priority-tag" style="background: {colors.bg}">P{point.priority}</span>
                    {#if currentLocation && pointDistances[i] !== undefined}<span class="distance-tag">{formatDistance(pointDistances[i])}</span>{/if}
                  </div>
                  <button class="delete-btn" on:click|stopPropagation={() => deletePoint(point.id, point.name)} title="ลบจุดนี้"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                </div>
              {/each}
            {/if}
          </div>
        {:else if activeTab === 'route' && optimizedRoute}
          <div class="route-summary">
            <div class="route-detail-card">
              <div class="rd-header">สรุปเส้นทาง</div>
              <div class="rd-grid">
                <div class="rd-row">
                  <span class="rd-icon">📏</span>
                  <span class="rd-label">ระยะทาง</span>
                  <span class="rd-value">{(optimizedRoute.total_distance / 1000).toFixed(1)} กม.</span>
                </div>
                <div class="rd-row">
                  <span class="rd-icon">⏱️</span>
                  <span class="rd-label">เวลาเดินทาง</span>
                  <span class="rd-value">
                    {#if optimizedRoute.total_time >= 3600}
                      {Math.floor(optimizedRoute.total_time / 3600)} ชม. {Math.round((optimizedRoute.total_time % 3600) / 60)} น.
                    {:else}
                      {Math.round(optimizedRoute.total_time / 60)} นาที
                    {/if}
                  </span>
                </div>
                <div class="rd-row">
                  <span class="rd-icon">📍</span>
                  <span class="rd-label">จุดแวะ</span>
                  <span class="rd-value">{optimizedRoute.optimized_order.filter((p) => p.id !== -1).length} จุด</span>
                </div>
                <div class="rd-row">
                  <span class="rd-icon">🕐</span>
                  <span class="rd-label">ถึงโดยประมาณ</span>
                  <span class="rd-value">{new Date(Date.now() + optimizedRoute.total_time * 1000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span>
                </div>
                <div class="rd-row">
                  <span class="rd-icon">🚗</span>
                  <span class="rd-label">ความเร็วเฉลี่ย</span>
                  <span class="rd-value">{optimizedRoute.total_time > 0 ? Math.round((optimizedRoute.total_distance / 1000) / (optimizedRoute.total_time / 3600)) : 0} กม./ชม.</span>
                </div>
              </div>
              <div class="rd-divider"></div>
              <div class="rd-header">ค่าใช้จ่าย</div>
              <div class="rd-grid">
                {#if vehicleType === 'fuel'}
                  <div class="rd-row">
                    <span class="rd-icon">⛽</span>
                    <span class="rd-label">น้ำมัน ({(optimizedRoute.total_distance / 1000 / KM_PER_LITER).toFixed(1)} ลิตร)</span>
                    <span class="rd-value cost">฿{Math.round((optimizedRoute.total_distance / 1000) / KM_PER_LITER * currentFuelPrice)}</span>
                  </div>
                  <div class="rd-row sub">
                    <span class="rd-icon"></span>
                    <span class="rd-label">ราคาน้ำมัน</span>
                    <span class="rd-value">฿{currentFuelPrice.toFixed(2)}/ลิตร</span>
                  </div>
                  <div class="rd-row sub">
                    <span class="rd-icon"></span>
                    <span class="rd-label">อัตราสิ้นเปลือง</span>
                    <span class="rd-value">{KM_PER_LITER} กม./ลิตร</span>
                  </div>
                {:else}
                  <div class="rd-row">
                    <span class="rd-icon">⚡</span>
                    <span class="rd-label">ค่าไฟ ({evEnergyConsumption.toFixed(1)} kWh)</span>
                    <span class="rd-value cost">฿{Math.round(evCostEstimate)}</span>
                  </div>
                  <div class="rd-row sub">
                    <span class="rd-icon"></span>
                    <span class="rd-label">อัตราค่าไฟ</span>
                    <span class="rd-value">฿{ELECTRICITY_PRICE_PER_KWH}/kWh</span>
                  </div>
                  <div class="rd-row sub">
                    <span class="rd-icon"></span>
                    <span class="rd-label">อัตราสิ้นเปลือง</span>
                    <span class="rd-value">{KWH_PER_100KM} kWh/100กม.</span>
                  </div>
                  <div class="rd-row sub">
                    <span class="rd-icon"></span>
                    <span class="rd-label">แบตหลังเดินทาง</span>
                    <span class="rd-value" style="color: {evBatteryAfterTrip < 20 ? '#ef4444' : '#00ff88'}">{Math.round(evBatteryAfterTrip)}%</span>
                  </div>
                {/if}
                {#if tollCostEstimate > 0}
                  <div class="rd-row">
                    <span class="rd-icon">🛣️</span>
                    <span class="rd-label">ค่าผ่านทาง</span>
                    <span class="rd-value cost">฿{Math.round(tollCostEstimate)}</span>
                  </div>
                {/if}
                <div class="rd-total">
                  <span class="rd-label">รวมทั้งหมด</span>
                  <span class="rd-value total">฿{vehicleType === 'fuel' ? Math.round((optimizedRoute.total_distance / 1000) / KM_PER_LITER * currentFuelPrice + tollCostEstimate) : Math.round(evCostEstimate + tollCostEstimate)}</span>
                </div>
              </div>
            </div>
            <div class="route-timeline">
              <h4>ลำดับการเดินทาง</h4>
              {#each optimizedRoute.optimized_order as point, i}
                {@const isStart = point.id === -1}
                {@const isCustomer = point.isCustomerOrder || false}
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

  <!-- Add Point Form Overlay (outside sidebar for proper z-index) -->
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
            <button type="submit" class="btn btn-primary" disabled={isAddingPoint}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>{isAddingPoint ? 'กำลังเพิ่ม...' : 'บันทึก'}</button>
            <button type="button" class="btn btn-ghost" on:click={cancelAddForm}>ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>
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
                  <span class="route-stat-val">฿{Math.round(getFuelCostForRoute(alt.distance, alt.duration))}</span>
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
              <div class="comp-col">฿{Math.round(getFuelCostForRoute(alt.distance, alt.duration))}</div>
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
            {@const cheapest = routeAlternatives.reduce((a, b) => getFuelCostForRoute(a.distance, a.duration) + a.tollEstimate < getFuelCostForRoute(b.distance, b.duration) + b.tollEstimate ? a : b)}
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
  {#if !isNavigating && !showSettings && !showAddForm}
    <button class="desktop-sidebar-toggle" class:sidebar-hidden={desktopSidebarCollapsed} on:click={() => { desktopSidebarCollapsed = !desktopSidebarCollapsed; smoothMapResize(); }} title={desktopSidebarCollapsed ? 'แสดงเมนู [M]' : 'ซ่อนเมนู [M]'}>
      {#if desktopSidebarCollapsed}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        <span>เมนู</span>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        <span>ซ่อน</span>
      {/if}
    </button>
  {/if}

  <div class="map-container" class:fullscreen={isNavigating} class:settings-open={showSettings} class:addform-open={showAddForm} class:globe-mode={globeMode}>
    <div id="map"></div>
    <!-- Three.js 3D Globe -->
    <!-- Three.js 3D Globe -->
    <div id="globe-container" class:active={globeMode}>
      {#if globeMode && !globeReady && !globeError}
        <div class="globe-loading">
          <div class="globe-loading-spinner"></div>
          <span>กำลังโหลดโลก 3D...</span>
        </div>
      {/if}
      {#if globeError}
        <div class="globe-loading">
          <span style="color: #ef4444">{globeError}</span>
          <button class="globe-retry-btn" on:click={() => { globeError = ''; globeInitializing = false; globeReady = false; enterGlobeMode(); }}>ลองใหม่</button>
        </div>
      {/if}
      {#if globeMode}
        <button class="globe-back-btn" on:click={() => { const ll = getGlobeCenterLatLng(); exitGlobeMode(ll || { lat: 13.7, lng: 100.5 }); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
          กลับแผนที่
        </button>
        <!-- Globe location info + my location button -->
        {#if globeReady}
          <div class="globe-info-panel">
            <div class="globe-region-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              <span>{globeViewLabel || 'กำลังโหลด...'}</span>
            </div>
            {#if currentLocation}
              <div class="globe-my-loc-info">
                <svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px;flex-shrink:0;color:#00ff88"><circle cx="12" cy="12" r="6"/></svg>
                <span>ตำแหน่งของคุณ: {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}</span>
              </div>
            {/if}
          </div>
          <button class="globe-myloc-btn" on:click={goToMyLocationOnGlobe} title="ไปตำแหน่งของฉัน">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        {/if}
      {/if}
    </div>

    {#if !isNavigating && !isSearchFocused && !directDestination && !showStartPointPicker && !aiChatOpen}
      <div class="map-top-left-group">
        <div class="map-stats glass-card" class:route-active={optimizedRoute}>
          <div class="map-stat"><span class="map-stat-value">{isDataLoaded ? deliveryPoints.length : '...'}</span><span class="map-stat-label">จุดแวะ</span></div>
          <div class="map-stat"><span class="map-stat-value">{isDataLoaded ? getSuccessCount() : '...'}</span><span class="map-stat-label">เสร็จแล้ว</span></div>
          <div class="map-stat weather"><span class="map-stat-value">{getWeatherIcon()} {weather.temp}°</span><span class="map-stat-label">อากาศ</span></div>
        </div>
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
      </div>
    {/if}

    <!-- Add Point Mode Toggle (hidden when route is calculated) -->
    {#if !isNavigating && !isSearchFocused && !directDestination && !optimizedRoute && !showStartPointPicker && !aiChatOpen}
      <button class="add-point-toggle glass-card" class:active={addPointMode} on:click={() => { addPointMode = !addPointMode; if (map) map.getContainer().style.cursor = addPointMode ? 'crosshair' : ''; if (!addPointMode && clickMarker) { clickMarker.remove(); clickMarker = null; } }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        <span>{addPointMode ? 'ปักหมุดอยู่...' : 'เพิ่มจุด'}</span>
      </button>
    {/if}

    {#if !isNavigating && !optimizedRoute && addPointMode && !aiChatOpen}
      <div class="map-info glass-card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>คลิกที่แผนที่เพื่อเพิ่มจุดแวะ</span></div>
    {/if}

    <!-- My Location + Camera Reset Buttons (bottom-right) -->
    {#if !isNavigating && !globeMode && !aiChatOpen}
      <div class="map-right-btns">
        {#if camActive}
          <button class="map-cam-btn active" on:click={resetCamView} title="รีเซ็ตมุมกล้อง (กลับทิศเหนือ)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate({-camAngle}deg)">
              <circle cx="12" cy="12" r="9" stroke-opacity="0.3"/>
              <polygon points="12,3 9,13 12,11 15,13" fill="#ef4444" stroke="none"/>
              <polygon points="12,21 9,11 12,13 15,11" fill="#a1a1aa" stroke="none"/>
            </svg>
          </button>
        {/if}
        <button class="map-myloc-btn" on:click={centerOnCurrentLocation} title="ไปตำแหน่งปัจจุบัน">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
        </button>
      </div>
    {/if}

    <!-- Floating Navigate Button (mobile) -->
    {#if optimizedRoute && !isNavigating && !isSearchFocused && !directDestination && !showIncidentsPanel && !aiChatOpen}
      <button class="map-nav-btn glass-card" on:click={() => { if (allDeliveryPoints.length > 0) startNavigation(); }} title="เริ่มนำทาง">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
        <span>นำทาง</span>
      </button>
    {/if}

    <!-- ==================== FLOATING PANELS ON MAP ==================== -->

    <!-- Floating Search Bar -->
    {#if !aiChatOpen}
    <SearchPanel
      {isNavigating}
      {directDestination}
      {getUserKey}
      {showStartPointPicker}
      {startPointSearchQuery}
      {isSearchingStartPoint}
      {startPointResults}
      on:selectResult={(e) => selectSearchResult(e.detail)}
      on:navigate={navigateToSearchResult}
      on:clearDestination={() => { if (destinationMarker) { destinationMarker.remove(); destinationMarker = null; } directDestination = null; }}
      on:searchError={(e) => showNotification(e.detail.message, 'error')}
      on:searchFocus={(e) => isSearchFocused = e.detail}
      on:startPointInput={(e) => { startPointSearchQuery = e.detail; onStartPointSearchInput(); }}
      on:selectStartPoint={(e) => setCustomStartFromSearch(e.detail)}
      on:closeStartPointSearch={() => { showStartPointPicker = false; if (!useCustomStartPoint) clearCustomStartPoint(); }}
    />
    {/if}

    <!-- Floating Route Preferences -->
    {#if !isNavigating && !aiChatOpen}
      <div class="map-prefs-float glass-card">
        <div class="float-pref-chips">
          <button class="float-pref-chip" class:active={routePreference === 'fastest'} on:click={() => toggleRoutePreference('fastest')}>🚀 เร็วสุด</button>
          <button class="float-pref-chip" class:active={routePreference === 'shortest'} on:click={() => toggleRoutePreference('shortest')}>📏 สั้นสุด</button>
          <button class="float-pref-chip" class:active={routePreference === 'no_tolls'} on:click={() => toggleRoutePreference('no_tolls')}>🚫 เลี่ยงทางด่วน</button>
          <button class="float-pref-chip" class:active={routePreference === 'no_highways'} on:click={() => toggleRoutePreference('no_highways')}>🏘️ เลี่ยงมอเตอร์เวย์</button>
        </div>
        <div class="float-pref-toggles">
          <button class="float-toggle-chip" class:active={showTraffic} on:click={toggleTraffic} title="แสดงการจราจร [T]">🚦</button>
          <button class="float-toggle-chip" class:active={showIncidentsPanel} on:click={toggleIncidentsPanel} title="เหตุการณ์จราจร">🚨</button>
          <button class="float-toggle-chip" class:active={autoRerouteEnabled} on:click={() => { autoRerouteEnabled = !autoRerouteEnabled; localStorage.setItem(getUserKey('autoRerouteEnabled'), String(autoRerouteEnabled)); }} title="คำนวณใหม่อัตโนมัติ">🔄</button>
          <button class="float-toggle-chip gps-refresh-btn" class:spinning={isRefreshingGps} on:click={refreshGpsPosition} title="รีเฟรช GPS (±{Math.round(accuracy)}m)">📍</button>
          <button class="float-toggle-chip" class:active={showWeatherRadar} on:click={toggleWeatherRadar} title="เรดาร์ฝน">🌧️</button>
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

    <!-- Floating Along-Route POI (search button) -->
    {#if optimizedRoute && !isNavigating && !isSearchFocused && !directDestination}
      <div class="map-poi-float glass-card">
        <button class="poi-search-btn" on:click={searchPOIsAlongRoute} disabled={isLoadingPOIs}>
          {isLoadingPOIs ? '⏳ กำลังค้นหา...' : '🔍 ค้นหาสถานที่บนเส้นทาง'}
        </button>
        {#if alongRoutePOIs.length > 0 && !showPOIModal}
          <div class="poi-btn-row">
            <button class="poi-btn-half poi-reopen-btn" on:click={() => { showPOIModal = true; }}>
              📋 ดู ({alongRoutePOIs.length})
            </button>
            <button class="poi-btn-half poi-clear-btn" on:click={clearAllPOI}>
              ✕ ยกเลิก
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Vehicle Toggle moved to map-top-left-group -->

    <!-- Floating Saved Routes (if any) -->
    {#if !isNavigating && savedRoutes.length > 0 && !aiChatOpen}
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

<!-- AI Chat Panel (floating) -->
{#if aiAvailable && !isNavigating}
  <AIChatPanel context={aiChatContext} bind:isOpen={aiChatOpen} />
{/if}

<!-- AI Route Suggestion Modal -->
{#if showAISuggestion}
  <AIRouteSuggestion
    suggestion={aiSuggestion}
    points={allDeliveryPoints}
    isLoading={isAIPlanning}
    on:apply={applyAISuggestion}
    on:dismiss={() => { showAISuggestion = false; aiSuggestion = null; }}
  />
{/if}

<!-- POI Results Modal (outside app-container for proper fixed positioning) -->
{#if showPOIModal && alongRoutePOIs.length > 0 && !isNavigating}
  <div class="poi-modal-backdrop" on:click={closePOIPanel} on:keypress={() => {}} role="button" tabindex="-1"></div>
  <div class="poi-modal">
    <div class="poi-modal-header">
      <h3 class="poi-modal-title">สถานที่บนเส้นทาง</h3>
      <span class="poi-modal-count">{alongRoutePOIs.filter(p => activePOITypes.has(p.type)).length} แห่ง</span>
      <button class="poi-modal-close" on:click={closePOIPanel}>✕</button>
    </div>
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
    {#if alongRoutePOIs.filter(p => activePOITypes.has(p.type)).length === 0}
      <div class="poi-empty">ไม่พบสถานที่ในหมวดที่เลือก</div>
    {:else}
      <div class="poi-list-modal">
        {#each alongRoutePOIs.filter(p => activePOITypes.has(p.type)) as poi}
          <div class="poi-item-modal" on:click={() => flyToPOI(poi)} on:keypress={() => {}} role="button" tabindex="0">
            <span class="poi-type-icon-lg">{getPOIIcon(poi.type)}</span>
            <div class="poi-item-detail">
              <span class="poi-name-lg">{poi.name || poi.tags?.brand || getPOILabel(poi.type)}</span>
              <span class="poi-type-label">{getPOILabel(poi.type)}</span>
              {#if poi.tags?.['addr:road'] || poi.tags?.['addr:city'] || poi.tags?.['addr:subdistrict']}
                <span class="poi-address">{[poi.tags?.['addr:road'], poi.tags?.['addr:subdistrict'], poi.tags?.['addr:city']].filter(Boolean).join(', ')}</span>
              {/if}
              {#if poi.tags?.cuisine}
                <span class="poi-extra">🍽️ {poi.tags.cuisine.replace(/;/g, ', ')}</span>
              {/if}
              {#if poi.tags?.opening_hours}
                <span class="poi-extra">🕐 {poi.tags.opening_hours}</span>
              {/if}
              {#if poi.tags?.phone}
                <span class="poi-extra">📞 {poi.tags.phone}</span>
              {/if}
              <span class="poi-distance-info">📍 {formatDistance(poi.distAlongRoute)} บนเส้นทาง · ห่าง {Math.round(poi.distFromRoute)} ม.</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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

/* Enhanced Vehicle Info Cards */

/* ==================== REORDER MODE ==================== */
.btn-reorder-active {
  background: rgba(0,255,136,0.15) !important;
  color: #00ff88 !important;
  border: 1px solid rgba(0,255,136,0.3) !important;
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
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
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
  :global(body) { font-family: 'Kanit', sans-serif; background: #0a0a0f; color: #e4e4e7; overflow: hidden; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  :global(::selection) { background: rgba(0, 255, 136, 0.25); color: #fff; }

  .app-container { display: flex; height: 100vh; width: 100vw; overflow: hidden; background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%); }

  .sidebar {
    width: 500px;
    flex-shrink: 0;
    background: #0d0d18;
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    flex-direction: column;
    z-index: 10;
    overflow: hidden;
    max-width: 100%;
    position: relative;
    transition: width 0.3s cubic-bezier(0.22, 1, 0.36, 1),
                opacity 0.15s ease;
    will-change: width, opacity;
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
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
    border: none;
    border-radius: 0 14px 14px 0;
    cursor: pointer;
    color: #0a0a0f;
    font-family: 'Kanit', sans-serif;
    font-size: 11px;
    font-weight: 600;
    z-index: 1500;
    transition: left 0.3s cubic-bezier(0.22, 1, 0.36, 1),
                transform 0.2s ease,
                background 0.2s ease,
                box-shadow 0.2s ease;
    will-change: left, transform;
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
    box-shadow: 0 2px 12px rgba(0, 255, 136, 0.2);
  }
  .desktop-sidebar-toggle:hover {
    background: linear-gradient(135deg, #00e67a 0%, #00b35e 100%);
    box-shadow: 0 4px 20px rgba(0, 255, 136, 0.35);
    transform: translateY(-50%) scale(1.05);
  }
  .desktop-sidebar-toggle:active {
    transform: translateY(-50%) scale(0.95);
    transition-duration: 0.1s;
  }
  .desktop-sidebar-toggle svg { width: 24px; height: 24px; flex-shrink: 0; transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .desktop-sidebar-toggle:hover svg { transform: scale(1.15); }
  .desktop-sidebar-toggle span { white-space: nowrap; }

  /* When sidebar is hidden - move button to left edge */
  .desktop-sidebar-toggle.sidebar-hidden {
    left: 0;
  }

  /* Desktop collapsed state - uses margin-left instead of width for smooth GPU animation */
  .sidebar.desktop-collapsed {
    width: 0;
    min-width: 0;
    margin-left: 0;
    opacity: 0;
    pointer-events: none;
    border-right: none;
    overflow: hidden;
  }
  .sidebar-header { padding: 14px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; background: rgba(0, 0, 0, 0.1); position: relative; }
  .sidebar-scroll { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; padding-bottom: 10px; }
  .sidebar-scroll::-webkit-scrollbar { width: 5px; }
  .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
  .sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(0, 255, 136, 0.15); border-radius: 10px; transition: background 0.3s; }
  .sidebar-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0, 255, 136, 0.35); }

  .logo { display: flex; align-items: center; gap: 10px; }
  .logo.desktop-only { margin-bottom: 8px; }
  .mobile-only { display: none; }
  .logo-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0, 255, 136, 0.2); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease; }
  .logo-icon:hover { transform: scale(1.08) rotate(-3deg); box-shadow: 0 4px 16px rgba(0, 255, 136, 0.3); }
  .logo-icon svg { width: 18px; height: 18px; color: #0a0a0f; }
  .logo-text h1 { font-size: 15px; font-weight: 700; color: #00ff88; }
  .logo-text span { font-size: 9px; color: #71717a; text-transform: uppercase; letter-spacing: 1px; }

  .stats-badge { display: flex; flex-direction: column; align-items: center; background: rgba(0, 255, 136, 0.08); border: 1px solid rgba(0, 255, 136, 0.15); border-radius: 8px; padding: 6px 12px; transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease; }
  .stats-badge:hover { transform: scale(1.05); box-shadow: 0 4px 16px rgba(0, 255, 136, 0.12); }
  .stats-number { font-size: 16px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .stats-label { font-size: 9px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Start Point Selector (in header) */
  .header-start-point { flex: 0 1 auto; min-width: 0; }
  .header-start-point .start-options { display: flex; gap: 4px; }
  .header-start-point .start-selected { margin-top: 4px; padding: 3px 6px; font-size: 10px; }
  .start-options { display: flex; gap: 4px; }
  .start-opt { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 22px; font-size: 12px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: rgba(255,255,255,0.03); color: #a1a1aa; cursor: pointer; transition: all 0.2s; font-family: inherit; white-space: nowrap; }
  /* Floating Start Point Search (on map) */
  .start-opt:hover { background: rgba(255,255,255,0.06); color: #e4e4e7; }
  .start-opt.active { background: rgba(0,255,136,0.1); border-color: rgba(0,255,136,0.3); color: #00ff88; }
  .start-opt.disabled-route { opacity: 0.4; cursor: not-allowed; }
  .start-selected { display: flex; align-items: center; gap: 6px; margin-top: 6px; padding: 6px 10px; background: rgba(0,255,136,0.06); border: 1px solid rgba(0,255,136,0.15); border-radius: 8px; font-size: 12px; color: #00ff88; }
  .start-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .start-clear { background: none; border: none; color: #a1a1aa; cursor: pointer; padding: 2px 4px; font-size: 14px; line-height: 1; font-family: inherit; }
  .start-clear:hover { color: #ef4444; }
  .start-point-search { margin-top: 6px; }
  .start-search-input { width: 100%; padding: 8px 12px; font-size: 13px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; background: rgba(255,255,255,0.04); color: #e4e4e7; outline: none; font-family: inherit; }
  .start-search-input:focus { border-color: rgba(0,255,136,0.4); }
  .start-searching { padding: 8px; font-size: 12px; color: #a1a1aa; text-align: center; }
  .start-results { margin-top: 4px; max-height: 180px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; background: rgba(15,15,25,0.95); }
  .start-result-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; font-size: 12px; color: #e4e4e7; border: none; border-bottom: 1px solid rgba(255,255,255,0.04); background: none; cursor: pointer; text-align: left; font-family: inherit; }
  .start-result-item:last-child { border-bottom: none; }
  .start-result-item:hover { background: rgba(0,255,136,0.06); }
  .start-result-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  :global(.custom-start-marker) { background: none !important; border: none !important; }
  :global(.custom-start-wrapper) { position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }
  :global(.custom-start-dot) {
    width: 18px; height: 18px; border-radius: 50%;
    background: #00ff88; border: 3px solid #fff;
    box-shadow: 0 0 12px rgba(0,255,136,0.6), 0 0 24px rgba(0,255,136,0.3);
    position: relative; z-index: 3;
  }
  :global(.custom-start-pulse) {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 44px; height: 44px; border-radius: 50%;
    background: rgba(0,255,136,0.15); border: 2px solid rgba(0,255,136,0.3);
    animation: customStartPulse 2s ease-out infinite; z-index: 1;
  }
  :global(.custom-start-pulse-2) { animation-delay: 1s; }
  :global(.custom-start-label) {
    position: absolute; top: -28px; left: 50%; transform: translateX(-50%) scale(var(--start-label-scale, 1));
    transform-origin: bottom center;
    background: rgba(0,255,136,0.9); color: #0a0a0f;
    font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 6px;
    white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3); z-index: 4;
    font-family: 'Kanit', sans-serif; transition: transform 0.2s ease;
  }
  :global(.start-label-gps) {
    background: rgba(66,133,244,0.9);
  }
  :global(.start-label-gps::after) {
    border-top-color: rgba(66,133,244,0.9) !important;
  }
  :global(.custom-start-label::after) {
    content: ''; position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%);
    border-left: 5px solid transparent; border-right: 5px solid transparent;
    border-top: 5px solid rgba(0,255,136,0.9);
  }
  @keyframes customStartPulse {
    0% { transform: translate(-50%, -50%) scale(0.8); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
  }
  .start-pin { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); }

  .action-buttons { padding: 10px 14px; display: flex; flex-direction: row; flex-wrap: wrap; gap: 5px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
  .action-buttons .btn { flex: 1 1 calc(33.3% - 4px); min-width: 0; }

  .btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 9px 12px; border-radius: 10px;
    font-family: 'Kanit', sans-serif; font-size: 12px; font-weight: 500;
    cursor: pointer; border: none; outline: none;
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.35s cubic-bezier(0.22, 1, 0.36, 1),
                opacity 0.25s ease,
                background 0.25s ease,
                border-color 0.25s ease,
                filter 0.25s ease;
    will-change: transform;
    position: relative;
    overflow: hidden;
  }
  .btn::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at var(--x, 50%) var(--y, 50%), rgba(255,255,255,0.12) 0%, transparent 60%);
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
  }
  .btn:hover::after { opacity: 1; }
  .btn svg { width: 16px; height: 16px; transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .btn:hover svg { transform: scale(1.1); }
  .btn:active:not(:disabled) { transform: scale(0.95); transition-duration: 0.1s; }
  .btn-primary { background: #00ff88; color: #0a0a0f; box-shadow: 0 2px 12px rgba(0, 255, 136, 0.2); }
  .btn-primary:hover:not(:disabled) { background: #00e67a; box-shadow: 0 4px 20px rgba(0, 255, 136, 0.35); transform: translateY(-1px); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
  .btn-navigate { background: rgba(0,255,136,0.12); color: #00ff88; border: 1px solid rgba(0,255,136,0.25); box-shadow: 0 2px 12px rgba(0,255,136,0.1); }
  .btn-navigate:hover { background: rgba(0,255,136,0.2); box-shadow: 0 4px 20px rgba(0,255,136,0.2); transform: translateY(-1px); }
  .btn-secondary { background: rgba(255,255,255,0.06); color: #a1a1aa; border: 1px solid rgba(255,255,255,0.1); }
  .btn-secondary:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); color: #e4e4e7; transform: translateY(-1px); }
  .btn-ghost { background: rgba(255, 255, 255, 0.05); color: #a1a1aa; border: 1px solid rgba(255, 255, 255, 0.1); }
  .btn-ghost:hover { background: rgba(255, 255, 255, 0.1); color: #e4e4e7; border-color: rgba(255, 255, 255, 0.2); transform: translateY(-1px); }
  .btn-drag-active { background: rgba(0,255,136,0.15); color: #00ff88; border: 1px solid rgba(0,255,136,0.3); }
  .btn-drag-active:hover { background: rgba(0,255,136,0.25); border-color: rgba(0,255,136,0.5); transform: translateY(-1px); }

  .spinner { width: 20px; height: 20px; border: 2px solid rgba(10, 10, 15, 0.3); border-top-color: #0a0a0f; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

    .glass-card {
      background: rgba(18, 18, 28, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
      contain: layout style paint;
    }
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
      transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
    }

    .btn-ev-clear:hover {
      background: rgba(255, 107, 107, 0.25);
    }
  .add-form { padding: 20px; animation: slideIn 0.4s cubic-bezier(0.22, 1, 0.36, 1); width: 100%; max-width: 440px; max-height: 85vh; overflow-y: auto; border-radius: 16px; }
  .add-form-overlay {
    position: fixed; inset: 0; z-index: 2100;
    background: rgba(0,0,0,0.6); display: flex;
    align-items: center; justify-content: center;
    padding: 20px;
  }
  @keyframes slideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeInFloat { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  .form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .form-header h3 { font-size: 16px; font-weight: 600; color: #e4e4e7; }
  .close-btn {
    width: 32px; height: 32px; border-radius: 8px;
    background: rgba(255, 255, 255, 0.05); border: none;
    color: #71717a; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
                background 0.25s ease,
                color 0.25s ease,
                box-shadow 0.25s ease;
  }
  .close-btn:hover { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; transform: scale(1.1) rotate(90deg); box-shadow: 0 2px 8px rgba(255, 107, 107, 0.15); }
  .close-btn:active { transform: scale(0.9) rotate(90deg); transition-duration: 0.1s; }
  .close-btn svg { width: 16px; height: 16px; }
  .form-hint { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #71717a; margin-bottom: 20px; }
  .form-hint svg { width: 16px; height: 16px; color: #00ff88; }
  .form-group { margin-bottom: 16px; }
  .form-group label { display: block; font-size: 12px; font-weight: 500; color: #a1a1aa; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .form-group input, .form-group textarea { width: 100%; padding: 12px 16px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 14px; transition: border-color 0.35s ease, box-shadow 0.35s ease, background 0.35s ease; resize: none; }
  .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #00ff88; background: rgba(0, 0, 0, 0.45); box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1), 0 4px 16px rgba(0, 255, 136, 0.06); }
  .form-group input::placeholder, .form-group textarea::placeholder { color: #52525b; }
  .coords-group { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .coord-input input { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 13px; background: rgba(0, 0, 0, 0.5); color: #71717a; }
  .priority-selector { display: flex; flex-wrap: wrap; gap: 8px; }
  .priority-btn { flex: 1 1 auto; min-width: 50px; max-width: 70px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 4px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); border: 2px solid transparent; cursor: pointer; transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s; }
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
    gap: 4px;
    margin: 3px 14px 10px;
    padding: 3px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
  }
  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    background: transparent;
    border: none;
    color: #71717a;
    font-family: 'Kanit', sans-serif;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.3s ease, background 0.3s ease, box-shadow 0.3s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    position: relative;
  }
  .tab svg {
    width: 14px;
    height: 14px;
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .tab:hover:not(:disabled) {
    color: #a1a1aa;
    background: rgba(255, 255, 255, 0.04);
  }
  .tab:hover:not(:disabled) svg { transform: scale(1.15); }
  .tab:active:not(:disabled) {
    transform: scale(0.96);
    transition-duration: 0.1s;
  }
  .tab.active {
    background: rgba(0, 255, 136, 0.1);
    color: #00ff88;
    box-shadow: 0 2px 12px rgba(0, 255, 136, 0.1), inset 0 1px 0 rgba(0, 255, 136, 0.1);
  }
  .tab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .tab-chevron { display: none; }
  .content-area.content-collapsed { max-height: none; opacity: 1; padding: 0 14px; overflow: visible; }
  .content-area { flex: 1; overflow-y: auto; padding: 0 14px; }
  .content-area::-webkit-scrollbar { width: 5px; }
  .content-area::-webkit-scrollbar-track { background: transparent; }
  .content-area::-webkit-scrollbar-thumb { background: rgba(0, 255, 136, 0.15); border-radius: 10px; }
  .content-area::-webkit-scrollbar-thumb:hover { background: rgba(0, 255, 136, 0.35); }

  /* Clean Empty State */
  .empty-state {
    text-align: center;
    padding: 30px 16px;
    margin: 10px;
  }
  .empty-icon {
    width: 50px;
    height: 50px;
    margin: 0 auto 12px;
    background: rgba(139, 92, 246, 0.08);
    border: 1px solid rgba(139, 92, 246, 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .empty-icon svg {
    width: 24px;
    height: 24px;
    color: #8b5cf6;
  }
  .empty-state h4 {
    font-size: 13px;
    font-weight: 600;
    color: #a1a1aa;
    margin-bottom: 6px;
  }
  .empty-state p {
    font-size: 11px;
    color: #71717a;
    line-height: 1.5;
  }

  /* Clean Points List */
  .points-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 16px;
  }
  .point-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    cursor: pointer;
    position: relative;
    transition: background 0.15s ease;
  }
  .point-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 2px;
    height: 100%;
    background: #00ff88;
    border-radius: 2px 0 0 2px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .point-card:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .point-card:hover::before {
    opacity: 0.6;
  }
  .point-card:active {
    background: rgba(255, 255, 255, 0.06);
  }
  .point-card.active {
    background: rgba(0, 255, 136, 0.04);
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
    color: #e4e4e7;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .point-info p {
    font-size: 12px;
    color: #52525b;
    margin-bottom: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }
  .point-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .priority-tag {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    color: white;
  }
  .distance-tag {
    font-size: 11px;
    color: #71717a;
    background: none;
    padding: 0;
    border-radius: 0;
  }
  .delete-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: transparent;
    border: none;
    color: #3f3f46;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
    flex-shrink: 0;
  }
  .point-card:hover .delete-btn {
    opacity: 1;
  }
  .delete-btn:hover {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }
  .delete-btn svg {
    width: 16px;
    height: 16px;
  }

  /* Modern Route Summary */
  .route-summary {
    padding-bottom: 12px;
  }
  .route-detail-card {
    margin-bottom: 10px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .rd-header {
    font-size: 10px;
    font-weight: 600;
    color: #a1a1aa;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .rd-grid {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rd-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
  }
  .rd-row.sub {
    padding-left: 22px;
    opacity: 0.6;
  }
  .rd-icon {
    width: 16px;
    font-size: 11px;
    text-align: center;
    flex-shrink: 0;
  }
  .rd-label {
    flex: 1;
    font-size: 12px;
    color: #d4d4d8;
  }
  .rd-value {
    font-size: 12px;
    font-weight: 600;
    color: #00ff88;
    font-family: 'JetBrains Mono', monospace;
    white-space: nowrap;
  }
  .rd-value.cost { color: #fbbf24; }
  .rd-value.total {
    font-size: 14px;
    font-weight: 700;
    color: #f59e0b;
  }
  .rd-divider {
    height: 1px;
    background: rgba(255,255,255,0.06);
    margin: 8px 0;
  }
  .rd-total {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0 2px;
    margin-top: 4px;
    border-top: 1px solid rgba(255,255,255,0.08);
  }
  .rd-total .rd-label {
    font-weight: 600;
    color: #e4e4e7;
  }
  .summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .summary-header h3 {
    font-size: 13px;
    font-weight: 600;
    color: #f4f4f5;
  }
  .route-badge {
    padding: 3px 10px;
    background: rgba(0, 255, 136, 0.1);
    border: 1px solid rgba(0, 255, 136, 0.2);
    border-radius: 14px;
    font-size: 10px;
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
    gap: 8px;
    margin-bottom: 12px;
  }
  .stat-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 10px 8px;
    text-align: center;
    transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
  }
  .stat-card:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
  }
  .stat-icon {
    width: 30px;
    height: 30px;
    margin: 0 auto 6px;
    background: rgba(0, 255, 136, 0.08);
    border: 1px solid rgba(0, 255, 136, 0.15);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }
  .stat-icon svg {
    width: 16px;
    height: 16px;
    color: #00ff88;
  }
  .stat-value {
    font-size: 18px;
    font-weight: 700;
    color: #f4f4f5;
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    line-height: 1;
    margin-bottom: 2px;
  }
  .stat-label {
    font-size: 9px;
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
  .route-timeline h4 { font-size: 10px; font-weight: 600; color: #a1a1aa; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .timeline-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; margin-bottom: 6px; cursor: pointer; transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s; }
  .timeline-item:hover { background: rgba(255, 255, 255, 0.04); }
  .timeline-item.start .timeline-marker { background: #3b82f6; }
  .timeline-item.end .timeline-marker { background: #ff6b6b; }
  .timeline-marker { width: 24px; height: 24px; border-radius: 6px; background: #667eea; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: white; flex-shrink: 0; }
  .timeline-content { flex: 1; }
  .timeline-label { font-size: 9px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
  .timeline-name { font-size: 12px; font-weight: 500; color: #e4e4e7; }

  .sidebar-footer { padding: 10px 14px; border-top: 1px solid rgba(255, 255, 255, 0.05); display: flex; justify-content: space-between; font-size: 9px; color: #52525b; flex-shrink: 0; }

  /* ==================== NEW FEATURES CSS ==================== */

  /* Header Actions */
  .header-actions { display: flex; gap: 6px; }
  .icon-btn {
    width: 32px; height: 32px; border-radius: 8px;
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
  .vehicle-toggle-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 16px; border-radius: 10px; border: none; cursor: pointer; font-family: 'Kanit', sans-serif; font-size: 14px; font-weight: 500; transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease; }
  .vehicle-toggle-btn.fuel { background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.2); color: #00ff88; }
  .vehicle-toggle-btn.ev { background: rgba(0,200,255,0.08); border: 1px solid rgba(0,200,255,0.2); color: #67e8f9; }
  .vehicle-toggle-btn:hover { background: rgba(255, 255, 255, 0.05); }
  .toggle-icon { font-size: 20px; }
  .ev-charge-badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; color: #000; }

  /* Vehicle Type Settings */
  .vehicle-type-selector { display: flex; gap: 12px; margin-bottom: 16px; }
  .vehicle-type-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 2px solid transparent; cursor: pointer; transition: background 0.3s, color 0.3s, border-color 0.3s, opacity 0.3s, transform 0.3s; }
  .vehicle-type-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .vehicle-type-btn.active { border-color: #00ff88; background: rgba(0, 255, 136, 0.1); }
  .vehicle-type-btn.active:last-child { border-color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
  .vehicle-icon { font-size: 32px; }
  .vehicle-label { font-size: 14px; font-weight: 500; color: #e4e4e7; }

  /* Vehicle Info Card - shared */
  .vehicle-info-card { border-radius: 12px; margin-top: 10px; overflow: hidden; }
  .vehicle-info-card.fuel { background: linear-gradient(135deg, rgba(0,255,136,0.05) 0%, rgba(0,200,100,0.02) 100%); border: 1px solid rgba(0,255,136,0.15); }
  .vehicle-info-card.ev { background: linear-gradient(135deg, rgba(59,130,246,0.05) 0%, rgba(99,102,241,0.02) 100%); border: 1px solid rgba(59,130,246,0.15); }

  /* Top row: header left + stats right */
  .vic-top-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; gap: 8px; }
  .vic-header { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .vic-header-icon { font-size: 18px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; flex-shrink: 0; }
  .fuel-header .vic-header-icon { background: rgba(0,255,136,0.12); }
  .ev-header .vic-header-icon { background: rgba(59,130,246,0.12); }
  .vic-header-info { display: flex; flex-direction: column; gap: 0; }
  .vic-header-title { font-size: 13px; font-weight: 600; color: #e4e4e7; line-height: 1.2; }
  .vic-header-sub { font-size: 11px; color: #71717a; line-height: 1.2; }
  .fuel-header .vic-header-sub { color: #34d399; }
  .ev-header .vic-header-sub { color: #60a5fa; }

  /* Fuel inline stat */
  .vic-inline-stat { display: flex; align-items: baseline; gap: 4px; }
  .vic-inline-val { font-size: 22px; font-weight: 700; color: #34d399; line-height: 1; }
  .vic-inline-unit { font-size: 10px; color: #71717a; }

  /* EV mini stats (inline, right side of header) */
  .vic-mini-stats { display: flex; align-items: center; gap: 0; background: rgba(255,255,255,0.04); border-radius: 8px; padding: 4px 2px; flex-shrink: 0; }
  .vic-mini-stat { display: flex; flex-direction: column; align-items: center; padding: 0 8px; }
  .vic-mini-val { font-size: 14px; font-weight: 700; line-height: 1.2; }
  .vic-mini-unit { font-size: 8px; color: #52525b; line-height: 1.2; }
  .vic-mini-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.08); flex-shrink: 0; }

  /* Fuel single slider row */
  .vic-slider-row { padding: 6px 12px 8px; border-top: 1px solid rgba(0,255,136,0.08); }
  .vic-label-compact { display: block; font-size: 10px; color: #71717a; margin-bottom: 4px; }

  /* EV grid sliders - 2 cols */
  .vic-grid-sliders { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-top: 1px solid rgba(59,130,246,0.08); }
  .vic-slider-cell { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .vic-slider-cell:nth-child(odd) { border-right: 1px solid rgba(255,255,255,0.04); }
  .vic-slider-wide { grid-column: 1 / -1; border-right: none; }

  .vic-label { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; font-size: 11px; color: #a1a1aa; }
  .vic-label strong { font-size: 14px; color: #e4e4e7; font-weight: 600; }
  .vic-label strong small { font-size: 9px; color: #71717a; font-weight: 400; }
  .vehicle-info-card.fuel .vic-label strong { color: #34d399; }
  .vehicle-info-card.ev .vic-label strong { color: #60a5fa; }

  /* Range sliders */
  .vic-range { width: 100%; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); appearance: none; cursor: pointer; outline: none; }
  .vic-range::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; cursor: pointer; border: 2px solid rgba(0,0,0,0.2); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
  .fuel-range::-webkit-slider-thumb { background: #00ff88; }
  .ev-range::-webkit-slider-thumb { background: #3b82f6; }
  .battery-range::-webkit-slider-thumb { background: var(--battery-color, #3b82f6); }
  .vic-range-hint { display: flex; justify-content: space-between; font-size: 8px; color: rgba(255,255,255,0.15); margin-top: 2px; }

  /* Consumption row: slider + speed chips side by side */
  .vic-consumption-row { display: flex; align-items: center; gap: 10px; }
  .vic-consumption-row .vic-range { flex: 1; min-width: 0; }
  .vic-speed-chips { display: flex; gap: 3px; flex-shrink: 0; }
  .vic-chip { font-size: 11px; font-weight: 700; display: flex; align-items: baseline; gap: 1px; }
  .vic-chip small { font-size: 8px; color: #52525b; margin-left: 1px; }

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

  /* Map Vehicle Type Indicator */
  .map-stat.vehicle-type { border-left: 2px solid #00ff88; }
  .map-stat.vehicle-type.ev { border-left-color: #3b82f6; }

  /* Route Badge */
  .route-badge.ev-badge { background: rgba(59, 130, 246, 0.08); border-color: rgba(59, 130, 246, 0.15); color: #3b82f6; }

  /* EV Primary Button */
  .btn-primary.btn-ev { background: rgba(0,200,255,0.15); color: #67e8f9; border: 1px solid rgba(0,200,255,0.25); }

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

  /* Multi-select Toolbar */
  .multi-select-toolbar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 16px; margin: 0 8px 6px;
    background: linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.08) 100%);
    border: 1px solid rgba(99,102,241,0.25);
    border-radius: 12px;
    animation: mstSlideIn 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes mstSlideIn {
    from { opacity: 0; transform: translateY(-8px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .mst-left { display: flex; align-items: center; gap: 10px; }
  .mst-count {
    width: 30px; height: 30px; border-radius: 8px;
    background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.3);
    display: flex; align-items: center; justify-content: center;
    transition: background 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .mst-count.has-selected {
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border-color: transparent;
    box-shadow: 0 0 14px rgba(99,102,241,0.4);
    transform: scale(1.05);
  }
  .mst-num {
    font-size: 13px; font-weight: 700; color: #c7d2fe;
    font-family: 'JetBrains Mono', monospace;
  }
  .mst-count.has-selected .mst-num { color: #fff; }
  .mst-label { font-size: 12px; color: #a1a1aa; font-weight: 500; }
  .mst-actions { display: flex; align-items: center; gap: 4px; }
  .mst-btn {
    width: 32px; height: 32px; border-radius: 8px; border: none;
    background: rgba(255,255,255,0.05);
    color: #a1a1aa; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
  }
  .mst-btn svg { width: 16px; height: 16px; }
  .mst-btn:hover { background: rgba(0,255,136,0.1); color: #00ff88; transform: scale(1.1); }
  .mst-btn:active { transform: scale(0.95); }
  .mst-btn.delete { color: #71717a; }
  .mst-btn.delete:hover:not(:disabled) { background: rgba(239,68,68,0.15); color: #f87171; }
  .mst-btn.delete:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
  .mst-btn.close { color: #71717a; }
  .mst-btn.close:hover { background: rgba(255,255,255,0.08); color: #d4d4d8; }
  .mst-divider { width: 1px; height: 20px; background: rgba(99,102,241,0.2); margin: 0 4px; }

  /* Multi-select Checkbox */
  .checkbox {
    width: 20px; height: 20px; border-radius: 6px;
    background: rgba(255,255,255,0.06); border: 2px solid rgba(255,255,255,0.15);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; color: white; flex-shrink: 0;
    transition: background 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .checkbox.checked {
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border-color: transparent;
    box-shadow: 0 0 10px rgba(99,102,241,0.3);
    transform: scale(1.1);
  }
  .point-card.selected {
    background: rgba(99,102,241,0.06);
    border-color: rgba(99,102,241,0.2);
  }
  .distance-tag { font-size: 11px; color: #71717a; margin-left: 8px; }

  /* Modal Overlay */
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(8px) saturate(0.8);
    -webkit-backdrop-filter: blur(8px) saturate(0.8);
    z-index: 2000; display: flex; align-items: center; justify-content: center;
    padding: 20px;
    animation: modalFadeIn 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes modalFadeIn {
    from { opacity: 0; backdrop-filter: blur(0px); }
    to { opacity: 1; backdrop-filter: blur(8px); }
  }
  @keyframes modalSlideIn {
    0% { opacity: 0; transform: translateY(-30px) scale(0.92); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
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
  .add-form-modal .form-group input, .add-form-modal .form-group textarea { width: 100%; padding: 12px 14px; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 14px; transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s; }
  .add-form-modal .form-group input:focus, .add-form-modal .form-group textarea:focus { outline: none; border-color: #00ff88; background: rgba(0, 255, 136, 0.05); }
  .add-form-modal .form-group textarea { resize: vertical; min-height: 60px; }
  .add-form-modal .coords-group { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .add-form-modal .priority-selector { display: flex; gap: 8px; flex-wrap: wrap; }
  .add-form-modal .priority-btn { flex: 1; min-width: 60px; padding: 10px 8px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; cursor: pointer; transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .add-form-modal .priority-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .add-form-modal .priority-btn.active { background: var(--btn-bg); border-color: var(--btn-glow); }
  .add-form-modal .priority-num { font-size: 18px; font-weight: 700; color: #e4e4e7; }
  .add-form-modal .priority-label { font-size: 10px; color: #a1a1aa; }
  .add-form-modal .priority-btn.active .priority-num, .add-form-modal .priority-btn.active .priority-label { color: white; }
  .add-form-modal .form-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.1); }

  /* SettingsPanel CSS moved to $lib/components/SettingsPanel.svelte */

  /* ====== Logout Confirm ====== */
  .logout-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 2999; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); animation: logoutFadeIn 0.3s ease; }
  @keyframes logoutFadeIn { from { opacity: 0 } to { opacity: 1 } }
  .logout-modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
    width: 360px; max-width: calc(100% - 32px); z-index: 3000;
    background: rgba(12,12,20,0.96); backdrop-filter: blur(40px) saturate(1.5);
    -webkit-backdrop-filter: blur(40px) saturate(1.5);
    border: 1px solid rgba(255,60,60,0.12);
    border-radius: 24px; padding: 36px 28px 28px; text-align: center;
    box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03), 0 0 60px rgba(255,60,60,0.06);
    animation: logoutModalIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
    overflow: hidden;
  }
  @keyframes logoutModalIn { from { opacity: 0; transform: translate(-50%,-50%) scale(0.85) translateY(20px); } to { opacity: 1; transform: translate(-50%,-50%) scale(1) translateY(0); } }
  .logout-glow {
    position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
    background: conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(255,60,60,0.04) 60deg, transparent 120deg, rgba(255,100,60,0.03) 200deg, transparent 280deg);
    animation: logoutGlowSpin 6s linear infinite; pointer-events: none;
  }
  @keyframes logoutGlowSpin { to { transform: rotate(360deg) } }
  .logout-icon-wrap {
    position: relative; width: 72px; height: 72px; margin: 0 auto 20px;
    display: flex; align-items: center; justify-content: center;
  }
  .logout-icon-ring {
    position: absolute; inset: 0; border-radius: 50%;
    border: 2px solid rgba(255,60,60,0.2);
  }
  .logout-icon-ring.r1 { animation: logoutRingPulse 2s ease-out infinite; }
  .logout-icon-ring.r2 { animation: logoutRingPulse 2s 0.6s ease-out infinite; }
  @keyframes logoutRingPulse { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.8); opacity: 0; } }
  .logout-icon-core {
    width: 56px; height: 56px; border-radius: 16px;
    background: linear-gradient(135deg, rgba(255,60,60,0.15), rgba(255,60,60,0.05));
    border: 1px solid rgba(255,60,60,0.15);
    display: flex; align-items: center; justify-content: center;
    position: relative; z-index: 1;
  }
  .logout-icon-core svg { width: 26px; height: 26px; color: #ff4040; }
  .logout-title { font-size: 20px; font-weight: 700; color: #f0f0f0; margin: 0 0 8px; position: relative; z-index: 1; }
  .logout-desc { font-size: 14px; color: #888; line-height: 1.6; margin: 0 0 28px; position: relative; z-index: 1; }
  .logout-sub { font-size: 12px; color: #555; }
  .logout-actions { display: flex; gap: 12px; position: relative; z-index: 1; }
  .logout-btn-cancel {
    flex: 1; padding: 12px 16px; border-radius: 14px; font-size: 14px; font-weight: 600;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
    color: #aaa; cursor: pointer; transition: background 0.25s, color 0.25s, border-color 0.25s, opacity 0.25s, transform 0.25s; font-family: 'Kanit', sans-serif;
  }
  .logout-btn-cancel:hover { background: rgba(255,255,255,0.08); color: #ddd; border-color: rgba(255,255,255,0.12); }
  .logout-btn-confirm {
    flex: 1; padding: 12px 16px; border-radius: 14px; font-size: 14px; font-weight: 600;
    background: linear-gradient(135deg, rgba(255,50,50,0.9), rgba(220,40,40,0.9));
    border: 1px solid rgba(255,80,80,0.3); color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: background 0.25s, color 0.25s, border-color 0.25s, opacity 0.25s, transform 0.25s; font-family: 'Kanit', sans-serif;
    box-shadow: 0 4px 20px rgba(255,50,50,0.25);
  }
  .logout-btn-confirm svg { width: 16px; height: 16px; }
  .logout-btn-confirm:hover { background: linear-gradient(135deg, rgba(255,60,60,1), rgba(230,50,50,1)); box-shadow: 0 6px 30px rgba(255,50,50,0.35); transform: translateY(-1px); }
  .logout-btn-confirm:active { transform: translateY(0); }

  /* AlertsPanel CSS moved to $lib/components/AlertsPanel.svelte */

  .map-container { flex: 1; position: relative; overflow: hidden; transition: flex 0.35s cubic-bezier(0.4, 0, 0.2, 1); }
  .map-container.fullscreen { width: 100vw; }
  .map-container.settings-open > *:not(#map) { display: none !important; }
  .map-container.addform-open > *:not(#map) { display: none !important; }

  /* ═══ Globe Mode: Three.js 3D Earth ═══ */
  .map-container.globe-mode { background: #000003 !important; }
  .map-container.globe-mode #map { opacity: 0; pointer-events: none; transition: opacity 0.4s ease; }

  #globe-container {
    position: absolute; inset: 0; z-index: 1100;
    opacity: 0; pointer-events: none;
    transition: opacity 0.5s ease;
    background: radial-gradient(ellipse at center, #050510 0%, #000003 70%);
  }
  #globe-container.active {
    opacity: 1; pointer-events: auto;
  }
  :global(#globe-container canvas) {
    width: 100% !important; height: 100% !important;
    display: block;
  }
  .globe-loading {
    position: absolute; inset: 0; z-index: 20;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
    color: #a1a1aa; font-size: 14px; font-family: 'Kanit', sans-serif;
  }
  .globe-loading-spinner {
    width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1);
    border-top: 3px solid #00ff88; border-radius: 50%;
    animation: globe-spin 1s linear infinite;
  }
  @keyframes globe-spin { to { transform: rotate(360deg); } }
  .globe-retry-btn {
    padding: 8px 20px; border-radius: 8px; border: 1px solid rgba(0,255,136,0.3);
    background: rgba(0,255,136,0.1); color: #00ff88; cursor: pointer;
    font-family: 'Kanit', sans-serif; font-size: 13px;
  }
  .globe-back-btn {
    position: absolute; top: 20px; left: 20px; z-index: 30;
    display: flex; align-items: center; gap: 6px;
    padding: 10px 18px; border-radius: 12px;
    background: rgba(15, 15, 25, 0.85); border: 1px solid rgba(255,255,255,0.12);
    color: #e4e4e7; font-size: 13px; font-family: 'Kanit', sans-serif;
    cursor: pointer; transition: background 0.2s, border-color 0.2s;
  }
  .globe-back-btn svg { width: 16px; height: 16px; }
  .globe-back-btn:hover { background: rgba(0,255,136,0.1); border-color: rgba(0,255,136,0.3); color: #00ff88; }

  .globe-info-panel {
    position: absolute; bottom: 24px; left: 24px; z-index: 30;
    display: flex; flex-direction: column; gap: 6px;
    padding: 12px 16px; border-radius: 12px;
    background: rgba(15, 15, 25, 0.85); border: 1px solid rgba(255,255,255,0.1);
    font-family: 'Kanit', sans-serif; font-size: 13px; color: #e4e4e7;
    max-width: 280px;
  }
  .globe-region-label {
    display: flex; align-items: center; gap: 8px;
    color: #00ff88; font-weight: 500; font-size: 14px;
  }
  .globe-my-loc-info {
    display: flex; align-items: center; gap: 6px;
    color: #a1a1aa; font-size: 11px;
  }
  .globe-myloc-btn {
    position: absolute; bottom: 24px; right: 24px; z-index: 30;
    width: 48px; height: 48px; border-radius: 50%;
    background: rgba(15, 15, 25, 0.85); border: 1px solid rgba(255,255,255,0.12);
    color: #e4e4e7; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.2s, border-color 0.2s, color 0.2s;
  }
  .globe-myloc-btn svg { width: 24px; height: 24px; }
  .globe-myloc-btn:hover { background: rgba(0,255,136,0.1); border-color: rgba(0,255,136,0.3); color: #00ff88; }

  /* Globe mobile adjustments */
  @media (max-width: 768px) {
    .globe-info-panel { bottom: 16px; left: 12px; padding: 10px 12px; max-width: 220px; font-size: 12px; border-radius: 10px; }
    .globe-region-label { font-size: 13px; }
    .globe-my-loc-info { font-size: 10px; }
    .globe-myloc-btn { bottom: 16px; right: 12px; width: 42px; height: 42px; }
    .globe-back-btn { top: 14px; left: 12px; padding: 8px 14px; font-size: 12px; border-radius: 10px; }
  }

  /* Hide UI overlays in globe mode */
  .map-container.globe-mode .map-stats,
  .map-container.globe-mode .add-point-toggle,
  .map-container.globe-mode .map-info,
  .map-container.globe-mode .map-search-float,
  .map-container.globe-mode .route-prefs-float { opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }

  /* Add Point Toggle - Top Left below stats */
  .add-point-toggle {
    position: absolute; top: 120px; left: 16px; z-index: 1001;
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.08);
    color: #a1a1aa; font-size: 12px; font-weight: 500;
    font-family: 'Kanit', sans-serif;
    cursor: pointer; transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
    animation: fadeInFloat 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .add-point-toggle svg { width: 16px; height: 16px; }
  .add-point-toggle:hover { background: rgba(0,255,136,0.08); border-color: rgba(0,255,136,0.2); color: #00ff88; }
  .add-point-toggle.active {
    background: rgba(0,255,136,0.15); border-color: rgba(0,255,136,0.4);
    color: #00ff88; box-shadow: 0 0 12px rgba(0,255,136,0.15);
  }
  .add-point-toggle.active svg { animation: pulse-icon 1.5s ease infinite; }
  @keyframes pulse-icon { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

  /* Map Stats - Top Left */
  /* Floating Route Summary (mobile only) */
  .map-route-summary { display: none; }

  .map-stats { display: flex; gap: 10px; padding: 10px 14px; border-radius: 12px; }
  .map-stat { text-align: center; padding: 4px 8px; }
  .map-stat-value { display: block; font-size: 18px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .map-stat-label { font-size: 10px; color: #71717a; text-transform: uppercase; }
  .map-stat.weather .map-stat-value { font-size: 16px; }
  #map { width: 100%; height: 100%; overflow: hidden; background: #1a1a2e !important; will-change: transform; -webkit-transform: translateZ(0); transform: translateZ(0); }
  :global(.leaflet-container) { background: #1a1a2e !important; }
  :global(.leaflet-control-zoom) { display: none !important; }
  :global(.leaflet-tile-pane) { -webkit-backface-visibility: hidden; transform: translateZ(0); background: #1a1a2e; }
  :global(.leaflet-container) { background: #1a1a2e !important; }
  :global(.leaflet-marker-icon.leaflet-default-icon-path),
  :global(.leaflet-marker-shadow) { display: none !important; }
  :global(.main-tiles) { image-rendering: auto; filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(1.1); }
  :global(.leaflet-tile) { image-rendering: auto; will-change: transform, opacity; }
  :global(.leaflet-tile-loaded) { opacity: 1 !important; }
  :global(.leaflet-map-pane) { will-change: transform; }
  :global(.leaflet-tile-container) { will-change: transform; }
  :global(.leaflet-overlay-pane svg) { shape-rendering: geometricPrecision; }
  :global(.leaflet-overlay-pane path) { shape-rendering: geometricPrecision; stroke-linecap: round; stroke-linejoin: round; }
  :global(.leaflet-fade-anim .leaflet-tile) { will-change: transform, opacity; transition: opacity 0.08s linear !important; }
  :global(.leaflet-fade-anim .leaflet-popup) { transition: none !important; }
  .map-info { position: absolute; bottom: 24px; left: 16px; display: flex; align-items: center; gap: 10px; padding: 12px 18px; font-size: 13px; color: #a1a1aa; z-index: 999; white-space: nowrap; }
  .map-info svg { width: 18px; height: 18px; color: #00ff88; }


  .toast {
    position: fixed; bottom: 170px; right: 16px;
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px 10px 12px; border-radius: 12px;
    font-size: 12px; font-weight: 500; z-index: 9999;
    animation: toastSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    white-space: nowrap; overflow: hidden;
    max-width: 320px;
  }
  @keyframes toastSlideIn {
    0% { opacity: 0; transform: translateX(40px) scale(0.9); }
    60% { transform: translateX(-4px) scale(1.02); }
    100% { opacity: 1; transform: translateX(0) scale(1); }
  }

  .toast-glow { display: none; }

  .toast-success {
    background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.3); color: #00ff88;
    box-shadow: 0 8px 32px rgba(0, 255, 136, 0.12), 0 0 0 1px rgba(0, 255, 136, 0.05);
  }
  .toast-error {
    background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); color: #ff6b6b;
    box-shadow: 0 8px 32px rgba(255, 107, 107, 0.12), 0 0 0 1px rgba(255, 107, 107, 0.05);
  }
  .toast-warning {
    background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b;
    box-shadow: 0 8px 32px rgba(245, 158, 11, 0.12), 0 0 0 1px rgba(245, 158, 11, 0.05);
  }

  .toast-icon-wrap {
    width: 24px; height: 24px; flex-shrink: 0;
    border-radius: 8px; display: flex; align-items: center; justify-content: center;
  }
  .toast-icon-wrap svg { width: 14px; height: 14px; }
  .toast-success .toast-icon-wrap { background: rgba(0, 255, 136, 0.2); }
  .toast-error .toast-icon-wrap { background: rgba(255, 107, 107, 0.2); }
  .toast-warning .toast-icon-wrap { background: rgba(245, 158, 11, 0.2); }

  .toast-msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }

  .toast-close {
    width: 20px; height: 20px; flex-shrink: 0;
    background: none; border: none; cursor: pointer; color: inherit; opacity: 0.5;
    display: flex; align-items: center; justify-content: center;
    border-radius: 5px; transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
  }
  .toast-close:hover { opacity: 1; background: rgba(255,255,255,0.1); }
  .toast-close svg { width: 12px; height: 12px; }

  .toast-progress {
    position: absolute; bottom: 0; left: 0; height: 2px; border-radius: 0 0 16px 16px;
    animation: toastProgress 3.5s linear forwards;
  }
  .toast-success .toast-progress { background: linear-gradient(90deg, #00ff88, #00cc6a); }
  .toast-error .toast-progress { background: linear-gradient(90deg, #ff6b6b, #ff4757); }
  .toast-warning .toast-progress { background: linear-gradient(90deg, #f59e0b, #f97316); }
  @keyframes toastProgress { from { width: 100%; } to { width: 0%; } }
  .undo-btn { background: rgba(255, 255, 255, 0.15); color: inherit; border: 1px solid rgba(255, 255, 255, 0.25); padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'Kanit', sans-serif; transition: background 0.2s; margin-left: 4px; }
  .undo-btn:hover { background: rgba(255, 255, 255, 0.25); }

  :global(.leaflet-container) { height: 100% !important; width: 100% !important; background: #1a1a2e; }
  :global(.leaflet-control-zoom) { border: none !important; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35) !important; border-radius: 12px !important; overflow: hidden; }
  :global(.leaflet-control-zoom a) { background: rgba(15, 15, 25, 0.95) !important; color: #a1a1aa !important; border: 1px solid rgba(255, 255, 255, 0.08) !important; transition: background 0.25s ease, color 0.25s ease !important; }
  :global(.leaflet-control-zoom a:hover) { background: rgba(0, 255, 136, 0.15) !important; color: #00ff88 !important; }
  :global(.leaflet-control-zoom a:hover) { background: rgba(25, 25, 40, 0.95) !important; color: #e4e4e7 !important; }
  :global(.leaflet-control-zoom-in) { border-radius: 10px 10px 0 0 !important; }
  :global(.leaflet-control-zoom-out) { border-radius: 0 0 10px 10px !important; }

  /* Right side map buttons — camera + my location */
  .map-right-btns {
    position: absolute; bottom: 110px; right: 10px; z-index: 1001;
    display: flex; flex-direction: column; gap: 8px;
  }
  .map-myloc-btn, .map-cam-btn {
    width: 40px; height: 40px; border-radius: 12px;
    background: rgba(15, 15, 25, 0.95); border: 1px solid rgba(255,255,255,0.08);
    color: #a1a1aa; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 24px rgba(0,0,0,0.35);
    transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.15s;
    position: relative;
  }
  .map-myloc-btn svg, .map-cam-btn svg { width: 22px; height: 22px; }
  .map-myloc-btn:hover { background: rgba(0,255,136,0.1); border-color: rgba(0,255,136,0.3); color: #00ff88; }
  .map-myloc-btn:active, .map-cam-btn:active { transform: scale(0.92); }
  .map-cam-btn.active { background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.4); color: #60a5fa; }
  .map-cam-btn:hover { background: rgba(59,130,246,0.2); border-color: rgba(59,130,246,0.5); color: #60a5fa; }
  .cam-label {
    position: absolute; bottom: -16px; left: 50%; transform: translateX(-50%);
    font-size: 9px; font-weight: 600; color: #60a5fa; white-space: nowrap;
    font-family: 'JetBrains Mono', monospace;
  }

  :global(.marker-pin) {
    width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 16px; font-weight: 800; color: white; font-family: 'Kanit', sans-serif;
    border: 3px solid rgba(255, 255, 255, 0.5); position: relative;
    transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    transform: scale(var(--marker-scale, 1));
    transform-origin: center bottom;
  }
  :global(.marker-pin:hover) { filter: brightness(1.15); }
  :global(.marker-pin.draggable) { border-color: #fb923c; cursor: grab; animation: drag-pulse 1.5s ease-in-out infinite; }
  :global(.marker-pin.draggable:active) { cursor: grabbing; }
  :global(.drag-hint) { position: absolute; top: -8px; right: -8px; width: 16px; height: 16px; background: #fb923c; border-radius: 50%; font-size: 9px; display: flex; align-items: center; justify-content: center; color: white; border: 2px solid rgba(0,0,0,0.3); }
  @keyframes drag-pulse { 0%, 100% { border-color: #fb923c; } 50% { border-color: #fdba74; } }
  :global(.route-pin) { width: 48px; height: 48px; font-size: 17px; border-width: 3px; }
  :global(.marker-label) { position: absolute; bottom: -24px; left: 50%; transform: translateX(-50%); background: rgba(0, 0, 0, 0.8); padding: 2px 8px; border-radius: 4px; font-size: 10px; white-space: nowrap; }
  :global(.target-label) { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important; animation: pulse-label 1.5s ease-in-out infinite; }
  :global(.marker-name-label) {
    position: absolute; top: -26px; left: 50%; transform: translateX(-50%) scale(var(--start-label-scale, 1));
    transform-origin: bottom center;
    background: rgba(102,126,234,0.9); color: #fff;
    font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 5px;
    white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3); z-index: 4;
    font-family: 'Kanit', sans-serif; pointer-events: none; transition: transform 0.2s ease;
  }
  :global(.marker-name-label::after) {
    content: ''; position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%);
    border-left: 4px solid transparent; border-right: 4px solid transparent;
    border-top: 4px solid rgba(102,126,234,0.9);
  }
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
  :global(.heading-beam) {
    position: absolute;
    width: 150px; height: 50px;
    top: 50%; left: 50%;
    margin-left: -75px;
    margin-top: -50px;
    transform-origin: 50% 100%;
    background: conic-gradient(
      from -65deg at 50% 100%,
      transparent 0deg,
      rgba(0, 255, 136, 0.1) 30deg,
      rgba(0, 255, 136, 0.28) 65deg,
      rgba(0, 255, 136, 0.1) 100deg,
      transparent 130deg
    );
    border-radius: 50%;
    -webkit-mask: radial-gradient(ellipse at 50% 100%, black 0%, black 30%, transparent 75%);
    mask: radial-gradient(ellipse at 50% 100%, black 0%, black 30%, transparent 75%);
    pointer-events: none;
    transition: opacity 0.3s;
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

  :global(.dark-popup .leaflet-popup-content-wrapper) { background: rgba(15, 15, 25, 0.97); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); padding: 0; overflow: hidden; }
  :global(.dark-popup .leaflet-popup-tip) { background: rgba(15, 15, 25, 0.95); border: 1px solid rgba(255, 255, 255, 0.1); }
  :global(.dark-popup .leaflet-popup-content) { margin: 0; }
  :global(.custom-popup) { min-width: 220px; }
  :global(.popup-accent) { height: 3px; width: 100%; flex-shrink: 0; }
  :global(.popup-header) { display: flex; align-items: center; gap: 12px; padding: 14px 16px 8px; }
  :global(.popup-badge) { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; color: white; font-family: 'Kanit', sans-serif; flex-shrink: 0; }
  :global(.popup-header-text) { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  :global(.popup-header-text h4) { font-size: 14px; font-weight: 600; color: #f4f4f5; margin: 0; font-family: 'Kanit', sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  :global(.popup-tag) { font-size: 10px; font-weight: 500; letter-spacing: 0.5px; font-family: 'Kanit', sans-serif; }
  :global(.popup-content) { padding: 10px 16px 14px; border-top: 1px solid rgba(255, 255, 255, 0.06); }
  :global(.popup-content p) { font-size: 12px; color: #a1a1aa; line-height: 1.5; font-family: 'Kanit', sans-serif; }
  :global(.leaflet-popup-close-button) { color: rgba(255, 255, 255, 0.5) !important; top: 8px !important; right: 8px !important; width: 24px !important; height: 24px !important; font-size: 18px !important; }
  :global(.leaflet-popup-close-button:hover) { color: white !important; }

  /* ==================== RESPONSIVE ==================== */
  
  /* Tablet */
  @media (max-width: 1024px) {
    .desktop-only { display: none !important; }
    .mobile-only { display: block !important; }
    .app-container { flex-direction: column; }
    .sidebar { width: 100%; height: auto; max-height: 60vh; min-height: 200px; border-right: none; border-bottom: none; overflow-y: auto; }
    .map-container { flex: 1; height: 60vh; min-height: 300px; position: relative; overflow: hidden; }
    #map { position: absolute; inset: 0; width: 100%; height: 100%; }
    .sidebar-content { padding: 12px; }
    .point-card { padding: 12px; }
    .map-stats { flex-wrap: wrap; gap: 8px; padding: 10px; }
    .alerts-panel { width: calc(100% - 60px); max-width: 400px; }
    .settings-panel { max-width: 95%; }
    .today-stats { gap: 8px; padding: 5px 10px; }
  }
  
  /* Mobile */
  @media (max-width: 768px) {
    .app-container { flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden; }

    /* ========== MOBILE SIDEBAR ========== */
    .sidebar {
      width: 100%; height: auto; max-height: 55vh; border-right: none; overflow: hidden; flex-shrink: 0;
      background: #0a0a16;
      border-bottom: none;
      border-radius: 0 0 20px 20px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.5);
      transition: max-height 0.35s cubic-bezier(0.22, 1, 0.36, 1);
      will-change: max-height;
      position: relative;
      z-index: 10;
    }
    .sidebar.collapsed { max-height: 52px !important; overflow: hidden !important; min-height: 0 !important; border-radius: 0 0 16px 16px; }
    .sidebar.collapsed > *:not(.sidebar-toggle) { display: none !important; }
    .sidebar.desktop-collapsed {
      width: 100% !important; margin-left: 0 !important; max-height: 0 !important;
      min-height: 0 !important; border-bottom: none !important; overflow: hidden !important;
    }
    .desktop-sidebar-toggle { display: none !important; }

    /* --- Toggle Handle --- */
    .sidebar-toggle {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%; padding: 14px 16px 8px; border: none;
      background: transparent; color: #71717a; font-size: 12px;
      font-family: 'Kanit', sans-serif; cursor: pointer; flex-shrink: 0;
      height: auto; position: relative;
    }
    .sidebar-toggle::before {
      content: ''; position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
      width: 32px; height: 4px; border-radius: 99px;
      background: rgba(255,255,255,0.15);
      transition: background 0.2s;
    }
    .sidebar-toggle:active::before { background: #00ff88; }
    .sidebar-toggle svg { width: 0; height: 0; overflow: hidden; }
    .sidebar-toggle svg.flipped { width: 0; height: 0; }
    .sidebar-toggle > span { font-size: 11px; color: #52525b; font-weight: 500; }
    .sidebar-toggle .toggle-text { font-weight: 500; color: #52525b; font-size: 11px; }

    /* --- Collapsed Summary --- */
    .collapsed-summary {
      display: flex; align-items: center; justify-content: center;
      gap: 14px; width: 100%; padding: 2px 8px;
    }
    .cs-stat { display: flex; align-items: baseline; gap: 3px; padding: 0; }
    .cs-val {
      font-size: 15px; font-weight: 700; color: #f4f4f5;
      font-family: 'JetBrains Mono', monospace; line-height: 1;
    }
    .cs-val.cs-cost { color: #00ff88; }
    .cs-unit { font-size: 9px; color: #71717a; text-transform: none; letter-spacing: 0; margin-top: 0; font-weight: 400; }
    .cs-divider { width: 3px; height: 3px; border-radius: 50%; background: rgba(255,255,255,0.2); flex-shrink: 0; }
    .cs-arrow { display: none; }

    /* --- Header --- */
    .sidebar-header {
      padding: 0 12px 8px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: none; background: transparent;
    }
    .sidebar-header .logo {
      display: flex; align-items: center; gap: 7px;
    }
    .sidebar-header .logo .logo-icon {
      width: 28px; height: 28px; border-radius: 8px;
      background: linear-gradient(135deg, #00ff88, #00cc6a);
    }
    .sidebar-header .logo .logo-icon svg { width: 16px; height: 16px; stroke: #0a0a14; }
    .sidebar-header .logo .logo-text h1 { font-size: 13px; font-weight: 700; color: #00ff88; }
    .sidebar-header .logo .logo-text span { font-size: 8px; color: #52525b; }
    .sidebar-header .header-actions {
      display: flex; gap: 5px;
    }
    .sidebar-header .icon-btn {
      width: 34px; height: 34px; font-size: 14px; border-radius: 10px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07);
      transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.15s;
    }
    .sidebar-header .icon-btn:active { background: rgba(0,255,136,0.15); transform: scale(0.9); }
    .sidebar-header .keyboard-help-btn { display: none; }

    .sidebar-scroll {
      flex: 1; overflow-y: auto; overflow-x: hidden;
      -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
      min-height: 0; display: flex; flex-direction: column;
    }

    /* --- Action Buttons: horizontal scroll --- */
    .action-buttons {
      display: flex; flex-direction: row; flex-wrap: nowrap; gap: 7px;
      padding: 2px 12px 12px; flex-shrink: 0;
      overflow-x: auto; overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none; -ms-overflow-style: none;
    }
    .action-buttons::-webkit-scrollbar { display: none; }
    .action-buttons .btn {
      flex: 0 0 auto; min-width: 0; justify-content: center;
      padding: 8px 10px; font-size: 11px; gap: 4px; border-radius: 10px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07);
      white-space: nowrap; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
      font-weight: 500;
    }
    .action-buttons .btn:active { transform: scale(0.94); }
    .action-buttons .btn svg { width: 14px; height: 14px; flex-shrink: 0; }
    .action-buttons .btn span { white-space: nowrap; }
    .action-buttons .btn.btn-primary {
      background: linear-gradient(135deg, #00ff88, #00cc6a);
      border-color: transparent; color: #0a0a14;
      font-weight: 700; box-shadow: 0 3px 12px rgba(0,255,136,0.25);
    }
    .action-buttons .btn.btn-primary:active { box-shadow: 0 1px 6px rgba(0,255,136,0.3); }
    .action-buttons .btn.btn-navigate {
      background: rgba(0,255,136,0.12);
      border-color: rgba(0,255,136,0.25); color: #00ff88;
      font-weight: 700; box-shadow: 0 3px 12px rgba(0,255,136,0.15);
    }
    .action-buttons .btn.btn-navigate:active { box-shadow: 0 1px 6px rgba(0,255,136,0.2); }
    .action-buttons .btn.btn-secondary { color: #a1a1aa; border-color: rgba(255,255,255,0.1); }
    .action-buttons .btn.btn-ghost { color: #a1a1aa; border-color: rgba(255,255,255,0.05); }
    .action-buttons .btn.btn-save-route { color: #a1a1aa; border-color: rgba(255,255,255,0.08); }
    .action-buttons .btn.btn-share { color: #a1a1aa; border-color: rgba(255,255,255,0.08); }
    .action-buttons .btn.btn-alt-routes { color: #a1a1aa; border-color: rgba(255,255,255,0.08); }

    /* --- Tabs --- */
    .tabs {
      display: flex; gap: 0; margin: 0 12px 6px; padding: 3px;
      background: rgba(255,255,255,0.04); border-radius: 12px; flex-shrink: 0;
      border: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .tab {
      padding: 8px 0; font-size: 12px; white-space: nowrap; flex: 1; text-align: center;
      border-radius: 9px; border: none; border-bottom: none;
      background: transparent !important; color: #71717a; font-weight: 500;
      transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
    }
    .tab.active {
      background: rgba(0,255,136,0.1) !important; color: #00ff88 !important;
      border-bottom: none; font-weight: 600;
    }
    .tab svg { width: 13px; height: 13px; }
    .tab-chevron {
      width: 12px; height: 12px; margin-left: 2px;
      transition: transform 0.25s ease; flex-shrink: 0;
    }
    .tab-chevron-up { transform: rotate(180deg); }

    /* --- Content --- */
    .content-area {
      flex: 1; overflow-y: auto; overflow-x: hidden; padding: 2px 12px 16px;
      -webkit-overflow-scrolling: touch; overscroll-behavior: contain; min-height: 0;
      transition: max-height 0.3s ease, opacity 0.2s ease, padding 0.3s ease;
      max-height: 50vh;
    }
    .content-area.content-collapsed {
      max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; overflow: hidden;
    }

    .add-form { max-width: 400px; padding: 16px; border-radius: 20px; }
    .map-container { flex: 1; width: 100%; position: relative; overflow: hidden; min-height: 0; }
    #map { position: absolute; inset: 0; width: 100% !important; height: 100% !important; }

    .sidebar-header .logo h1 { font-size: 14px; }
    .sidebar-header .logo span { font-size: 8px; }
    .logo-icon { width: 28px; height: 28px; }
    .logo-icon svg { width: 16px; height: 16px; }
    .logo { gap: 8px; }
    .icon-btn { width: 36px; height: 36px; font-size: 14px; }

    /* --- Point Cards --- */
    .point-card {
      padding: 11px 12px; margin-bottom: 5px; border-radius: 14px; gap: 10px; width: 100%;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
      position: relative;
      overflow: hidden;
    }
    .point-card::before {
      content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
      border-radius: 0; background: transparent;
      transition: background 0.15s;
    }
    .point-card.active {
      border-color: rgba(0,255,136,0.2);
      background: rgba(0,255,136,0.04);
    }
    .point-card.active::before { background: #00ff88; }
    .point-card:hover { transform: none; }
    .point-card:active { transform: scale(0.98); background: rgba(255,255,255,0.05); }
    .point-number {
      width: 30px; height: 30px; font-size: 12px; border-radius: 9px; flex-shrink: 0;
      font-weight: 700;
    }
    .point-info p { display: none; }
    .point-info h4 { font-size: 13px; margin-bottom: 0; font-weight: 500; color: #e4e4e7; line-height: 1.3; }
    .point-meta { gap: 5px; }
    .point-meta .priority-tag { font-size: 9px; padding: 3px 8px; border-radius: 99px; font-weight: 600; }
    .point-meta .distance-tag { font-size: 9px; padding: 3px 8px; border-radius: 99px; background: rgba(255,255,255,0.05); color: #a1a1aa; }
    .point-actions { gap: 4px; }
    .point-actions .action-btn { width: 26px; height: 26px; border-radius: 8px; }
    .point-actions .action-btn svg { width: 12px; height: 12px; }
    .delete-btn { width: 24px; height: 24px; top: 6px; right: 6px; border-radius: 8px; }
    .delete-btn svg { width: 12px; height: 12px; }

    /* --- Route Summary: mobile-enabled --- */
    .route-summary { display: block !important; }
    .route-detail-card {
      margin-bottom: 8px; padding: 10px 12px; border-radius: 12px;
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
    }
    .rd-header { font-size: 10px; margin-bottom: 5px; }
    .rd-row { padding: 2px 0; gap: 6px; }
    .rd-row.sub { padding-left: 20px; }
    .rd-icon { font-size: 10px; width: 14px; }
    .rd-label { font-size: 11px; }
    .rd-value { font-size: 11px; }
    .rd-value.total { font-size: 13px; }
    .rd-divider { margin: 6px 0; }
    .rd-total { padding: 5px 0 2px; }
    .summary-header { margin-bottom: 6px; flex-wrap: wrap; gap: 4px; }
    .summary-header h3 { font-size: 13px; }
    .route-badge { font-size: 9px; padding: 3px 10px; border-radius: 99px; }
    .summary-stats { grid-template-columns: repeat(4, 1fr); gap: 5px; margin-bottom: 8px; }
    .stat-card { padding: 8px 4px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); }
    .stat-icon { width: 22px; height: 22px; margin-bottom: 2px; border-radius: 8px; }
    .stat-icon svg { width: 12px; height: 12px; }
    .stat-value { font-size: 16px; font-weight: 800; color: #00ff88; }
    .stat-label { font-size: 8px; color: #71717a; }
    .stat-card.fuel .stat-value, .stat-card.ev .stat-value { color: #f59e0b; }
    .fuel-route-info, .ev-route-info { padding: 10px; border-radius: 12px; margin-bottom: 8px; }
    .fuel-info-row, .ev-info-row { padding: 4px 0; font-size: 12px; }
    .fuel-info-row span, .ev-info-row span { font-size: 12px; }
    .fuel-info-row strong, .ev-info-row strong { font-size: 12px; }
    .cheapest-tip { font-size: 11px; padding: 8px; margin-top: 4px; border-radius: 10px; }
    .ev-warning-banner { font-size: 11px; padding: 8px; border-radius: 10px; }
    .trip-cost-card { padding: 10px; margin-top: 6px; border-radius: 12px; }
    .trip-cost-card h4 { font-size: 13px; margin-bottom: 6px; }
    .cost-label { font-size: 12px; }
    .cost-value { font-size: 13px; }
    .cost-row.sub span { font-size: 10px; }
    .cost-row.total .cost-label { font-size: 13px; }
    .cost-row.total .cost-value { font-size: 15px; }
    .timeline-item { padding: 9px 10px; gap: 8px; margin-bottom: 4px; border-radius: 10px; background: rgba(255,255,255,0.03); }
    .timeline-marker { width: 28px; height: 28px; font-size: 12px; border-radius: 8px; }
    .timeline-name { font-size: 12px; font-weight: 500; }
    .timeline-label { font-size: 9px; margin-bottom: 1px; color: #52525b; }
    .route-timeline h4 { font-size: 11px; margin-bottom: 6px; }
    .sidebar-footer { display: none; }

    /* Add Form Mobile */
    .add-form-overlay { z-index: 2100; padding: 16px; }
    .add-form { max-width: 400px; max-height: 80vh; padding: 20px !important; border-radius: 20px !important; }
    .add-form .form-header { margin-bottom: 12px; }
    .add-form .form-header h3 { font-size: 17px; }
    .add-form .close-btn { width: 34px; height: 34px; border-radius: 10px; }
    .add-form .form-hint { font-size: 12px; padding: 10px 12px; margin-bottom: 12px; border-radius: 10px; }
    .add-form .form-group { margin-bottom: 12px; }
    .add-form .form-group label { font-size: 12px; margin-bottom: 5px; }
    .add-form .form-group input, .add-form .form-group textarea { padding: 12px 14px; font-size: 15px; border-radius: 12px; }
    .add-form .form-group textarea { min-height: 50px; }
    .add-form .coords-group { grid-template-columns: 1fr 1fr; gap: 10px; }
    .add-form .priority-selector { gap: 6px; justify-content: center; }
    .add-form .priority-btn { min-width: 52px; max-width: 62px; padding: 10px 4px; border-radius: 12px; }
    .add-form .priority-num { font-size: 15px; }
    .add-form .priority-label { font-size: 8px; }
    .add-form .form-actions { flex-direction: row; gap: 10px; margin-top: 14px; }
    .add-form .form-actions .btn { flex: 1; padding: 14px; font-size: 15px; border-radius: 14px; }

    /* Marker pins on mobile */
    :global(.marker-pin) { width: 40px; height: 40px; font-size: 14px; border-width: 2.5px; }
    :global(.route-pin) { width: 44px; height: 44px; font-size: 16px; }
    :global(.marker-label) { font-size: 9px; bottom: -20px; padding: 2px 7px; }
    :global(.start-loc-marker) { width: 34px; height: 34px; }
    :global(.start-loc-core) { width: 18px; height: 18px; border-width: 2px; }

    /* Map overlays */
    .add-point-toggle { top: 80px; left: 8px; padding: 6px 10px; font-size: 11px; border-radius: 8px; }
    .add-point-toggle svg { width: 14px; height: 14px; }
    .map-stats { position: absolute; top: 118px; bottom: auto; left: 8px; right: auto; width: auto; flex-wrap: nowrap; gap: 0; padding: 2px 4px; z-index: 1000; border-radius: 6px; transition: top 0.3s ease; }
    .map-stats.route-active { top: 68px; }
    .map-stat { padding: 1px 4px; }
    .map-stat-value { font-size: 10px; font-weight: 600; }
    .map-stat-label { font-size: 6px; letter-spacing: 0; }
    .map-stat.weather .map-stat-value { font-size: 10px; }
    .map-info { display: none; }

    .map-right-btns { bottom: 135px; }

    /* Floating Navigate Button - mobile */
    .map-nav-btn {
      position: absolute;
      bottom: 50px;
      left: 10px;
      z-index: 1002;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 7px 12px;
      border-radius: 9999px;
      border: 1px solid rgba(0,255,136,0.25);
      background: rgba(10,15,20,0.85) !important;
      color: #00ff88;
      font-family: 'Kanit', sans-serif;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      transition: all 0.2s ease;
      animation: mrsSlideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .map-nav-btn:active { transform: scale(0.95); }
    .map-nav-btn svg { width: 13px; height: 13px; }
    @keyframes mrsSlideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    /* History Panel */

    /* Modals */
    .alerts-panel { position: fixed; width: calc(100% - 24px); left: 50%; top: 50%; transform: translate(-50%, -50%); max-height: 70vh; z-index: 2000; }

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
    .sidebar { max-height: 50vh; min-height: 70px; border-radius: 0 0 14px 14px; }
    .sidebar.collapsed { max-height: 44px !important; border-radius: 0 0 12px 12px; }
    .sidebar-toggle { height: auto; padding: 12px 12px 6px; }
    .sidebar-toggle::before { width: 26px; height: 3px; }
    .cs-val { font-size: 13px; }
    .cs-unit { font-size: 7px; }
    .cs-stat { padding: 0; }
    .collapsed-summary { gap: 10px; }
    .cs-divider { width: 2px; height: 2px; }
    .map-container { flex: 1; min-height: 0; }
    .sidebar-header { padding: 0 10px 6px; }
    .sidebar-header .header-actions { gap: 3px; }
    .sidebar-header .icon-btn { width: 30px; height: 30px; font-size: 12px; border-radius: 8px; }
    .action-buttons { padding: 0 10px 6px !important; gap: 5px !important; }
    .action-buttons .btn { padding: 8px 12px !important; font-size: 11px !important; border-radius: 10px !important; }
    .action-buttons .btn svg { width: 13px; height: 13px; }
    .tabs { margin: 0 10px 4px; padding: 2px; border-radius: 10px; }
    .tab { padding: 7px 0; font-size: 11px; border-radius: 8px; }
    .tab svg { width: 12px; height: 12px; }
    .content-area { padding: 2px 10px 12px; }
    .point-card { padding: 9px 10px; margin-bottom: 4px; border-radius: 12px; gap: 8px; }
    .point-card:active { transform: scale(0.98); }
    .point-number { width: 26px; height: 26px; font-size: 11px; border-radius: 8px; }
    .point-info h4 { font-size: 12px; }
    .point-actions { gap: 3px; }
    .point-actions .action-btn { width: 24px; height: 24px; border-radius: 6px; }
    .point-actions .action-btn svg { width: 11px; height: 11px; }
    .delete-btn { width: 22px; height: 22px; top: 4px; right: 5px; border-radius: 6px; }
    .delete-btn svg { width: 11px; height: 11px; }

    /* Add Form Small Mobile - modal stays same, just tighter padding */
    .add-form-overlay { padding: 12px; }
    .add-form { padding: 14px !important; }
    .add-form .form-header h3 { font-size: 15px; }
    .add-form .form-group { margin-bottom: 8px; }
    .add-form .form-group label { font-size: 11px; }
    .add-form .form-group input, .add-form .form-group textarea { padding: 9px 10px; font-size: 13px; }
    
    /* Route Summary - 4 cols stays, even smaller */
    .summary-stats { grid-template-columns: repeat(4, 1fr); gap: 3px; }
    .stat-card { padding: 5px 3px; }
    .stat-icon { width: 18px; height: 18px; margin-bottom: 1px; }
    .stat-icon svg { width: 10px; height: 10px; }
    .stat-value { font-size: 14px; }
    .stat-label { font-size: 7px; }

    /* Map Stats Small Mobile */
    .add-point-toggle { top: 78px; left: 6px; padding: 5px 8px; font-size: 10px; }
    .map-stats { top: 114px; bottom: auto; padding: 2px 3px; gap: 0; border-radius: 5px; }
    .map-stat { padding: 0px 3px; }
    .map-stat-value { font-size: 9px; font-weight: 600; }
    .map-stat-label { font-size: 5px; letter-spacing: 0; }
    .map-stat.weather .map-stat-value { font-size: 9px; }
    
    .today-stats { gap: 4px; padding: 3px 6px; }
    .today-stat .stat-value { font-size: 12px; }

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
  background: rgba(239,68,68,0.12);
  color: #f87171;
  border: 1px solid rgba(239,68,68,0.25);
  box-shadow: none;
}

.btn-danger:hover {
  background: rgba(239,68,68,0.2);
  transform: translateY(-1px);
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

/* ==================== Responsive สำหรับ Today Stats ==================== */

@media (max-width: 768px) {
  .today-stats {
    padding: 4px 8px;
    gap: 8px;
  }

  .today-stat .stat-value {
    font-size: 14px;
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
    gap: 12px;
    padding: 14px 16px 8px;
  }

  :global(.ev-status) {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.3px;
  }

  :global(.ev-popup-content) {
    padding: 10px 16px 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
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
    transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
    transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
    transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
  background: rgba(0,255,136,0.1);
  color: #00ff88;
  padding: 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(0,255,136,0.2);
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
}

.btn-cash:hover {
  background: rgba(0,255,136,0.18);
  transform: translateY(-1px);
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
/* SearchPanel CSS moved to $lib/components/SearchPanel.svelte */

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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
  background: rgba(255,255,255,0.05);
  color: #a1a1aa;
  border: 1px solid rgba(255,255,255,0.1);
}
.btn-alt-routes:hover { background: rgba(0,255,136,0.08); color: #00ff88; border-color: rgba(0,255,136,0.2); }
.btn-save-route {
  background: rgba(255,255,255,0.05);
  color: #a1a1aa;
  border: 1px solid rgba(255,255,255,0.1);
}
.btn-save-route:hover { background: rgba(0,255,136,0.08); color: #00ff88; border-color: rgba(0,255,136,0.2); }
.btn-share {
  background: rgba(255,255,255,0.05);
  color: #a1a1aa;
  border: 1px solid rgba(255,255,255,0.1);
}
.btn-share:hover { background: rgba(0,255,136,0.08); color: #00ff88; border-color: rgba(0,255,136,0.2); }

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

/* Turn-by-Turn, Curve Warning, Lane Guidance CSS moved to $lib/components/NavigationOverlay.svelte */

/* Route Progress Strip */
.nav-route-progress-strip {
  position: absolute; top: 36px; left: 50%; transform: translateX(-50%);
  width: calc(100% - 40px); max-width: 600px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.75);
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

/* Alt Route — outline stroke handled by separate polyline layer */

/* Route Selector Overlay */
.route-selector-overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.route-selector-panel {
  width: 100%;
  max-width: 440px;
  max-height: 85vh;
  overflow-y: auto;
  padding: 20px;
  background: rgba(12, 12, 22, 0.98) !important;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
  scrollbar-width: thin;
  animation: slideIn 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.route-selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.route-selector-header h3 { font-size: 13px; font-weight: 600; color: #a1a1aa; }
.route-selector-header .close-btn { width: 28px; height: 28px; }
.route-selector-list { display: flex; flex-direction: column; gap: 6px; }
.route-option-card {
  width: 100%;
  padding: 8px 10px 8px 12px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-left: 3px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s cubic-bezier(0.22, 1, 0.36, 1), color 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  text-align: left;
  font-family: 'Kanit', sans-serif;
  color: #e4e4e7;
  position: relative;
}
.route-option-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-left-color: rgba(0, 255, 136, 0.4);
  transform: translateY(-1px);
}
.route-option-card:active { transform: scale(0.98); }
.route-option-card.selected {
  background: rgba(0, 255, 136, 0.05);
  border-color: rgba(0, 255, 136, 0.15);
  border-left-color: #00ff88;
  box-shadow: 0 0 12px rgba(0, 255, 136, 0.06);
}
.route-option-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.route-option-label { font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: #a1a1aa; }
.route-option-card.selected .route-option-label { color: #00ff88; }
.recommended-badge {
  padding: 1px 5px;
  background: linear-gradient(135deg, #00ff88, #00cc6a);
  border-radius: 4px;
  font-size: 8px;
  font-weight: 700;
  color: #000;
  letter-spacing: 0.03em;
}
.route-option-stats {
  display: flex;
  gap: 8px;
  margin-bottom: 3px;
}
.route-stat-item {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: #a1a1aa;
}
.route-stat-icon { font-size: 10px; opacity: 0.7; }
.route-stat-val { font-weight: 600; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #e4e4e7; }
.route-option-tags {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
}
.route-tag {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.01em;
}
.route-tag.toll { background: rgba(255, 165, 2, 0.12); color: #ffa502; }
.route-tag.no-toll { background: rgba(0, 255, 136, 0.08); color: #00ff88; }
.route-tag.slower { background: rgba(255, 107, 107, 0.08); color: #ff6b6b; }
.route-tag.faster { background: rgba(0, 255, 136, 0.08); color: #00ff88; }

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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
}
.comp-select-btn:hover { background: rgba(0, 255, 136, 0.15); color: #00ff88; }
.comp-select-btn.active { background: rgba(0, 255, 136, 0.2); border-color: #00ff88; color: #00ff88; }
.comparison-summary { margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.summary-badges { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.summary-badge { font-size: 13px; font-weight: 500; padding: 6px 12px; background: rgba(255, 255, 255, 0.03); border-radius: 8px; }

/* Route Alternative Labels on Map */
:global(.route-label-marker) { background: none !important; border: none !important; }
:global(.route-alt-label) {
  padding: 10px 16px;
  border-radius: 14px;
  text-align: center;
  color: white;
  font-family: 'Kanit', sans-serif;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255,255,255,0.08);
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
  pointer-events: auto;
  border: 1.5px solid rgba(255,255,255,0.15);
}
:global(.route-alt-label:hover) { transform: scale(1.08); box-shadow: 0 6px 28px rgba(0, 0, 0, 0.6); }
:global(.alt-label-text) { display: block; font-size: 14px; font-weight: 700; }
:global(.alt-label-info) { display: block; font-size: 12px; opacity: 0.95; font-weight: 500; }
:global(.alt-toll-badge) { display: block; font-size: 11px; margin-top: 4px; padding: 3px 8px; background: rgba(0, 0, 0, 0.35); border-radius: 6px; font-weight: 500; }
:global(.alt-no-toll) { display: block; font-size: 11px; margin-top: 4px; font-weight: 500; }

/* Alternative Route Label (on map after calculation) */
:global(.gmap-alt-label) {
  display: inline-block;
  padding: 8px 14px;
  border-radius: 10px;
  text-align: center;
  font-family: 'Kanit', sans-serif;
  background: rgba(15, 15, 25, 0.95);
  border-left: 3px solid var(--alt-color, #3b82f6);
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.55);
  white-space: nowrap;
  border: 1px solid rgba(255,255,255,0.1);
  border-left: 3px solid var(--alt-color, #3b82f6);
}
:global(.gmap-alt-label:hover) {
  background: rgba(25, 25, 40, 0.95);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.65);
  transform: translateY(-2px);
}
:global(.gmap-alt-name) {
  font-size: 13px;
  font-weight: 700;
  color: var(--alt-color, #3b82f6);
  line-height: 1.4;
}
:global(.gmap-alt-sub) {
  font-size: 11px;
  color: #b0b5bf;
  line-height: 1.3;
  font-weight: 500;
}

/* Navigation Alternative Labels (during navigation) */
:global(.nav-alt-label) {
  display: inline-block;
  padding: 7px 12px;
  border-radius: 10px;
  text-align: center;
  font-family: 'Kanit', sans-serif;
  background: rgba(15, 15, 25, 0.95);
  border-left: 3px solid;
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
  border: 1px solid rgba(255,255,255,0.1);
}
:global(.nav-alt-label:hover) {
  background: rgba(25, 25, 40, 0.95);
  transform: translateY(-2px);
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.6);
}
:global(.nav-alt-name) {
  display: block;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}
:global(.nav-alt-info) {
  display: block;
  font-size: 10px;
  color: #b0b5bf;
  line-height: 1.3;
  font-weight: 500;
}
:global(.nav-alt-toll) {
  display: block;
  font-size: 9px;
  color: #ffa502;
  font-weight: 600;
  margin-top: 2px;
}
:global(.nav-alt-free) {
  display: block;
  font-size: 9px;
  color: #00ff88;
  font-weight: 500;
  margin-top: 2px;
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
  transition: background 0.3s ease, color 0.3s ease, border-color 0.3s ease, opacity 0.3s ease, transform 0.3s ease;
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
  font-size: 10px; transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.15s;
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
  transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.15s;
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

/* ==================== RESPONSIVE - ADVANCED FEATURES ==================== */

@media (max-width: 1024px) {
  .route-selector-panel { max-width: 400px; }
}

@media (max-width: 768px) {
  .search-section { padding: 8px 16px; }
  .search-input { padding: 10px 36px 10px 34px; font-size: 13px; }
  .route-preferences { padding: 8px 16px; }
  .pref-chips { gap: 4px; }
  .pref-chip { font-size: 11px; padding: 5px 8px; }
  .pref-toggles { gap: 4px; }
  .pref-toggle-item { font-size: 11px; }
  .route-selector-overlay { padding: 16px; }
  .route-selector-panel { max-width: 100%; max-height: 80vh; padding: 16px; border-radius: 20px; }
  .route-selector-header h3 { font-size: 13px; }
  .route-option-card { padding: 7px 10px 7px 11px; }
  .route-option-stats { flex-wrap: wrap; }
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
  .comparison-row { grid-template-columns: 1fr 1fr 1fr; gap: 6px; padding: 8px 10px; }
  .comparison-row .comp-col:nth-child(4) { display: none; }
}

/* ==================== FLOATING MAP PANELS ==================== */

/* SearchPanel floating CSS moved to $lib/components/SearchPanel.svelte */

/* Floating Route Preferences - Left side top */
.map-prefs-float {
  position: absolute;
  bottom: 16px;
  left: 16px;
  top: auto;
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
.map-top-left-group {
  position: absolute;
  top: 28px;
  left: 16px;
  z-index: 1001;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  animation: fadeInFloat 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both;
}
.map-top-left-group .map-stats {
  position: static;
  animation: none;
}
.map-vehicle-float {
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  padding: 4px;
  border-radius: 10px;
}
.float-saved-toggle {
  padding: 8px 16px;
  background: rgba(255, 165, 2, 0.1);
  border: 1px solid rgba(255, 165, 2, 0.2);
  border-radius: 10px;
  color: #ffa502;
  font-family: 'Kanit', sans-serif;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.float-saved-toggle:hover { background: rgba(255, 165, 2, 0.18); border-color: rgba(255, 165, 2, 0.4); box-shadow: 0 4px 16px rgba(255, 165, 2, 0.15); transform: translateY(-1px); }
.float-saved-toggle:active { transform: scale(0.96); transition-duration: 0.1s; }
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
  transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.15s;
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
  top: 120px;
  right: 16px;
  z-index: 1000;
  padding: 10px;
  border-radius: 14px;
  max-width: 340px;
  font-family: 'Kanit', sans-serif;
}
.poi-modal-backdrop {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5); z-index: 2000;
}
.poi-modal {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 90%; max-width: 420px; max-height: 80vh;
  background: rgba(15, 15, 25, 0.97);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 18px; z-index: 2001;
  padding: 20px; font-family: 'Kanit', sans-serif;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  display: flex; flex-direction: column;
  animation: modalIn 0.2s ease-out;
}
@keyframes modalIn { from { opacity: 0; transform: translate(-50%, -48%); } to { opacity: 1; transform: translate(-50%, -50%); } }
.poi-modal-header {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 14px; padding-bottom: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.poi-modal-title {
  font-size: 16px; font-weight: 600; color: #e4e4e7; margin: 0; flex: 1;
}
.poi-modal-count {
  font-size: 12px; color: #00ff88; background: rgba(0,255,136,0.1);
  padding: 3px 10px; border-radius: 12px; font-weight: 500;
}
.poi-modal-close {
  width: 32px; height: 32px; border-radius: 8px;
  background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3);
  color: #ef4444; font-size: 14px; cursor: pointer;
  transition: background 0.2s; flex-shrink: 0;
  font-family: inherit;
}
.poi-modal-close:hover { background: rgba(239,68,68,0.25); }
.poi-list-modal {
  max-height: 45vh; overflow-y: auto;
  display: flex; flex-direction: column; gap: 6px;
  margin-top: 8px;
  scrollbar-width: thin; scrollbar-color: rgba(0,255,136,0.3) transparent;
}
.poi-list-modal::-webkit-scrollbar { width: 6px; }
.poi-list-modal::-webkit-scrollbar-track { background: transparent; }
.poi-list-modal::-webkit-scrollbar-thumb { background: rgba(0,255,136,0.3); border-radius: 3px; }
.poi-list-modal::-webkit-scrollbar-thumb:hover { background: rgba(0,255,136,0.5); }
.poi-item-modal {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 10px 12px; background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;
  cursor: pointer; transition: background 0.15s, border-color 0.15s;
}
.poi-item-modal:hover { background: rgba(0,255,136,0.06); border-color: rgba(0,255,136,0.15); }
.poi-type-icon-lg { font-size: 24px; flex-shrink: 0; margin-top: 2px; }
.poi-item-detail { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.poi-name-lg { font-size: 13px; font-weight: 600; color: #e4e4e7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.poi-type-label { font-size: 10px; color: #00ff88; font-weight: 500; }
.poi-address { font-size: 10px; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.poi-extra { font-size: 10px; color: #71717a; }
.poi-distance-info { font-size: 10px; color: #52525b; margin-top: 2px; }
.poi-empty { padding: 20px; text-align: center; color: #71717a; font-size: 13px; }
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
}
.poi-search-btn:hover { background: rgba(0, 255, 136, 0.22); }
.poi-search-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.poi-btn-row { display: flex; gap: 6px; margin-top: 6px; }
.poi-btn-half {
  flex: 1; padding: 6px 8px; border-radius: 8px;
  font-size: 11px; font-family: 'Kanit', sans-serif;
  cursor: pointer; transition: background 0.2s, border-color 0.2s;
  text-align: center; white-space: nowrap;
}
.poi-reopen-btn { background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.3); color: #818cf8; }
.poi-reopen-btn:hover { background: rgba(99,102,241,0.22); }
.poi-clear-btn { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; }
.poi-clear-btn:hover { background: rgba(239,68,68,0.22); }
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
:global(.poi-pin) > *:not(.poi-pin-label) { transform: rotate(45deg); }
:global(.poi-pin-label) {
  position: absolute; top: -22px; left: 50%; transform: rotate(45deg) translateX(-50%);
  background: rgba(0,0,0,0.8); color: #fff;
  font-size: 9px; font-weight: 500; padding: 2px 6px; border-radius: 4px;
  white-space: nowrap; max-width: 100px; overflow: hidden; text-overflow: ellipsis;
  pointer-events: none; font-family: 'Kanit', sans-serif;
  transform-origin: bottom left;
}
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
:global(.selected-poi-marker-wrap) { background: none !important; border: none !important; }
:global(.selected-poi-pin) {
  width: 38px !important; height: 38px !important; font-size: 18px !important;
  box-shadow: 0 0 12px rgba(0,255,136,0.4), 0 0 24px rgba(0,255,136,0.15);
  border: 2px solid rgba(255,255,255,0.5) !important;
  animation: selectedPoiBounce 0.4s ease-out;
  transform: rotate(-45deg) scale(var(--start-label-scale, 1)) !important;
}
:global(.selected-poi-label) {
  font-size: 11px !important; font-weight: 600 !important;
  background: rgba(0,0,0,0.85) !important; padding: 3px 8px !important;
  border: 1px solid rgba(0,255,136,0.4); border-radius: 6px !important;
  max-width: 160px; top: -28px !important;
}
:global(.selected-poi-close) {
  position: absolute; top: -30px; right: -30px;
  transform: rotate(45deg);
  width: 20px; height: 20px; border-radius: 50%;
  background: rgba(239,68,68,0.85); color: #fff;
  font-size: 11px; line-height: 20px; text-align: center;
  cursor: pointer; pointer-events: auto;
  border: 1px solid rgba(239,68,68,0.6);
  transition: background 0.2s;
}
:global(.selected-poi-close:hover) { background: rgba(239,68,68,1); }
@keyframes selectedPoiBounce {
  0% { transform: rotate(-45deg) scale(0.3); opacity: 0; }
  60% { transform: rotate(-45deg) scale(1.1); opacity: 1; }
  100% { transform: rotate(-45deg) scale(var(--start-label-scale, 1)); opacity: 1; }
}
:global(.poi-popup) { font-family: 'Kanit', sans-serif; }
:global(.poi-popup-header) { display: flex; align-items: center; gap: 10px; padding: 12px 14px 8px; }
:global(.poi-badge) { width: 32px; height: 32px; border-radius: 8px; background: rgba(255, 255, 255, 0.08); font-size: 16px; }
:global(.poi-popup-name) { font-size: 13px; font-weight: 600; color: #f4f4f5; }
:global(.poi-popup-meta) { padding: 8px 14px 12px; border-top: 1px solid rgba(255, 255, 255, 0.06); }
:global(.poi-popup-meta p) { margin: 2px 0; font-size: 12px; color: #d4d4d8; }

/* ==================== MAP POI PINS & POPUPS ==================== */
:global(.map-poi-pin-wrap) { background: none !important; border: none !important; }
:global(.mpoi-dot-wrap) {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  cursor: pointer; white-space: nowrap;
  transition: transform 0.15s ease;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
}
:global(.mpoi-dot-wrap:hover) {
  transform: scale(1.3);
  filter: drop-shadow(0 3px 8px rgba(0,0,0,0.5));
}
/* วงกลมสำหรับสถานที่สำคัญ — ขาว + emoji */
:global(.mpoi-circle) {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid rgba(255,255,255,0.9);
  box-shadow: 0 1px 4px rgba(0,0,0,0.35);
  flex-shrink: 0;
}
:global(.mpoi-important) {
  background: rgba(30, 30, 50, 0.9);
}
/* วงกลมแบรนด์ — สีร้าน + ตัวอักษรขาว */
:global(.mpoi-brand) {
  color: #fff;
}
:global(.mpoi-c-icon) {
  font-size: 15px; line-height: 1;
}
:global(.mpoi-c-brand) {
  font-size: 9px; font-weight: 800; line-height: 1;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: -0.5px; color: #fff;
}
/* สถานที่เล็ก — วงกลมเล็กกว่า + emoji */
:global(.mpoi-small) {
  width: 22px; height: 22px;
  background: rgba(30, 30, 50, 0.85);
  border-width: 1.5px;
}
:global(.mpoi-small .mpoi-c-icon) {
  font-size: 12px;
}
/* ชื่อสถานที่ */
:global(.mpoi-c-name) {
  font-size: 9px; font-weight: 600; color: #e4e4e7;
  font-family: 'Kanit', sans-serif;
  background: rgba(0,0,0,0.75);
  padding: 1px 5px; border-radius: 3px;
  max-width: 80px; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.3; text-align: center;
  pointer-events: none;
}
:global(.map-poi-popup-container .leaflet-popup-content-wrapper) {
  background: rgba(15, 15, 30, 0.95) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
  color: #e4e4e7 !important;
  padding: 0 !important;
}
:global(.map-poi-popup-container .leaflet-popup-tip) {
  background: rgba(15, 15, 30, 0.95) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
}
:global(.map-poi-popup-container .leaflet-popup-close-btn) {
  color: #a1a1aa !important;
  font-size: 18px !important;
  top: 6px !important;
  right: 8px !important;
}
:global(.map-poi-popup) {
  font-family: 'Kanit', sans-serif;
  padding: 12px 14px;
  min-width: 180px;
}
:global(.mpoi-header) {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 8px;
}
:global(.mpoi-icon) {
  font-size: 22px; width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 10px; flex-shrink: 0;
}
:global(.mpoi-info) {
  display: flex; flex-direction: column; gap: 1px;
  min-width: 0;
}
:global(.mpoi-name) {
  font-size: 14px; font-weight: 600; color: #f4f4f5;
  line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
:global(.mpoi-type) {
  font-size: 11px; color: #00ff88; font-weight: 500;
}
:global(.mpoi-row) {
  font-size: 12px; color: #a1a1aa;
  padding: 2px 0;
  line-height: 1.4;
}
:global(.mpoi-row a) {
  color: #60a5fa; text-decoration: none;
}
:global(.mpoi-row a:hover) {
  text-decoration: underline;
}

/* ==================== RESPONSIVE - FLOATING PANELS ==================== */
@media (max-width: 1024px) {
  .map-search-float { width: 340px; top: 12px; right: 12px; }
  .map-prefs-float { top: auto; bottom: 14px; left: 12px; padding: 6px; }
  .float-pref-chip { font-size: 10px; padding: 4px 8px; }
  .float-toggle-chip { width: 28px; height: 28px; font-size: 12px; }
}

@media (max-width: 768px) {
  .map-search-float { left: 10px; right: 10px; width: auto; top: 10px; padding: 8px 10px; }
  .map-prefs-float {
    top: auto;
    bottom: 10px;
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    padding: 4px 5px;
    border-radius: 20px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    max-width: calc(100% - 20px);
  }
  .float-pref-chips { flex-wrap: nowrap; gap: 3px; }
  .float-pref-chip { font-size: 9px; padding: 3px 6px; }
  .float-pref-toggles { gap: 3px; margin-left: 1px; padding-left: 4px; }
  .float-toggle-chip { width: 24px; height: 24px; font-size: 11px; }
  .map-poi-float { top: 69px; right: 10px; max-width: 220px; padding: 6px; font-size: 11px; border-radius: 10px; }
  .map-poi-float .poi-search-btn { font-size: 10px; padding: 4px 8px; }
  .poi-modal { width: 95%; max-width: 360px; padding: 14px; }
  .map-top-left-group { flex-direction: column; gap: 6px; }
  .map-vehicle-float { display: none; }
  .float-vehicle-btn { padding: 5px 10px; font-size: 12px; }
  .map-saved-float { bottom: 20px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 40px); }
}

@media (max-width: 480px) {
  .map-search-float { left: 8px; right: 8px; width: auto; top: 8px; padding: 6px 8px; }
  .map-search-float .search-input { padding: 8px 32px 8px 30px; font-size: 12px; }
  .map-prefs-float {
    bottom: 6px;
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    padding: 3px 4px;
    border-radius: 18px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    max-width: calc(100% - 12px);
  }
  .float-pref-chips { flex-wrap: nowrap; gap: 2px; }
  .float-pref-chip { font-size: 8px; padding: 3px 5px; }
  .float-pref-toggles { gap: 2px; margin-left: 1px; padding-left: 3px; }
  .float-toggle-chip { width: 22px; height: 22px; font-size: 10px; }
  .map-poi-float { top: 67px; right: 8px; max-width: 200px; padding: 5px; font-size: 10px; border-radius: 8px; }
  .poi-modal { width: 95%; padding: 12px; }
  .poi-chip { font-size: 10px; padding: 3px 8px; }
  .map-top-left-group { flex-direction: column; gap: 4px; top: 14px; left: 10px; }
  .map-vehicle-float { display: none; }
  .float-vehicle-btn { padding: 4px 8px; font-size: 11px; gap: 4px; }
  .float-vehicle-label { display: none; }
  .map-saved-float { bottom: 14px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 30px); }
}

/* ==================== TRAFFIC LEGEND ==================== */
.traffic-legend {
  position: absolute;
  top: 120px;
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
  bottom: 65px;
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
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
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
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
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
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
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
:global(.incident-marker) { background: none !important; border: none !important; }

:global(.incident-pin) {
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

:global(.incident-pin .incident-icon) { font-size: 16px; }

:global(.incident-popup) {
  min-width: 220px;
  max-width: 280px;
  overflow: hidden;
}

:global(.incident-popup-header) {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 14px 8px;
  color: white;
  font-weight: 600;
}

:global(.incident-popup-title) { font-size: 13px; line-height: 1.3; font-family: 'Kanit', sans-serif; color: #f4f4f5; }

:global(.incident-popup-content) {
  padding: 10px 14px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

:global(.incident-popup-content p) {
  font-size: 12px;
  color: #d4d4d8;
  margin: 0 0 10px 0;
  line-height: 1.5;
  font-family: 'Kanit', sans-serif;
}

:global(.incident-popup-meta) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: #a1a1aa;
  font-family: 'Kanit', sans-serif;
}

:global(.incident-popup-meta span) {
  display: flex;
  align-items: center;
  gap: 4px;
}

:global(.incident-popup-time) {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 10px;
  color: #71717a;
  font-family: 'Kanit', sans-serif;
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
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
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
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
}

.btn-reroute-dismiss:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e4e4e7;
}

/* ==================== 2-OPT OPTIMIZATION ==================== */
.btn-optimize-2opt {
  background: rgba(0,255,136,0.1);
  color: #00ff88;
  border: 1px solid rgba(0,255,136,0.2);
}
.btn-optimize-2opt:hover:not(:disabled) {
  background: rgba(0,255,136,0.18);
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
  gap: 8px;
  cursor: pointer;
  padding: 9px 12px;
  user-select: none;
  flex: 1 1 calc(50% - 3px);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(109, 40, 217, 0.05) 100%);
  border-radius: 10px;
  border: 1px solid rgba(139, 92, 246, 0.2);
  transition: background 0.3s ease, color 0.3s ease, border-color 0.3s ease, opacity 0.3s ease, transform 0.3s ease;
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
  width: 36px;
  height: 20px;
  background: rgba(113, 113, 122, 0.4);
  border-radius: 10px;
  transition: background 0.3s ease, color 0.3s ease, border-color 0.3s ease, opacity 0.3s ease, transform 0.3s ease;
  flex-shrink: 0;
}
.real-dist-toggle input:checked + .toggle-switch {
  background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.4);
}
.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: background 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55), transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}
.real-dist-toggle input:checked + .toggle-switch .toggle-knob {
  left: 18px;
}
.toggle-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.toggle-text {
  font-size: 11px;
  font-weight: 500;
  color: #e4e4e7;
  white-space: nowrap;
}
.toggle-hint {
  font-size: 9px;
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
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
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
    display: none;
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
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
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

/* Google Maps Button */
.btn-google-maps {
  background: rgba(66, 133, 244, 0.12) !important;
  border: 1px solid rgba(66, 133, 244, 0.3) !important;
  color: #60a5fa !important;
}
.btn-google-maps:hover {
  background: rgba(66, 133, 244, 0.2) !important;
  border-color: rgba(66, 133, 244, 0.5) !important;
}
.btn-google-maps svg { color: #4285f4; }

/* AI Plan Button */
.btn-ai-plan {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(99, 102, 241, 0.2)) !important;
  border: 1px solid rgba(139, 92, 246, 0.4) !important;
  color: #c4b5fd !important;
}
.btn-ai-plan:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(99, 102, 241, 0.3)) !important;
  border-color: rgba(139, 92, 246, 0.6) !important;
  color: #e0d5ff !important;
}
.btn-ai-plan:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-ai-plan svg {
  color: #8b5cf6;
}

/* Point card selected state */
.point-card.keyboard-selected {
  background: rgba(59, 130, 246, 0.15) !important;
  border-color: rgba(59, 130, 246, 0.5) !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3), inset 0 0 20px rgba(59, 130, 246, 0.1) !important;
}

</style>