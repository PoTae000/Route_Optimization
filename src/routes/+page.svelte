<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';

  const API_URL = 'https://backendrouteoptimization-production.up.railway.app/api';

  let username = '';
  let password = '';
  let isLoading = false;
  let error = '';
  let rememberMe = false;
  let showPassword = false;
  let loginSuccess = false;
  let loginRole = '';
  let loginName = '';
  let alertVisible = false;
  let alertLeaving = false;

  async function handleLogin() {
    dismissAlert();
    if (!username.trim() || !password.trim()) {
      showAlert('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }
    // ตรวจสอบว่ามี session ซ้อนอยู่หรือไม่
    const existingUser = localStorage.getItem('user');
    if (existingUser) {
      try {
        const u = JSON.parse(existingUser);
        if (u?.username && u.username !== username.trim()) {
          showAlert('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
          return;
        }
      } catch {}
    }
    isLoading = true;
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.error) {
        showAlert(data.error);
      } else if (data.success) {
        // สร้าง session token เพื่อกัน login ซ้อน
        const sessionToken = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
        localStorage.setItem('user', JSON.stringify({ ...data.user, loggedInAt: new Date().toISOString(), sessionToken }));
        localStorage.setItem('activeSession', sessionToken);
        if (rememberMe) localStorage.setItem('rememberMe', username);
        else localStorage.removeItem('rememberMe');
        loginSuccess = true;
        loginRole = data.user.role?.toLowerCase() || 'user';
        loginName = data.user.name || data.user.username || username;
        setTimeout(() => redirectByRole(data.user.role, data.user.id), 2200);
        return;
      }
    } catch { showAlert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'); }
    isLoading = false;
  }

  let alertTimer: ReturnType<typeof setTimeout>;
  function showAlert(msg: string) {
    error = msg; alertVisible = true; alertLeaving = false;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => dismissAlert(), 5000);
  }
  function dismissAlert() {
    if (!alertVisible) return;
    alertLeaving = true;
    setTimeout(() => { error = ''; alertVisible = false; alertLeaving = false; }, 300);
  }

  const ENC_TABLE = ['K@','$V','Rj','X!','B~','Qm','@S','H$','Dz','L!','N~','We','F@','$T','J!','~M'];
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

  function redirectByRole(role: string, id: number) {
    const r = role.toLowerCase();
    let target = `/Home/${id}`;
    if (r === 'admin') target = `/Admin/${id}`;
    else if (r === 'driver') target = `/Home/${id}`;
    else if (r === 'customer') target = `/factory/${id}`;
    else if (r === 'user') target = `/User/${encodeUserId(id)}`;
    window.location.href = target;
  }

  function handleKeyPress(e: KeyboardEvent) { if (e.key === 'Enter') handleLogin(); }

  function initPage() {
    const remembered = localStorage.getItem('rememberMe');
    if (remembered) { username = remembered; rememberMe = true; }
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try { const user = JSON.parse(userStr); redirectByRole(user.role, user.id); }
      catch { localStorage.removeItem('user'); }
    }
  }

  // ─── Preload Map Tiles ในพื้นหลังตั้งแต่หน้า Login ─────────────────────
  // โหลด tile ของ CartoDB Dark Matter ไว้ใน browser cache ล่วงหน้า
  // เพื่อว่าเวลาเปิดหน้า Map จะโหลดได้ทันทีไม่ขาวๆ
  function preloadMapTiles() {
    const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
    const SUBDOMAINS = ['a', 'b', 'c', 'd'];

    // แปลง lat/lng → tile x,y ที่ zoom level z
    function latLngToTile(lat: number, lng: number, z: number): { x: number; y: number } {
      const n = Math.pow(2, z);
      const x = Math.floor((lng + 180) / 360 * n);
      const latRad = lat * Math.PI / 180;
      const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
      return { x, y };
    }

    function fetchTile(s: string, z: number, x: number, y: number) {
      const url = TILE_URL.replace('{s}', s).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
    }

    // โหลด tiles รอบจุดศูนย์กลาง ที่หลาย zoom levels
    function preloadAround(lat: number, lng: number, zoomLevels: number[], radius: number) {
      let count = 0;
      for (const z of zoomLevels) {
        const center = latLngToTile(lat, lng, z);
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            const s = SUBDOMAINS[(count++) % 4];
            fetchTile(s, z, center.x + dx, center.y + dy);
          }
        }
      }
    }

    // 1) โหลด tiles กรุงเทพ (default center) ทันที
    preloadAround(13.7465, 100.5348, [10, 11, 12, 13, 14], 3);

    // 2) ถ้ามี GPS → โหลด tiles รอบตำแหน่งผู้ใช้ด้วย (zoom ใกล้ๆ)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          // บันทึกตำแหน่งล่าสุดไว้ให้หน้า User ใช้
          localStorage.setItem('_preloadPos', JSON.stringify({ lat, lng }));
          preloadAround(lat, lng, [14, 15, 16, 17, 18], 4);
        },
        () => {},
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    }
  }

  onMount(() => {
    initPage();
    // เริ่มโหลด map tiles ในพื้นหลังทันที
    setTimeout(preloadMapTiles, 500);
  });
  afterNavigate(initPage);
</script>

<svelte:head>
  <title>เพิ่มประสิทธิภาพในการวางแผนเส้นทาง</title>
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
</svelte:head>

<div class="page">

  <!-- BG -->
  <div class="bg">
    <div class="blob b1"></div>
    <div class="blob b2"></div>
    <div class="blob b3"></div>
    <div class="bg-grid"></div>
    <div class="bg-vignette"></div>
  </div>

  <!-- ALERT -->
  {#if alertVisible}
  <div class="alert-zone" class:alert-out={alertLeaving}>
    <div class="alert-box">
      <div class="alert-glass">
        <div class="alert-row">
          <div class="beacon-core">
            <svg viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="1.8"/><path d="M12 9v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor"/></svg>
          </div>
          <div class="alert-info">
            <div class="alert-tag"><span class="tag-dot"></span>ERROR</div>
            <p class="alert-msg">{error}</p>
          </div>
          <button class="alert-dismiss" on:click={dismissAlert}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="alert-timeline"><div class="timeline-fill"></div></div>
      </div>
    </div>
  </div>
  {/if}

  <!-- LAYOUT -->
  <div class="split">

    <!-- LEFT -->
    <div class="left">
      <div class="left-content">
        <h1>
          <span class="h-line1">เพิ่มประสิทธิภาพ</span>
          <span class="h-line2">ในการวางแผนเส้นทาง</span>
        </h1>
        <p class="lead">วิเคราะห์และเปรียบเทียบเส้นทางที่ดีที่สุด<br/>ด้วยระบบนำทางอัจฉริยะแบบเรียลไทม์</p>

        <div class="stats-glass">
          <div class="stat"><span class="stat-num">4+</span><span class="stat-label">เส้นทาง</span></div>
          <div class="stat-div"></div>
          <div class="stat"><span class="stat-num">GPS</span><span class="stat-label">เรียลไทม์</span></div>
          <div class="stat-div"></div>
          <div class="stat"><span class="stat-num">24/7</span><span class="stat-label">พร้อมใช้งาน</span></div>
        </div>

        <div class="features">
          <div class="feat">
            <div class="feat-icon fi-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M8 6h4a4 4 0 014 4v0a4 4 0 01-4 4h-4" stroke-dasharray="4 3"/></svg>
            </div>
            <div class="feat-body"><strong>Multi-Route Analysis</strong><span>เปรียบเทียบ 4 เส้นทางพร้อมกัน</span></div>
          </div>
          <div class="feat">
            <div class="feat-icon fi-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2a8 8 0 00-8 8c0 5.4 8 12 8 12s8-6.6 8-12a8 8 0 00-8-8z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div class="feat-body"><strong>Live GPS Tracking</strong><span>ติดตามตำแหน่งแบบเรียลไทม์</span></div>
          </div>
          <div class="feat">
            <div class="feat-icon fi-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
            </div>
            <div class="feat-body"><strong>Voice Navigation</strong><span>นำทางพร้อมเสียงภาษาไทย</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- RIGHT LOGIN -->
    <div class="right">
      <div class="card-wrap">
        <div class="card">
          <div class="card-head">
            <div class="logo-core">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <h2>เข้าสู่ระบบ</h2>
            <p>ลงชื่อเข้าใช้เพื่อเริ่มวางแผนเส้นทาง</p>
          </div>

          <form on:submit|preventDefault={handleLogin} class="form" autocomplete="off">
            <div class="field">
              <label for="u">USERNAME</label>
              <div class="inp-wrap">
                <div class="inp-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                <input id="u" type="text" bind:value={username} on:keypress={handleKeyPress} placeholder="กรอกชื่อผู้ใช้" disabled={isLoading} autocomplete="off"/>
                <div class="inp-line"></div>
              </div>
            </div>
            <div class="field">
              <label for="p">PASSWORD</label>
              <div class="inp-wrap">
                <div class="inp-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>
                <input id="p" type={showPassword?'text':'password'} bind:value={password} on:keypress={handleKeyPress} placeholder="กรอกรหัสผ่าน" disabled={isLoading} autocomplete="off"/>
                <button type="button" class="eye" on:click={()=>showPassword=!showPassword}>
                  {#if showPassword}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  {:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>{/if}
                </button>
                <div class="inp-line"></div>
              </div>
            </div>

            <label class="check-row">
              <input type="checkbox" bind:checked={rememberMe}/>
              <div class="ck-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
              <span>จดจำฉัน</span>
            </label>

            <button type="submit" class="btn-go" disabled={isLoading}>
              {#if isLoading}
                <div class="btn-loader"></div><span>กำลังเข้าสู่ระบบ...</span>
              {:else}
                <span>เข้าสู่ระบบ</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
              {/if}
            </button>
          </form>

          <div class="card-foot">
            <div class="foot-line"></div>
            <span>Route Planning System v2.0</span>
            <div class="foot-line"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- SUCCESS -->
{#if loginSuccess}
<div class="ok-over">
  <div class="ok-body">
    <div class="ok-check">
      <svg viewBox="0 0 60 60">
        <circle class="oc-c" cx="30" cy="30" r="27" fill="none" stroke="currentColor" stroke-width="2"/>
        <path class="oc-p" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M18 30l8 8 16-16"/>
      </svg>
    </div>
    <h2>เข้าสู่ระบบสำเร็จ</h2>
    <p class="ok-name">{loginName}</p>
    <div class="ok-role role-{loginRole}">{loginRole === 'admin' ? 'Admin' : loginRole === 'driver' ? 'Driver' : loginRole === 'customer' ? 'Customer' : 'User'}</div>
    <div class="ok-bar"><div class="ok-fill"></div></div>
    <span class="ok-txt">กำลังนำทางเข้าสู่ระบบ...</span>
  </div>
</div>
{/if}

<style>
  :global(*){margin:0;padding:0;box-sizing:border-box}
  :global(body){font-family:'Kanit',sans-serif;background:#06060f;color:#e4e4e7;overflow-x:hidden}

  .page{min-height:100vh;position:relative}

  /* BG - static blobs, no animation */
  .bg{position:fixed;inset:0;z-index:0;overflow:hidden;background:linear-gradient(160deg,#06060f 0%,#080816 40%,#0a0c1a 70%,#06060f 100%)}
  .blob{position:absolute;border-radius:50%;pointer-events:none}
  .b1{width:600px;height:600px;background:radial-gradient(circle,rgba(0,255,136,.1),rgba(0,255,136,.01));filter:blur(80px);top:-10%;left:-8%}
  .b2{width:500px;height:500px;background:radial-gradient(circle,rgba(99,102,241,.09),rgba(99,102,241,.01));filter:blur(80px);bottom:-10%;right:-8%}
  .b3{width:450px;height:450px;background:radial-gradient(circle,rgba(6,182,212,.08),rgba(6,182,212,.01));filter:blur(70px);top:20%;right:15%}
  .bg-grid{position:absolute;inset:0;background-image:radial-gradient(circle,rgba(255,255,255,.02) 1px,transparent 1px);background-size:44px 44px}
  .bg-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 30%,rgba(6,6,15,.5) 70%,rgba(6,6,15,.85) 100%);pointer-events:none}

  /* ALERT */
  .alert-zone{position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:10000;width:94%;max-width:500px;transition:opacity .3s,transform .3s}
  .alert-out{opacity:0;transform:translateX(-50%) translateY(-20px)}
  .alert-box{position:relative}
  .alert-glass{border-radius:16px;background:rgba(20,6,12,.95);backdrop-filter:blur(20px);overflow:hidden;border:1px solid rgba(255,40,60,.15);box-shadow:0 20px 60px rgba(0,0,0,.6)}
  .alert-row{display:flex;align-items:center;gap:16px;padding:18px 20px}
  .beacon-core{width:44px;height:44px;min-width:44px;border-radius:12px;background:rgba(255,40,60,.15);display:flex;align-items:center;justify-content:center}
  .beacon-core svg{width:22px;height:22px;color:#ff4060}
  .alert-info{flex:1;display:flex;flex-direction:column;gap:4px}
  .alert-tag{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;color:#ff6080;font-family:'Space Mono',monospace;letter-spacing:2px}
  .tag-dot{width:6px;height:6px;border-radius:50%;background:#ff4060}
  .alert-msg{font-size:14px;color:#ddb0b8;line-height:1.5}
  .alert-dismiss{width:32px;height:32px;min-width:32px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:8px;cursor:pointer;transition:background .2s}
  .alert-dismiss:hover{background:rgba(255,40,60,.15)}
  .alert-dismiss svg{width:14px;height:14px;color:#888}
  .alert-timeline{height:3px;background:rgba(255,255,255,.05)}
  .timeline-fill{height:100%;width:100%;background:linear-gradient(90deg,#ff0040,#ff4080);animation:tlShrink 5s linear forwards}
  @keyframes tlShrink{to{width:0}}

  /* LAYOUT */
  .split{position:relative;z-index:1;display:flex;min-height:100vh}

  .left{flex:1;display:flex;align-items:center;padding:60px 50px 60px 80px}
  .left-content{max-width:560px}

  h1{margin-bottom:22px;line-height:1.1}
  .h-line1{display:block;font-size:52px;font-weight:900;background:linear-gradient(135deg,#ffffff 0%,#00ff88 55%,#06b6d4 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .h-line2{display:block;font-size:36px;font-weight:700;color:#52525b;margin-top:4px}
  .lead{font-size:15px;color:#3f3f46;line-height:1.8;margin-bottom:36px}

  .stats-glass{display:flex;align-items:center;padding:20px 28px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);border-radius:18px;backdrop-filter:blur(12px);margin-bottom:40px}
  .stat{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
  .stat-num{font-size:26px;font-weight:800;font-family:'Space Mono',monospace;background:linear-gradient(135deg,#00ff88,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .stat-label{font-size:11px;color:#52525b;font-weight:500}
  .stat-div{width:1px;height:36px;background:linear-gradient(to bottom,transparent,rgba(255,255,255,.06),transparent)}

  .features{display:flex;flex-direction:column;gap:4px}
  .feat{display:flex;align-items:center;gap:16px;padding:14px 16px;border-radius:14px;transition:background .2s;cursor:default}
  .feat:hover{background:rgba(255,255,255,.02)}
  .feat-icon{width:42px;height:42px;min-width:42px;display:flex;align-items:center;justify-content:center;border-radius:12px}
  .feat-icon svg{width:20px;height:20px}
  .fi-1{background:rgba(0,255,136,.06);border:1px solid rgba(0,255,136,.1);color:#00ff88}
  .fi-2{background:rgba(6,182,212,.06);border:1px solid rgba(6,182,212,.1);color:#06b6d4}
  .fi-3{background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.1);color:#818cf8}
  .feat-body{display:flex;flex-direction:column}
  .feat-body strong{font-size:13px;font-weight:600;color:#d4d4d8;font-family:'Space Mono',monospace}
  .feat-body span{font-size:11px;color:#52525b;margin-top:2px}

  .right{width:520px;min-width:520px;display:flex;align-items:center;justify-content:center;padding:40px;position:relative}
  .right::before{content:'';position:absolute;left:0;top:8%;bottom:8%;width:1px;background:linear-gradient(to bottom,transparent,rgba(0,255,136,.05) 50%,transparent)}

  .card-wrap{width:100%;max-width:420px}
  .card{padding:44px 40px;background:rgba(10,10,20,.8);backdrop-filter:blur(40px);border-radius:26px;border:1px solid rgba(255,255,255,.06);box-shadow:0 40px 100px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.04)}

  .card-head{text-align:center;margin-bottom:36px}
  .logo-core{width:64px;height:64px;display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#00ff88,#06b6d4);border-radius:20px;box-shadow:0 12px 44px rgba(0,255,136,.2);margin-bottom:20px}
  .logo-core svg{width:30px;height:30px;color:#06060f}
  .card-head h2{font-size:26px;font-weight:800;color:#f4f4f5;margin-bottom:6px;letter-spacing:-.5px}
  .card-head p{font-size:13px;color:#52525b}

  .form{display:flex;flex-direction:column;gap:24px}
  .field{display:flex;flex-direction:column;gap:8px}
  .field label{font-size:10px;font-weight:700;color:#52525b;font-family:'Space Mono',monospace;letter-spacing:2px}

  .inp-wrap{position:relative;display:flex;align-items:center;height:52px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.06);border-radius:14px;overflow:hidden;transition:border-color .2s,box-shadow .2s}
  .inp-wrap:focus-within{border-color:rgba(0,255,136,.25);box-shadow:0 0 0 3px rgba(0,255,136,.05)}
  .inp-icon{width:48px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .inp-icon svg{width:18px;height:18px;color:#3f3f46;transition:color .2s}
  .inp-wrap:focus-within .inp-icon svg{color:#00ff88}
  .inp-wrap input{flex:1;height:100%;background:none;border:none;outline:none;color:#e4e4e7;font-family:'Kanit';font-size:14px;padding-right:12px}
  .inp-wrap input::placeholder{color:#2a2a3a}
  .inp-wrap input:disabled{opacity:.4}
  .inp-wrap input:-webkit-autofill,.inp-wrap input:-webkit-autofill:hover,.inp-wrap input:-webkit-autofill:focus{-webkit-text-fill-color:#e4e4e7;-webkit-box-shadow:0 0 0 1000px rgba(6,6,15,.95) inset;transition:background-color 5000s;caret-color:#e4e4e7;font-family:'Kanit';font-size:14px}
  .inp-line{position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#00ff88,transparent);transform:scaleX(0);transition:transform .3s}
  .inp-wrap:focus-within .inp-line{transform:scaleX(1)}

  .eye{width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.04);border-radius:8px;cursor:pointer;margin-right:8px;transition:background .2s}
  .eye:hover{background:rgba(255,255,255,.07)}
  .eye svg{width:16px;height:16px;color:#52525b}

  .check-row{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;color:#71717a;user-select:none}
  .check-row input{display:none}
  .ck-box{width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:1.5px solid rgba(255,255,255,.1);border-radius:6px;transition:all .2s}
  .ck-box svg{width:12px;height:12px;color:#06060f;opacity:0;transition:opacity .15s}
  .check-row input:checked+.ck-box{background:linear-gradient(135deg,#00ff88,#00cc6a);border-color:#00ff88;box-shadow:0 0 14px rgba(0,255,136,.25)}
  .check-row input:checked+.ck-box svg{opacity:1}

  .btn-go{height:54px;width:100%;margin-top:4px;display:flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#00ff88,#00cc6a);border:none;border-radius:16px;color:#06060f;font-family:'Kanit';font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 8px 30px rgba(0,255,136,.18);transition:transform .2s,box-shadow .2s}
  .btn-go:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 12px 40px rgba(0,255,136,.28)}
  .btn-go:active:not(:disabled){transform:translateY(0)}
  .btn-go:disabled{opacity:.4;cursor:not-allowed}
  .btn-go svg{width:20px;height:20px;transition:transform .2s}
  .btn-go:hover svg{transform:translateX(4px)}
  .btn-loader{width:20px;height:20px;border:2.5px solid rgba(6,6,15,.2);border-top-color:#06060f;border-radius:50%;animation:spin .6s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}

  .card-foot{display:flex;align-items:center;gap:14px;margin-top:32px}
  .foot-line{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent)}
  .card-foot span{font-size:9px;color:#2a2a3a;font-family:'Space Mono',monospace;letter-spacing:1px;white-space:nowrap}

  /* RESPONSIVE */
  @media(max-width:1100px){.left{display:none}.right{width:100%;min-width:unset}.right::before{display:none}}
  @media(max-width:480px){.right{padding:16px}.card{padding:32px 24px;border-radius:22px}}

  /* SUCCESS */
  .ok-over{position:fixed;inset:0;z-index:9999;background:rgba(6,6,15,.97);display:flex;align-items:center;justify-content:center}
  .ok-body{display:flex;flex-direction:column;align-items:center;gap:16px;animation:popIn .5s cubic-bezier(.34,1.56,.64,1) both}
  @keyframes popIn{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:none}}
  .ok-check{width:80px;height:80px;color:#00ff88;filter:drop-shadow(0 0 20px rgba(0,255,136,.4))}
  .ok-check svg{width:100%;height:100%}
  .oc-c{stroke-dasharray:170;stroke-dashoffset:170;animation:drawC .5s .2s ease forwards}
  @keyframes drawC{to{stroke-dashoffset:0}}
  .oc-p{stroke-dasharray:50;stroke-dashoffset:50;animation:drawP .35s .6s ease forwards}
  @keyframes drawP{to{stroke-dashoffset:0}}
  .ok-body h2{font-size:24px;font-weight:800;background:linear-gradient(135deg,#00ff88,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .ok-name{font-size:15px;color:#a1a1aa}
  .ok-role{padding:8px 28px;border-radius:100px;font-size:12px;font-weight:700;font-family:'Space Mono',monospace;letter-spacing:1px}
  .role-admin{background:rgba(255,217,61,.1);border:1px solid rgba(255,217,61,.25);color:#ffd93d}
  .role-driver{background:rgba(0,255,136,.1);border:1px solid rgba(0,255,136,.25);color:#00ff88}
  .role-customer{background:rgba(168,85,247,.1);border:1px solid rgba(168,85,247,.25);color:#a855f7}
  .role-user{background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.25);color:#3b82f6}
  .ok-bar{width:180px;height:3px;background:rgba(255,255,255,.05);border-radius:3px;overflow:hidden;margin-top:6px}
  .ok-fill{height:100%;width:0;background:linear-gradient(90deg,#00ff88,#06b6d4);animation:fill 2s .3s ease forwards}
  @keyframes fill{to{width:100%}}
  .ok-txt{font-size:11px;color:#3f3f46;font-family:'Space Mono',monospace}
</style>