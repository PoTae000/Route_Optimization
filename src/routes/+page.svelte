<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';

  const API_URL = 'https://backend-route-optimization-phrjxz6hk-potae000s-projects.vercel.app/api';

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
        localStorage.setItem('user', JSON.stringify({ ...data.user, loggedInAt: new Date().toISOString() }));
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
    setTimeout(() => { error = ''; alertVisible = false; alertLeaving = false; }, 500);
  }

  // URL ID obfuscation สำหรับ User page (ต้องตรงกับ User/[id]/+page.svelte)
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

  onMount(initPage);
  afterNavigate(initPage);
</script>

<svelte:head>
  <title>เพิ่มประสิทธิภาพในการวางแผนเส้นทาง</title>
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
</svelte:head>

<div class="page">

  <!-- ===== BACKGROUND ===== -->
  <div class="bg">
    <div class="blob b1"></div>
    <div class="blob b2"></div>
    <div class="blob b3"></div>
    <div class="blob b4"></div>
    <div class="blob b5"></div>
    <div class="blob b6"></div>
    <!-- Aurora waves -->
    <div class="aurora">
      <div class="aurora-band a1"></div>
      <div class="aurora-band a2"></div>
      <div class="aurora-band a3"></div>
    </div>
    <!-- Shooting stars -->
    <div class="shooting-star ss1"></div>
    <div class="shooting-star ss2"></div>
    <div class="shooting-star ss3"></div>
    <!-- Noise grain overlay -->
    <div class="noise-overlay"></div>
    <!-- Scan line -->
    <div class="scan-line"></div>
    <svg class="bg-map" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <filter id="gl"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="glx"><feGaussianBlur stdDeviation="18"/></filter>
        <radialGradient id="starCtr" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#06b6d4" stop-opacity=".06"/><stop offset="100%" stop-color="#06b6d4" stop-opacity="0"/></radialGradient>
      </defs>

      <!-- ====== STAR center=720,450 R=260 ====== -->
      <!-- Outer glow ring -->
      <circle class="star-ring" cx="720" cy="450" r="310" fill="none" stroke="#00ff88" stroke-opacity=".04" stroke-width="1" stroke-dasharray="12 8">
        <animateTransform attributeName="transform" type="rotate" from="0 720 450" to="360 720 450" dur="60s" repeatCount="indefinite"/>
      </circle>
      <circle class="star-ring" cx="720" cy="450" r="330" fill="none" stroke="#818cf8" stroke-opacity=".03" stroke-width="1" stroke-dasharray="6 14">
        <animateTransform attributeName="transform" type="rotate" from="360 720 450" to="0 720 450" dur="45s" repeatCount="indefinite"/>
      </circle>

      <!-- Star glow background -->
      <path class="star-glow" d="M720,190 L873,660 L473,370 L967,370 L567,660 Z" fill="#00ff88" opacity=".012" filter="url(#glx)"/>
      <!-- Inner pentagon fill -->
      <path class="star-penta" d="M778,370 L814,481 L720,549 L626,481 L662,370 Z" fill="url(#starCtr)"/>
      <!-- Center glow -->
      <circle cx="720" cy="450" r="60" fill="#06b6d4" opacity=".02">
        <animate attributeName="r" values="50;80;50" dur="5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".02;.04;.02" dur="5s" repeatCount="indefinite"/>
      </circle>

      <!-- Star lines (main) -->
      <path class="rte-main" d="M720,190 L873,660 L473,370 L967,370 L567,660 Z" stroke="#00ff88" stroke-opacity=".3" stroke-width="2" fill="none" filter="url(#gl)" stroke-linejoin="round"/>
      <!-- Star lines (glow layer) -->
      <path class="rte-alt" d="M720,190 L873,660 L473,370 L967,370 L567,660 Z" stroke="#00ff88" stroke-opacity=".06" stroke-width="10" fill="none" stroke-linejoin="round"/>
      <!-- Star lines (purple dash) -->
      <path class="rte-alt" d="M720,190 L873,660 L473,370 L967,370 L567,660 Z" stroke="#818cf8" stroke-opacity=".1" stroke-width="1.5" fill="none" stroke-dasharray="8 6" stroke-linejoin="round"/>
      <!-- Outer pentagon: T1→T2→T3→T4→T5 -->
      <path class="rte-alt" d="M720,190 L967,370 L873,660 L567,660 L473,370 Z" stroke="#00ff88" stroke-opacity=".06" stroke-width="1" fill="none" stroke-dasharray="4 8"/>
      <!-- Inner pentagon -->
      <path class="rte-conn" d="M778,370 L814,481 L720,549 L626,481 L662,370 Z" stroke="#06b6d4" stroke-opacity=".12" stroke-width="1.2" fill="none"/>
      <!-- Radial lines: center to tips -->
      {#each [{x:720,y:190},{x:967,y:370},{x:873,y:660},{x:567,y:660},{x:473,y:370}] as t}
        <line class="rte-conn" x1="720" y1="450" x2={t.x} y2={t.y} stroke="#fff" stroke-opacity=".02" stroke-width="1" stroke-dasharray="3 6"/>
      {/each}

      <!-- Motion paths -->
      <path id="mp1" d="M720,190 L873,660 L473,370 L967,370 L567,660 Z" fill="none"/>
      <path id="mp2" d="M778,370 L814,481 L720,549 L626,481 L662,370 Z" fill="none"/>
      <path id="mp3" d="M720,190 L967,370 L873,660 L567,660 L473,370 Z" fill="none"/>

      <!-- Orb 1: green -->
      <g>
        <circle r="10" fill="#00ff88" opacity=".04"><animateMotion dur="14s" repeatCount="indefinite"><mpath href="#mp1"/></animateMotion></circle>
        <circle r="4" fill="#00ff88" opacity=".3"><animateMotion dur="14s" repeatCount="indefinite"><mpath href="#mp1"/></animateMotion>
          <animate attributeName="r" values="3;6;3" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values=".2;.4;.2" dur="2s" repeatCount="indefinite"/>
        </circle>
        <circle r="1.5" fill="#fff" opacity=".6"><animateMotion dur="14s" repeatCount="indefinite"><mpath href="#mp1"/></animateMotion></circle>
      </g>
      <!-- Orb 2: purple -->
      <g>
        <circle r="9" fill="#818cf8" opacity=".04"><animateMotion dur="14s" repeatCount="indefinite" begin="4.7s"><mpath href="#mp1"/></animateMotion></circle>
        <circle r="3.5" fill="#818cf8" opacity=".28"><animateMotion dur="14s" repeatCount="indefinite" begin="4.7s"><mpath href="#mp1"/></animateMotion>
          <animate attributeName="r" values="2.5;5;2.5" dur="1.8s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values=".2;.35;.2" dur="1.8s" repeatCount="indefinite"/>
        </circle>
        <circle r="1.2" fill="#fff" opacity=".5"><animateMotion dur="14s" repeatCount="indefinite" begin="4.7s"><mpath href="#mp1"/></animateMotion></circle>
      </g>
      <!-- Orb 3: cyan -->
      <g>
        <circle r="8" fill="#06b6d4" opacity=".04"><animateMotion dur="14s" repeatCount="indefinite" begin="9.3s"><mpath href="#mp1"/></animateMotion></circle>
        <circle r="3" fill="#06b6d4" opacity=".25"><animateMotion dur="14s" repeatCount="indefinite" begin="9.3s"><mpath href="#mp1"/></animateMotion>
          <animate attributeName="r" values="2;4.5;2" dur="2.2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values=".18;.32;.18" dur="2.2s" repeatCount="indefinite"/>
        </circle>
        <circle r="1" fill="#fff" opacity=".45"><animateMotion dur="14s" repeatCount="indefinite" begin="9.3s"><mpath href="#mp1"/></animateMotion></circle>
      </g>
      <!-- Inner orbs (pentagon) -->
      <g>
        <circle r="7" fill="#06b6d4" opacity=".04"><animateMotion dur="8s" repeatCount="indefinite" begin="1s"><mpath href="#mp2"/></animateMotion></circle>
        <circle r="3" fill="#06b6d4" opacity=".25"><animateMotion dur="8s" repeatCount="indefinite" begin="1s"><mpath href="#mp2"/></animateMotion>
          <animate attributeName="r" values="2;4.5;2" dur="1.6s" repeatCount="indefinite"/>
        </circle>
        <circle r="1" fill="#fff" opacity=".45"><animateMotion dur="8s" repeatCount="indefinite" begin="1s"><mpath href="#mp2"/></animateMotion></circle>
      </g>
      <g>
        <circle r="6" fill="#00ff88" opacity=".03"><animateMotion dur="8s" repeatCount="indefinite" begin="5s"><mpath href="#mp2"/></animateMotion></circle>
        <circle r="2.5" fill="#00ff88" opacity=".22"><animateMotion dur="8s" repeatCount="indefinite" begin="5s"><mpath href="#mp2"/></animateMotion>
          <animate attributeName="r" values="1.5;4;1.5" dur="1.4s" repeatCount="indefinite"/>
        </circle>
        <circle r="1" fill="#fff" opacity=".4"><animateMotion dur="8s" repeatCount="indefinite" begin="5s"><mpath href="#mp2"/></animateMotion></circle>
      </g>
      <!-- Outer pentagon orb -->
      <g>
        <circle r="6" fill="#818cf8" opacity=".03"><animateMotion dur="18s" repeatCount="indefinite" begin="2s"><mpath href="#mp3"/></animateMotion></circle>
        <circle r="2.5" fill="#818cf8" opacity=".18"><animateMotion dur="18s" repeatCount="indefinite" begin="2s"><mpath href="#mp3"/></animateMotion>
          <animate attributeName="r" values="1.5;3.5;1.5" dur="2.5s" repeatCount="indefinite"/>
        </circle>
        <circle r="1" fill="#fff" opacity=".35"><animateMotion dur="18s" repeatCount="indefinite" begin="2s"><mpath href="#mp3"/></animateMotion></circle>
      </g>

      <!-- ====== PINS (5 tips + 5 inner) ====== -->
      {#each [
        {x:720,y:190,c:'#00ff88',sz:7,lbl:'01',big:true},
        {x:967,y:370,c:'#818cf8',sz:7,lbl:'02',big:true},
        {x:873,y:660,c:'#00ff88',sz:7,lbl:'03',big:true},
        {x:567,y:660,c:'#06b6d4',sz:7,lbl:'04',big:true},
        {x:473,y:370,c:'#06b6d4',sz:7,lbl:'05',big:true},
        {x:778,y:370,c:'#818cf8',sz:4,lbl:'A'},
        {x:814,y:481,c:'#818cf8',sz:4,lbl:'B'},
        {x:720,y:549,c:'#06b6d4',sz:4,lbl:'C'},
        {x:626,y:481,c:'#06b6d4',sz:4,lbl:'D'},
        {x:662,y:370,c:'#00ff88',sz:4,lbl:'E'}
      ] as p, i}
        <g class="map-pin" style="animation-delay:{0.8 + i*0.12}s">
          {#if p.big}
            <circle cx={p.x} cy={p.y} r="28" fill={p.c} opacity=".04">
              <animate attributeName="r" values="24;42;24" dur="3.5s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values=".05;.01;.05" dur="3.5s" repeatCount="indefinite"/>
            </circle>
          {/if}
          <circle cx={p.x} cy={p.y} r={p.sz*2.2} fill="none" stroke={p.c} stroke-width=".5" opacity=".12">
            <animate attributeName="r" values="{p.sz*2};{p.sz*3};{p.sz*2}" dur="4s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values=".12;.03;.12" dur="4s" repeatCount="indefinite"/>
          </circle>
          <circle cx={p.x} cy={p.y} r={p.sz} fill="#0a0a18" stroke={p.c} stroke-width="1.5"/>
          <circle cx={p.x} cy={p.y} r={p.sz*.35} fill={p.c}/>
          <text x={p.x} y={p.y - p.sz - 7} fill={p.c} font-size="9" font-family="Space Mono, monospace" opacity=".4" text-anchor="middle">{p.lbl}</text>
        </g>
      {/each}

      <!-- Sparkle at tips -->
      {#each [{x:720,y:190,c:'#00ff88'},{x:967,y:370,c:'#818cf8'},{x:873,y:660,c:'#00ff88'},{x:567,y:660,c:'#06b6d4'},{x:473,y:370,c:'#06b6d4'}] as s, i}
        <line x1={s.x-8} y1={s.y} x2={s.x+8} y2={s.y} stroke={s.c} stroke-opacity=".15" stroke-width="1">
          <animate attributeName="x1" values="{s.x-6};{s.x-12};{s.x-6}" dur="{3+i*0.4}s" repeatCount="indefinite"/>
          <animate attributeName="x2" values="{s.x+6};{s.x+12};{s.x+6}" dur="{3+i*0.4}s" repeatCount="indefinite"/>
          <animate attributeName="stroke-opacity" values=".15;.04;.15" dur="{3+i*0.4}s" repeatCount="indefinite"/>
        </line>
        <line x1={s.x} y1={s.y-8} x2={s.x} y2={s.y+8} stroke={s.c} stroke-opacity=".15" stroke-width="1">
          <animate attributeName="y1" values="{s.y-6};{s.y-12};{s.y-6}" dur="{3+i*0.4}s" repeatCount="indefinite"/>
          <animate attributeName="y2" values="{s.y+6};{s.y+12};{s.y+6}" dur="{3+i*0.4}s" repeatCount="indefinite"/>
          <animate attributeName="stroke-opacity" values=".15;.04;.15" dur="{3+i*0.4}s" repeatCount="indefinite"/>
        </line>
      {/each}

      <!-- Floating particles -->
      {#each [
        {x:180,y:300,c:'#00ff88'},{x:1280,y:350,c:'#06b6d4'},{x:250,y:180,c:'#818cf8'},
        {x:1100,y:140,c:'#00ff88'},{x:650,y:150,c:'#06b6d4'},{x:440,y:200,c:'#818cf8'},
        {x:1000,y:180,c:'#00ff88'},{x:800,y:140,c:'#06b6d4'},{x:560,y:750,c:'#818cf8'},
        {x:1200,y:600,c:'#00ff88'},{x:300,y:550,c:'#06b6d4'},{x:1050,y:500,c:'#818cf8'}
      ] as pt, i}
        <circle cx={pt.x} cy={pt.y} r="1.5" fill={pt.c} opacity=".12">
          <animate attributeName="cy" values="{pt.y};{pt.y-25};{pt.y}" dur="{3.5+i*0.5}s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values=".12;.03;.12" dur="{3.5+i*0.5}s" repeatCount="indefinite"/>
        </circle>
      {/each}
    </svg>
    <div class="bg-grid"></div>
    <div class="bg-vignette"></div>
  </div>

  <!-- ===== ALERT ===== -->
  {#if alertVisible}
  <div class="alert-zone" class:alert-out={alertLeaving}>
    <div class="alert-box">
      <div class="neon-border"></div>
      <div class="alert-glass">
        <div class="radar-sweep"></div>
        <div class="alert-row">
          <div class="alert-beacon">
            <div class="beacon-ring r1"></div>
            <div class="beacon-ring r2"></div>
            <div class="beacon-ring r3"></div>
            <div class="beacon-core">
              <svg viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="1.8"/><path d="M12 9v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor"/></svg>
            </div>
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

  <!-- ===== LAYOUT ===== -->
  <div class="split">

    <!-- LEFT HERO -->
    <div class="left">
      <div class="left-content">
        <h1>
          <span class="h-line1">เพิ่มประสิทธิภาพ</span>
          <span class="h-line2">ในการวางแผนเส้นทาง</span>
        </h1>

        <p class="lead">วิเคราะห์และเปรียบเทียบเส้นทางที่ดีที่สุด<br/>ด้วยระบบนำทางอัจฉริยะแบบเรียลไทม์</p>

        <div class="stats-glass">
          <div class="stat">
            <span class="stat-num">4+</span>
            <span class="stat-label">เส้นทาง</span>
          </div>
          <div class="stat-div"></div>
          <div class="stat">
            <span class="stat-num">GPS</span>
            <span class="stat-label">เรียลไทม์</span>
          </div>
          <div class="stat-div"></div>
          <div class="stat">
            <span class="stat-num">24/7</span>
            <span class="stat-label">พร้อมใช้งาน</span>
          </div>
        </div>

        <div class="features">
          <div class="feat">
            <div class="feat-icon fi-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M8 6h4a4 4 0 014 4v0a4 4 0 01-4 4h-4" stroke-dasharray="4 3"/></svg>
            </div>
            <div class="feat-body">
              <strong>Multi-Route Analysis</strong>
              <span>เปรียบเทียบ 4 เส้นทางพร้อมกัน</span>
            </div>
          </div>
          <div class="feat">
            <div class="feat-icon fi-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2a8 8 0 00-8 8c0 5.4 8 12 8 12s8-6.6 8-12a8 8 0 00-8-8z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div class="feat-body">
              <strong>Live GPS Tracking</strong>
              <span>ติดตามตำแหน่งแบบเรียลไทม์</span>
            </div>
          </div>
          <div class="feat">
            <div class="feat-icon fi-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
            </div>
            <div class="feat-body">
              <strong>Voice Navigation</strong>
              <span>นำทางพร้อมเสียงภาษาไทย</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- RIGHT LOGIN -->
    <div class="right">
      <div class="card-wrap">
        <div class="card-glow"></div>
        <div class="card-border"></div>
        <div class="card">
          <div class="card-head">
            <div class="logo-wrap">
              <div class="logo-ring"></div>
              <div class="logo-ring ring-2"></div>
              <div class="logo-core">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
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

<!-- ===== SUCCESS ===== -->
{#if loginSuccess}
<div class="ok-over">
  <div class="ok-rays"></div>
  <div class="ok-rings">
    <div class="ok-ring ok-r1"></div>
    <div class="ok-ring ok-r2"></div>
    <div class="ok-ring ok-r3"></div>
  </div>
  <div class="ok-body">
    <div class="ok-check"><svg viewBox="0 0 60 60"><circle class="oc-c" cx="30" cy="30" r="27" fill="none" stroke="currentColor" stroke-width="2"/><path class="oc-p" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M18 30l8 8 16-16"/></svg></div>
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

  /* PAGE - CSS animation fixes black screen on client-side navigation */
  .page{min-height:100vh;position:relative;animation:pageIn .9s ease forwards}
  @keyframes pageIn{from{opacity:0}to{opacity:1}}

  /* ======== BACKGROUND ======== */
  .bg{position:fixed;inset:0;z-index:0;overflow:hidden;background:linear-gradient(160deg,#06060f 0%,#080816 40%,#0a0c1a 70%,#06060f 100%)}
  .blob{position:absolute;border-radius:50%;will-change:transform;transform:translateZ(0)}
  .b1{width:650px;height:650px;background:radial-gradient(circle,rgba(0,255,136,.14),rgba(0,255,136,.02));filter:blur(80px);top:-12%;left:-8%;animation:bf1 30s ease-in-out infinite}
  .b2{width:550px;height:550px;background:radial-gradient(circle,rgba(99,102,241,.12),rgba(99,102,241,.01));filter:blur(80px);bottom:-12%;right:-10%;animation:bf2 26s ease-in-out infinite}
  .b3{width:480px;height:480px;background:radial-gradient(circle,rgba(6,182,212,.1),rgba(6,182,212,.01));filter:blur(70px);top:15%;right:12%;animation:bf3 32s ease-in-out infinite}
  .b4{width:400px;height:400px;background:radial-gradient(circle,rgba(168,85,247,.08),rgba(168,85,247,.01));filter:blur(70px);bottom:20%;left:20%;animation:bf4 28s ease-in-out infinite}
  .b5{width:600px;height:600px;background:radial-gradient(circle,rgba(0,200,255,.12),rgba(0,200,255,.02));filter:blur(80px);top:50%;left:50%;transform:translate(-50%,-50%);animation:bf5 35s ease-in-out infinite}
  .b6{width:450px;height:450px;background:radial-gradient(circle,rgba(255,100,200,.1),rgba(255,100,200,.02));filter:blur(70px);top:60%;right:25%;animation:bf6 24s ease-in-out infinite}

  @keyframes bf1{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(70px,50px) scale(1.12)}50%{transform:translate(30px,-40px) scale(.94)}75%{transform:translate(-50px,30px) scale(1.06)}}
  @keyframes bf2{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(-60px,-40px) scale(1.1)}50%{transform:translate(-25px,50px) scale(.9)}75%{transform:translate(40px,-25px) scale(1.05)}}
  @keyframes bf3{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(-45px,35px) scale(1.14)}66%{transform:translate(55px,-25px) scale(.86)}}
  @keyframes bf4{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(45px,-45px) scale(1.08)}66%{transform:translate(-35px,35px) scale(.92)}}
  @keyframes bf5{0%,100%{transform:translate(-50%,-50%) scale(1)}25%{transform:translate(-40%,-60%) scale(1.15)}50%{transform:translate(-60%,-45%) scale(.88)}75%{transform:translate(-45%,-55%) scale(1.1)}}
  @keyframes bf6{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(-30px,40px) scale(1.12)}66%{transform:translate(40px,-30px) scale(.9)}}

  /* Aurora / Northern Lights */
  .aurora{position:absolute;inset:0;overflow:hidden;pointer-events:none}
  .aurora-band{position:absolute;width:200%;height:50%;filter:blur(60px);will-change:transform;transform:translateZ(0)}
  .a1{background:linear-gradient(90deg,transparent 0%,rgba(0,255,136,.18) 20%,rgba(6,182,212,.22) 40%,rgba(0,255,136,.12) 60%,transparent 80%);top:-5%;left:-20%;animation:auroraFlow1 20s ease-in-out infinite;transform:rotate(-8deg) skewX(-15deg)}
  .a2{background:linear-gradient(90deg,transparent 0%,rgba(99,102,241,.14) 25%,rgba(168,85,247,.18) 50%,rgba(99,102,241,.1) 75%,transparent 100%);top:15%;left:-30%;animation:auroraFlow2 25s ease-in-out infinite;transform:rotate(5deg) skewX(10deg)}
  .a3{background:linear-gradient(90deg,transparent 0%,rgba(6,182,212,.12) 30%,rgba(0,255,136,.15) 50%,rgba(6,182,212,.08) 70%,transparent 100%);top:30%;left:-15%;animation:auroraFlow3 18s ease-in-out infinite;transform:rotate(-3deg) skewX(-8deg)}
  @keyframes auroraFlow1{0%,100%{transform:translateX(0) rotate(-8deg) skewX(-15deg) scaleY(1)}25%{transform:translateX(8%) rotate(-5deg) skewX(-12deg) scaleY(1.3)}50%{transform:translateX(-5%) rotate(-10deg) skewX(-18deg) scaleY(.8)}75%{transform:translateX(4%) rotate(-6deg) skewX(-10deg) scaleY(1.1)}}
  @keyframes auroraFlow2{0%,100%{transform:translateX(0) rotate(5deg) skewX(10deg) scaleY(1)}33%{transform:translateX(-6%) rotate(8deg) skewX(14deg) scaleY(1.2)}66%{transform:translateX(5%) rotate(3deg) skewX(6deg) scaleY(.9)}}
  @keyframes auroraFlow3{0%,100%{transform:translateX(0) rotate(-3deg) skewX(-8deg)}50%{transform:translateX(10%) rotate(2deg) skewX(5deg) scaleY(1.4)}}

  /* Shooting stars */
  .shooting-star{position:absolute;width:180px;height:2px;background:linear-gradient(90deg,rgba(255,255,255,.7),rgba(0,255,136,.3),transparent);border-radius:2px;opacity:0;pointer-events:none;z-index:1}
  .shooting-star::before{content:'';position:absolute;left:0;top:-2px;width:5px;height:5px;border-radius:50%;background:#fff;box-shadow:0 0 10px 3px rgba(0,255,136,.5),0 0 20px 6px rgba(0,255,136,.2)}
  .ss1{top:15%;left:-180px;transform:rotate(25deg);animation:shoot1 7s 1s ease-in infinite}
  .ss2{top:30%;left:-180px;transform:rotate(18deg);animation:shoot2 11s 4s ease-in infinite}
  .ss3{top:10%;left:-180px;transform:rotate(35deg);animation:shoot3 9s 7s ease-in infinite}
  @keyframes shoot1{0%{transform:translateX(0) rotate(25deg);opacity:0}1%{opacity:1}8%{transform:translateX(120vw) rotate(25deg);opacity:0}100%{opacity:0}}
  @keyframes shoot2{0%{transform:translateX(0) rotate(18deg);opacity:0}1%{opacity:.9}7%{transform:translateX(130vw) rotate(18deg);opacity:0}100%{opacity:0}}
  @keyframes shoot3{0%{transform:translateX(0) rotate(35deg);opacity:0}1%{opacity:.8}9%{transform:translateX(110vw) rotate(35deg);opacity:0}100%{opacity:0}}

  /* Noise grain overlay - static for performance */
  .noise-overlay{position:absolute;inset:0;opacity:.04;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:128px 128px}

  /* Scan line effect - uses transform instead of top for GPU */
  .scan-line{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(0,255,136,.08),rgba(6,182,212,.12),rgba(0,255,136,.08),transparent);pointer-events:none;will-change:transform;animation:scanMove 8s 2s linear infinite;z-index:1}
  @keyframes scanMove{0%{transform:translateY(-2px);opacity:0}3%{opacity:1}97%{opacity:1}100%{transform:translateY(100vh);opacity:0}}

  .bg-grid{position:absolute;inset:0;background-image:radial-gradient(circle,rgba(255,255,255,.025) 1px,transparent 1px);background-size:44px 44px;opacity:0;animation:gridFade 2s .4s ease forwards}
  @keyframes gridFade{to{opacity:1}}
  .bg-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 30%,rgba(6,6,15,.5) 70%,rgba(6,6,15,.85) 100%);pointer-events:none}

  /* Star map */
  .bg-map{position:absolute;inset:0;width:100%;height:100%}
  .star-ring{opacity:0;animation:fadeIn 3s 2s ease forwards}
  .star-glow{opacity:0;animation:fadeIn 3s 2.5s ease forwards}
  .star-penta{opacity:0;animation:fadeIn 3s 3s ease forwards}
  .rte-main{stroke-dasharray:3000;stroke-dashoffset:3000;animation:drawRte 3.5s .5s ease forwards}
  @keyframes drawRte{to{stroke-dashoffset:0}}
  .rte-alt{opacity:0;animation:fadeIn 2s 1.8s ease forwards}
  .rte-conn{opacity:0;animation:fadeIn 2s 2.2s ease forwards}
  .map-pin{opacity:0;animation:pinIn .5s ease forwards}
  @keyframes pinIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{to{opacity:1}}

  /* ======== ALERT ======== */
  .alert-zone{position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:10000;width:94%;max-width:500px;animation:alertBounce .7s cubic-bezier(.36,1.4,.5,1)}
  .alert-out{animation:alertExit .5s cubic-bezier(.55,0,1,.45) forwards}
  @keyframes alertBounce{0%{opacity:0;transform:translateX(-50%) translateY(-60px) scale(.85) rotateX(15deg)}60%{opacity:1;transform:translateX(-50%) translateY(8px) scale(1.02) rotateX(-2deg)}100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1) rotateX(0)}}
  @keyframes alertExit{to{opacity:0;transform:translateX(-50%) translateY(-40px) scale(.9) rotateX(10deg)}}
  .alert-box{position:relative;perspective:600px}
  .neon-border{position:absolute;inset:-2px;border-radius:22px;background:conic-gradient(from var(--a,0deg),#ff0040,#ff4080,#ff0040,transparent 40%,transparent 60%,#ff4060,#ff0040);animation:neonSpin 3s linear infinite;padding:2px;mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;-webkit-mask-composite:xor;filter:blur(.5px);opacity:.8}
  @property --a{syntax:"<angle>";initial-value:0deg;inherits:false}
  @keyframes neonSpin{to{--a:360deg}}
  .alert-glass{position:relative;border-radius:20px;background:rgba(12,6,10,.92);backdrop-filter:blur(40px) saturate(1.8);overflow:hidden;border:1px solid rgba(255,40,60,.08);box-shadow:0 25px 80px rgba(0,0,0,.7),0 0 120px rgba(255,0,40,.06),inset 0 1px 0 rgba(255,255,255,.04)}
  .radar-sweep{position:absolute;top:0;left:0;width:200%;height:200%;background:conic-gradient(from 0deg at 0% 0%,transparent 0deg,rgba(255,40,60,.05) 30deg,transparent 60deg);animation:radarSpin 4s linear infinite;pointer-events:none}
  @keyframes radarSpin{to{transform:rotate(360deg)}}
  .alert-row{display:flex;align-items:center;gap:16px;padding:20px 22px;position:relative;z-index:2}
  .alert-beacon{position:relative;width:48px;height:48px;min-width:48px;display:flex;align-items:center;justify-content:center}
  .beacon-ring{position:absolute;inset:0;border-radius:14px;border:1.5px solid rgba(255,40,60,.25)}
  .r1{animation:bRing 2s ease-out infinite}.r2{animation:bRing 2s ease-out infinite .5s}.r3{animation:bRing 2s ease-out infinite 1s}
  @keyframes bRing{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.8);opacity:0}}
  .beacon-core{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,rgba(255,40,60,.2),rgba(255,40,60,.05));display:flex;align-items:center;justify-content:center;position:relative;z-index:1}
  .beacon-core svg{width:24px;height:24px;color:#ff4060}
  .alert-info{flex:1;display:flex;flex-direction:column;gap:4px}
  .alert-tag{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;color:#ff6080;font-family:'Space Mono',monospace;letter-spacing:2px}
  .tag-dot{width:6px;height:6px;border-radius:50%;background:#ff4060;box-shadow:0 0 8px #ff4060;animation:tagBlink 1s steps(2) infinite}
  @keyframes tagBlink{50%{opacity:.2}}
  .alert-msg{font-size:14px;color:#ddb0b8;line-height:1.5}
  .alert-dismiss{width:34px;height:34px;min-width:34px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;cursor:pointer;transition:all .25s}
  .alert-dismiss:hover{background:rgba(255,40,60,.15);border-color:rgba(255,40,60,.3);transform:rotate(90deg)}
  .alert-dismiss svg{width:14px;height:14px;color:#666;transition:color .25s}
  .alert-dismiss:hover svg{color:#ff4060}
  .alert-timeline{height:3px;background:rgba(255,255,255,.03);position:relative;z-index:2}
  .timeline-fill{height:100%;width:100%;background:linear-gradient(90deg,#ff0040,#ff4080,#ff8060,#ff4080,#ff0040);background-size:400% 100%;animation:tlShrink 5s linear forwards,tlShimmer 1s linear infinite}
  @keyframes tlShrink{to{width:0}}
  @keyframes tlShimmer{from{background-position:0 0}to{background-position:400% 0}}

  /* ======== LAYOUT ======== */
  .split{position:relative;z-index:1;display:flex;min-height:100vh}

  /* LEFT HERO */
  .left{flex:1;display:flex;align-items:center;padding:60px 50px 60px 80px;animation:slideLeft .8s .2s ease both}
  @keyframes slideLeft{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:none}}
  .left-content{max-width:560px}

  .sys-badge{display:inline-flex;align-items:center;gap:10px;padding:7px 18px;background:rgba(0,255,136,.03);border:1px solid rgba(0,255,136,.08);border-radius:100px;margin-bottom:32px;animation:badgePulse 4s ease-in-out infinite}
  @keyframes badgePulse{0%,100%{box-shadow:0 0 0 0 rgba(0,255,136,0)}50%{box-shadow:0 0 0 6px rgba(0,255,136,.04)}}
  .badge-led{width:6px;height:6px;border-radius:50%;background:#00ff88;box-shadow:0 0 10px #00ff88,0 0 25px rgba(0,255,136,.3);animation:ledPulse 2s ease infinite}
  @keyframes ledPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}
  .badge-text{font-size:11px;font-weight:700;color:#00ff88;font-family:'Space Mono',monospace;letter-spacing:2px}
  .badge-ver{font-size:9px;font-weight:400;color:#3f3f46;font-family:'Space Mono',monospace;padding:2px 8px;background:rgba(255,255,255,.03);border-radius:20px}

  h1{margin-bottom:22px;line-height:1.1}
  .h-line1{display:block;font-size:52px;font-weight:900;background:linear-gradient(135deg,#ffffff 0%,#d4d4d8 30%,#00ff88 55%,#06b6d4 80%,#818cf8 100%);background-size:300% 300%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:gradShift 8s ease infinite}
  @keyframes gradShift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
  .h-line2{display:block;font-size:36px;font-weight:700;color:#52525b;margin-top:4px}

  .lead{font-size:15px;color:#3f3f46;line-height:1.8;margin-bottom:36px}

  /* Stats Glass */
  .stats-glass{display:flex;align-items:center;gap:0;padding:20px 28px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);border-radius:18px;backdrop-filter:blur(12px);margin-bottom:40px;animation:slideLeft 1s .4s ease both}
  .stat{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
  .stat-num{font-size:26px;font-weight:800;font-family:'Space Mono',monospace;background:linear-gradient(135deg,#00ff88,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .stat-label{font-size:11px;color:#52525b;font-weight:500}
  .stat-div{width:1px;height:36px;background:linear-gradient(to bottom,transparent,rgba(255,255,255,.06),transparent)}

  /* Features */
  .features{display:flex;flex-direction:column;gap:4px}
  .feat{display:flex;align-items:center;gap:16px;padding:14px 16px;border-radius:14px;transition:all .3s;cursor:default;animation:featIn .6s ease both}
  .feat:nth-child(1){animation-delay:.6s}.feat:nth-child(2){animation-delay:.75s}.feat:nth-child(3){animation-delay:.9s}
  @keyframes featIn{from{opacity:0;transform:translateX(-20px)}to{opacity:1;transform:none}}
  .feat:hover{background:rgba(255,255,255,.02)}
  .feat-icon{width:42px;height:42px;min-width:42px;display:flex;align-items:center;justify-content:center;border-radius:12px;transition:all .3s}
  .feat-icon svg{width:20px;height:20px}
  .fi-1{background:rgba(0,255,136,.06);border:1px solid rgba(0,255,136,.1);color:#00ff88}
  .fi-2{background:rgba(6,182,212,.06);border:1px solid rgba(6,182,212,.1);color:#06b6d4}
  .fi-3{background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.1);color:#818cf8}
  .feat:hover .fi-1{box-shadow:0 0 20px rgba(0,255,136,.1)}.feat:hover .fi-2{box-shadow:0 0 20px rgba(6,182,212,.1)}.feat:hover .fi-3{box-shadow:0 0 20px rgba(99,102,241,.1)}
  .feat-body{display:flex;flex-direction:column}
  .feat-body strong{font-size:13px;font-weight:600;color:#d4d4d8;font-family:'Space Mono',monospace}
  .feat-body span{font-size:11px;color:#52525b;margin-top:2px}

  /* RIGHT */
  .right{width:520px;min-width:520px;display:flex;align-items:center;justify-content:center;padding:40px;position:relative;animation:slideRight .8s .3s ease both}
  @keyframes slideRight{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:none}}
  .right::before{content:'';position:absolute;left:0;top:8%;bottom:8%;width:1px;background:linear-gradient(to bottom,transparent,rgba(0,255,136,.05) 30%,rgba(99,102,241,.05) 70%,transparent)}

  .card-wrap{position:relative;width:100%;max-width:420px}

  .card-glow{position:absolute;top:50%;left:50%;width:320px;height:320px;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(0,255,136,.05),transparent 70%);pointer-events:none;filter:blur(50px)}

  .card-border{position:absolute;inset:-1.5px;border-radius:28px;background:conic-gradient(from var(--a,0deg),rgba(0,255,136,.35),rgba(6,182,212,.2),rgba(99,102,241,.2),transparent 45%,transparent 70%,rgba(0,255,136,.25));animation:neonSpin 8s linear infinite;padding:1.5px;mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;-webkit-mask-composite:xor;opacity:.5}

  .card{position:relative;padding:44px 40px;background:rgba(10,10,20,.75);backdrop-filter:blur(60px) saturate(1.4);border-radius:26px;border:1px solid rgba(255,255,255,.04);box-shadow:0 40px 100px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.02),inset 0 1px 0 rgba(255,255,255,.04)}

  .card-head{text-align:center;margin-bottom:36px}

  .logo-wrap{position:relative;display:inline-flex;margin-bottom:20px}
  .logo-ring{position:absolute;inset:-10px;border-radius:50%;border:1.5px solid rgba(0,255,136,.12);animation:orbitSpin 18s linear infinite}
  .logo-ring::after{content:'';position:absolute;top:-4px;left:50%;width:7px;height:7px;border-radius:50%;background:#00ff88;box-shadow:0 0 12px #00ff88;transform:translateX(-50%)}
  .ring-2{inset:-20px;border:1px dashed rgba(6,182,212,.08);animation:orbitSpin 28s linear infinite reverse}
  .ring-2::after{width:5px;height:5px;background:#06b6d4;box-shadow:0 0 10px #06b6d4}
  @keyframes orbitSpin{to{transform:rotate(360deg)}}
  .logo-core{width:64px;height:64px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#00ff88,#00cc6a,#06b6d4);border-radius:20px;box-shadow:0 12px 44px rgba(0,255,136,.25),0 0 80px rgba(0,255,136,.06)}
  .logo-core svg{width:30px;height:30px;color:#06060f}

  .card-head h2{font-size:26px;font-weight:800;color:#f4f4f5;margin-bottom:6px;letter-spacing:-.5px}
  .card-head p{font-size:13px;color:#52525b}

  .form{display:flex;flex-direction:column;gap:24px}
  .field{display:flex;flex-direction:column;gap:8px}
  .field label{font-size:10px;font-weight:700;color:#52525b;font-family:'Space Mono',monospace;letter-spacing:2px}

  .inp-wrap{position:relative;display:flex;align-items:center;height:52px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.05);border-radius:14px;overflow:hidden;transition:all .3s}
  .inp-wrap:focus-within{border-color:rgba(0,255,136,.2);box-shadow:0 0 0 3px rgba(0,255,136,.04),0 0 30px rgba(0,255,136,.02)}
  .inp-icon{width:48px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .inp-icon svg{width:18px;height:18px;color:#3f3f46;transition:color .3s}
  .inp-wrap:focus-within .inp-icon svg{color:#00ff88}
  .inp-wrap input{flex:1;height:100%;background:none;border:none;outline:none;color:#e4e4e7;font-family:'Kanit';font-size:14px;padding-right:12px}
  .inp-wrap input::placeholder{color:#2a2a3a}
  .inp-wrap input:disabled{opacity:.4}
  .inp-wrap input:-webkit-autofill,.inp-wrap input:-webkit-autofill:hover,.inp-wrap input:-webkit-autofill:focus,.inp-wrap input:-webkit-autofill:active{-webkit-text-fill-color:#e4e4e7;-webkit-box-shadow:0 0 0 1000px rgba(6,6,15,.95) inset;transition:background-color 5000s ease-in-out 0s;caret-color:#e4e4e7;font-family:'Kanit';font-size:14px}
  .inp-line{position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#00ff88,transparent);transform:scaleX(0);transition:transform .4s}
  .inp-wrap:focus-within .inp-line{transform:scaleX(1)}

  .eye{width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.04);border-radius:8px;cursor:pointer;margin-right:8px;transition:all .2s}
  .eye:hover{background:rgba(255,255,255,.07)}
  .eye svg{width:16px;height:16px;color:#52525b}

  .check-row{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;color:#71717a;user-select:none}
  .check-row input{display:none}
  .ck-box{width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:1.5px solid rgba(255,255,255,.1);border-radius:6px;transition:all .25s}
  .ck-box svg{width:12px;height:12px;color:#06060f;opacity:0;transition:all .2s}
  .check-row input:checked+.ck-box{background:linear-gradient(135deg,#00ff88,#00cc6a);border-color:#00ff88;box-shadow:0 0 14px rgba(0,255,136,.3)}
  .check-row input:checked+.ck-box svg{opacity:1}

  .btn-go{height:54px;width:100%;margin-top:4px;display:flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#00ff88,#00cc6a);border:none;border-radius:16px;color:#06060f;font-family:'Kanit';font-size:16px;font-weight:800;cursor:pointer;position:relative;overflow:hidden;box-shadow:0 8px 36px rgba(0,255,136,.2);transition:all .35s cubic-bezier(.4,0,.2,1)}
  .btn-go::before{content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);animation:goSheen 3s ease-in-out infinite}
  @keyframes goSheen{0%,100%{left:-100%}50%{left:150%}}
  .btn-go:hover:not(:disabled){transform:translateY(-3px);box-shadow:0 14px 50px rgba(0,255,136,.3),0 0 80px rgba(0,255,136,.06)}
  .btn-go:active:not(:disabled){transform:translateY(-1px)}
  .btn-go:disabled{opacity:.4;cursor:not-allowed}
  .btn-go svg{width:20px;height:20px;transition:transform .3s}
  .btn-go:hover svg{transform:translateX(5px)}
  .btn-go span{position:relative;z-index:1}
  .btn-loader{width:20px;height:20px;border:2.5px solid rgba(6,6,15,.2);border-top-color:#06060f;border-radius:50%;animation:spin .55s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}

  .card-foot{display:flex;align-items:center;gap:14px;margin-top:32px}
  .foot-line{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent)}
  .card-foot span{font-size:9px;color:#2a2a3a;font-family:'Space Mono',monospace;letter-spacing:1px;white-space:nowrap}

  /* ======== RESPONSIVE ======== */
  @media(max-width:1100px){.left{display:none}.right{width:100%;min-width:unset}.right::before{display:none}}
  @media(max-width:768px){.bg-map{display:none}.aurora,.shooting-star,.scan-line,.noise-overlay{display:none}}
  @media(max-width:480px){.right{padding:16px}.card{padding:32px 24px;border-radius:22px}}

  /* ======== SUCCESS ======== */
  .ok-over{position:fixed;inset:0;z-index:9999;background:rgba(6,6,15,.98);display:flex;align-items:center;justify-content:center;animation:fadeIn .4s ease}
  @keyframes fadeIn{from{opacity:0}}
  .ok-rays{position:absolute;top:50%;left:50%;width:400px;height:400px;transform:translate(-50%,-50%);background:conic-gradient(from 0deg,transparent,rgba(0,255,136,.03),transparent,rgba(6,182,212,.02),transparent,rgba(0,255,136,.03),transparent);animation:raySpin 10s linear infinite;border-radius:50%}
  @keyframes raySpin{to{transform:translate(-50%,-50%) rotate(360deg)}}
  .ok-rings{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}
  .ok-ring{position:absolute;border-radius:50%;border:1px solid rgba(0,255,136,.1);top:50%;left:50%;transform:translate(-50%,-50%)}
  .ok-r1{width:200px;height:200px;animation:ringGrow 2s ease-out infinite}
  .ok-r2{width:300px;height:300px;animation:ringGrow 2s ease-out infinite .5s}
  .ok-r3{width:400px;height:400px;animation:ringGrow 2s ease-out infinite 1s}
  @keyframes ringGrow{0%{transform:translate(-50%,-50%) scale(.8);opacity:.4}100%{transform:translate(-50%,-50%) scale(1.2);opacity:0}}
  .ok-body{position:relative;display:flex;flex-direction:column;align-items:center;gap:16px;animation:popIn .6s .2s cubic-bezier(.34,1.56,.64,1) both}
  @keyframes popIn{from{opacity:0;transform:scale(.5) translateY(30px)}to{opacity:1;transform:none}}
  .ok-check{width:80px;height:80px;color:#00ff88;filter:drop-shadow(0 0 24px rgba(0,255,136,.5))}
  .ok-check svg{width:100%;height:100%}
  .oc-c{stroke-dasharray:170;stroke-dashoffset:170;animation:drawC .6s .3s ease forwards}
  @keyframes drawC{to{stroke-dashoffset:0}}
  .oc-p{stroke-dasharray:50;stroke-dashoffset:50;animation:drawP .4s .7s ease forwards}
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
  .ok-txt{font-size:11px;color:#3f3f46;font-family:'Space Mono',monospace;animation:blink 1.2s steps(2) infinite}
  @keyframes blink{50%{opacity:.15}}
</style>
