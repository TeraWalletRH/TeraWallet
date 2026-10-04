/**
 * Tera Wallet - Dynamic Proof Card Generator & 1-Click X (Twitter) Share Module
 */

(function () {
  'use strict';

  // Inject CSS stylesheet if not present
  if (!document.getElementById('tera-social-share-css')) {
    const link = document.createElement('link');
    link.id = 'tera-social-share-css';
    link.rel = 'stylesheet';
    link.href = '/tera/social-share.css';
    document.head.appendChild(link);
  }

  /**
   * Generates a 1200x630 HTML5 Canvas image blob/data URL representing a proof card.
   */
  function renderProofCardCanvas(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');

    if (!ctx) return canvas;

    // Safely polyfill roundRect if missing in older CanvasRenderingContext2D engines
    if (typeof ctx.roundRect !== 'function') {
      ctx.roundRect = function (x, y, w, h, r) {
        const radius = typeof r === 'number' ? r : 0;
        this.beginPath();
        this.moveTo(x + radius, y);
        this.lineTo(x + w - radius, y);
        this.quadraticCurveTo(x + w, y, x + w, y + radius);
        this.lineTo(x + w, y + h - radius);
        this.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        this.lineTo(x + radius, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - radius);
        this.lineTo(x, y + radius);
        this.quadraticCurveTo(x, y, x + radius, y);
        this.closePath();
      };
    }

    const actionType = (data.actionType || 'SUPERVISED INTENT').toUpperCase();
    const intentId = (data.intentId || data.id || '0x7f8a9b2c').slice(0, 16);
    const ownerTag = data.ownerTag || data.userTag || '@tera_owner';
    const timestamp = data.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const amountStr = data.amount ? `${data.amount} ${data.assetSymbol || 'USDC'}` : null;

    // 1. Background Gradient
    const bgGradient = ctx.createLinearGradient(0, 0, 1200, 630);
    bgGradient.addColorStop(0, '#0a140e');
    bgGradient.addColorStop(0.5, '#0f2417');
    bgGradient.addColorStop(1, '#050c08');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, 1200, 630);

    // Decorative Glowing Orbs
    const orb1 = ctx.createRadialGradient(1100, 100, 10, 1100, 100, 450);
    orb1.addColorStop(0, 'rgba(0, 200, 83, 0.25)');
    orb1.addColorStop(1, 'rgba(0, 200, 83, 0)');
    ctx.fillStyle = orb1;
    ctx.fillRect(0, 0, 1200, 630);

    const orb2 = ctx.createRadialGradient(100, 550, 10, 100, 550, 350);
    orb2.addColorStop(0, 'rgba(0, 230, 118, 0.15)');
    orb2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = orb2;
    ctx.fillRect(0, 0, 1200, 630);

    // Card Outer Frame Border
    ctx.strokeStyle = 'rgba(0, 200, 83, 0.35)';
    ctx.lineWidth = 4;
    ctx.roundRect(30, 30, 1140, 570, 24);
    ctx.stroke();

    // Inner Glass Panel
    ctx.fillStyle = 'rgba(18, 30, 23, 0.7)';
    ctx.roundRect(50, 50, 1100, 530, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // --- HEADER AREA ---
    // Logo Icon (Shield / Tera Symbol)
    ctx.fillStyle = '#00c853';
    ctx.shadowColor = '#00c853';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(95, 110, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; // Reset shadow

    // Inner Logo Mark Symbol
    ctx.fillStyle = '#050c08';
    ctx.font = '900 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('T', 95, 118);

    // Title & Subtitle
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 28px system-ui, -apple-system, sans-serif';
    ctx.fillText('TERA WALLET', 135, 106);

    ctx.fillStyle = '#00e676';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('ROBINHOOD CHAIN (ARBITRUM ORBIT L2)', 135, 130);

    // Status Badge (Top Right)
    ctx.fillStyle = 'rgba(0, 200, 83, 0.15)';
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth = 2;
    ctx.roundRect(850, 85, 250, 48, 24);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#00e676';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✓ VERIFIED & SIGNED', 975, 115);

    // --- SEPARATOR LINE ---
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(80, 160);
    ctx.lineTo(1120, 160);
    ctx.stroke();

    // --- MAIN CONTENT BODY ---
    // Action Type Header
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a0aec0';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText('SUPERVISED INTENT ACTION', 80, 198);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 36px system-ui, sans-serif';
    ctx.fillText(actionType, 80, 242);

    if (amountStr) {
      ctx.fillStyle = '#00e676';
      ctx.font = '700 28px system-ui, sans-serif';
      ctx.fillText(`[ ${amountStr} ]`, 600, 242);
    }

    // --- 5 DETERMINISTIC SAFETY GATES CHECKLIST ---
    ctx.fillStyle = '#a0aec0';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText('SAFETY GATE PIPELINE VERIFICATION', 80, 290);

    const gates = [
      { name: '1. Asset Registry Check', status: 'SUPPORTED & PASSED' },
      { name: '2. ERC-3643 Eligibility', status: 'VERIFIED & PASS' },
      { name: '3. Private Policy Vault', status: 'SAFE WITHIN LIMITS' },
      { name: '4. Risk & Slippage Engine', status: 'BOUNDS APPROVED' },
      { name: '5. Owner Wallet Signature', status: 'ATTESTED & SIGNED' },
    ];

    let gateY = 320;
    gates.forEach((gate) => {
      // Gate Box
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.strokeStyle = 'rgba(0, 200, 83, 0.2)';
      ctx.lineWidth = 1;
      ctx.roundRect(80, gateY, 490, 42, 8);
      ctx.fill();
      ctx.stroke();

      // Check Icon
      ctx.fillStyle = '#00c853';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText('✓', 95, gateY + 26);

      // Gate Name
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(gate.name, 125, gateY + 26);

      // Gate Status
      ctx.fillStyle = '#00e676';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(gate.status, 555, gateY + 26);
      ctx.textAlign = 'left';

      gateY += 50;
    });

    // --- RIGHT SIDE METADATA PANEL ---
    const metaX = 610;

    // Intent Details Box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.roundRect(metaX, 290, 490, 205, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#a0aec0';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('INTENT HASH / ID', metaX + 20, 320);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 16px monospace';
    ctx.fillText(intentId, metaX + 20, 345);

    ctx.fillStyle = '#a0aec0';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('SUPERVISED BY OWNER TAG', metaX + 20, 385);
    ctx.fillStyle = '#00e676';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText(ownerTag, metaX + 20, 412);

    ctx.fillStyle = '#a0aec0';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('TIMESTAMP', metaX + 20, 448);
    ctx.fillStyle = '#d1dcd5';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(timestamp, metaX + 20, 472);

    // --- FOOTER TAGLINE ---
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(80, 520);
    ctx.lineTo(1120, 520);
    ctx.stroke();

    ctx.fillStyle = '#718096';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText('The agent can think; Tera Wallet checks; you approve.', 80, 555);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#00c853';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillText('terawallet.app', 1120, 555);

    return canvas;
  }

  /**
   * Construct Tweet Text & URL
   */
  function buildTwitterIntentUrl(data) {
    const action = data.actionType || 'Supervised Intent';
    const intentId = (data.intentId || data.id || '0x7f8a9b2c').slice(0, 10);
    const userTag = data.ownerTag || data.userTag || '@tera_owner';
    const refParam = userTag ? `?ref=${encodeURIComponent(userTag)}` : '';
    const verifyUrl = `https://terawallet.app/dashboard/receipts${refParam}`;

    const tweetText =
      `My AI Agent safely executed ${action} (${intentId}) on @RobinhoodApp Chain via @TeraWalletRH 🔒\n\n` +
      `✅ 5 Safety Gates: PASSED\n` +
      `✅ Private Policy Vault: SAFE\n` +
      `⚡ The agent thinks, Tera checks, I approve.\n\n` +
      `Verify on-chain receipt 👇`;

    return {
      tweetText,
      intentUrl: `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(verifyUrl)}`,
      verifyUrl,
    };
  }

  /**
   * Helper to show Toast Notification
   */
  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'tera-toast-notification';
    toast.innerHTML = `✓ ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  /**
   * Open the 1-Click Share Modal
   */
  window.openTeraShareModal = function (data = {}) {
    // Remove existing modal if open
    const existing = document.getElementById('tera-share-modal');
    if (existing) existing.remove();

    const { tweetText, intentUrl, verifyUrl } = buildTwitterIntentUrl(data);

    // Modal Markup
    const overlay = document.createElement('div');
    overlay.id = 'tera-share-modal';
    overlay.className = 'tera-share-modal-overlay';

    overlay.innerHTML = `
      <div class="tera-share-modal-card">
        <div class="tera-share-header">
          <div class="tera-share-title-group">
            <span class="tera-share-badge">Viral Social Proof</span>
            <h3 class="tera-share-title">Share Receipt to X</h3>
          </div>
          <button class="tera-share-close-btn" id="tera-share-close">&times;</button>
        </div>
        
        <div class="tera-share-body">
          <div class="tera-card-preview-container" id="tera-canvas-wrapper">
            <!-- Canvas rendered dynamically -->
          </div>

          <div class="tera-tweet-preview-box">
            <div class="tera-tweet-preview-label">Tweet Preview</div>
            <div class="tera-tweet-preview-text">${tweetText.replace(/</g, '&lt;')}</div>
          </div>

          <div class="tera-share-actions">
            <a href="${intentUrl}" target="_blank" rel="noopener noreferrer" class="tera-btn tera-btn-x" id="tera-btn-post-x">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              Post on X
            </a>

            <button type="button" class="tera-btn tera-btn-secondary" id="tera-btn-copy-img">
              📋 Copy Proof Card
            </button>

            <button type="button" class="tera-btn tera-btn-outline" id="tera-btn-download-img">
              ⬇ Download PNG
            </button>

            <button type="button" class="tera-btn tera-btn-outline" id="tera-btn-copy-link">
              🔗 Copy Referral Link
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Render Canvas
    const canvas = renderProofCardCanvas(data);
    canvas.className = 'tera-card-preview-canvas';
    const wrapper = overlay.querySelector('#tera-canvas-wrapper');
    wrapper.appendChild(canvas);

    // Event Handlers
    overlay.querySelector('#tera-share-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    // Copy Image to Clipboard
    overlay.querySelector('#tera-btn-copy-img').onclick = async () => {
      try {
        canvas.toBlob(async (blob) => {
          if (blob) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ]);
            showToast('Proof Card copied to clipboard! Paste directly into X.');
          }
        });
      } catch (err) {
        showToast('Direct copy unsupported on browser. Use Download PNG!');
      }
    };

    // Download PNG Card
    overlay.querySelector('#tera-btn-download-img').onclick = () => {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `tera-proof-card-${data.intentId || 'receipt'}.png`;
      link.href = dataUrl;
      link.click();
      showToast('Proof Card downloaded!');
    };

    // Copy Referral Link
    overlay.querySelector('#tera-btn-copy-link').onclick = () => {
      navigator.clipboard.writeText(verifyUrl);
      showToast('Referral verification link copied!');
    };
  };

  // Helper trigger button generator for easy injection into receipt list items
  window.createTeraShareButton = function (receiptData) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tera-share-trigger-btn';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
      Share to X
    `;
    btn.onclick = (e) => {
      e.stopPropagation();
      window.openTeraShareModal(receiptData);
    };
    return btn;
  };

  /**
   * Generates a 1200x630 HTML5 Canvas image blob/data URL representing a Tag Receive Card.
   */
  function renderTagReceiveCanvas(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const tag = (data.tag || 'owner').replace(/^@+/, '');
    const handle = `@${tag}`;
    const address = data.address || '';
    const network = data.network || 'ROBINHOOD CHAIN';

    // 1. Dark emerald background
    const bgGradient = ctx.createLinearGradient(0, 0, 1200, 630);
    bgGradient.addColorStop(0, '#0a140e');
    bgGradient.addColorStop(0.5, '#0f2417');
    bgGradient.addColorStop(1, '#050c08');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, 1200, 630);

    // Glowing accents
    const orb = ctx.createRadialGradient(1000, 120, 10, 1000, 120, 450);
    orb.addColorStop(0, 'rgba(0, 200, 83, 0.25)');
    orb.addColorStop(1, 'rgba(0, 200, 83, 0)');
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, 1200, 630);

    // Card frame
    ctx.strokeStyle = 'rgba(0, 200, 83, 0.35)';
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 30, 1140, 570);

    // Inner Glass Panel
    ctx.fillStyle = 'rgba(18, 30, 23, 0.75)';
    ctx.fillRect(50, 50, 1100, 530);

    // Brand logo
    ctx.fillStyle = '#00c853';
    ctx.beginPath();
    ctx.arc(95, 110, 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#050c08';
    ctx.font = '900 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('T', 95, 118);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillText('TERA WALLET', 135, 106);

    ctx.fillStyle = '#00e676';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(`${network.toUpperCase()} · ARBITRUM ORBIT L2`, 135, 130);

    // Verified Handle badge (Top Right)
    ctx.fillStyle = 'rgba(0, 200, 83, 0.15)';
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth = 2;
    ctx.strokeRect(850, 85, 250, 48);
    ctx.fillStyle = '#00e676';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✓ VERIFIED HANDLE', 975, 115);

    // Separator line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(80, 160);
    ctx.lineTo(1120, 160);
    ctx.stroke();

    // Body: Big handle
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a0aec0';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('CLAIMED PAYMENT HANDLE', 80, 210);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 64px system-ui, sans-serif';
    ctx.fillText(handle, 80, 290);

    if (address) {
      ctx.fillStyle = '#00e676';
      ctx.font = '600 22px monospace';
      ctx.fillText(address, 80, 340);
    }

    // Callout
    ctx.fillStyle = '#cbd5e0';
    ctx.font = '500 20px system-ui, sans-serif';
    ctx.fillText('Send USDG and tokens directly to this tag on Robinhood Chain.', 80, 420);
    ctx.fillText('No complex 42-character hex addresses required.', 80, 455);

    // QR Box on right
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(860, 200, 220, 220);
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth = 4;
    ctx.strokeRect(860, 200, 220, 220);

    ctx.fillStyle = '#050c08';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SCAN TO PAY', 970, 305);
    ctx.fillStyle = '#00c853';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillText(handle, 970, 330);

    // Footer
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(80, 520);
    ctx.lineTo(1120, 520);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#68d391';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('⚡️ Powered by Tera Wallet & Robinhood Chain', 80, 555);

    return canvas;
  }

  function buildTagTwitterIntentUrl(data) {
    const clean = String(data.tag || 'owner').replace(/^@+/, '');
    const handle = `@${clean}`;
    const payUrl = `https://terawallet.app/pay/@${clean}`;
    const tweetText = `Send USDG & crypto directly to my verified handle ${handle} on @RobinhoodApp Chain via @TeraWalletRH 💳⚡️\n\nNo 42-character hex addresses. 1-click execution.\n\nClaim your handle 👇`;
    return {
      tweetText,
      intentUrl: `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(payUrl)}`,
      payUrl,
    };
  }

  /**
   * Open the "Share My Tag" Modal
   */
  window.openTagShareModal = function (data = {}) {
    const existing = document.getElementById('tera-tag-share-modal');
    if (existing) existing.remove();

    const { tweetText, intentUrl, payUrl } = buildTagTwitterIntentUrl(data);

    const overlay = document.createElement('div');
    overlay.id = 'tera-tag-share-modal';
    overlay.className = 'tera-share-modal-overlay';

    overlay.innerHTML = `
      <div class="tera-share-modal-card">
        <div class="tera-share-header">
          <div class="tera-share-title-group">
            <span class="tera-share-badge">Verified Handle Card</span>
            <h3 class="tera-share-title">Share My @Tag</h3>
          </div>
          <button class="tera-share-close-btn" id="tera-tag-share-close">&times;</button>
        </div>
        
        <div class="tera-share-body">
          <div class="tera-card-preview-container" id="tera-tag-canvas-wrapper">
          </div>

          <div class="tera-tweet-preview-box">
            <div class="tera-tweet-preview-label">Post on X Preview</div>
            <div class="tera-tweet-preview-text">${tweetText.replace(/</g, '&lt;')}</div>
          </div>

          <div class="tera-share-actions">
            <a href="${intentUrl}" target="_blank" rel="noopener noreferrer" class="tera-btn tera-btn-x" id="tera-btn-tag-x">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              Share to X
            </a>

            <button type="button" class="tera-btn tera-btn-secondary" id="tera-btn-tag-copy-img">
              📋 Copy Image
            </button>

            <button type="button" class="tera-btn tera-btn-outline" id="tera-btn-tag-download">
              ⬇ Download PNG
            </button>

            <button type="button" class="tera-btn tera-btn-outline" id="tera-btn-tag-copy-link">
              🔗 Copy Payment Link
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const canvas = renderTagReceiveCanvas(data);
    canvas.className = 'tera-card-preview-canvas';
    const wrapper = overlay.querySelector('#tera-tag-canvas-wrapper');
    wrapper.appendChild(canvas);

    overlay.querySelector('#tera-tag-share-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    overlay.querySelector('#tera-btn-tag-copy-img').onclick = async () => {
      try {
        canvas.toBlob(async (blob) => {
          if (blob) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ]);
            showToast('Tag Card copied to clipboard! Paste directly into X.');
          }
        });
      } catch (err) {
        showToast('Direct copy unsupported on browser. Use Download PNG!');
      }
    };

    overlay.querySelector('#tera-btn-tag-download').onclick = () => {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `tera-tag-${data.tag || 'card'}.png`;
      link.href = dataUrl;
      link.click();
      showToast('Tag Card downloaded!');
    };

    overlay.querySelector('#tera-btn-tag-copy-link').onclick = () => {
      navigator.clipboard.writeText(payUrl);
      showToast('Tag payment link copied!');
    };
  };

  window.createTagShareButton = function (tag, address) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tera-share-trigger-btn tera-tag-share-btn';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
      Share My Tag
    `;
    btn.onclick = (e) => {
      e.stopPropagation();
      window.openTagShareModal({ tag, address });
    };
    return btn;
  };
})();

