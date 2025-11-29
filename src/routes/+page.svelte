<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let map: any;
  let L: any;
  let deliveryPoints: any[] = [];
  let optimizedRoute: any = null;
  let routeLayer: any = null;
  let glowLayer: any = null;
  let markers: any[] = [];

  const API_URL = 'http://localhost:3000/api';

  let newPoint = {
    name: '',
    address: '',
    lat: 13.7563,
    lng: 100.5018,
    priority: 3
  };

  let isOptimizing = false;
  let showAddForm = false;
  let clickMarker: any = null;
  let notification = { show: false, message: '', type: 'success' as 'success' | 'error' | 'warning' };
  let activeTab: 'points' | 'route' = 'points';
  let activePointId: number | null = null;

  // Navigation Mode State
  let isNavigating = false;
  let currentLocation: { lat: number; lng: number } | null = null;
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

  // ==================== NEW FEATURES STATE ====================
  
  // Statistics
  let totalDeliveriesToday = 0;
  let completedDeliveries = 0;
  let averageDeliveryTime = 0;
  let totalDistanceTraveled = 0;
  
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
  let fuelConsumption = 0; // liters
  let fuelCostEstimate = 0; // baht
  const FUEL_PRICE_PER_LITER = 42; // baht
  const KM_PER_LITER = 15;
  
  // Voice navigation
  let voiceEnabled = true;
  
  // Night mode
  let isNightMode = false;
  
  // Settings panel
  let showSettings = false;
  
  // Search
  let searchQuery = '';
  let searchResults: any[] = [];
  let showSearchResults = false;
  
  // Filter & Sort
  let sortBy: 'priority' | 'distance' | 'name' = 'priority';
  let filterPriority: number | null = null;
  
  // Multi-select for batch operations
  let selectedPoints: number[] = [];
  let isMultiSelectMode = false;
  
  // Route history
  let routeHistory: any[] = [];
  
  // Offline mode indicator
  let isOffline = false;
  
  // Battery status
  let batteryLevel = 100;
  let isCharging = false;
  
  // Driver info
  let driverInfo = {
    name: 'คนขับ 001',
    id: 'DRV-2024-001',
    vehicle: 'Toyota Vios',
    plateNumber: 'กข 1234'
  };
  
  // Delivery notes
  let deliveryNotes: Record<number, string> = {};
  
  // Photo proof
  let deliveryPhotos: Record<number, string[]> = {};
  
  // Customer contact
  let showContactModal = false;
  let selectedCustomer: any = null;
  
  // Break time tracking
  let isOnBreak = false;
  let breakStartTime: Date | null = null;
  let totalBreakTime = 0;
  
  // Alert system
  let alerts: { id: number; type: string; message: string; time: Date }[] = [];
  let showAlerts = false;

  onMount(async () => {
    try {
      L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');

      map = L.map('map', {
        zoomControl: false
      }).setView([13.7465, 100.5348], 12);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
        attribution: '© Stadia Maps © OpenMapTiles © OSM',
        maxZoom: 19
      }).addTo(map);

      setTimeout(() => map.invalidateSize(), 200);

      map.on('click', (e: any) => {
        if (isNavigating) return;
        if (clickMarker) clickMarker.remove();

        newPoint.lat = parseFloat(e.latlng.lat.toFixed(6));
        newPoint.lng = parseFloat(e.latlng.lng.toFixed(6));

        clickMarker = L.marker([e.latlng.lat, e.latlng.lng], {
          icon: L.divIcon({
            className: 'click-marker',
            html: `<div class="pulse-marker"></div>`,
            iconSize: [48, 48],
            iconAnchor: [24, 24]
          })
        }).addTo(map);

        showAddForm = true;
      });

      await loadDeliveryPoints();
      initExtraFeatures();
    } catch (error) {
      console.error('Map init error:', error);
      showNotification('ไม่สามารถโหลดแผนที่ได้', 'error');
    }
  });

  onDestroy(() => {
    stopNavigation();
  });

  async function loadDeliveryPoints() {
    try {
      const res = await fetch(`${API_URL}/points`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      deliveryPoints = Array.isArray(data)
        ? data.map((p: any) => ({
            id: Number(p.id),
            name: p.name || 'ไม่มีชื่อ',
            address: p.address || 'ไม่มีที่อยู่',
            lat: Number(p.lat),
            lng: Number(p.lng),
            priority: Number(p.priority || 3)
          }))
        : [];

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
          html: `<div class="marker-pin" style="background: ${colors.bg}; box-shadow: 0 0 20px ${colors.glow};">
            <span>${i + 1}</span>
          </div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        })
      }).addTo(map);

      marker.bindPopup(`
        <div class="custom-popup">
          <div class="popup-header" style="background: ${colors.bg}">
            <span class="popup-number">${i + 1}</span>
            <span class="popup-priority">P${point.priority}</span>
          </div>
          <div class="popup-content">
            <h4>${point.name}</h4>
            <p>${point.address}</p>
          </div>
        </div>
      `, { className: 'dark-popup' });

      markers.push(marker);
    });
  }

  async function addDeliveryPoint() {
    if (!newPoint.name.trim() || !newPoint.address.trim()) {
      showNotification('กรุณากรอกข้อมูลให้ครบ', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPoint)
      });

      const data = await res.json();
      if (data.error || !res.ok) throw new Error(data.error || 'เพิ่มไม่สำเร็จ');

      await loadDeliveryPoints();
      
      // Set the new point as active and scroll to it
      if (data.id) {
        activePointId = data.id;
        setTimeout(() => {
          const element = document.getElementById(`point-${data.id}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
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
      const res = await fetch(`${API_URL}/points/${id}`, { method: 'DELETE' });
      const data = await res.json();

      if (data.error || !res.ok) throw new Error(data.error || 'ลบไม่สำเร็จ');

      await loadDeliveryPoints();
      if (optimizedRoute) clearRoute();
      showNotification('ลบสำเร็จ', 'success');
    } catch (err) {
      showNotification('ลบไม่สำเร็จ', 'error');
    }
  }

  async function optimizeRoute() {
    if (deliveryPoints.length < 1) {
      showNotification('ต้องมีอย่างน้อย 1 จุดส่ง', 'error');
      return;
    }

    isOptimizing = true;

    try {
      // Get current location as start point
      const startPoint = await getCurrentLocationAsStart();
      
      // Sort points by nearest neighbor algorithm
      const sortedPoints = sortByNearestNeighbor(startPoint, [...deliveryPoints]);
      
      // Build waypoints for OSRM: start -> all sorted points (including last one)
      const waypoints = [
        `${startPoint.lng},${startPoint.lat}`,
        ...sortedPoints.map((p: any) => `${p.lng},${p.lat}`)
      ].join(';');

      // Call OSRM directly to get route through ALL points
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson`;
      const res = await fetch(osrmUrl);
      const data = await res.json();

      if (data.code !== 'Ok' || !data.routes?.[0]) {
        throw new Error('ไม่สามารถคำนวณเส้นทางได้');
      }

      // Build optimized route data
      optimizedRoute = {
        route: {
          geometry: data.routes[0].geometry
        },
        total_distance: data.routes[0].distance,
        total_time: data.routes[0].duration,
        optimized_order: [
          { ...startPoint, name: 'ตำแหน่งปัจจุบัน', address: 'จุดเริ่มต้นของคุณ' },
          ...sortedPoints
        ]
      };

      remainingDistance = data.routes[0].distance;
      remainingTime = data.routes[0].duration;
      displayOptimizedRoute();
      activeTab = 'route';
      showNotification('คำนวณเส้นทางสำเร็จ', 'success');
    } catch (err: any) {
      showNotification(err.message || 'คำนวณไม่สำเร็จ', 'error');
    } finally {
      isOptimizing = false;
    }
  }

  // Nearest Neighbor Algorithm - เริ่มจากจุดใกล้สุดไปเรื่อยๆ
  function sortByNearestNeighbor(start: { lat: number; lng: number }, points: any[]): any[] {
    const sorted: any[] = [];
    const remaining = [...points];
    let currentPos = start;

    while (remaining.length > 0) {
      let nearestIndex = 0;
      let nearestDist = Infinity;

      // Find nearest point from current position
      remaining.forEach((point, index) => {
        const dist = getDistance(currentPos.lat, currentPos.lng, point.lat, point.lng);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIndex = index;
        }
      });

      // Add nearest to sorted and remove from remaining
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

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          let msg = 'ไม่สามารถระบุตำแหน่งได้';
          if (error.code === 1) msg = 'กรุณาอนุญาตการเข้าถึง GPS';
          if (error.code === 2) msg = 'ไม่สามารถระบุตำแหน่งได้';
          if (error.code === 3) msg = 'หมดเวลาการระบุตำแหน่ง';
          reject(new Error(msg));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        }
      );
    });
  }

  function displayOptimizedRoute() {
    if (!L || !map || !optimizedRoute?.route?.geometry) return;

    if (routeLayer) routeLayer.remove();
    if (glowLayer) glowLayer.remove();

    const coords = optimizedRoute.route.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    
    glowLayer = L.polyline(coords, {
      color: '#00ff88',
      weight: 12,
      opacity: 0.3,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    routeLayer = L.polyline(coords, {
      color: '#00ff88',
      weight: 4,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), { padding: [80, 80] });

    markers.forEach(m => m.remove());
    markers = [];

    optimizedRoute.optimized_order.forEach((point: any, i: number) => {
      const isStart = i === 0;
      const isCurrentLocation = isStart && point.name === 'ตำแหน่งปัจจุบัน';
      
      let gradient, glow;
      if (isCurrentLocation) {
        gradient = 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)';
        glow = '#3b82f6';
      } else {
        gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        glow = '#667eea';
      }

      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: 'route-marker',
          html: `<div class="marker-pin route-pin ${isCurrentLocation ? 'current-loc' : ''}" style="background: ${gradient}; box-shadow: 0 0 25px ${glow};">
            <span>${isCurrentLocation ? '📍' : i + 1}</span>
            ${isCurrentLocation ? '<div class="marker-label">คุณอยู่ที่นี่</div>' : ''}
          </div>`,
          iconSize: [52, 52],
          iconAnchor: [26, 26]
        })
      }).addTo(map);

      marker.bindPopup(`
        <div class="custom-popup">
          <div class="popup-header" style="background: ${gradient}">
            <span class="popup-number">${isCurrentLocation ? '📍' : i + 1}</span>
            <span class="popup-priority">${isCurrentLocation ? 'จุดเริ่มต้น' : 'จุดส่ง'}</span>
          </div>
          <div class="popup-content">
            <h4>${point.name}</h4>
            <p>${point.address}</p>
          </div>
        </div>
      `, { className: 'dark-popup' });

      markers.push(marker);
    });
  }

  function clearRoute() {
    if (routeLayer) routeLayer.remove();
    if (glowLayer) glowLayer.remove();
    routeLayer = null;
    glowLayer = null;
    optimizedRoute = null;
    activeTab = 'points';
    displayPoints();
    showNotification('ล้างเส้นทางแล้ว', 'success');
  }

  // ==================== NAVIGATION MODE ====================

  function startNavigation() {
    if (!optimizedRoute) return;

    if (!navigator.geolocation) {
      showNotification('เบราว์เซอร์ไม่รองรับ GPS', 'error');
      return;
    }

    isNavigating = true;
    currentTargetIndex = 0;
    arrivedPoints = [];
    traveledPath = [];
    remainingDistance = optimizedRoute.total_distance;
    remainingTime = optimizedRoute.total_time;
    navigationStartTime = new Date();
    elapsedTime = 0;
    speedHistory = [];
    maxSpeed = 0;

    watchId = navigator.geolocation.watchPosition(
      updatePosition,
      handleGeoError,
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 1000
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
    
    // Update markers to show navigation state
    updateNavigationMarkers();
    
    const firstTarget = optimizedRoute.optimized_order[currentTargetIndex];
    if (firstTarget) {
      map.setView([firstTarget.lat, firstTarget.lng], 16);
    }
    
    // Fix map not loading fully
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
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

    if (optimizedRoute) {
      displayOptimizedRoute();
    }

    showNotification('หยุดนำทางแล้ว', 'success');
  }

  function updatePosition(position: GeolocationPosition) {
    const { latitude, longitude, accuracy: acc } = position.coords;
    currentLocation = { lat: latitude, lng: longitude };
    accuracy = acc;

    // Calculate speed
    calculateSpeed(latitude, longitude);

    updateCurrentLocationMarker();
    updateRouteDisplay();
    updateNavigationMarkers();
    checkArrival();

    if (isNavigating) {
      map.setView([latitude, longitude], map.getZoom(), { animate: true });
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

  function updateCurrentLocationMarker() {
    if (!L || !map || !currentLocation) return;

    if (currentLocationMarker) {
      currentLocationMarker.setLatLng([currentLocation.lat, currentLocation.lng]);
    } else {
      currentLocationMarker = L.marker([currentLocation.lat, currentLocation.lng], {
        icon: L.divIcon({
          className: 'current-location-marker',
          html: `
            <div class="location-accuracy" style="width: ${Math.min(accuracy * 2, 100)}px; height: ${Math.min(accuracy * 2, 100)}px;"></div>
            <div class="location-dot">
              <div class="location-dot-inner"></div>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        }),
        zIndexOffset: 1000
      }).addTo(map);
    }
  }

  function updateRouteDisplay() {
    if (!L || !map || !currentLocation || !optimizedRoute?.route?.geometry) return;

    // Use the navigation display function
    updateRouteDisplayForNavigation();
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

  function updateNavigationMarkers() {
    if (!L || !map || !optimizedRoute) return;

    markers.forEach(m => m.remove());
    markers = [];

    optimizedRoute.optimized_order.forEach((point: any, i: number) => {
      const isArrived = arrivedPoints.includes(i);
      const isCurrent = i === currentTargetIndex;
      const isStart = i === 0;

      let gradient, glow;
      if (isArrived) {
        gradient = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
        glow = '#6b7280';
      } else if (isCurrent) {
        gradient = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
        glow = '#f59e0b';
      } else if (isStart) {
        gradient = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)';
        glow = '#00ff88';
      } else {
        gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        glow = '#667eea';
      }

      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: 'route-marker',
          html: `<div class="marker-pin route-pin ${isArrived ? 'arrived' : ''} ${isCurrent ? 'current-target' : ''}" style="background: ${gradient}; box-shadow: 0 0 25px ${glow};">
            <span>${isArrived ? '✓' : i + 1}</span>
            ${isCurrent ? '<div class="marker-label target-label">เป้าหมาย</div>' : ''}
          </div>`,
          iconSize: [52, 52],
          iconAnchor: [26, 26]
        })
      }).addTo(map);

      markers.push(marker);
    });
  }

  function checkArrival() {
    if (!currentLocation || !optimizedRoute) return;

    const target = optimizedRoute.optimized_order[currentTargetIndex];
    if (!target) return;

    const dist = getDistance(currentLocation.lat, currentLocation.lng, target.lat, target.lng);
    distanceToNextPoint = dist;

    if (dist < 50 && !arrivedPoints.includes(currentTargetIndex)) {
      arrivedPoints = [...arrivedPoints, currentTargetIndex];
      markAsDelivered(target.id);
      showNotification(`ถึง ${target.name} แล้ว!`, 'success');
      speak(`ถึง ${target.name} แล้ว`);

      if (currentTargetIndex < optimizedRoute.optimized_order.length - 1) {
        currentTargetIndex++;
        updateRouteDisplayForNavigation();
        updateNavigationMarkers();
      } else {
        // จุดสุดท้าย
        showNotification('ส่งครบทุกจุดแล้ว! 🎉', 'success');
        speak('ส่งครบทุกจุดแล้ว');
      }
    }
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

  function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

  async function skipToNextPoint() {
    if (currentTargetIndex >= optimizedRoute.optimized_order.length - 1) {
      // ถ้าอยู่ที่จุดสุดท้ายแล้ว ให้ข้าม
      if (!arrivedPoints.includes(currentTargetIndex)) {
        arrivedPoints = [...arrivedPoints, currentTargetIndex];
        showNotification('ข้ามจุดสุดท้ายแล้ว', 'warning');
        speak('ข้ามจุดสุดท้ายแล้ว');
        addAlert('navigation', 'ข้ามจุดหมายสุดท้าย');
      }
      return;
    }
    
    const skippedPoint = optimizedRoute.optimized_order[currentTargetIndex];
    
    // Mark current point as skipped (not delivered)
    arrivedPoints = [...arrivedPoints, currentTargetIndex];
    currentTargetIndex++;
    
    // Just update the display - no need to recalculate, use existing route
    updateRouteDisplayForNavigation();
    updateNavigationMarkers();
    
    // Center on next target
    const nextTarget = optimizedRoute.optimized_order[currentTargetIndex];
    if (nextTarget) {
      map.setView([nextTarget.lat, nextTarget.lng], 15, { animate: true });
    }
    
    showNotification(`ข้าม ${skippedPoint.name}`, 'warning');
    addAlert('navigation', `ข้ามจุด: ${skippedPoint.name}`);
  }

  function updateRouteDisplayForNavigation() {
    if (!L || !map || !optimizedRoute?.route?.geometry) return;

    // Get full route coordinates
    const fullRouteCoords: [number, number][] = optimizedRoute.route.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    
    // Find where current target is on the route
    const currentTarget = optimizedRoute.optimized_order[currentTargetIndex];
    if (!currentTarget) return;

    // Find the index on route closest to current target
    let targetRouteIndex = 0;
    let minDist = Infinity;
    fullRouteCoords.forEach((coord, idx) => {
      const dist = getDistance(currentTarget.lat, currentTarget.lng, coord[0], coord[1]);
      if (dist < minDist) {
        minDist = dist;
        targetRouteIndex = idx;
      }
    });

    // Find start point index (current location or start of route)
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

    // Clear old layers
    clearAllRouteLayers();
    if (traveledLayer) {
      traveledLayer.remove();
      traveledLayer = null;
    }

    // Draw traveled part (gray) - from route start to current position
    if (startIndex > 0) {
      const traveledCoords = fullRouteCoords.slice(0, startIndex + 1);
      traveledLayer = L.polyline(traveledCoords, {
        color: '#6b7280',
        weight: 5,
        opacity: 0.6,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
    }

    // Draw remaining part (green) - from current position to end
    const remainingCoords = fullRouteCoords.slice(startIndex);
    if (remainingCoords.length > 1) {
      remainingGlowLayer = L.polyline(remainingCoords, {
        color: '#00ff88',
        weight: 12,
        opacity: 0.3,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);

      remainingRouteLayer = L.polyline(remainingCoords, {
        color: '#00ff88',
        weight: 5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
    }

    // Update remaining distance/time
    let totalRemaining = 0;
    for (let i = startIndex; i < fullRouteCoords.length - 1; i++) {
      totalRemaining += getDistance(
        fullRouteCoords[i][0], fullRouteCoords[i][1],
        fullRouteCoords[i + 1][0], fullRouteCoords[i + 1][1]
      );
    }
    remainingDistance = totalRemaining;
    remainingTime = (totalRemaining / 1000) / 30 * 3600;
  }

  // Keep this for backward compatibility but simplify
  async function drawRouteFromOSRM(start: {lat: number, lng: number}, points: any[]) {
    const waypoints = [
      `${start.lng},${start.lat}`,
      ...points.map((p: any) => `${p.lng},${p.lat}`)
    ].join(';');

    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson`;
      const res = await fetch(osrmUrl);
      const data = await res.json();
      
      if (data.code === 'Ok' && data.routes?.[0]?.geometry) {
        const coords = data.routes[0].geometry.coordinates.map((c: number[]) => [c[1], c[0]]);

        remainingGlowLayer = L.polyline(coords, {
          color: '#00ff88',
          weight: 14,
          opacity: 0.3,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);

        remainingRouteLayer = L.polyline(coords, {
          color: '#00ff88',
          weight: 5,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);

        optimizedRoute.route.geometry = data.routes[0].geometry;
        remainingDistance = data.routes[0].distance;
        remainingTime = data.routes[0].duration;

        map.fitBounds(remainingRouteLayer.getBounds(), { padding: [80, 80] });
      } else {
        drawStraightLineRoute(start, points);
      }
    } catch (err) {
      console.error('OSRM error:', err);
      drawStraightLineRoute(start, points);
    }
  }

  function clearAllRouteLayers() {
    // Remove remaining route layers
    if (remainingRouteLayer && map.hasLayer(remainingRouteLayer)) {
      map.removeLayer(remainingRouteLayer);
    }
    remainingRouteLayer = null;
    
    if (remainingGlowLayer && map.hasLayer(remainingGlowLayer)) {
      map.removeLayer(remainingGlowLayer);
    }
    remainingGlowLayer = null;
    
    // Remove original route layers
    if (routeLayer && map.hasLayer(routeLayer)) {
      map.removeLayer(routeLayer);
    }
    routeLayer = null;
    
    if (glowLayer && map.hasLayer(glowLayer)) {
      map.removeLayer(glowLayer);
    }
    glowLayer = null;
  }

  function drawStraightLineRoute(start: {lat: number, lng: number}, points: any[]) {
    const coords: [number, number][] = [
      [start.lat, start.lng],
      ...points.map((p: any) => [p.lat, p.lng] as [number, number])
    ];

    remainingGlowLayer = L.polyline(coords, {
      color: '#00ff88',
      weight: 14,
      opacity: 0.3,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    remainingRouteLayer = L.polyline(coords, {
      color: '#00ff88',
      weight: 5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Calculate distance
    let totalDist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      totalDist += getDistance(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    }
    remainingDistance = totalDist;
    remainingTime = (totalDist / 1000) / 30 * 3600;
  }

  async function recalculateRouteFromAPI() {
    if (!optimizedRoute || !L || !map) return;
    updateRouteDisplayForNavigation();
    updateNavigationMarkers();
  }

  function redrawRemainingRoute() {
    // Use API instead
    recalculateRouteFromAPI();
  }

  function recalculateRemainingRoute() {
    recalculateRouteFromAPI();
  }

  function drawFallbackRoute() {
    recalculateRouteFromAPI();
  }

  // ==================== SPEED & TRACKING ====================
  
  function calculateSpeed(newLat: number, newLng: number) {
    const now = Date.now();
    if (lastPosition) {
      const distance = getDistance(lastPosition.lat, lastPosition.lng, newLat, newLng);
      const timeDiff = (now - lastPosition.time) / 1000; // seconds
      if (timeDiff > 0) {
        currentSpeed = (distance / timeDiff) * 3.6; // km/h
        if (currentSpeed > maxSpeed) maxSpeed = currentSpeed;
        speedHistory.push(currentSpeed);
        if (speedHistory.length > 60) speedHistory.shift(); // Keep last 60 readings
      }
    }
    lastPosition = { lat: newLat, lng: newLng, time: now };
  }
  
  function getAverageSpeed(): number {
    if (speedHistory.length === 0) return 0;
    return speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length;
  }

  // ==================== ETA CALCULATION ====================
  
  function updateETA() {
    if (remainingDistance > 0 && currentSpeed > 5) {
      const hoursRemaining = (remainingDistance / 1000) / currentSpeed;
      const msRemaining = hoursRemaining * 3600 * 1000;
      estimatedArrivalTime = new Date(Date.now() + msRemaining);
    } else if (remainingDistance > 0) {
      // Use average speed of 30 km/h if not moving
      const hoursRemaining = (remainingDistance / 1000) / 30;
      const msRemaining = hoursRemaining * 3600 * 1000;
      estimatedArrivalTime = new Date(Date.now() + msRemaining);
    }
  }
  
  function formatETA(date: Date | null): string {
    if (!date) return '--:--';
    return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  // ==================== FUEL CALCULATION ====================
  
  function updateFuelEstimate() {
    const distanceKm = remainingDistance / 1000;
    fuelConsumption = distanceKm / KM_PER_LITER;
    fuelCostEstimate = fuelConsumption * FUEL_PRICE_PER_LITER;
  }

  // ==================== VOICE NAVIGATION ====================
  
  function speak(text: string) {
    if (!voiceEnabled || typeof window === 'undefined') return;
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'th-TH';
      utterance.rate = 1;
      speechSynthesis.speak(utterance);
    }
  }
  
  function announceNextTurn() {
    if (!optimizedRoute || currentTargetIndex >= optimizedRoute.optimized_order.length) return;
    const target = optimizedRoute.optimized_order[currentTargetIndex];
    const distKm = (distanceToNextPoint / 1000).toFixed(1);
    speak(`อีก ${distKm} กิโลเมตร ถึง ${target.name}`);
  }
  
  function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    showNotification(voiceEnabled ? 'เปิดเสียงนำทาง' : 'ปิดเสียงนำทาง', 'success');
  }

  // ==================== TRAFFIC STATUS ====================
  
  function updateTrafficStatus() {
    // Mock traffic based on time of day
    const hour = new Date().getHours();
    if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19)) {
      trafficStatus = 'heavy';
    } else if ((hour >= 11 && hour <= 13)) {
      trafficStatus = 'moderate';
    } else {
      trafficStatus = 'smooth';
    }
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

  // ==================== SEARCH & FILTER ====================
  
  function searchPoints() {
    if (!searchQuery.trim()) {
      searchResults = [];
      showSearchResults = false;
      return;
    }
    
    const query = searchQuery.toLowerCase();
    searchResults = deliveryPoints.filter(p => 
      p.name.toLowerCase().includes(query) ||
      p.address.toLowerCase().includes(query)
    );
    showSearchResults = true;
  }
  
  function selectSearchResult(point: any) {
    focusOnPoint(point.lat, point.lng);
    activePointId = point.id;
    searchQuery = '';
    showSearchResults = false;
  }
  
  function sortPoints() {
    deliveryPoints = [...deliveryPoints].sort((a, b) => {
      switch (sortBy) {
        case 'priority':
          return a.priority - b.priority;
        case 'name':
          return a.name.localeCompare(b.name, 'th');
        case 'distance':
          if (!currentLocation) return 0;
          const distA = getDistance(currentLocation.lat, currentLocation.lng, a.lat, a.lng);
          const distB = getDistance(currentLocation.lat, currentLocation.lng, b.lat, b.lng);
          return distA - distB;
        default:
          return 0;
      }
    });
    displayPoints();
  }
  
  function filterByPriority(priority: number | null) {
    filterPriority = priority;
  }
  
  function getFilteredPoints() {
    if (filterPriority === null) return deliveryPoints;
    return deliveryPoints.filter(p => p.priority === filterPriority);
  }

  // ==================== MULTI-SELECT ====================
  
  function toggleMultiSelect() {
    isMultiSelectMode = !isMultiSelectMode;
    if (!isMultiSelectMode) {
      selectedPoints = [];
    }
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
    showNotification(`ลบ ${selectedPoints.length} จุดสำเร็จ`, 'success');
  }

  // ==================== BREAK TIME ====================
  
  function startBreak() {
    isOnBreak = true;
    breakStartTime = new Date();
    showNotification('เริ่มพักเบรค', 'success');
    addAlert('break', 'คนขับเริ่มพักเบรค');
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

  // ==================== ALERTS ====================
  
  function addAlert(type: string, message: string) {
    const alert = {
      id: Date.now(),
      type,
      message,
      time: new Date()
    };
    alerts = [alert, ...alerts].slice(0, 50); // Keep last 50
  }
  
  function clearAlerts() {
    alerts = [];
  }
  
  function dismissAlert(id: number) {
    alerts = alerts.filter(a => a.id !== id);
  }

  // ==================== DELIVERY COMPLETION ====================
  
  function markAsDelivered(pointId: number) {
    completedDeliveries++;
    addAlert('delivery', `ส่งสำเร็จ: ${deliveryPoints.find(p => p.id === pointId)?.name}`);
    speak('ส่งสำเร็จ');
  }
  
  function addDeliveryNote(pointId: number, note: string) {
    deliveryNotes[pointId] = note;
  }

  // ==================== STATISTICS ====================
  
  function updateStatistics() {
    totalDeliveriesToday = deliveryPoints.length;
    if (navigationStartTime) {
      elapsedTime = Date.now() - navigationStartTime.getTime();
    }
    if (completedDeliveries > 0) {
      averageDeliveryTime = elapsedTime / completedDeliveries;
    }
  }
  
  function getCompletionRate(): number {
    if (totalDeliveriesToday === 0) return 0;
    return Math.round((completedDeliveries / totalDeliveriesToday) * 100);
  }

  // ==================== WEATHER (MOCK) ====================
  
  function updateWeather() {
    // Mock weather update
    const conditions = ['sunny', 'cloudy', 'rainy'];
    weather = {
      temp: 28 + Math.floor(Math.random() * 8),
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      humidity: 60 + Math.floor(Math.random() * 30)
    };
  }
  
  function getWeatherIcon(): string {
    switch (weather.condition) {
      case 'sunny': return '☀️';
      case 'cloudy': return '☁️';
      case 'rainy': return '🌧️';
      default: return '🌤️';
    }
  }

  // ==================== BATTERY STATUS ====================
  
  async function updateBatteryStatus() {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      try {
        const battery: any = await (navigator as any).getBattery();
        batteryLevel = Math.round(battery.level * 100);
        isCharging = battery.charging;
      } catch (e) {
        // Battery API not supported
      }
    }
  }
  
  function getBatteryColor(): string {
    if (batteryLevel > 50) return '#00ff88';
    if (batteryLevel > 20) return '#ffa502';
    return '#ff6b6b';
  }

  // ==================== NIGHT MODE ====================
  
  function toggleNightMode() {
    isNightMode = !isNightMode;
    // Could change map tiles here for night mode
    showNotification(isNightMode ? 'เปิดโหมดกลางคืน' : 'ปิดโหมดกลางคืน', 'success');
  }

  // ==================== EXPORT DATA ====================
  
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

  // ==================== SHARE LOCATION ====================
  
  function shareCurrentLocation() {
    if (!currentLocation) {
      showNotification('ยังไม่มีตำแหน่งปัจจุบัน', 'error');
      return;
    }
    
    const url = `https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`;
    
    if (navigator.share) {
      navigator.share({
        title: 'ตำแหน่งปัจจุบัน',
        text: `ตำแหน่งคนขับ: ${driverInfo.name}`,
        url: url
      });
    } else {
      navigator.clipboard.writeText(url);
      showNotification('คัดลอกลิงก์แล้ว', 'success');
    }
  }

  // ==================== EMERGENCY ====================
  
  function emergencyStop() {
    if (confirm('ต้องการหยุดฉุกเฉินใช่หรือไม่?')) {
      stopNavigation();
      addAlert('emergency', 'หยุดฉุกเฉิน!');
      speak('หยุดฉุกเฉิน');
      showNotification('หยุดฉุกเฉินแล้ว', 'error');
    }
  }

  // ==================== INIT EXTRA FEATURES ====================
  
  function initExtraFeatures() {
    updateTrafficStatus();
    updateWeather();
    updateBatteryStatus();
    
    // Update every minute
    setInterval(() => {
      updateTrafficStatus();
      updateStatistics();
      updateETA();
      updateFuelEstimate();
    }, 60000);
    
    // Update battery every 5 minutes
    setInterval(updateBatteryStatus, 300000);
  }

  // ==================== END NAVIGATION MODE ====================

  function cancelAddForm() {
    showAddForm = false;
    if (clickMarker) clickMarker.remove();
    newPoint = { name: '', address: '', lat: 13.7563, lng: 100.5018, priority: 3 };
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
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</svelte:head>

<div class="app-container">
  <!-- Settings Panel -->
  {#if showSettings}
    <div class="settings-overlay" on:click={() => showSettings = false} on:keypress={() => {}} role="button" tabindex="-1">
      <div class="settings-panel glass-card" on:click|stopPropagation role="dialog">
        <div class="settings-header">
          <h3>⚙️ ตั้งค่า</h3>
          <button class="close-btn" on:click={() => showSettings = false}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        
        <div class="settings-content">
          <div class="settings-section">
            <h4>🚗 ข้อมูลคนขับ</h4>
            <div class="driver-card">
              <div class="driver-avatar">👤</div>
              <div class="driver-details">
                <div class="driver-name">{driverInfo.name}</div>
                <div class="driver-id">{driverInfo.id}</div>
                <div class="driver-vehicle">{driverInfo.vehicle} • {driverInfo.plateNumber}</div>
              </div>
            </div>
          </div>
          
          <div class="settings-section">
            <h4>🔊 เสียง</h4>
            <label class="toggle-setting">
              <span>เสียงนำทาง</span>
              <button class="toggle-btn" class:active={voiceEnabled} on:click={toggleVoice}>
                <div class="toggle-knob"></div>
              </button>
            </label>
          </div>
          
          <div class="settings-section">
            <h4>🌙 การแสดงผล</h4>
            <label class="toggle-setting">
              <span>โหมดกลางคืน</span>
              <button class="toggle-btn" class:active={isNightMode} on:click={toggleNightMode}>
                <div class="toggle-knob"></div>
              </button>
            </label>
          </div>
          
          <div class="settings-section">
            <h4>📊 ข้อมูลเพิ่มเติม</h4>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">ราคาน้ำมัน</span>
                <span class="info-value">{FUEL_PRICE_PER_LITER} ฿/ลิตร</span>
              </div>
              <div class="info-item">
                <span class="info-label">อัตราสิ้นเปลือง</span>
                <span class="info-value">{KM_PER_LITER} กม./ลิตร</span>
              </div>
            </div>
          </div>
          
          <div class="settings-actions">
            <button class="btn btn-secondary" on:click={exportRouteData}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              ส่งออกข้อมูล
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
                {#if alert.type === 'delivery'}📦
                {:else if alert.type === 'navigation'}🧭
                {:else if alert.type === 'break'}☕
                {:else if alert.type === 'emergency'}🚨
                {:else}📢{/if}
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M15 9l-6 6M9 9l6 6"/>
          </svg>
        {/if}
      </div>
      <span>{notification.message}</span>
    </div>
  {/if}

  <!-- Navigation Overlay -->
  {#if isNavigating}
    <div class="nav-overlay">
      <!-- Top Status Bar -->
      <div class="nav-status-bar">
        <div class="status-item">
          <span class="status-icon">{getWeatherIcon()}</span>
          <span>{weather.temp}°C</span>
        </div>
        <div class="status-item" style="color: {getTrafficColor()}">
          <span class="status-icon">🚦</span>
          <span>{getTrafficLabel()}</span>
        </div>
        <div class="status-item" style="color: {getBatteryColor()}">
          <span class="status-icon">{isCharging ? '⚡' : '🔋'}</span>
          <span>{batteryLevel}%</span>
        </div>
        <div class="status-item">
          <span class="status-icon">📡</span>
          <span>{accuracy < 10 ? 'GPS แม่นยำ' : accuracy < 30 ? 'GPS ปกติ' : 'GPS อ่อน'}</span>
        </div>
      </div>

      <div class="nav-top-bar glass-card">
        <div class="nav-target-info">
          <div class="nav-target-label">เป้าหมายถัดไป</div>
          <div class="nav-target-name">
            {#if currentTargetIndex < optimizedRoute?.optimized_order?.length}
              {optimizedRoute.optimized_order[currentTargetIndex].name}
            {:else}
              ถึงจุดหมายแล้ว
            {/if}
          </div>
          <div class="nav-eta">
            ถึงเวลา: <strong>{formatETA(estimatedArrivalTime)}</strong>
          </div>
        </div>
        <div class="nav-distance-badge">
          <span class="nav-distance-value">{formatDistance(distanceToNextPoint)}</span>
        </div>
      </div>

      <!-- Speed Display -->
      <div class="speed-display glass-card">
        <div class="speed-value">{Math.round(currentSpeed)}</div>
        <div class="speed-unit">km/h</div>
        <div class="speed-max">สูงสุด: {Math.round(maxSpeed)} km/h</div>
      </div>

      <div class="nav-bottom-panel glass-card">
        <div class="nav-stats">
          <div class="nav-stat">
            <div class="nav-stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
              </svg>
            </div>
            <div class="nav-stat-content">
              <div class="nav-stat-value">{formatDistance(remainingDistance)}</div>
              <div class="nav-stat-label">ระยะทางเหลือ</div>
            </div>
          </div>
          <div class="nav-stat">
            <div class="nav-stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <div class="nav-stat-content">
              <div class="nav-stat-value">{formatTime(remainingTime)}</div>
              <div class="nav-stat-label">เวลาเหลือ</div>
            </div>
          </div>
          <div class="nav-stat">
            <div class="nav-stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <div class="nav-stat-content">
              <div class="nav-stat-value">{arrivedPoints.length}/{optimizedRoute?.optimized_order?.length || 0}</div>
              <div class="nav-stat-label">เสร็จแล้ว</div>
            </div>
          </div>
          <div class="nav-stat">
            <div class="nav-stat-icon">⛽</div>
            <div class="nav-stat-content">
              <div class="nav-stat-value">฿{Math.round(fuelCostEstimate)}</div>
              <div class="nav-stat-label">ค่าน้ำมัน</div>
            </div>
          </div>
        </div>

        <div class="nav-progress">
          <div class="nav-progress-bar">
            <div 
              class="nav-progress-fill" 
              style="width: {optimizedRoute ? (arrivedPoints.length / optimizedRoute.optimized_order.length) * 100 : 0}%"
            ></div>
          </div>
        </div>

        <div class="nav-actions">
          <button class="nav-btn nav-btn-secondary" on:click={skipToNextPoint} disabled={arrivedPoints.length >= (optimizedRoute?.optimized_order?.length || 0)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
            </svg>
            ข้าม
          </button>
          <button class="nav-btn nav-btn-voice" class:active={voiceEnabled} on:click={toggleVoice}>
            {#if voiceEnabled}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>
            {/if}
          </button>
          <button class="nav-btn nav-btn-center" on:click={centerOnCurrentLocation}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v4m0 12v4m10-10h-4M6 12H2"/>
            </svg>
          </button>
          <button class="nav-btn nav-btn-share" on:click={shareCurrentLocation}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          </button>
          <button class="nav-btn nav-btn-break" class:active={isOnBreak} on:click={isOnBreak ? endBreak : startBreak}>
            ☕
          </button>
          <button class="nav-btn nav-btn-stop" on:click={stopNavigation}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="6" width="12" height="12" rx="2"/>
            </svg>
            หยุด
          </button>
        </div>

        <!-- Break indicator -->
        {#if isOnBreak}
          <div class="break-indicator">
            ☕ กำลังพักเบรค ({formatBreakTime()})
          </div>
        {/if}
      </div>

      <!-- Emergency Button -->
      <button class="emergency-btn" on:click={emergencyStop}>
        🚨 ฉุกเฉิน
      </button>
    </div>
  {/if}

  <!-- Sidebar (hidden during navigation) -->
  {#if !isNavigating}
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
            </svg>
          </div>
          <div class="logo-text">
            <h1>RouteFlow</h1>
            <span>Delivery Optimizer</span>
          </div>
        </div>
        <div class="header-actions">
          <button class="icon-btn" on:click={() => showAlerts = !showAlerts} title="การแจ้งเตือน">
            🔔
            {#if alerts.length > 0}
              <span class="badge">{alerts.length}</span>
            {/if}
          </button>
          <button class="icon-btn" on:click={() => showSettings = true} title="ตั้งค่า">⚙️</button>
        </div>
      </div>

      <!-- Multi-select toolbar -->
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
        <button 
          class="btn btn-primary"
          on:click={optimizeRoute}
          disabled={isOptimizing || deliveryPoints.length < 1}
        >
          {#if isOptimizing}
            <div class="spinner"></div>
            <span>กำลังคำนวณ...</span>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            <span>คำนวณเส้นทาง</span>
          {/if}
        </button>

        {#if optimizedRoute}
          <button class="btn btn-navigate" on:click={startNavigation}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
            <span>เริ่มนำทาง</span>
          </button>
          <button class="btn btn-ghost" on:click={clearRoute}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 18L18 6M6 6l12 12"/>
            </svg>
            <span>ล้างเส้นทาง</span>
          </button>
        {/if}

        {#if !optimizedRoute}
          <button class="btn btn-secondary" on:click={() => showAddForm = !showAddForm}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            <span>เพิ่มจุดส่ง</span>
          </button>

          <button class="btn btn-ghost" on:click={toggleMultiSelect}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span>{isMultiSelectMode ? 'ยกเลิกเลือก' : 'เลือกหลายรายการ'}</span>
          </button>
        {/if}
      </div>

      {#if showAddForm && !optimizedRoute}
        <div class="add-form glass-card">
          <div class="form-header">
            <h3>เพิ่มจุดส่งใหม่</h3>
            <button class="close-btn" on:click={cancelAddForm}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <p class="form-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"/>
            </svg>
            คลิกบนแผนที่เพื่อเลือกตำแหน่ง
          </p>

          <form on:submit|preventDefault={addDeliveryPoint}>
            <div class="form-group">
              <label>ชื่อสถานที่</label>
              <input type="text" bind:value={newPoint.name} placeholder="เช่น บ้านลูกค้า A" required />
            </div>

            <div class="form-group">
              <label>ที่อยู่</label>
              <textarea bind:value={newPoint.address} placeholder="รายละเอียดที่อยู่..." rows="2" required></textarea>
            </div>

            <div class="form-group coords-group">
              <div class="coord-input">
                <label>Latitude</label>
                <input type="text" value={newPoint.lat} readonly />
              </div>
              <div class="coord-input">
                <label>Longitude</label>
                <input type="text" value={newPoint.lng} readonly />
              </div>
            </div>

            <div class="form-group">
              <label>ระดับความสำคัญ</label>
              <div class="priority-selector">
                {#each [1,2,3,4,5] as p}
                  {@const colors = getPriorityGradient(p)}
                  <button 
                    type="button"
                    class="priority-btn"
                    class:active={newPoint.priority === p}
                    style="--btn-bg: {colors.bg}; --btn-glow: {colors.glow}"
                    on:click={() => newPoint.priority = p}
                  >
                    <span class="priority-num">{p}</span>
                    <span class="priority-label">{getPriorityLabel(p)}</span>
                  </button>
                {/each}
              </div>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 13l4 4L19 7"/>
                </svg>
                บันทึก
              </button>
              <button type="button" class="btn btn-ghost" on:click={cancelAddForm}>ยกเลิก</button>
            </div>
          </form>
        </div>
      {/if}

      <div class="tabs">
        <button class="tab" class:active={activeTab === 'points'} on:click={() => activeTab = 'points'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
            <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          จุดส่ง
        </button>
        <button class="tab" class:active={activeTab === 'route'} on:click={() => activeTab = 'route'} disabled={!optimizedRoute}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
          </svg>
          เส้นทาง
        </button>
      </div>

      <div class="content-area">
        {#if activeTab === 'points'}
          <div class="points-list">
            {#if getFilteredPoints().length === 0}
              <div class="empty-state">
                <div class="empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                    <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                </div>
                <h4>ยังไม่มีจุดส่ง</h4>
                <p>คลิกบนแผนที่หรือกดปุ่ม "เพิ่มจุดส่ง"</p>
              </div>
            {:else}
              {#each getFilteredPoints() as point, i}
                {@const colors = getPriorityGradient(point.priority)}
                <div 
                  id="point-{point.id}"
                  class="point-card"
                  class:active={activePointId === point.id}
                  class:selected={selectedPoints.includes(point.id)}
                  on:click={() => {
                    if (isMultiSelectMode) {
                      togglePointSelection(point.id);
                    } else {
                      activePointId = point.id;
                      focusOnPoint(point.lat, point.lng);
                    }
                  }}
                  on:keypress={(e) => e.key === 'Enter' && focusOnPoint(point.lat, point.lng)}
                  role="button"
                  tabindex="0"
                >
                  {#if isMultiSelectMode}
                    <div class="checkbox" class:checked={selectedPoints.includes(point.id)}>
                      {#if selectedPoints.includes(point.id)}✓{/if}
                    </div>
                  {/if}
                  <div class="point-number" style="background: {colors.bg}; box-shadow: 0 0 15px {colors.glow}40;">{i + 1}</div>
                  <div class="point-info">
                    <h4>{point.name}</h4>
                    <p>{point.address}</p>
                    <div class="point-meta">
                      <span class="priority-tag" style="background: {colors.bg}">P{point.priority} · {getPriorityLabel(point.priority)}</span>
                      {#if currentLocation}
                        <span class="distance-tag">
                          📍 {formatDistance(getDistance(currentLocation.lat, currentLocation.lng, point.lat, point.lng))}
                        </span>
                      {/if}
                    </div>
                  </div>
                  <button class="delete-btn" on:click|stopPropagation={() => deletePoint(point.id, point.name)} title="ลบจุดนี้">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        {:else if activeTab === 'route' && optimizedRoute}
          <div class="route-summary">
            <div class="summary-header">
              <h3>สรุปเส้นทาง</h3>
              <span class="route-badge">เส้นทางที่ดีที่สุด</span>
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
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
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
                <div class="stat-value">{optimizedRoute.optimized_order.length}</div>
                <div class="stat-label">จุดแวะ</div>
              </div>
              <div class="stat-card fuel">
                <div class="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 22V8a2 2 0 012-2h8a2 2 0 012 2v14"/>
                    <path d="M15 12h2a2 2 0 012 2v2a2 2 0 002 2h0a2 2 0 002-2V9.83a2 2 0 00-.59-1.42L18 4"/>
                    <path d="M18 4v4"/>
                    <rect x="5" y="10" width="6" height="4"/>
                  </svg>
                </div>
                <div class="stat-value">฿{Math.round((optimizedRoute.total_distance / 1000) / KM_PER_LITER * FUEL_PRICE_PER_LITER)}</div>
                <div class="stat-label">ค่าน้ำมัน (ประมาณ)</div>
              </div>
            </div>

            <div class="route-timeline">
              <h4>ลำดับการเดินทาง</h4>
              {#each optimizedRoute.optimized_order as point, i}
                {@const isStart = i === 0}
                {@const isCurrentLocation = isStart && point.name === 'ตำแหน่งปัจจุบัน'}
                <div class="timeline-item" class:start={isCurrentLocation} on:click={() => focusOnPoint(point.lat, point.lng)} on:keypress={(e) => e.key === 'Enter' && focusOnPoint(point.lat, point.lng)} role="button" tabindex="0">
                  <div class="timeline-marker"><span>{isCurrentLocation ? '📍' : i + 1}</span></div>
                  <div class="timeline-content">
                    <div class="timeline-label">{isCurrentLocation ? 'ตำแหน่งของคุณ' : `จุดที่ ${i + 1}`}</div>
                    <div class="timeline-name">{point.name}</div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="sidebar-footer">
        <span>RouteFlow v2.0</span>
        <span>GPS Navigation</span>
      </div>
    </aside>
  {/if}

  <div class="map-container" class:fullscreen={isNavigating}>
    <div id="map"></div>
    
    <!-- Quick Stats - Top Right Corner -->
    {#if !isNavigating}
      <div class="map-stats glass-card">
        <div class="map-stat">
          <span class="map-stat-value">{deliveryPoints.length}</span>
          <span class="map-stat-label">จุดส่ง</span>
        </div>
        <div class="map-stat">
          <span class="map-stat-value">{completedDeliveries}</span>
          <span class="map-stat-label">เสร็จแล้ว</span>
        </div>
        <div class="map-stat">
          <span class="map-stat-value">{getCompletionRate()}%</span>
          <span class="map-stat-label">ความคืบหน้า</span>
        </div>
        <div class="map-stat weather">
          <span class="map-stat-value">{getWeatherIcon()} {weather.temp}°</span>
          <span class="map-stat-label">อากาศ</span>
        </div>
      </div>
      
      <!-- Filter & Sort - Below Stats -->
      <div class="map-filters glass-card">
        <select bind:value={sortBy} on:change={sortPoints}>
          <option value="priority">เรียงตามความสำคัญ</option>
          <option value="distance">เรียงตามระยะทาง</option>
          <option value="name">เรียงตามชื่อ</option>
        </select>
        <div class="filter-chips">
          <button class="filter-chip" class:active={filterPriority === null} on:click={() => filterByPriority(null)}>ทั้งหมด</button>
          <button class="filter-chip priority-1" class:active={filterPriority === 1} on:click={() => filterByPriority(1)}>ด่วนมาก</button>
          <button class="filter-chip priority-2" class:active={filterPriority === 2} on:click={() => filterByPriority(2)}>ด่วน</button>
          <button class="filter-chip priority-3" class:active={filterPriority === 3} on:click={() => filterByPriority(3)}>ปกติ</button>
        </div>
      </div>
    {/if}
    
    {#if !isNavigating && !optimizedRoute}
      <div class="map-info glass-card">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 16v-4M12 8h.01"/>
        </svg>
        <span>คลิกที่แผนที่เพื่อเพิ่มจุดส่ง</span>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { font-family: 'Kanit', sans-serif; background: #0a0a0f; color: #e4e4e7; overflow: hidden; }

  .app-container { display: flex; height: 100vh; width: 100vw; background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%); }

  .sidebar { width: 420px; background: rgba(15, 15, 25, 0.95); backdrop-filter: blur(20px); border-right: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; z-index: 10; }
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

  .add-form { margin: 0 24px 20px; padding: 20px; animation: slideIn 0.3s ease; }
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
  .priority-selector { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .priority-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 4px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); border: 2px solid transparent; cursor: pointer; transition: all 0.2s; }
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
  .settings-panel { width: 90%; max-width: 450px; max-height: 80vh; overflow-y: auto; padding: 24px; }
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

  .nav-bottom-panel { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); width: calc(100% - 40px); max-width: 600px; padding: 20px; pointer-events: auto; }
  .nav-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; }
  .nav-stat { display: flex; align-items: center; gap: 12px; }
  .nav-stat-icon { width: 44px; height: 44px; background: rgba(0, 255, 136, 0.1); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .nav-stat-icon svg { width: 22px; height: 22px; color: #00ff88; }
  .nav-stat-content { flex: 1; }
  .nav-stat-value { font-size: 18px; font-weight: 700; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; }
  .nav-stat-label { font-size: 11px; color: #71717a; }
  .nav-progress { margin-bottom: 16px; }
  .nav-progress-bar { height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 3px; overflow: hidden; }
  .nav-progress-fill { height: 100%; background: linear-gradient(90deg, #00ff88, #00cc6a); border-radius: 3px; transition: width 0.5s ease; }
  .nav-actions { display: flex; gap: 12px; }
  .nav-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px; border-radius: 12px; font-family: 'Kanit', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }
  .nav-btn svg { width: 20px; height: 20px; }
  .nav-btn-secondary { background: rgba(255, 255, 255, 0.1); color: #a1a1aa; }
  .nav-btn-secondary:hover:not(:disabled) { background: rgba(255, 255, 255, 0.15); color: #e4e4e7; }
  .nav-btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
  .nav-btn-center { background: rgba(59, 130, 246, 0.2); color: #60a5fa; flex: 0 0 auto; width: 56px; }
  .nav-btn-center:hover { background: rgba(59, 130, 246, 0.3); }
  .nav-btn-stop { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }
  .nav-btn-stop:hover { background: rgba(255, 107, 107, 0.3); }

  .toast { position: fixed; top: 24px; right: 24px; display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-radius: 14px; font-size: 14px; font-weight: 500; z-index: 9999; animation: toastIn 0.4s ease; backdrop-filter: blur(20px); }
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
</style>