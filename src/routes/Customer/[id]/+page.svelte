<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/stores';

  const API_URL = 'http://localhost:3000/api';

  let currentUser: any = null;
  let map: any;
  let L: any;

  // Customer location
  let customerLocation: { lat: number; lng: number } | null = null;
  let customerMarker: any = null;
  let customerAddress = '';

  // Drivers
  let availableDrivers: any[] = [];
  let selectedDriver: any = null;

  // Orders
  let myOrders: any[] = [];
  let activeTab: 'order' | 'history' | 'payments' = 'order';

  // UI State
  let isLoading = false;
  let notification = { show: false, message: '', type: 'success' as 'success' | 'error' };
  let orderNotes = '';

  // ==========================================
  // PAYMENT SYSTEM
  // ==========================================
  


  // Payment
  interface PaymentMethod {
    id: string;
    name: string;
    icon: string;
    description: string;
  }

  const paymentMethods: PaymentMethod[] = [
    { id: 'cash', name: 'เงินสด', icon: '💵', description: 'ชำระเงินปลายทาง' },
    { id: 'promptpay', name: 'พร้อมเพย์', icon: '📱', description: 'สแกน QR Code' },
    { id: 'transfer', name: 'โอนเงิน', icon: '🏦', description: 'โอนเข้าบัญชีธนาคาร' },
    { id: 'credit_card', name: 'บัตรเครดิต', icon: '💳', description: 'Visa, Mastercard' }
  ];

  let selectedPayment: PaymentMethod = paymentMethods[0];

  // Payment Modal State
  let showPaymentModal = false;
  let paymentStep: 'method' | 'confirm' | 'qr' | 'upload' | 'success' = 'method';
  let currentOrderForPayment: any = null;
  let paymentProofFile: File | null = null;
  let paymentProofPreview: string = '';
  let transactionRef = '';
  let isProcessingPayment = false;

  // PromptPay Settings
  const promptPaySettings = {
    id: '0812345678',
    name: 'บริษัท เดลิเวอรี่ จำกัด'
  };

  // Bank Settings
  const bankSettings = {
    name: 'ธนาคารกสิกรไทย',
    account: '123-4-56789-0',
    accountName: 'บริษัท เดลิเวอรี่ จำกัด'
  };

  // Payment History
  let paymentHistory: any[] = [];

  // ==========================================
  // FACTORY SHOP CHECKOUT
  // ==========================================
  
  interface FactoryOrderItem {
    id: number;
    name: string;
    price: number;
    quantity: number;
    selectedSize: string;
    image: string;
    unit: string;
  }

  let isCheckoutMode = false;
  let factoryOrderItems: FactoryOrderItem[] = [];
  let productTotal = 0;

  // Computed total
  $: grandTotal = productTotal;

  function logout() {
    localStorage.removeItem('user');
    goto('/');
  }

  function goBack() {
    goto('/factory/' + currentUser.id);
  }

  onMount(async () => {
    const userStr = localStorage.getItem('user');
    if (!userStr) {
      goto('/');
      return;
    }

    currentUser = JSON.parse(userStr);
    
    if (currentUser.role !== 'customer') {
      if (currentUser.role === 'admin') {
        goto(`/Admin/${currentUser.id}`);
      } else {
        goto(`/Home/${currentUser.id}`);
      }
      return;
    }

    const urlId = $page.params.id;
    if (Number(urlId) !== currentUser.id) {
      goto(`/Customer/${currentUser.id}`);
      return;
    }

    // ==========================================
    // CHECK FOR FACTORY SHOP CHECKOUT
    // ==========================================
    const urlParams = new URLSearchParams(window.location.search);
    isCheckoutMode = urlParams.get('checkout') === 'true';

    if (isCheckoutMode) {
      const factoryOrderStr = localStorage.getItem('factory_order');
      if (factoryOrderStr) {
        try {
          const factoryOrder = JSON.parse(factoryOrderStr);
          factoryOrderItems = factoryOrder.items || [];
          productTotal = factoryOrder.total || 0;
          
          activeTab = 'order';
          
          console.log('🛒 Factory checkout loaded:', factoryOrderItems.length, 'items, Total:', productTotal);
        } catch (e) {
          console.error('Error parsing factory order:', e);
        }
      }
    }

    try {
      L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');

      map = L.map('map', {
        zoomControl: false
      }).setView([13.7563, 100.5018], 13);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
        attribution: '© Stadia Maps © OpenMapTiles © OSM',
        maxZoom: 19
      }).addTo(map);

      map.on('click', (e: any) => {
        setCustomerLocation(e.latlng.lat, e.latlng.lng);
      });

      setTimeout(() => map.invalidateSize(), 100);
      setTimeout(() => map.invalidateSize(), 500);

      await loadAvailableDrivers();
      await loadMyOrders();
      await loadPaymentHistory();

    } catch (error) {
      console.error('Map init error:', error);
      showNotification('ไม่สามารถโหลดแผนที่ได้', 'error');
    }
  });

  async function loadAvailableDrivers() {
    try {
      const res = await fetch(`${API_URL}/drivers/available`);
      const data = await res.json();
      if (!data.error) {
        availableDrivers = data;
      }
    } catch (err) {
      console.error('Error loading drivers:', err);
    }
  }

  async function loadMyOrders() {
    try {
      const res = await fetch(`${API_URL}/customer/orders?customer_id=${currentUser.id}`);
      const data = await res.json();
      if (!data.error && Array.isArray(data)) {
        myOrders = data;
      }
    } catch (err) {
      console.error('Error loading orders:', err);
    }
  }

  async function loadPaymentHistory() {
    try {
      const res = await fetch(`${API_URL}/customer/payments?customer_id=${currentUser.id}`);
      const data = await res.json();
      if (!data.error && Array.isArray(data)) {
        paymentHistory = data;
      }
    } catch (err) {
      console.error('Error loading payment history:', err);
    }
  }

  function setCustomerLocation(lat: number, lng: number) {
    customerLocation = { lat, lng };

    if (customerMarker) {
      customerMarker.setLatLng([lat, lng]);
    } else {
      customerMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'customer-marker',
          html: `
            <div class="customer-pin">
              <span>📍</span>
            </div>
          `,
          iconSize: [60, 60],
          iconAnchor: [30, 30]
        }),
        draggable: true
      }).addTo(map);

      customerMarker.on('dragend', (e: any) => {
        const pos = e.target.getLatLng();
        customerLocation = { lat: pos.lat, lng: pos.lng };
        reverseGeocode(pos.lat, pos.lng);
      });
    }

    map.setView([lat, lng], 16, { animate: true });
    reverseGeocode(lat, lng);
  }

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
      const data = await res.json();
      customerAddress = data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch (err) {
      customerAddress = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      showNotification('เบราว์เซอร์ไม่รองรับ GPS', 'error');
      return;
    }

    isLoading = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCustomerLocation(position.coords.latitude, position.coords.longitude);
        isLoading = false;
        showNotification('ระบุตำแหน่งสำเร็จ', 'success');
      },
      (error) => {
        isLoading = false;
        showNotification('ไม่สามารถระบุตำแหน่งได้', 'error');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function selectDriver(driver: any) {
    selectedDriver = driver;
  }

  function selectPaymentMethod(method: PaymentMethod) {
    selectedPayment = method;
  }

  // ==========================================
  // CREATE ORDER WITH PAYMENT
  // ==========================================

  async function createOrder() {
    if (!customerLocation) {
      showNotification('กรุณาปักหมุดตำแหน่งของคุณก่อน', 'error');
      return;
    }

    if (!selectedDriver) {
      showNotification('กรุณาเลือกคนขับ', 'error');
      return;
    }

    isLoading = true;

    try {
      const finalProductTotal = isCheckoutMode ? productTotal : 0;
      const finalTotalAmount = finalProductTotal;

      const orderData: any = {
        customer_id: currentUser.id,
        customer_name: currentUser.name,
        driver_id: selectedDriver.id,
        driver_name: selectedDriver.name,
        address: customerAddress,
        lat: customerLocation.lat,
        lng: customerLocation.lng,
        notes: orderNotes,
        product_total: finalProductTotal,
        total_amount: finalTotalAmount,
        payment_method: selectedPayment.id,
        payment_status: selectedPayment.id === 'cash' ? 'pending' : 'pending',
        order_source: isCheckoutMode ? 'factory_shop' : 'customer'
      };

      if (isCheckoutMode && factoryOrderItems.length > 0) {
        orderData.items = factoryOrderItems;
      }

      const res = await fetch(`${API_URL}/customer/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (selectedPayment.id !== 'cash') {
        currentOrderForPayment = { ...data, total_amount: finalTotalAmount };
        showPaymentModal = true;
        paymentStep = selectedPayment.id === 'promptpay' ? 'qr' : 'upload';
      } else {
        showNotification('สร้างคำสั่งสำเร็จ! ชำระเงินปลายทาง', 'success');
      }
      
      customerLocation = null;
      if (customerMarker) {
        customerMarker.remove();
        customerMarker = null;
      }
      customerAddress = '';
      selectedDriver = null;
      orderNotes = '';
      
      if (isCheckoutMode) {
        localStorage.removeItem('factory_order');
        localStorage.removeItem('factory_cart');
        
        try {
          await fetch(`${API_URL}/cart/clear/${currentUser.id}`, {
            method: 'DELETE'
          });
          console.log('✅ Cart cleared from database');
        } catch (err) {
          console.error('Failed to clear cart from DB:', err);
        }
        
        factoryOrderItems = [];
        productTotal = 0;
        isCheckoutMode = false;
        
        // ✅ FIXED: Use SvelteKit's replaceState instead of window.history.replaceState
        replaceState(`/Customer/${currentUser.id}`, {});
      }
      
      await loadMyOrders();

    } catch (err: any) {
      showNotification(err.message || 'เกิดข้อผิดพลาด', 'error');
    } finally {
      isLoading = false;
    }
  }

  // ==========================================
  // PAYMENT FUNCTIONS
  // ==========================================

  function openPaymentModal(order: any) {
    currentOrderForPayment = order;
    showPaymentModal = true;
    paymentStep = 'method';
    paymentProofFile = null;
    paymentProofPreview = '';
    transactionRef = '';
  }

  function closePaymentModal() {
    showPaymentModal = false;
    currentOrderForPayment = null;
    paymentStep = 'method';
    paymentProofFile = null;
    paymentProofPreview = '';
    transactionRef = '';
  }

  function handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      paymentProofFile = input.files[0];
      
      const reader = new FileReader();
      reader.onload = (e) => {
        paymentProofPreview = e.target?.result as string;
      };
      reader.readAsDataURL(paymentProofFile);
    }
  }

  async function submitPayment() {
    if (!currentOrderForPayment) return;

    isProcessingPayment = true;

    try {
      const paymentAmount = currentOrderForPayment.total_amount || grandTotal;

      const formData = new FormData();
      formData.append('order_id', currentOrderForPayment.id.toString());
      formData.append('customer_id', currentUser.id.toString());
      formData.append('amount', paymentAmount.toString());
      formData.append('payment_method', selectedPayment.id);
      formData.append('transaction_ref', transactionRef);
      
      if (paymentProofFile) {
        formData.append('payment_proof', paymentProofFile);
      }

      const res = await fetch(`${API_URL}/customer/payments`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      paymentStep = 'success';
      await loadMyOrders();
      await loadPaymentHistory();

      setTimeout(() => {
        closePaymentModal();
        showNotification('บันทึกการชำระเงินสำเร็จ! รอการตรวจสอบ', 'success');
      }, 2000);

    } catch (err: any) {
      showNotification(err.message || 'เกิดข้อผิดพลาดในการชำระเงิน', 'error');
    } finally {
      isProcessingPayment = false;
    }
  }

  function getPromptPayQR(amount: number): string {
    return `https://promptpay.io/${promptPaySettings.id}/${amount}.png`;
  }

  async function cancelOrder(orderId: number) {
    if (!confirm('ยืนยันยกเลิกคำสั่ง?')) return;

    try {
      const res = await fetch(`${API_URL}/customer/orders/${orderId}/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: currentUser.id })
      });

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      showNotification('ยกเลิกคำสั่งสำเร็จ', 'success');
      await loadMyOrders();

    } catch (err: any) {
      showNotification(err.message || 'เกิดข้อผิดพลาด', 'error');
    }
  }

  function showNotification(message: string, type: 'success' | 'error') {
    notification = { show: true, message, type };
    setTimeout(() => {
      notification = { ...notification, show: false };
    }, 3000);
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'pending': return 'background: rgba(255, 193, 7, 0.15); color: #ffc107; border-color: rgba(255, 193, 7, 0.3);';
      case 'accepted': return 'background: rgba(59, 130, 246, 0.15); color: #3b82f6; border-color: rgba(59, 130, 246, 0.3);';
      case 'completed': return 'background: rgba(0, 255, 136, 0.15); color: #00ff88; border-color: rgba(0, 255, 136, 0.3);';
      case 'cancelled': return 'background: rgba(239, 68, 68, 0.15); color: #ef4444; border-color: rgba(239, 68, 68, 0.3);';
      default: return 'background: rgba(113, 113, 122, 0.15); color: #71717a;';
    }
  }

  function getStatusText(status: string): string {
    switch (status) {
      case 'pending': return 'รอดำเนินการ';
      case 'accepted': return 'รับงานแล้ว';
      case 'completed': return 'เสร็จสิ้น';
      case 'cancelled': return 'ยกเลิก';
      default: return status;
    }
  }

  function getPaymentStatusColor(status: string): string {
    switch (status) {
      case 'pending': return 'background: rgba(255, 193, 7, 0.15); color: #ffc107;';
      case 'paid': return 'background: rgba(0, 255, 136, 0.15); color: #00ff88;';
      case 'verified': return 'background: rgba(59, 130, 246, 0.15); color: #3b82f6;';
      case 'failed': return 'background: rgba(239, 68, 68, 0.15); color: #ef4444;';
      case 'refunded': return 'background: rgba(168, 85, 247, 0.15); color: #a855f7;';
      default: return 'background: rgba(113, 113, 122, 0.15); color: #71717a;';
    }
  }

  function getPaymentStatusText(status: string): string {
    switch (status) {
      case 'pending': return 'รอชำระ';
      case 'paid': return 'ชำระแล้ว';
      case 'verified': return 'ยืนยันแล้ว';
      case 'failed': return 'ไม่สำเร็จ';
      case 'refunded': return 'คืนเงินแล้ว';
      default: return status;
    }
  }

  function formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString('th-TH', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB'
    }).format(amount);
  }

  $: pendingPaymentOrders = myOrders.filter(o => o.payment_status === 'pending' && o.payment_method !== 'cash');
  $: totalSpent = paymentHistory.filter(p => p.status === 'paid' || p.status === 'verified').reduce((sum, p) => sum + (p.amount || 0), 0);
</script>

<!-- Toast Notification -->
{#if notification.show}
  <div class="toast toast-{notification.type}">
    {notification.message}
  </div>
{/if}

<!-- Payment Modal -->
{#if showPaymentModal && currentOrderForPayment}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" on:click={closePaymentModal}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2>💳 ชำระเงิน</h2>
        <button class="modal-close" on:click={closePaymentModal}>✕</button>
      </div>

      <div class="modal-body">
        <div class="payment-summary">
          <div class="summary-row">
            <span>รหัสคำสั่ง</span>
            <span class="order-id">#{currentOrderForPayment.id}</span>
          </div>
          {#if isCheckoutMode && productTotal > 0}
            <div class="summary-row">
              <span>ค่าสินค้า</span>
              <span>{formatCurrency(productTotal)}</span>
            </div>
          {/if}
          <div class="summary-row total">
            <span>ยอดชำระ</span>
            <span class="amount">{formatCurrency(currentOrderForPayment.total_amount || grandTotal)}</span>
          </div>
        </div>

        {#if paymentStep === 'method'}
          <div class="payment-methods">
            <h3>เลือกวิธีชำระเงิน</h3>
            <div class="methods-grid">
              {#each paymentMethods as method}
                <button 
                  class="method-card" 
                  class:selected={selectedPayment.id === method.id}
                  on:click={() => selectPaymentMethod(method)}
                >
                  <span class="method-icon">{method.icon}</span>
                  <span class="method-name">{method.name}</span>
                  <span class="method-desc">{method.description}</span>
                  {#if selectedPayment.id === method.id}
                    <span class="check-icon">✓</span>
                  {/if}
                </button>
              {/each}
            </div>
            <button 
              class="btn btn-primary" 
              on:click={() => {
                if (selectedPayment.id === 'cash') {
                  closePaymentModal();
                  showNotification('เลือกชำระเงินปลายทาง', 'success');
                } else if (selectedPayment.id === 'promptpay') {
                  paymentStep = 'qr';
                } else {
                  paymentStep = 'upload';
                }
              }}
            >
              ดำเนินการต่อ →
            </button>
          </div>
        {/if}

        {#if paymentStep === 'qr'}
          <div class="qr-section">
            <h3>📱 สแกน QR Code พร้อมเพย์</h3>
            <div class="qr-container">
              <img 
                src={getPromptPayQR(currentOrderForPayment.total_amount || grandTotal)} 
                alt="PromptPay QR" 
                class="qr-image"
              />
            </div>
            <div class="qr-info">
              <p class="qr-name">{promptPaySettings.name}</p>
              <p class="qr-id">พร้อมเพย์: {promptPaySettings.id}</p>
              <p class="qr-amount">จำนวนเงิน: {formatCurrency(currentOrderForPayment.total_amount || grandTotal)}</p>
            </div>
            <div class="qr-actions">
              <button class="btn btn-secondary" on:click={() => paymentStep = 'upload'}>
                📤 อัพโหลดหลักฐาน
              </button>
            </div>
          </div>
        {/if}

        {#if paymentStep === 'upload'}
          <div class="upload-section">
            <h3>📤 อัพโหลดหลักฐานการชำระเงิน</h3>
            
            {#if selectedPayment.id === 'transfer'}
              <div class="bank-info">
                <h4>🏦 ข้อมูลบัญชีธนาคาร</h4>
                <p><strong>ธนาคาร:</strong> {bankSettings.name}</p>
                <p><strong>เลขบัญชี:</strong> {bankSettings.account}</p>
                <p><strong>ชื่อบัญชี:</strong> {bankSettings.accountName}</p>
              </div>
            {/if}

            <div class="upload-area" class:has-file={paymentProofPreview}>
              {#if paymentProofPreview}
                <img src={paymentProofPreview} alt="หลักฐาน" class="proof-preview" />
                <button class="remove-file" on:click={() => { paymentProofFile = null; paymentProofPreview = ''; }}>
                  ✕
                </button>
              {:else}
                <label class="upload-label">
                  <input type="file" accept="image/*" on:change={handleFileUpload} hidden />
                  <span class="upload-icon">📸</span>
                  <span class="upload-text">คลิกเพื่ออัพโหลดหลักฐาน</span>
                  <span class="upload-hint">รองรับไฟล์ JPG, PNG</span>
                </label>
              {/if}
            </div>

            <div class="form-group">
              <label>เลขอ้างอิง / หมายเหตุ (ถ้ามี)</label>
              <input 
                type="text" 
                bind:value={transactionRef} 
                placeholder="เลขที่รายการ, เวลาโอน..."
              />
            </div>

            <button 
              class="btn btn-primary" 
              disabled={!paymentProofFile || isProcessingPayment}
              on:click={submitPayment}
            >
              {#if isProcessingPayment}
                <span class="spinner"></span> กำลังบันทึก...
              {:else}
                ✓ ยืนยันการชำระเงิน
              {/if}
            </button>
          </div>
        {/if}

        {#if paymentStep === 'success'}
          <div class="success-section">
            <div class="success-icon">✅</div>
            <h3>บันทึกการชำระเงินสำเร็จ!</h3>
            <p>ระบบจะตรวจสอบและยืนยันการชำระเงินของคุณ</p>
            <p class="success-note">โดยปกติจะใช้เวลาไม่เกิน 15 นาที</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<div class="app-container">
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <div class="logo-icon">🚗</div>
        <div class="logo-text">
          <h1>Route Optimization</h1>
          <span>{currentUser?.name || 'ลูกค้า'}</span>
        </div>
      </div>
      <button class="back-btn" on:click={goBack} title="กลับไปหน้าร้าน">← กลับ</button>
    </div>

    <div class="stats-row">
      <div class="stat-card purple">
        <span class="stat-icon">📦</span>
        <div class="stat-info">
          <span class="stat-value">{myOrders.length}</span>
          <span class="stat-label">คำสั่งทั้งหมด</span>
        </div>
      </div>
      <div class="stat-card yellow">
        <span class="stat-icon">💰</span>
        <div class="stat-info">
          <span class="stat-value">{pendingPaymentOrders.length}</span>
          <span class="stat-label">รอชำระ</span>
        </div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab" class:active={activeTab === 'order'} on:click={() => activeTab = 'order'}>
        📍 สั่งบริการ
      </button>
      <button class="tab" class:active={activeTab === 'history'} on:click={() => activeTab = 'history'}>
        📋 ประวัติ
        {#if pendingPaymentOrders.length > 0}
          <span class="badge">{pendingPaymentOrders.length}</span>
        {/if}
      </button>
      <button class="tab" class:active={activeTab === 'payments'} on:click={() => activeTab = 'payments'}>
        💳 การชำระ
      </button>
    </div>

    <div class="content-area">
      {#if activeTab === 'order'}
        {#if isCheckoutMode && factoryOrderItems.length > 0}
          <div class="checkout-banner">
            <div class="checkout-header">
              <span class="checkout-icon">🏭</span>
              <div class="checkout-title">
                <h3>สั่งซื้อจาก Factory Shop</h3>
                <span>{factoryOrderItems.length} รายการ</span>
              </div>
            </div>
            
            <div class="order-items-list">
              {#each factoryOrderItems as item}
                <div class="order-item">
                  <span class="item-image">{item.image}</span>
                  <div class="item-details">
                    <span class="item-name">{item.name}</span>
                    <span class="item-size">{item.selectedSize}</span>
                  </div>
                  <div class="item-qty">x{item.quantity}</div>
                  <div class="item-price">{formatCurrency(item.price * item.quantity)}</div>
                </div>
              {/each}
            </div>
            
            <div class="checkout-total">
              <span>รวมค่าสินค้า</span>
              <span class="total-value">{formatCurrency(productTotal)}</span>
            </div>
          </div>
        {/if}

        <div class="section">
          <div class="section-header">
            <span class="step-badge">1</span>
            <h3>ระบุตำแหน่ง</h3>
          </div>
          <p class="section-hint">คลิกแผนที่หรือใช้ GPS เพื่อปักหมุด</p>
          
          <button class="btn btn-gps" on:click={useCurrentLocation} disabled={isLoading}>
            {#if isLoading}
              <span class="spinner"></span> กำลังค้นหา...
            {:else}
              📍 ใช้ตำแหน่งปัจจุบัน
            {/if}
          </button>

          {#if customerLocation}
            <div class="location-info">
              <span class="location-icon">✅</span>
              <div class="location-details">
                <div class="location-coords">{customerLocation.lat.toFixed(6)}, {customerLocation.lng.toFixed(6)}</div>
                <div class="location-address">{customerAddress}</div>
              </div>
            </div>
          {/if}
        </div>

        <div class="section">
          <div class="section-header">
            <span class="step-badge">2</span>
            <h3>เลือกคนขับ</h3>
          </div>
          
          {#if availableDrivers.length === 0}
            <div class="empty-mini">
              <span>😴</span>
              <p>ไม่มีคนขับออนไลน์</p>
            </div>
          {:else}
            <div class="drivers-list">
              {#each availableDrivers as driver}
                <button 
                  class="driver-card" 
                  class:selected={selectedDriver?.id === driver.id}
                  on:click={() => selectDriver(driver)}
                >
                  <div class="driver-avatar">
                    {driver.avatar || '🚗'}
                  </div>
                  <div class="driver-info">
                    <span class="driver-name">{driver.name}</span>
                    <span class="driver-vehicle">{driver.vehicle || 'ยานพาหนะ'}</span>
                  </div>
                  {#if selectedDriver?.id === driver.id}
                    <span class="selected-badge">✓</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="section">
          <div class="section-header">
            <span class="step-badge">3</span>
            <h3>วิธีชำระเงิน</h3>
          </div>
          
          <div class="payment-options">
            {#each paymentMethods as method}
              <button 
                class="payment-card"
                class:selected={selectedPayment.id === method.id}
                on:click={() => selectPaymentMethod(method)}
              >
                <span class="payment-icon">{method.icon}</span>
                <span class="payment-name">{method.name}</span>
                {#if selectedPayment.id === method.id}
                  <span class="payment-check">✓</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <span class="step-badge">4</span>
            <h3>หมายเหตุ (ไม่บังคับ)</h3>
          </div>
          <textarea bind:value={orderNotes} placeholder="รายละเอียดเพิ่มเติม..." rows="2"></textarea>
        </div>

        <div class="order-summary">
          {#if isCheckoutMode && productTotal > 0}
            <div class="summary-line">
              <span>🛒 ค่าสินค้า ({factoryOrderItems.length} รายการ)</span>
              <span>{formatCurrency(productTotal)}</span>
            </div>
          {/if}
          <div class="summary-line total">
            <span>รวมทั้งสิ้น</span>
            <span class="total-amount">{formatCurrency(grandTotal)}</span>
          </div>
        </div>

        <button 
          class="btn btn-submit" 
          on:click={createOrder} 
          disabled={isLoading || !customerLocation || !selectedDriver}
        >
          {#if isLoading}
            <span class="spinner"></span> กำลังสร้างคำสั่ง...
          {:else}
            ✓ ยืนยันคำสั่ง
          {/if}
        </button>

      {:else if activeTab === 'history'}
        <div class="orders-list">
          {#if myOrders.length === 0}
            <div class="empty-state">
              <span>📭</span>
              <p>ยังไม่มีประวัติการสั่ง</p>
            </div>
          {:else}
            {#each myOrders as order}
              <div class="order-card">
                <div class="order-header">
                  <div class="order-id-row">
                    <span class="order-id">#{order.id}</span>
                    {#if order.order_source === 'factory_shop'}
                      <span class="source-tag">🏭 Factory Shop</span>
                    {/if}
                  </div>
                  <div class="order-badges">
                    <span class="order-status" style={getStatusColor(order.status)}>
                      {getStatusText(order.status)}
                    </span>
                    <span class="payment-status" style={getPaymentStatusColor(order.payment_status)}>
                      {getPaymentStatusText(order.payment_status)}
                    </span>
                  </div>
                </div>
                <div class="order-body">
                  <div class="order-row">
                    <span class="row-icon">🚗</span>
                    <span class="row-value">{order.driver_name || 'ยังไม่มีคนขับ'}</span>
                  </div>
                  <div class="order-row">
                    <span class="row-icon">📍</span>
                    <span class="row-value address">{order.address}</span>
                  </div>
                  {#if order.product_total > 0}
                    <div class="order-row">
                      <span class="row-icon">🛒</span>
                      <span class="row-value">ค่าสินค้า: {formatCurrency(order.product_total)}</span>
                    </div>
                  {/if}
                  <div class="order-row">
                    <span class="row-icon">💰</span>
                    <span class="row-value total-highlight">{formatCurrency(order.total_amount || order.product_total || 0)}</span>
                  </div>
                  <div class="order-row">
                    <span class="row-icon">🕐</span>
                    <span class="row-value">{formatDate(order.created_at)}</span>
                  </div>
                </div>
                <div class="order-actions">
                  {#if order.status === 'pending'}
                    <button class="btn-small btn-cancel-order" on:click={() => cancelOrder(order.id)}>
                      ❌ ยกเลิก
                    </button>
                  {/if}
                  {#if order.payment_status === 'pending' && order.payment_method !== 'cash'}
                    <button class="btn-small btn-pay" on:click={() => openPaymentModal(order)}>
                      💳 ชำระเงิน
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </div>

      {:else if activeTab === 'payments'}
        <div class="payments-section">
          <div class="total-spent-card">
            <span class="spent-icon">💸</span>
            <div class="spent-info">
              <span class="spent-label">ยอดใช้จ่ายทั้งหมด</span>
              <span class="spent-value">{formatCurrency(totalSpent)}</span>
            </div>
          </div>

          {#if pendingPaymentOrders.length > 0}
            <div class="pending-section">
              <h3>⏳ รอชำระเงิน ({pendingPaymentOrders.length})</h3>
              {#each pendingPaymentOrders as order}
                <div class="pending-card">
                  <div class="pending-info">
                    <span class="pending-id">#{order.id}</span>
                    <span class="pending-amount">{formatCurrency(order.total_amount || order.product_total || 0)}</span>
                  </div>
                  <button class="btn-pay-now" on:click={() => openPaymentModal(order)}>
                    ชำระเลย
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          <div class="history-section">
            <h3>📜 ประวัติการชำระ</h3>
            {#if paymentHistory.length === 0}
              <div class="empty-mini">
                <span>💳</span>
                <p>ยังไม่มีประวัติการชำระ</p>
              </div>
            {:else}
              {#each paymentHistory as payment}
                <div class="payment-history-card">
                  <div class="ph-left">
                    <span class="ph-icon">
                      {payment.payment_method === 'promptpay' ? '📱' : 
                       payment.payment_method === 'transfer' ? '🏦' : 
                       payment.payment_method === 'credit_card' ? '💳' : '💵'}
                    </span>
                    <div class="ph-info">
                      <span class="ph-order">คำสั่ง #{payment.order_id}</span>
                      <span class="ph-date">{formatDate(payment.created_at)}</span>
                    </div>
                  </div>
                  <div class="ph-right">
                    <span class="ph-amount">{formatCurrency(payment.amount)}</span>
                    <span class="ph-status" style={getPaymentStatusColor(payment.status)}>
                      {getPaymentStatusText(payment.status)}
                    </span>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </aside>

  <div class="map-container">
    <div id="map"></div>
    
    <div class="map-hint glass-card">
      <span>👆</span> คลิกแผนที่เพื่อปักหมุดตำแหน่งของคุณ
    </div>
  </div>
</div>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { font-family: 'Kanit', sans-serif; background: #0a0a0f; color: #e4e4e7; overflow: hidden; }

  .app-container { display: flex; height: 100vh; width: 100vw; background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%); }

  .sidebar { 
    width: 500px; background: rgba(15, 15, 25, 0.95); backdrop-filter: blur(20px); 
    border-right: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; z-index: 10; 
  }

  .sidebar-header { 
    padding: 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); 
    display: flex; justify-content: space-between; align-items: center; 
  }

  .logo { display: flex; align-items: center; gap: 12px; }
  .logo-icon { 
    width: 48px; height: 48px; background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); 
    border-radius: 14px; display: flex; align-items: center; justify-content: center; 
    font-size: 24px; box-shadow: 0 0 30px rgba(0, 255, 136, 0.3); 
  }
  .logo-text h1 { 
    font-size: 20px; font-weight: 700; 
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); 
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; 
  }
  .logo-text span { font-size: 12px; color: #71717a; }

  .back-btn { 
    padding: 8px 16px; border-radius: 10px; background: rgba(0, 255, 136, 0.1); 
    border: 1px solid rgba(0, 255, 136, 0.3); color: #00ff88; font-size: 13px; 
    font-family: 'Kanit', sans-serif; cursor: pointer; transition: all 0.2s;
  }
  .back-btn:hover { background: rgba(0, 255, 136, 0.2); transform: scale(1.05); }

  .stats-row { display: flex; gap: 12px; padding: 16px; }
  .stat-card {
    flex: 1; display: flex; align-items: center; gap: 10px;
    padding: 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .stat-card.purple { background: rgba(0, 255, 136, 0.1); border-color: rgba(0, 255, 136, 0.3); }
  .stat-card.yellow { background: rgba(255, 193, 7, 0.1); border-color: rgba(255, 193, 7, 0.3); }
  .stat-icon { font-size: 24px; }
  .stat-info { display: flex; flex-direction: column; }
  .stat-value { font-size: 20px; font-weight: 700; color: #e4e4e7; }
  .stat-label { font-size: 11px; color: #71717a; }

  .tabs { display: flex; padding: 12px 16px; gap: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
  .tab { 
    flex: 1; padding: 10px; border-radius: 10px; background: rgba(255, 255, 255, 0.03); 
    border: 1px solid rgba(255, 255, 255, 0.05); color: #71717a; font-family: 'Kanit', sans-serif; 
    font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    position: relative;
  }
  .tab:hover { background: rgba(255, 255, 255, 0.05); color: #a1a1aa; }
  .tab.active { background: rgba(0, 255, 136, 0.1); border-color: rgba(0, 255, 136, 0.3); color: #00ff88; }
  .tab .badge {
    position: absolute; top: -6px; right: -6px;
    background: #ef4444; color: white; font-size: 10px;
    width: 18px; height: 18px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
  }

  .content-area { flex: 1; overflow-y: auto; padding: 16px; }
  .content-area::-webkit-scrollbar { width: 6px; }
  .content-area::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }

  .section { 
    background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); 
    border-radius: 14px; padding: 16px; margin-bottom: 12px; 
  }
  .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .step-badge { 
    width: 26px; height: 26px; background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); 
    border-radius: 50%; display: flex; align-items: center; justify-content: center; 
    font-size: 13px; font-weight: 700; color: #0a0a0f; 
  }
  .section-header h3 { font-size: 14px; font-weight: 600; color: #e4e4e7; }
  .section-hint { font-size: 11px; color: #71717a; margin-bottom: 10px; }

  .btn { 
    display: flex; align-items: center; justify-content: center; gap: 8px; 
    padding: 12px 16px; border-radius: 10px; font-family: 'Kanit', sans-serif; 
    font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s; width: 100%;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-gps { 
    background: rgba(59, 130, 246, 0.15); color: #60a5fa; 
    border: 1px solid rgba(59, 130, 246, 0.3); 
  }
  .btn-gps:hover:not(:disabled) { background: rgba(59, 130, 246, 0.25); }

  .btn-submit { 
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); 
    color: #0a0a0f; box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3); margin-top: 8px;
  }
  .btn-submit:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 30px rgba(0, 255, 136, 0.4); }

  .btn-primary {
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
    color: #0a0a0f; margin-top: 16px;
  }
  .btn-primary:hover:not(:disabled) { transform: translateY(-2px); }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.1); color: #e4e4e7;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .btn-small {
    padding: 6px 12px; font-size: 12px; border-radius: 8px;
    font-family: 'Kanit', sans-serif; cursor: pointer; border: none;
  }
  .btn-cancel-order { background: rgba(239, 68, 68, 0.15); color: #f87171; }
  .btn-pay { background: rgba(0, 255, 136, 0.15); color: #00ff88; }

  .location-info { 
    display: flex; align-items: flex-start; gap: 12px; 
    padding: 12px; background: rgba(0, 255, 136, 0.05); 
    border: 1px solid rgba(0, 255, 136, 0.2); border-radius: 10px; margin-top: 12px;
  }
  .location-icon { font-size: 20px; }
  .location-details { flex: 1; }
  .location-coords { font-size: 11px; color: #00ff88; font-family: monospace; margin-bottom: 4px; }
  .location-address { font-size: 12px; color: #a1a1aa; line-height: 1.4; }

  .selected-check {
    position: absolute; top: 8px; right: 8px;
    width: 20px; height: 20px; background: #00ff88; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: #0a0a0f; font-size: 12px;
  }

  .drivers-list { display: flex; flex-direction: column; gap: 8px; }
  .driver-card { 
    display: flex; align-items: center; gap: 12px; padding: 10px; 
    background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); 
    border-radius: 12px; cursor: pointer; transition: all 0.2s; text-align: left;
  }
  .driver-card:hover { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.15); }
  .driver-card.selected { background: rgba(0, 255, 136, 0.1); border-color: rgba(0, 255, 136, 0.4); }
  .driver-avatar { 
    width: 40px; height: 40px; background: linear-gradient(135deg, #00ff88, #00cc6a); 
    border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; 
  }
  .driver-info { flex: 1; }
  .driver-name { font-size: 13px; font-weight: 600; color: #e4e4e7; display: block; }
  .driver-vehicle { font-size: 11px; color: #71717a; }
  .selected-badge { 
    width: 24px; height: 24px; background: #00ff88; border-radius: 50%; 
    display: flex; align-items: center; justify-content: center; color: #0a0a0f; font-size: 12px; 
  }

  .payment-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .payment-card {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 12px 8px; background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;
    cursor: pointer; transition: all 0.2s; position: relative;
  }
  .payment-card:hover { background: rgba(255, 255, 255, 0.05); }
  .payment-card.selected { background: rgba(0, 255, 136, 0.1); border-color: rgba(0, 255, 136, 0.4); }
  .payment-icon { font-size: 20px; }
  .payment-name { font-size: 11px; color: #a1a1aa; }
  .payment-check {
    position: absolute; top: 4px; right: 4px;
    width: 16px; height: 16px; background: #00ff88; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: #0a0a0f; font-size: 10px;
  }

  textarea { 
    width: 100%; padding: 10px; background: rgba(0, 0, 0, 0.3); 
    border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; 
    color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 13px; resize: none; 
  }
  textarea:focus { outline: none; border-color: #00ff88; }
  textarea::placeholder { color: #52525b; }

  .order-summary {
    background: rgba(0, 255, 136, 0.05); border: 1px solid rgba(0, 255, 136, 0.2);
    border-radius: 12px; padding: 12px; margin-top: 12px;
  }

  .checkout-banner {
    background: linear-gradient(135deg, rgba(0, 255, 136, 0.1), rgba(6, 95, 70, 0.15));
    border: 1px solid rgba(0, 255, 136, 0.3);
    border-radius: 16px; padding: 16px; margin-bottom: 16px;
  }
  .checkout-header {
    display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
    padding-bottom: 12px; border-bottom: 1px solid rgba(0, 255, 136, 0.2);
  }
  .checkout-icon { font-size: 32px; }
  .checkout-title h3 { font-size: 16px; color: #00ff88; font-weight: 600; margin: 0; }
  .checkout-title span { font-size: 12px; color: #71717a; }
  
  .order-items-list {
    display: flex; flex-direction: column; gap: 8px;
    max-height: 200px; overflow-y: auto;
    padding-right: 8px;
  }
  .order-items-list::-webkit-scrollbar { width: 4px; }
  .order-items-list::-webkit-scrollbar-thumb { background: rgba(0, 255, 136, 0.3); border-radius: 2px; }
  
  .order-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px; background: rgba(0, 0, 0, 0.2);
    border-radius: 10px;
  }
  .item-image { font-size: 28px; }
  .item-details { flex: 1; display: flex; flex-direction: column; }
  .item-name { font-size: 13px; color: #e4e4e7; font-weight: 500; }
  .item-size { font-size: 10px; color: #71717a; }
  .item-qty {
    padding: 4px 8px; background: rgba(0, 255, 136, 0.15);
    border-radius: 6px; font-size: 12px; color: #00ff88; font-weight: 600;
  }
  .item-price { font-size: 14px; color: #00ff88; font-weight: 600; min-width: 80px; text-align: right; }
  
  .checkout-total {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 12px; padding-top: 12px;
    border-top: 1px dashed rgba(0, 255, 136, 0.3);
  }
  .checkout-total span:first-child { font-size: 13px; color: #a1a1aa; }
  .checkout-total .total-value { font-size: 20px; font-weight: 700; color: #00ff88; }

  .order-id-row { display: flex; align-items: center; gap: 8px; }
  .source-tag {
    padding: 2px 8px; background: rgba(0, 255, 136, 0.15);
    border: 1px solid rgba(0, 255, 136, 0.3);
    border-radius: 10px; font-size: 10px; color: #00ff88;
  }
  .summary-line {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 0; font-size: 13px; color: #a1a1aa;
  }
  .summary-line.total {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin-top: 8px; padding-top: 12px;
    font-weight: 600; color: #e4e4e7;
  }
  .total-amount { color: #00ff88; font-size: 18px; }

  .orders-list { display: flex; flex-direction: column; gap: 12px; }
  .order-card { 
    background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); 
    border-radius: 14px; padding: 14px; 
  }
  .order-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .order-id { font-size: 14px; font-weight: 700; color: #00ff88; }
  .order-badges { display: flex; gap: 6px; }
  .order-status, .payment-status { 
    padding: 4px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; 
    border: 1px solid transparent;
  }
  .order-body { display: flex; flex-direction: column; gap: 6px; }
  .order-row { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; }
  .row-icon { width: 20px; text-align: center; }
  .row-value { color: #a1a1aa; flex: 1; }
  .row-value.address { 
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; 
    overflow: hidden; line-height: 1.4;
  }
  .row-value.total-highlight { color: #00ff88; font-weight: 600; font-size: 14px; }
  .order-actions { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }

  .payments-section { display: flex; flex-direction: column; gap: 16px; }
  
  .total-spent-card {
    display: flex; align-items: center; gap: 16px; padding: 20px;
    background: linear-gradient(135deg, rgba(0, 255, 136, 0.2), rgba(0, 204, 106, 0.1));
    border: 1px solid rgba(0, 255, 136, 0.3); border-radius: 16px;
  }
  .spent-icon { font-size: 36px; }
  .spent-info { display: flex; flex-direction: column; }
  .spent-label { font-size: 12px; color: #a1a1aa; }
  .spent-value { font-size: 28px; font-weight: 700; color: #00ff88; }

  .pending-section h3, .history-section h3 {
    font-size: 14px; color: #e4e4e7; margin-bottom: 10px;
  }
  .pending-card {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px; background: rgba(255, 193, 7, 0.05);
    border: 1px solid rgba(255, 193, 7, 0.2); border-radius: 10px;
    margin-bottom: 8px;
  }
  .pending-info { display: flex; align-items: center; gap: 12px; }
  .pending-id { font-size: 13px; color: #ffc107; font-weight: 600; }
  .pending-amount { font-size: 14px; color: #e4e4e7; }
  .btn-pay-now {
    padding: 6px 14px; background: rgba(0, 255, 136, 0.15);
    border: 1px solid rgba(0, 255, 136, 0.3); color: #00ff88;
    border-radius: 8px; font-size: 12px; font-family: 'Kanit', sans-serif;
    cursor: pointer; transition: all 0.2s;
  }
  .btn-pay-now:hover { background: rgba(0, 255, 136, 0.25); }

  .payment-history-card {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px; background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;
    margin-bottom: 8px;
  }
  .ph-left { display: flex; align-items: center; gap: 12px; }
  .ph-icon { font-size: 24px; }
  .ph-info { display: flex; flex-direction: column; }
  .ph-order { font-size: 13px; color: #e4e4e7; }
  .ph-date { font-size: 11px; color: #71717a; }
  .ph-right { text-align: right; }
  .ph-amount { font-size: 14px; font-weight: 600; color: #e4e4e7; display: block; }
  .ph-status { font-size: 10px; padding: 2px 8px; border-radius: 10px; }

  .empty-state { text-align: center; padding: 40px 20px; }
  .empty-state span { font-size: 48px; display: block; margin-bottom: 12px; }
  .empty-state p { font-size: 14px; color: #71717a; }
  .empty-mini { text-align: center; padding: 20px; }
  .empty-mini span { font-size: 32px; display: block; margin-bottom: 8px; }
  .empty-mini p { font-size: 12px; color: #71717a; }

  .spinner { 
    width: 16px; height: 16px; border: 2px solid rgba(255, 255, 255, 0.3); 
    border-top-color: currentColor; border-radius: 50%; animation: spin 0.8s linear infinite; 
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .toast { 
    position: fixed; top: 20px; right: 20px; padding: 14px 20px; 
    border-radius: 12px; font-size: 14px; z-index: 9999; animation: slideIn 0.3s ease; 
  }
  @keyframes slideIn { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
  .toast-success { background: rgba(0, 255, 136, 0.15); border: 1px solid rgba(0, 255, 136, 0.3); color: #00ff88; }
  .toast-error { background: rgba(255, 107, 107, 0.15); border: 1px solid rgba(255, 107, 107, 0.3); color: #ff6b6b; }

  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center;
    z-index: 9999; padding: 20px;
  }
  .modal-content {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px;
    width: 100%; max-width: 420px; max-height: 90vh; overflow-y: auto;
  }
  .modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .modal-header h2 { font-size: 18px; color: #e4e4e7; }
  .modal-close {
    width: 32px; height: 32px; background: rgba(255, 255, 255, 0.1);
    border: none; border-radius: 8px; color: #71717a; font-size: 16px;
    cursor: pointer; transition: all 0.2s;
  }
  .modal-close:hover { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }
  .modal-body { padding: 20px; }

  .payment-summary {
    background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px; padding: 16px; margin-bottom: 20px;
  }
  .payment-summary .summary-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; font-size: 13px; color: #a1a1aa;
  }
  .payment-summary .summary-row.total {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin-top: 8px; padding-top: 12px;
  }
  .amount { font-size: 20px; font-weight: 700; color: #00ff88; }

  .payment-methods h3 { font-size: 14px; color: #e4e4e7; margin-bottom: 12px; }
  .methods-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .method-card {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 16px; background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;
    cursor: pointer; transition: all 0.2s; position: relative;
  }
  .method-card:hover { background: rgba(255, 255, 255, 0.05); }
  .method-card.selected { background: rgba(0, 255, 136, 0.1); border-color: rgba(0, 255, 136, 0.4); }
  .method-icon { font-size: 28px; }
  .method-name { font-size: 13px; font-weight: 600; color: #e4e4e7; }
  .method-desc { font-size: 10px; color: #71717a; text-align: center; }
  .check-icon {
    position: absolute; top: 8px; right: 8px;
    width: 22px; height: 22px; background: #00ff88; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: #0a0a0f; font-size: 14px;
  }

  .qr-section { text-align: center; }
  .qr-section h3 { font-size: 14px; color: #e4e4e7; margin-bottom: 16px; }
  .qr-container {
    background: white; padding: 16px; border-radius: 16px;
    display: inline-block; margin-bottom: 16px;
  }
  .qr-image { width: 200px; height: 200px; }
  .qr-info { margin-bottom: 16px; }
  .qr-name { font-size: 14px; color: #e4e4e7; font-weight: 600; }
  .qr-id { font-size: 12px; color: #71717a; margin: 4px 0; }
  .qr-amount { font-size: 16px; color: #00ff88; font-weight: 700; }
  .qr-actions { display: flex; justify-content: center; }

  .upload-section h3 { font-size: 14px; color: #e4e4e7; margin-bottom: 16px; }
  .bank-info {
    background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 12px; padding: 16px; margin-bottom: 16px;
  }
  .bank-info h4 { font-size: 13px; color: #60a5fa; margin-bottom: 8px; }
  .bank-info p { font-size: 12px; color: #a1a1aa; margin: 4px 0; }
  
  .upload-area {
    border: 2px dashed rgba(255, 255, 255, 0.2); border-radius: 12px;
    padding: 30px; text-align: center; margin-bottom: 16px;
    position: relative; transition: all 0.2s;
  }
  .upload-area:hover { border-color: rgba(0, 255, 136, 0.5); }
  .upload-area.has-file { border-style: solid; border-color: rgba(0, 255, 136, 0.3); padding: 10px; }
  .upload-label { cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .upload-icon { font-size: 36px; }
  .upload-text { font-size: 13px; color: #e4e4e7; }
  .upload-hint { font-size: 11px; color: #71717a; }
  .proof-preview { max-width: 100%; max-height: 200px; border-radius: 8px; }
  .remove-file {
    position: absolute; top: 8px; right: 8px;
    width: 28px; height: 28px; background: rgba(239, 68, 68, 0.8);
    border: none; border-radius: 50%; color: white; font-size: 14px;
    cursor: pointer;
  }

  .form-group { margin-bottom: 16px; }
  .form-group label { display: block; font-size: 12px; color: #71717a; margin-bottom: 6px; }
  .form-group input {
    width: 100%; padding: 10px 12px; background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px;
    color: #e4e4e7; font-size: 13px; font-family: 'Kanit', sans-serif;
  }
  .form-group input:focus { outline: none; border-color: #00ff88; }

  .success-section { text-align: center; padding: 30px 0; }
  .success-icon { font-size: 64px; margin-bottom: 16px; }
  .success-section h3 { font-size: 18px; color: #00ff88; margin-bottom: 8px; }
  .success-section p { font-size: 13px; color: #a1a1aa; }
  .success-note { font-size: 11px; color: #71717a; margin-top: 8px; }

  .map-container { flex: 1; position: relative; }
  #map { width: 100%; height: 100%; }
  
  .map-hint { 
    position: absolute; bottom: 20px; left: 20px; display: flex; align-items: center; gap: 10px; 
    padding: 12px 18px; background: rgba(15, 15, 25, 0.9); backdrop-filter: blur(10px); 
    border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; 
    font-size: 13px; color: #a1a1aa; z-index: 1000;
  }

  .glass-card { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.08); }

  :global(.leaflet-container) { height: 100% !important; background: #0a0a0f; }
  :global(.customer-pin) { 
    display: flex; flex-direction: column; align-items: center; 
    padding: 8px 12px; background: linear-gradient(135deg, #00ff88, #00cc6a); 
    border-radius: 12px; border: 3px solid white; 
    box-shadow: 0 4px 20px rgba(0, 255, 136, 0.5); animation: bounce 0.5s ease;
  }
  :global(.customer-pin span) { font-size: 24px; }
  :global(.pin-label) { font-size: 10px; color: #0a0a0f; font-weight: 600; margin-top: 4px; white-space: nowrap; }
  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }

  @media (max-width: 768px) {
    .app-container { flex-direction: column; }
    .sidebar { width: 100%; height: 55vh; border-right: none; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
    .map-container { height: 45vh; }
    .stats-row { flex-wrap: wrap; }
    .stat-card { flex: 1 1 calc(50% - 6px); }
  }
</style>