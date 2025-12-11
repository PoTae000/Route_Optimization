<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  const API_URL = 'http://localhost:3000/api';

  // ==================== TYPES ====================
  interface Product {
    id: number;
    name: string;
    description: string;
    price: number;
    unit: string;
    minOrder: number;
    image: string;
    category: string;
    sizes: string[];
    inStock: boolean;
    popular?: boolean;
    new?: boolean;
  }

  interface CartItem extends Product {
    db_id?: number;
    quantity: number;
    selectedSize: string;
  }

  // ==================== STATE ====================
  let currentUser: any = null;
  let products: Product[] = [];
  let cart: CartItem[] = [];
  let selectedCategory = 'all';
  let searchQuery = '';
  let showCart = false;
  let showProductModal = false;
  let selectedProduct: Product | null = null;
  let selectedSize = '';
  let quantity = 1;
  let notification = { show: false, message: '', type: 'success' };
  let isLoading = true;
  let cartLoaded = false;
  let isSavingCart = false;
  let useDBCart = true;

  const categories = [
    { id: 'all', name: 'ทั้งหมด', icon: '📦' },
    { id: 'shipping', name: 'กล่องพัสดุ', icon: '🚚' },
    { id: 'food', name: 'กล่องอาหาร', icon: '🍱' },
    { id: 'gift', name: 'กล่องของขวัญ', icon: '🎁' },
    { id: 'custom', name: 'กล่องสั่งทำ', icon: '✨' },
    { id: 'packaging', name: 'บรรจุภัณฑ์', icon: '📋' }
  ];

  const fallbackProducts: Product[] = [
    { id: 1, name: 'กล่องพัสดุ Size S', description: 'กล่องกระดาษลูกฟูก 3 ชั้น แข็งแรง ทนทาน', price: 8, unit: 'ใบ', minOrder: 50, image: '📦', category: 'shipping', sizes: ['14x20x6 cm', '17x25x9 cm'], inStock: true, popular: true },
    { id: 2, name: 'กล่องพัสดุ Size M', description: 'กล่องกระดาษลูกฟูก 3 ชั้น เหมาะสำหรับพัสดุขนาดกลาง', price: 12, unit: 'ใบ', minOrder: 50, image: '📦', category: 'shipping', sizes: ['20x30x15 cm', '25x35x15 cm'], inStock: true },
    { id: 3, name: 'กล่องพัสดุ Size L', description: 'กล่องกระดาษลูกฟูก 5 ชั้น แข็งแรงพิเศษ', price: 18, unit: 'ใบ', minOrder: 30, image: '📦', category: 'shipping', sizes: ['30x40x20 cm', '35x45x25 cm'], inStock: true },
    { id: 4, name: 'กล่องพัสดุ Size XL', description: 'กล่องลูกฟูก 5 ชั้น ขนาดใหญ่พิเศษ', price: 35, unit: 'ใบ', minOrder: 20, image: '📦', category: 'shipping', sizes: ['40x50x30 cm', '50x60x40 cm'], inStock: true },
    { id: 5, name: 'กล่องอาหาร Kraft', description: 'กล่องกระดาษคราฟท์ใส่อาหาร Food Grade', price: 5, unit: 'ใบ', minOrder: 100, image: '🍱', category: 'food', sizes: ['500ml', '700ml', '1000ml'], inStock: true, popular: true },
    { id: 6, name: 'กล่องเค้ก 1 ปอนด์', description: 'กล่องใส่เค้กพร้อมหน้าต่างใส ดีไซน์สวยงาม', price: 15, unit: 'ใบ', minOrder: 50, image: '🎂', category: 'food', sizes: ['1 ปอนด์', '2 ปอนด์'], inStock: true, new: true },
    { id: 7, name: 'กล่องข้าว 2 ช่อง', description: 'กล่องใส่อาหาร 2 ช่อง มีฝาปิด กันรั่ว', price: 4, unit: 'ใบ', minOrder: 100, image: '🍱', category: 'food', sizes: ['S', 'M', 'L'], inStock: true },
    { id: 8, name: 'กล่องของขวัญ Premium', description: 'กล่องของขวัญกระดาษแข็ง พร้อมฝาแม่เหล็ก', price: 45, unit: 'ใบ', minOrder: 20, image: '🎁', category: 'gift', sizes: ['S (15x15x10)', 'M (20x20x15)', 'L (25x25x20)'], inStock: true, popular: true },
    { id: 9, name: 'กล่องของขวัญ Ribbon', description: 'กล่องของขวัญพร้อมริบบิ้น สีสันสดใส', price: 35, unit: 'ใบ', minOrder: 30, image: '🎀', category: 'gift', sizes: ['S', 'M', 'L'], inStock: true },
    { id: 10, name: 'กล่องสั่งทำ พิมพ์โลโก้', description: 'กล่องกระดาษสั่งทำพิเศษ พิมพ์โลโก้แบรนด์ได้', price: 25, unit: 'ใบ', minOrder: 100, image: '✨', category: 'custom', sizes: ['ตามสั่ง'], inStock: true, new: true },
    { id: 11, name: 'กล่อง Die-Cut', description: 'กล่องไดคัทรูปทรงพิเศษ ออกแบบได้ตามต้องการ', price: 30, unit: 'ใบ', minOrder: 200, image: '⭐', category: 'custom', sizes: ['ตามสั่ง'], inStock: true },
    { id: 12, name: 'ถุงกระดาษคราฟท์', description: 'ถุงกระดาษคราฟท์หูเชือก แข็งแรง', price: 8, unit: 'ใบ', minOrder: 100, image: '🛍️', category: 'packaging', sizes: ['S (20x10x25)', 'M (25x12x30)', 'L (30x15x35)'], inStock: true },
    { id: 13, name: 'กระดาษห่อของ Kraft', description: 'กระดาษคราฟท์สำหรับห่อของ หนา 125 แกรม', price: 150, unit: 'ม้วน', minOrder: 5, image: '📜', category: 'packaging', sizes: ['50cm x 50m', '100cm x 50m'], inStock: true },
    { id: 14, name: 'พลาสติกกันกระแทก', description: 'Bubble Wrap สำหรับห่อสินค้าแตกง่าย', price: 200, unit: 'ม้วน', minOrder: 3, image: '🔵', category: 'packaging', sizes: ['50cm x 50m', '100cm x 50m'], inStock: true },
    { id: 15, name: 'เทปกาว OPP', description: 'เทปกาวใส OPP สำหรับปิดกล่อง แข็งแรงทนทาน', price: 25, unit: 'ม้วน', minOrder: 36, image: '📎', category: 'packaging', sizes: ['2 นิ้ว x 100 หลา'], inStock: true }
  ];

  $: filteredProducts = products.filter(p => {
    const matchCategory = selectedCategory === 'all' || p.category === selectedCategory;
    const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                       p.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  $: cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  $: cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  onMount(async () => {
    document.body.style.overflow = '';
    document.body.style.overflowX = 'hidden';
    document.body.style.overflowY = 'auto';
    document.documentElement.style.overflow = '';
    window.scrollTo(0, 0);

    const userStr = localStorage.getItem('user');
    if (userStr) {
      currentUser = JSON.parse(userStr);
      const dbSuccess = await loadCartFromDB();
      if (!dbSuccess) {
        useDBCart = false;
        const savedCart = localStorage.getItem('factory_cart');
        if (savedCart) {
          try {
            cart = JSON.parse(savedCart);
            console.log('🛒 Cart loaded from localStorage (DB unavailable):', cart.length, 'items');
          } catch (e) {
            cart = [];
          }
        }
      }
    } else {
      const savedCart = localStorage.getItem('factory_cart');
      if (savedCart) {
        try {
          cart = JSON.parse(savedCart);
          console.log('🛒 Cart loaded from localStorage:', cart.length, 'items');
        } catch (e) {
          cart = [];
        }
      }
    }
    
    cartLoaded = true;
    await loadProducts(true);
  });

  $: if (typeof window !== 'undefined' && cartLoaded && cart) {
    localStorage.setItem('factory_cart', JSON.stringify(cart));
  }

  async function loadCartFromDB(): Promise<boolean> {
    if (!currentUser) return false;
    
    try {
      const response = await fetch(`${API_URL}/cart/${currentUser.id}`);      
      if (!response.ok) {
        console.error('❌ Cart API returned error status:', response.status);
        return false;
      }
      
      const text = await response.text();
      
      if (!text || text.trim() === '') {
        console.error('❌ Cart API returned empty response');
        return false;
      }
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('❌ Cart API returned invalid JSON:', text.substring(0, 100));
        return false;
      }
      
      if (data.error) {
        console.error('❌ Cart DB Error:', data.error);
        return false;
      }
      
      if (Array.isArray(data)) {
        cart = data.map(item => ({
          db_id: item.id,
          id: item.product_id,
          name: item.product_name,
          price: parseFloat(item.product_price),
          image: item.product_image || '📦',
          unit: item.product_unit || 'ชิ้น',
          quantity: item.quantity,
          selectedSize: item.selected_size,
          minOrder: item.min_order || 1,
          description: '',
          category: '',
          sizes: [item.selected_size],
          inStock: true
        }));
        console.log('🛒 Cart loaded from DB:', cart.length, 'items');
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Failed to load cart from DB:', error);
      return false;
    }
  }

  async function addToCartDB(item: CartItem) {
    if (!currentUser) return;
    
    try {
      const response = await fetch(`${API_URL}/cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: currentUser.id,
          product_id: item.id,
          product_name: item.name,
          product_price: item.price,
          product_image: item.image,
          product_unit: item.unit,
          quantity: item.quantity,
          selected_size: item.selectedSize,
          min_order: item.minOrder
        })
      });
      
      if (!response.ok) {
        console.error('❌ Cart API POST error status:', response.status);
        throw new Error('API error');
      }
      
      const text = await response.text();
      if (!text || text.trim() === '') {
        console.error('❌ Cart API POST returned empty response');
        throw new Error('Empty response');
      }
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('❌ Cart API POST returned invalid JSON');
        throw new Error('Invalid JSON');
      }
      
      if (data.error) {
        console.error('❌ Cart API Error:', data.error);
        console.log('📦 Fallback to localStorage...');
        useDBCart = false;
        addToCartLocal(item);
        return;
      }
      
      console.log('✅ Added to cart DB:', data);
      await loadCartFromDB();
    } catch (error) {
      console.error('❌ Failed to add to cart DB:', error);
      console.log('📦 Fallback to localStorage...');
      useDBCart = false;
      addToCartLocal(item);
    }
  }

  function addToCartLocal(item: CartItem) {
    const existingIndex = cart.findIndex(
      c => c.id === item.id && c.selectedSize === item.selectedSize
    );

    if (existingIndex >= 0) {
      cart[existingIndex].quantity += item.quantity;
      cart = [...cart];
    } else {
      cart = [...cart, item];
    }
    
    localStorage.setItem('factory_cart', JSON.stringify(cart));
    console.log('💾 Cart saved to localStorage:', cart.length, 'items');
  }

  async function updateCartItemDB(db_id: number, quantity: number) {
    if (!currentUser || !db_id || !useDBCart) return;
    
    try {
      const response = await fetch(`${API_URL}/cart/${db_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity })
      });
      
      if (response.ok) {
        console.log('✅ Updated cart item:', db_id);
      }
    } catch (error) {
      console.error('❌ Failed to update cart item:', error);
    }
  }

  async function removeFromCartDB(db_id: number) {
    if (!currentUser || !db_id || !useDBCart) return;
    
    try {
      const response = await fetch(`${API_URL}/cart/${db_id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        console.log('✅ Removed from cart DB:', db_id);
      }
    } catch (error) {
      console.error('❌ Failed to remove from cart:', error);
    }
  }

  async function clearCartDB() {
    if (!currentUser || !useDBCart) return;
    
    try {
      await fetch(`${API_URL}/cart/clear/${currentUser.id}`, {
        method: 'DELETE'
      });
      console.log('✅ Cart cleared');
    } catch (error) {
      console.error('❌ Failed to clear cart:', error);
    }
  }

  async function loadProducts(forceRefresh = false) {
    isLoading = true;
    
    if (forceRefresh) {
      products = [];
    }
    
    try {
      const timestamp = forceRefresh ? `?t=${Date.now()}` : '';
      const response = await fetch(`${API_URL}/products${timestamp}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      
      if (!response.ok) {
        throw new Error('API response not ok');
      }
      
      const data = await response.json();
      
      if (Array.isArray(data) && data.length > 0) {
        products = data;
        console.log(`✅ Loaded ${products.length} products from API`);
      } else {
        console.log('⚠️ No products from API, using fallback');
        products = fallbackProducts;
      }
    } catch (error) {
      console.error('❌ Failed to load products:', error);
      products = fallbackProducts;
    }
    isLoading = false;
  }

  function logout() {
    localStorage.removeItem('user');
    currentUser = null;
    goto('/');
  }

  function showNotification(message: string, type = 'success') {
    notification = { show: true, message, type };
    setTimeout(() => notification.show = false, 3000);
  }

  function openProductModal(product: Product) {
    selectedProduct = product;
    selectedSize = product.sizes[0];
    quantity = product.minOrder;
    showProductModal = true;
  }

  function closeProductModal() {
    showProductModal = false;
    selectedProduct = null;
  }

  // ✅ FIXED: เก็บชื่อสินค้าก่อน close modal เพื่อป้องกัน null error
  function addToCart() {
    if (!selectedProduct) return;

    // เก็บชื่อไว้ก่อน เพราะ closeProductModal จะ set selectedProduct = null
    const productName = selectedProduct.name;

    const newItem: CartItem = {
      ...selectedProduct,
      quantity,
      selectedSize
    };

    if (currentUser && useDBCart) {
      addToCartDB(newItem);
    } else {
      addToCartLocal(newItem);
    }

    closeProductModal();
    showNotification(`เพิ่ม ${productName} ลงตะกร้าแล้ว! 🛒`);
  }

  function removeFromCart(index: number) {
    const item = cart[index];
    
    if (currentUser && item.db_id && useDBCart) {
      removeFromCartDB(item.db_id);
    }
    
    cart = cart.filter((_, i) => i !== index);
  }

  function updateQuantity(index: number, newQty: number) {
    if (newQty >= cart[index].minOrder) {
      cart[index].quantity = newQty;
      
      if (currentUser && cart[index].db_id && useDBCart) {
        updateCartItemDB(cart[index].db_id!, newQty);
      }
      
      cart = [...cart];
    }
  }

  function proceedToCheckout() {
    if (cart.length === 0) {
      showNotification('กรุณาเลือกสินค้าก่อน', 'error');
      return;
    }

    if (!currentUser) {
      showNotification('กรุณาเข้าสู่ระบบก่อนสั่งซื้อ', 'error');
      setTimeout(() => goto('/'), 1500);
      return;
    }

    const orderData = {
      items: cart.map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        selectedSize: item.selectedSize,
        image: item.image,
        unit: item.unit
      })),
      total: cartTotal,
      orderDate: new Date().toISOString(),
      source: 'factory_shop'
    };
    
    localStorage.setItem('factory_order', JSON.stringify(orderData));
    goto(`/Customer/${currentUser.id}?checkout=true`);
  }

  async function onCheckoutSuccess() {
    if (currentUser && useDBCart) {
      await clearCartDB();
    }
    localStorage.removeItem('factory_cart');
    cart = [];
  }

  function goToLogin() {
    goto('/');
  }

  function closeCart() {
    showCart = false;
  }
</script>

<div class="factory-shop">
  <div class="bg-effects">
    <div class="gradient-orb orb1"></div>
    <div class="gradient-orb orb2"></div>
    <div class="gradient-orb orb3"></div>
    <div class="grid-pattern"></div>
  </div>

  <header class="header">
    <div class="header-content">
      <div class="logo">
        <span class="logo-icon">🏭</span>
        <div class="logo-text">
          <h1>BOX FACTORY</h1>
          <span>โรงงานกล่องกระดาษครบวงจร</span>
        </div>
      </div>

      <div class="search-bar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="text" placeholder="ค้นหาสินค้า..." bind:value={searchQuery} />
      </div>

      <div class="header-actions">
        <button class="refresh-btn" on:click={() => loadProducts(true)} title="รีเฟรชสินค้า">🔄</button>
        
        <button class="cart-btn" on:click={() => showCart = true}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
          {#if cartItemCount > 0}
            <span class="cart-badge">{cartItemCount}</span>
          {/if}
        </button>

        {#if currentUser}
          <div class="user-info">
            <span class="user-avatar">{currentUser.avatar || '👤'}</span>
            <span class="user-name">{currentUser.name}</span>
            <button class="logout-btn" on:click={logout}>ออก</button>
          </div>
        {:else}
          <button class="login-btn" on:click={goToLogin}>เข้าสู่ระบบ</button>
        {/if}
      </div>
    </div>
  </header>

  <section class="hero">
    <div class="hero-content">
      <div class="hero-badge">🏆 มาตรฐาน ISO 9001</div>
      <h2>กล่องกระดาษคุณภาพ<br/><span class="gradient-text">จากโรงงานสู่มือคุณ</span></h2>
      <p>ผลิตจากวัสดุคุณภาพสูง แข็งแรง ทนทาน<br/>ราคาโรงงาน จัดส่งทั่วประเทศ</p>
      <div class="hero-stats">
        <div class="stat">
          <span class="stat-value">10K+</span>
          <span class="stat-label">ลูกค้าไว้วางใจ</span>
        </div>
        <div class="stat">
          <span class="stat-value">{products.length}</span>
          <span class="stat-label">รายการสินค้า</span>
        </div>
        <div class="stat">
          <span class="stat-value">24h</span>
          <span class="stat-label">จัดส่งรวดเร็ว</span>
        </div>
      </div>
    </div>
    <div class="hero-visual">
      <div class="floating-box box1">📦</div>
      <div class="floating-box box2">🎁</div>
      <div class="floating-box box3">🍱</div>
      <div class="floating-box box4">🛍️</div>
    </div>
  </section>

  <section class="categories">
    <div class="category-scroll">
      {#each categories as cat}
        <button class="category-btn" class:active={selectedCategory === cat.id} on:click={() => selectedCategory = cat.id}>
          <span class="cat-icon">{cat.icon}</span>
          <span class="cat-name">{cat.name}</span>
        </button>
      {/each}
    </div>
  </section>

  <section class="products-section">
    <div class="section-header">
      <h3>🏭 สินค้าจากโรงงาน</h3>
      <span class="product-count">{filteredProducts.length} รายการ</span>
    </div>

    {#if isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>กำลังโหลดสินค้า...</p>
      </div>
    {:else}
      <div class="products-grid">
        {#each filteredProducts as product (product.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="product-card" on:click={() => openProductModal(product)}>
            {#if product.popular}
              <span class="product-tag popular">🔥 ขายดี</span>
            {/if}
            {#if product.new}
              <span class="product-tag new">✨ ใหม่</span>
            {/if}
            
            <div class="product-image">
              <span class="product-emoji">{product.image}</span>
            </div>
            
            <div class="product-info">
              <h4>{product.name}</h4>
              <p class="product-desc">{product.description}</p>
              
              <div class="product-meta">
                <span class="product-price">฿{product.price.toLocaleString()}<small>/{product.unit}</small></span>
                <span class="product-min">ขั้นต่ำ {product.minOrder}</span>
              </div>
              
              <button class="add-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                เพิ่มลงตะกร้า
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="features">
    <div class="feature">
      <div class="feature-icon">🏭</div>
      <h4>ผลิตเอง</h4>
      <p>โรงงานของเราเอง ควบคุมคุณภาพทุกขั้นตอน</p>
    </div>
    <div class="feature">
      <div class="feature-icon">💰</div>
      <h4>ราคาโรงงาน</h4>
      <p>ไม่ผ่านคนกลาง ราคาถูกกว่าท้องตลาด</p>
    </div>
    <div class="feature">
      <div class="feature-icon">🚛</div>
      <h4>จัดส่งรวดเร็ว</h4>
      <p>จัดส่งภายใน 1-3 วัน ทั่วประเทศ</p>
    </div>
    <div class="feature">
      <div class="feature-icon">🎨</div>
      <h4>สั่งทำได้</h4>
      <p>รับผลิตกล่องตามแบบ พิมพ์โลโก้ได้</p>
    </div>
  </section>

  <footer class="footer">
    <div class="footer-content">
      <div class="footer-brand">
        <span>🏭</span>
        <span>BOX FACTORY</span>
      </div>
      <div class="footer-contact">
        <p>📞 02-XXX-XXXX | 📱 08X-XXX-XXXX</p>
        <p>📍 นิคมอุตสาหกรรม จ.สมุทรปราการ</p>
      </div>
    </div>
  </footer>

  <!-- ✅ WIDER MODAL - Layout แนวนอน -->
  {#if showProductModal && selectedProduct}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-overlay" on:click={closeProductModal}>
      <div class="modal product-modal" on:click|stopPropagation>
        <button class="modal-close" on:click={closeProductModal}>✕</button>
        
        <div class="modal-body">
          <div class="modal-product-image">
            <span>{selectedProduct.image}</span>
          </div>
          
          <div class="modal-product-info">
            <h3>{selectedProduct.name}</h3>
            <p class="modal-desc">{selectedProduct.description}</p>
            
            <div class="modal-price">
              <span class="price-value">฿{selectedProduct.price.toLocaleString()}</span>
              <span class="price-unit">/{selectedProduct.unit}</span>
            </div>

            <div class="modal-options">
              <label>
                <span>ขนาด</span>
                <select bind:value={selectedSize}>
                  {#each selectedProduct.sizes as size}
                    <option value={size}>{size}</option>
                  {/each}
                </select>
              </label>

              <label>
                <span>จำนวน (ขั้นต่ำ {selectedProduct.minOrder})</span>
                <div class="quantity-input">
                  <button on:click={() => quantity = Math.max(selectedProduct?.minOrder || 1, quantity - 10)}>−</button>
                  <input type="number" bind:value={quantity} min={selectedProduct.minOrder} />
                  <button on:click={() => quantity += 10}>+</button>
                </div>
              </label>
            </div>

            <div class="modal-total">
              <span>รวม</span>
              <span class="total-value">฿{(selectedProduct.price * quantity).toLocaleString()}</span>
            </div>

            <button class="modal-add-btn" on:click={addToCart}>🛒 เพิ่มลงตะกร้า</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if showCart}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="cart-overlay" on:click={closeCart}></div>
    <aside class="cart-sidebar">
      <div class="cart-header">
        <h3>🛒 ตะกร้าสินค้า</h3>
        <button class="close-btn" on:click={closeCart}>✕</button>
      </div>

      <div class="cart-body">
        {#if cart.length === 0}
          <div class="cart-empty">
            <span>📦</span>
            <p>ยังไม่มีสินค้าในตะกร้า</p>
          </div>
        {:else}
          {#each cart as item, index}
            <div class="cart-item">
              <div class="cart-item-image">{item.image}</div>
              <div class="cart-item-info">
                <h4>{item.name}</h4>
                <p class="cart-item-size">{item.selectedSize}</p>
                <p class="cart-item-price">฿{item.price}/{item.unit}</p>
              </div>
              <div class="cart-item-actions">
                <div class="cart-item-qty">
                  <button on:click={() => updateQuantity(index, item.quantity - 10)}>−</button>
                  <span>{item.quantity}</span>
                  <button on:click={() => updateQuantity(index, item.quantity + 10)}>+</button>
                </div>
                <div class="cart-item-total">฿{(item.price * item.quantity).toLocaleString()}</div>
                <button class="cart-item-remove" on:click={() => removeFromCart(index)}>🗑️</button>
              </div>
            </div>
          {/each}
        {/if}
      </div>

      {#if cart.length > 0}
        <div class="cart-footer">
          <div class="cart-summary">
            <div class="summary-row">
              <span>จำนวนรายการ</span>
              <span>{cart.length} รายการ</span>
            </div>
            <div class="summary-row total">
              <span>รวมทั้งหมด</span>
              <span class="total-amount">฿{cartTotal.toLocaleString()}</span>
            </div>
            <p class="delivery-note">* ค่าจัดส่งคำนวณในขั้นตอนถัดไป</p>
          </div>
          <button class="checkout-btn" on:click={proceedToCheckout}>🚚 สั่งซื้อ & เลือกการจัดส่ง</button>
        </div>
      {/if}
    </aside>
  {/if}

  {#if notification.show}
    <div class="toast" class:error={notification.type === 'error'}>
      <span class="toast-icon">{notification.type === 'success' ? '✅' : '❌'}</span>
      {notification.message}
    </div>
  {/if}
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(html) { overflow-x: hidden; overflow-y: auto !important; height: auto; }
  :global(body) { font-family: 'Kanit', sans-serif; background: #0a0a0f; color: #e4e4e7; min-height: 100vh; overflow-x: hidden; overflow-y: auto !important; height: auto; }
  .factory-shop { min-height: 100vh; position: relative; overflow-x: hidden; }
  .bg-effects { position: fixed; inset: 0; z-index: -1; overflow: hidden; }
  .gradient-orb { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.4; animation: float-orb 20s ease-in-out infinite; }
  .orb1 { width: 500px; height: 500px; background: linear-gradient(135deg, #00ff88, #00cc6a); top: -200px; left: -100px; }
  .orb2 { width: 400px; height: 400px; background: linear-gradient(135deg, #065f46, #064e3b); bottom: -150px; right: -100px; animation-delay: -7s; }
  .orb3 { width: 300px; height: 300px; background: linear-gradient(135deg, #10b981, #059669); top: 50%; left: 50%; transform: translate(-50%, -50%); animation-delay: -14s; }
  @keyframes float-orb { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -30px) scale(1.05); } 66% { transform: translate(-20px, 20px) scale(0.95); } }
  .grid-pattern { position: absolute; inset: 0; background-image: linear-gradient(rgba(0, 255, 136, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 136, 0.03) 1px, transparent 1px); background-size: 50px 50px; }
  .header { background: rgba(10, 10, 15, 0.8); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(0, 255, 136, 0.2); padding: 16px 24px; position: sticky; top: 0; z-index: 100; }
  .header-content { max-width: 1400px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .logo { display: flex; align-items: center; gap: 12px; }
  .logo-icon { font-size: 40px; filter: drop-shadow(0 0 20px rgba(0, 255, 136, 0.5)); }
  .logo-text h1 { font-size: 24px; font-weight: 700; color: #00ff88; letter-spacing: 2px; text-shadow: 0 0 30px rgba(0, 255, 136, 0.5); }
  .logo-text span { font-size: 11px; color: #a1a1aa; display: block; }
  .search-bar { flex: 1; max-width: 500px; position: relative; }
  .search-bar svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; color: #71717a; }
  .search-bar input { width: 100%; padding: 12px 16px 12px 44px; border: 1px solid rgba(0, 255, 136, 0.3); border-radius: 12px; background: rgba(255, 255, 255, 0.05); font-family: 'Kanit', sans-serif; font-size: 14px; color: #e4e4e7; transition: all 0.3s; }
  .search-bar input::placeholder { color: #71717a; }
  .search-bar input:focus { outline: none; border-color: #00ff88; box-shadow: 0 0 20px rgba(0, 255, 136, 0.2); }
  .header-actions { display: flex; align-items: center; gap: 16px; }
  .cart-btn { position: relative; width: 44px; height: 44px; border-radius: 12px; background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.3); color: #00ff88; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s; }
  .cart-btn:hover { background: rgba(0, 255, 136, 0.2); transform: translateY(-2px); }
  .cart-btn svg { width: 22px; height: 22px; }
  .cart-badge { position: absolute; top: -6px; right: -6px; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; font-size: 11px; font-weight: 600; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .user-info { display: flex; align-items: center; gap: 10px; padding: 8px 16px; background: rgba(255, 255, 255, 0.05); border-radius: 25px; border: 1px solid rgba(255, 255, 255, 0.1); }
  .user-avatar { font-size: 24px; }
  .user-name { font-size: 14px; color: #e4e4e7; }
  .logout-btn, .login-btn { padding: 8px 16px; border-radius: 20px; font-family: 'Kanit', sans-serif; font-size: 13px; cursor: pointer; transition: all 0.3s; }
  .logout-btn { background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; }
  .login-btn { background: linear-gradient(135deg, #00ff88, #00cc6a); border: none; color: #0a0a0f; font-weight: 600; }
  .login-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(0, 255, 136, 0.4); }
  .refresh-btn { width: 44px; height: 44px; border-radius: 12px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s; }
  .refresh-btn:hover { background: rgba(59, 130, 246, 0.2); transform: rotate(180deg); }
  .hero { max-width: 1400px; margin: 0 auto; padding: 60px 24px; display: flex; align-items: center; justify-content: space-between; gap: 40px; }
  .hero-badge { display: inline-block; padding: 8px 16px; background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.3); border-radius: 20px; font-size: 13px; color: #00ff88; margin-bottom: 16px; }
  .hero-content h2 { font-size: 48px; font-weight: 700; color: #e4e4e7; line-height: 1.2; margin-bottom: 16px; }
  .gradient-text { background: linear-gradient(135deg, #00ff88, #00cc6a); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .hero-content p { font-size: 18px; color: #a1a1aa; line-height: 1.6; margin-bottom: 32px; }
  .hero-stats { display: flex; gap: 32px; }
  .stat { text-align: center; }
  .stat-value { display: block; font-size: 32px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .stat-label { font-size: 12px; color: #71717a; }
  .hero-visual { position: relative; width: 350px; height: 350px; flex-shrink: 0; }
  .floating-box { position: absolute; font-size: 70px; animation: float 4s ease-in-out infinite; filter: drop-shadow(0 10px 30px rgba(0, 0, 0, 0.5)); }
  .box1 { top: 20px; left: 50%; transform: translateX(-50%); }
  .box2 { bottom: 40px; left: 20px; font-size: 55px; animation-delay: 0.5s; }
  .box3 { bottom: 60px; right: 20px; font-size: 50px; animation-delay: 1s; }
  .box4 { top: 50%; right: 0; font-size: 45px; animation-delay: 1.5s; }
  @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }
  .categories { background: rgba(10, 10, 15, 0.6); backdrop-filter: blur(10px); border-top: 1px solid rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding: 16px 24px; position: sticky; top: 77px; z-index: 90; }
  .category-scroll { max-width: 1400px; margin: 0 auto; display: flex; gap: 12px; overflow-x: auto; padding: 4px 0; scrollbar-width: none; }
  .category-scroll::-webkit-scrollbar { display: none; }
  .category-btn { display: flex; align-items: center; gap: 8px; padding: 10px 20px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 25px; font-family: 'Kanit', sans-serif; font-size: 14px; color: #a1a1aa; cursor: pointer; white-space: nowrap; transition: all 0.3s; }
  .category-btn:hover { background: rgba(0, 255, 136, 0.1); border-color: rgba(0, 255, 136, 0.3); color: #00ff88; }
  .category-btn.active { background: linear-gradient(135deg, #00ff88, #00cc6a); border-color: transparent; color: #0a0a0f; font-weight: 600; box-shadow: 0 4px 15px rgba(0, 255, 136, 0.4); }
  .cat-icon { font-size: 18px; }
  .loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 20px; color: #71717a; }
  .spinner { width: 48px; height: 48px; border: 3px solid rgba(0, 255, 136, 0.2); border-top-color: #00ff88; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .products-section { max-width: 1400px; margin: 0 auto; padding: 40px 24px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .section-header h3 { font-size: 28px; font-weight: 600; color: #e4e4e7; }
  .product-count { color: #71717a; font-size: 14px; padding: 6px 14px; background: rgba(255, 255, 255, 0.05); border-radius: 20px; }
  .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px; }
  .product-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; overflow: hidden; cursor: pointer; position: relative; transition: all 0.4s; }
  .product-card:hover { transform: translateY(-8px); border-color: rgba(0, 255, 136, 0.4); box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3), 0 0 30px rgba(0, 255, 136, 0.1); }
  .product-tag { position: absolute; top: 12px; left: 12px; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; z-index: 1; }
  .product-tag.popular { background: linear-gradient(135deg, #f97316, #ea580c); color: white; }
  .product-tag.new { background: linear-gradient(135deg, #00ff88, #00cc6a); color: #0a0a0f; }
  .product-image { background: linear-gradient(135deg, rgba(0, 255, 136, 0.1), rgba(6, 95, 70, 0.1)); padding: 40px; display: flex; align-items: center; justify-content: center; }
  .product-emoji { font-size: 80px; filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.3)); }
  .product-info { padding: 20px; }
  .product-info h4 { font-size: 18px; font-weight: 600; color: #e4e4e7; margin-bottom: 8px; }
  .product-desc { font-size: 13px; color: #71717a; line-height: 1.5; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .product-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .product-price { font-size: 22px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .product-price small { font-size: 12px; color: #71717a; font-weight: 400; }
  .product-min { font-size: 11px; color: #a1a1aa; background: rgba(255, 255, 255, 0.05); padding: 4px 10px; border-radius: 8px; }
  .add-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; background: linear-gradient(135deg, #00ff88, #00cc6a); border: none; border-radius: 12px; color: #0a0a0f; font-family: 'Kanit', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s; }
  .add-btn:hover { transform: scale(1.02); box-shadow: 0 8px 20px rgba(0, 255, 136, 0.4); }
  .add-btn svg { width: 18px; height: 18px; }
  .features { max-width: 1400px; margin: 40px auto; padding: 0 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; }
  .feature { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; padding: 32px; text-align: center; transition: all 0.3s; }
  .feature:hover { border-color: rgba(0, 255, 136, 0.3); transform: translateY(-4px); }
  .feature-icon { font-size: 48px; margin-bottom: 16px; }
  .feature h4 { font-size: 18px; font-weight: 600; color: #e4e4e7; margin-bottom: 8px; }
  .feature p { font-size: 14px; color: #71717a; line-height: 1.5; }
  .footer { background: rgba(10, 10, 15, 0.8); border-top: 1px solid rgba(255, 255, 255, 0.08); padding: 40px 24px; margin-top: 60px; }
  .footer-content { max-width: 1400px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 24px; }
  .footer-brand { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 600; color: #00ff88; }
  .footer-contact { color: #71717a; font-size: 14px; text-align: right; }
  .footer-contact p { margin: 4px 0; }

  /* ==================== WIDER MODAL ==================== */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(12px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .modal { background: linear-gradient(135deg, rgba(20, 20, 30, 0.98), rgba(10, 10, 15, 0.99)); border: 1px solid rgba(0, 255, 136, 0.2); border-radius: 28px; max-width: 800px; width: 100%; max-height: 90vh; overflow: hidden; position: relative; box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 255, 136, 0.1); }
  .modal-close { position: absolute; top: 20px; right: 20px; width: 44px; height: 44px; border-radius: 50%; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #a1a1aa; font-size: 22px; cursor: pointer; z-index: 10; transition: all 0.3s; display: flex; align-items: center; justify-content: center; }
  .modal-close:hover { background: rgba(239, 68, 68, 0.3); color: #f87171; border-color: rgba(239, 68, 68, 0.5); }
  .product-modal { padding: 0; }
  .modal-body { display: flex; flex-direction: row; min-height: 450px; }
  .modal-product-image { flex: 0 0 320px; background: linear-gradient(135deg, rgba(0, 255, 136, 0.15), rgba(6, 95, 70, 0.2)); display: flex; align-items: center; justify-content: center; padding: 40px; }
  .modal-product-image span { font-size: 160px; filter: drop-shadow(0 20px 40px rgba(0, 0, 0, 0.5)); animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  .modal-product-info { flex: 1; padding: 40px; display: flex; flex-direction: column; justify-content: center; overflow-y: auto; }
  .modal-product-info h3 { font-size: 28px; font-weight: 700; color: #e4e4e7; margin-bottom: 12px; line-height: 1.3; }
  .modal-desc { color: #a1a1aa; font-size: 15px; line-height: 1.7; margin-bottom: 24px; }
  .modal-price { margin-bottom: 28px; padding: 16px 20px; background: rgba(0, 255, 136, 0.08); border-radius: 16px; border: 1px solid rgba(0, 255, 136, 0.15); display: inline-block; }
  .price-value { font-size: 42px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .price-unit { font-size: 18px; color: #71717a; margin-left: 4px; }
  .modal-options { display: flex; flex-direction: column; gap: 20px; margin-bottom: 24px; }
  .modal-options label { display: flex; flex-direction: column; gap: 10px; }
  .modal-options label span { font-size: 14px; font-weight: 500; color: #a1a1aa; }
  .modal-options select { padding: 14px 18px; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 14px; background: rgba(255, 255, 255, 0.05); font-family: 'Kanit', sans-serif; font-size: 15px; color: #e4e4e7; cursor: pointer; transition: all 0.3s; }
  .modal-options select:focus { outline: none; border-color: #00ff88; box-shadow: 0 0 20px rgba(0, 255, 136, 0.2); }
  .quantity-input { display: flex; align-items: center; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 14px; overflow: hidden; background: rgba(255, 255, 255, 0.03); }
  .quantity-input button { width: 56px; height: 56px; border: none; background: rgba(255, 255, 255, 0.05); color: #e4e4e7; font-size: 24px; cursor: pointer; transition: all 0.2s; }
  .quantity-input button:hover { background: #00ff88; color: #0a0a0f; }
  .quantity-input input { flex: 1; text-align: center; border: none; background: transparent; font-family: 'JetBrains Mono', monospace; font-size: 20px; font-weight: 600; color: #e4e4e7; }
  .quantity-input input:focus { outline: none; }
  .modal-total { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.25); border-radius: 16px; margin-bottom: 24px; }
  .modal-total span:first-child { color: #a1a1aa; font-size: 16px; font-weight: 500; }
  .total-value { font-size: 32px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .modal-add-btn { width: 100%; padding: 18px; background: linear-gradient(135deg, #00ff88, #00cc6a); border: none; border-radius: 16px; color: #0a0a0f; font-family: 'Kanit', sans-serif; font-size: 18px; font-weight: 600; cursor: pointer; transition: all 0.3s; }
  .modal-add-btn:hover { transform: scale(1.02); box-shadow: 0 10px 30px rgba(0, 255, 136, 0.4); }

  /* Cart Sidebar */
  .cart-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); z-index: 998; }
  .cart-sidebar { position: fixed; right: 0; top: 0; width: 100%; max-width: 420px; height: 100vh; height: 100dvh; background: linear-gradient(180deg, rgba(15, 15, 20, 0.98), rgba(10, 10, 15, 0.99)); border-left: 1px solid rgba(0, 255, 136, 0.2); display: flex; flex-direction: column; z-index: 999; animation: slideIn 0.3s ease; overflow: hidden; }
  @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
  .cart-header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; background: linear-gradient(135deg, #00ff88, #00cc6a); }
  .cart-header h3 { font-size: 20px; font-weight: 600; color: #0a0a0f; }
  .close-btn { width: 36px; height: 36px; border-radius: 50%; background: rgba(0, 0, 0, 0.2); border: none; color: #0a0a0f; font-size: 18px; cursor: pointer; transition: all 0.3s; }
  .close-btn:hover { background: rgba(0, 0, 0, 0.3); }
  .cart-body { flex: 1 1 0; overflow-y: auto; overflow-x: hidden; padding: 16px; min-height: 0; -webkit-overflow-scrolling: touch; }
  .cart-empty { text-align: center; padding: 60px 20px; color: #71717a; }
  .cart-empty span { font-size: 80px; display: block; margin-bottom: 16px; opacity: 0.3; }
  .cart-item { display: flex; flex-direction: column; gap: 12px; padding: 16px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; margin-bottom: 12px; }
  .cart-item-image { font-size: 36px; }
  .cart-item-info { display: flex; align-items: center; gap: 12px; }
  .cart-item-info h4 { flex: 1; font-size: 14px; font-weight: 600; color: #e4e4e7; margin: 0; }
  .cart-item-size { font-size: 11px; color: #71717a; background: rgba(255, 255, 255, 0.05); padding: 2px 8px; border-radius: 4px; }
  .cart-item-price { font-size: 13px; color: #00ff88; font-weight: 500; }
  .cart-item-actions { display: flex; align-items: center; gap: 12px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.05); }
  .cart-item-qty { display: flex; align-items: center; gap: 2px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; overflow: hidden; }
  .cart-item-qty button { width: 32px; height: 32px; border: none; background: transparent; color: #a1a1aa; cursor: pointer; font-size: 16px; transition: all 0.2s; }
  .cart-item-qty button:hover { background: #00ff88; color: #0a0a0f; }
  .cart-item-qty span { width: 40px; text-align: center; font-size: 13px; font-weight: 600; color: #e4e4e7; }
  .cart-item-total { flex: 1; font-weight: 600; color: #00ff88; font-size: 16px; font-family: 'JetBrains Mono', monospace; text-align: right; }
  .cart-item-remove { background: none; border: none; font-size: 20px; cursor: pointer; opacity: 0.5; transition: all 0.2s; padding: 4px; }
  .cart-item-remove:hover { opacity: 1; transform: scale(1.2); }
  .cart-footer { flex: 0 0 auto; padding: 20px 24px; background: rgba(0, 0, 0, 0.4); border-top: 1px solid rgba(255, 255, 255, 0.1); }
  .cart-summary { margin-bottom: 16px; }
  .summary-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #a1a1aa; }
  .summary-row.total { font-size: 18px; font-weight: 600; color: #e4e4e7; border-top: 1px dashed rgba(255, 255, 255, 0.1); margin-top: 8px; padding-top: 12px; }
  .total-amount { font-size: 24px; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .delivery-note { font-size: 12px; color: #71717a; margin-top: 8px; }
  .checkout-btn { width: 100%; padding: 16px; background: linear-gradient(135deg, #00ff88, #00cc6a); border: none; border-radius: 12px; color: #0a0a0f; font-family: 'Kanit', sans-serif; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s; }
  .checkout-btn:hover { transform: scale(1.02); box-shadow: 0 8px 25px rgba(0, 255, 136, 0.4); }
  .toast { position: fixed; top: 100px; right: 24px; display: flex; align-items: center; gap: 10px; padding: 16px 24px; background: linear-gradient(135deg, rgba(0, 255, 136, 0.9), rgba(0, 204, 106, 0.9)); backdrop-filter: blur(10px); border: 1px solid rgba(0, 255, 136, 0.3); border-radius: 12px; color: #0a0a0f; font-size: 14px; font-weight: 500; z-index: 2000; animation: toastIn 0.4s ease; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); }
  .toast.error { background: linear-gradient(135deg, rgba(239, 68, 68, 0.9), rgba(220, 38, 38, 0.9)); border-color: rgba(239, 68, 68, 0.3); color: white; }
  @keyframes toastIn { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
  .toast-icon { font-size: 18px; }

  /* Responsive - Modal แนวตั้งบนมือถือ */
  @media (max-width: 768px) { 
    .header-content { flex-wrap: wrap; } 
    .search-bar { order: 3; max-width: 100%; flex-basis: 100%; margin-top: 12px; } 
    .logo-text h1 { font-size: 18px; } 
    .hero { flex-direction: column; padding: 40px 24px; text-align: center; } 
    .hero-content h2 { font-size: 32px; } 
    .hero-visual { width: 250px; height: 250px; } 
    .hero-stats { justify-content: center; } 
    .products-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; } 
    .cart-sidebar { max-width: 100%; } 
    .user-name { display: none; }
    
    /* Modal แนวตั้งบนมือถือ */
    .modal { max-width: 95%; }
    .modal-body { flex-direction: column; min-height: auto; }
    .modal-product-image { flex: 0 0 auto; padding: 30px; min-height: 200px; }
    .modal-product-image span { font-size: 100px; }
    .modal-product-info { padding: 24px; }
    .modal-product-info h3 { font-size: 22px; }
    .price-value { font-size: 32px; }
    .total-value { font-size: 26px; }
    .quantity-input button { width: 48px; height: 48px; }
  }
  @media (max-width: 480px) { 
    .hero-content h2 { font-size: 26px; } 
    .products-grid { grid-template-columns: 1fr; } 
    .hero-stats { flex-direction: column; gap: 16px; } 
  }
</style>