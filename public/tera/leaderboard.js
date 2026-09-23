/**
 * Tera Wallet - Viral Referral Leaderboard & "Agent Supervisor" Rank Cards
 */

(function () {
  'use strict';

  // Inject CSS stylesheet if not present
  if (!document.getElementById('tera-leaderboard-css')) {
    const link = document.createElement('link');
    link.id = 'tera-leaderboard-css';
    link.rel = 'stylesheet';
    link.href = '/tera/leaderboard.css';
    document.head.appendChild(link);
  }

  // Sample Mock Leaderboard Data (complemented by live wallet account state)
  const TOP_SUPERVISORS = [
    { rank: 1, handle: '@astra', address: '0x3c12...3ff8', intentsCount: 184, referralsCount: 42, points: 18400, tier: 'master' },
    { rank: 2, handle: '@satoshi_ai', address: '0x8f19...4b92', intentsCount: 142, referralsCount: 31, points: 14200, tier: 'master' },
    { rank: 3, handle: '@quantum_dev', address: '0x7a8c...901e', intentsCount: 119, referralsCount: 28, points: 11900, tier: 'master' },
    { rank: 4, handle: '@rwa_whale', address: '0x4d12...883c', intentsCount: 95, referralsCount: 19, points: 9500, tier: 'diamond' },
    { rank: 5, handle: '@robinhood_pro', address: '0x1e9a...554f', intentsCount: 88, referralsCount: 15, points: 8800, tier: 'diamond' },
    { rank: 6, handle: '@cyber_agent', address: '0x6b44...221d', intentsCount: 74, referralsCount: 12, points: 7400, tier: 'gold' },
    { rank: 7, handle: '@orbit_node', address: '0x99c1...6601', intentsCount: 62, referralsCount: 9, points: 6200, tier: 'gold' },
    { rank: 8, handle: '@crypto_alex', address: '0x550a...9911', intentsCount: 51, referralsCount: 7, points: 5100, tier: 'silver' },
    { rank: 9, handle: '@vault_guard', address: '0x2289...337a', intentsCount: 43, referralsCount: 5, points: 4300, tier: 'silver' },
    { rank: 10, handle: '@tera_pioneer', address: '0x00f1...118e', intentsCount: 35, referralsCount: 4, points: 3500, tier: 'bronze' },
  ];

  /**
   * Determine Rank Tier metadata
   */
  function getTierConfig(tier) {
    switch (tier?.toLowerCase()) {
      case 'master':
        return { label: '👑 Master Supervisor', title: 'TOP 1% AGENT SUPERVISOR', color: '#ffd700', bg: 'rgba(255, 215, 0, 0.2)' };
      case 'diamond':
        return { label: '💎 Diamond Supervisor', title: 'TOP 5% AGENT SUPERVISOR', color: '#00e5ff', bg: 'rgba(0, 229, 255, 0.2)' };
      case 'gold':
        return { label: '🥇 Gold Supervisor', title: 'TOP 15% AGENT SUPERVISOR', color: '#ffab00', bg: 'rgba(255, 171, 0, 0.2)' };
      case 'silver':
        return { label: '🥈 Silver Supervisor', title: 'TOP 35% AGENT SUPERVISOR', color: '#cfd8dc', bg: 'rgba(207, 216, 220, 0.2)' };
      default:
        return { label: '🥉 Bronze Supervisor', title: 'PIONEER AGENT SUPERVISOR', color: '#bcaaa4', bg: 'rgba(141, 110, 99, 0.2)' };
    }
  }

  /**
   * Render 1200x630 HTML5 Canvas "Flex My Rank" Social Card
   */
  function renderRankCardCanvas(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');

    if (!ctx) return canvas;

    // Polyfill roundRect
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

    const tierConfig = getTierConfig(data.tier || 'diamond');
    const handle = data.handle || data.userTag || '@tera_owner';
    const rankNum = data.rank ? `#${data.rank}` : 'TOP 5%';
    const intentsCount = data.intentsCount || 42;
    const referralsCount = data.referralsCount || 8;
    const points = (data.points || 4200).toLocaleString();

    // 1. Background Gradient
    const bg = ctx.createLinearGradient(0, 0, 1200, 630);
    bg.addColorStop(0, '#09150d');
    bg.addColorStop(0.5, '#0f291a');
    bg.addColorStop(1, '#050c08');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 630);

    // Glowing Orbs
    const orb1 = ctx.createRadialGradient(900, 150, 10, 900, 150, 400);
    orb1.addColorStop(0, tierConfig.bg);
    orb1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = orb1;
    ctx.fillRect(0, 0, 1200, 630);

    // Outer Border Frame
    ctx.strokeStyle = tierConfig.color;
    ctx.lineWidth = 3;
    ctx.roundRect(30, 30, 1140, 570, 24);
    ctx.stroke();

    // Glass Panel
    ctx.fillStyle = 'rgba(15, 26, 20, 0.75)';
    ctx.roundRect(50, 50, 1100, 530, 20);
    ctx.fill();

    // Header Branding
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.fillText('TERA WALLET', 80, 110);

    ctx.fillStyle = '#00e676';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('ROBINHOOD CHAIN • AGENT SUPERVISOR LEADERBOARD', 80, 134);

    // Rank Badge Box (Top Right)
    ctx.fillStyle = tierConfig.bg;
    ctx.strokeStyle = tierConfig.color;
    ctx.lineWidth = 2;
    ctx.roundRect(800, 80, 300, 56, 28);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = tierConfig.color;
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`GLOBAL RANK ${rankNum}`, 950, 116);
    ctx.textAlign = 'left';

    // Separator
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(80, 165);
    ctx.lineTo(1120, 165);
    ctx.stroke();

    // Main Rank Banner Title
    ctx.fillStyle = '#a0aec0';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText('SUPERVISOR IDENTITY & RANK TIER', 80, 205);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 44px system-ui, sans-serif';
    ctx.fillText(handle, 80, 255);

    ctx.fillStyle = tierConfig.color;
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(tierConfig.label.toUpperCase(), 80, 295);

    // Stats Grid Cards
    const stats = [
      { label: 'INTENTS SIGNED', value: `${intentsCount}` },
      { label: 'ACTIVE REFERRALS', value: `${referralsCount}` },
      { label: 'AGENT POINTS', value: points },
    ];

    let statX = 80;
    stats.forEach((st) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.strokeStyle = 'rgba(0, 200, 83, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.roundRect(statX, 335, 320, 140, 16);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#819b8c';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(st.label, statX + 24, 370);

      ctx.fillStyle = '#ffffff';
      ctx.font = '800 36px system-ui, sans-serif';
      ctx.fillText(st.value, statX + 24, 425);

      statX += 360;
    });

    // Tagline Footer
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(80, 510);
    ctx.lineTo(1120, 510);
    ctx.stroke();

    ctx.fillStyle = '#718096';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText('Supervising RWA AI Agents on Robinhood L2 🔒 Zero keys surrendered.', 80, 548);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#00c853';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(`terawallet.app/?ref=${encodeURIComponent(handle)}`, 1120, 548);

    return canvas;
  }

  /**
   * Open "Flex Rank on X" Modal
   */
  window.openFlexRankModal = function (userRankData = {}) {
    const data = {
      handle: userRankData.handle || '@astra',
      rank: userRankData.rank || 4,
      intentsCount: userRankData.intentsCount || 42,
      referralsCount: userRankData.referralsCount || 8,
      points: userRankData.points || 4200,
      tier: userRankData.tier || 'diamond',
    };

    const tierConfig = getTierConfig(data.tier);
    const refUrl = `https://terawallet.app/dashboard/?ref=${encodeURIComponent(data.handle)}`;

    const tweetText =
      `I just hit ${tierConfig.label} (Rank #${data.rank}) on @TeraWalletRH! 🏆\n\n` +
      `⚡ Approved ${data.intentsCount} safe RWA AI intents on @RobinhoodApp L2\n` +
      `🔒 0 keys surrendered | ${data.points.toLocaleString()} Agent Points\n\n` +
      `Supervise your AI agent with me 👇`;

    const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(refUrl)}`;

    // Modal Markup
    const overlay = document.createElement('div');
    overlay.className = 'tera-share-modal-overlay';
    overlay.id = 'tera-rank-modal';

    overlay.innerHTML = `
      <div class="tera-share-modal-card">
        <div class="tera-share-header">
          <div class="tera-share-title-group">
            <span class="tera-share-badge">Flex My Rank</span>
            <h3 class="tera-share-title">Agent Supervisor Rank Card</h3>
          </div>
          <button class="tera-share-close-btn" id="tera-rank-close">&times;</button>
        </div>
        
        <div class="tera-share-body">
          <div class="tera-card-preview-container" id="tera-rank-canvas-wrapper"></div>

          <div class="tera-tweet-preview-box">
            <div class="tera-tweet-preview-label">Tweet Preview</div>
            <div class="tera-tweet-preview-text">${tweetText.replace(/</g, '&lt;')}</div>
          </div>

          <div class="tera-share-actions">
            <a href="${intentUrl}" target="_blank" rel="noopener noreferrer" class="tera-btn tera-btn-x">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              Flex Rank on X
            </a>

            <button type="button" class="tera-btn tera-btn-secondary" id="tera-rank-copy-img">
              📋 Copy Rank Card
            </button>

            <button type="button" class="tera-btn tera-btn-outline" id="tera-rank-download-img">
              ⬇ Download PNG
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Canvas Render
    const canvas = renderRankCardCanvas(data);
    canvas.className = 'tera-card-preview-canvas';
    overlay.querySelector('#tera-rank-canvas-wrapper').appendChild(canvas);

    // Close handlers
    overlay.querySelector('#tera-rank-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    // Copy image blob to clipboard
    overlay.querySelector('#tera-rank-copy-img').onclick = async () => {
      try {
        canvas.toBlob(async (blob) => {
          if (blob) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ]);
            showToast('Rank Card copied! Paste directly into X.');
          }
        });
      } catch (err) {
        showToast('Direct copy unsupported on browser. Use Download PNG!');
      }
    };

    // Download PNG
    overlay.querySelector('#tera-rank-download-img').onclick = () => {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.download = `tera-supervisor-rank-${data.handle}.png`;
      a.href = dataUrl;
      a.click();
      showToast('Rank Card downloaded!');
    };
  };

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'tera-toast-notification';
    toast.innerHTML = `✓ ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  /**
   * Render Main Leaderboard View into a Target Container
   */
  window.renderTeraLeaderboard = function (containerId = 'tera-leaderboard-root') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const myHandle = '@astra';
    const myRefUrl = `https://terawallet.app/dashboard/?ref=${encodeURIComponent(myHandle)}`;

    container.innerHTML = `
      <div class="tera-leaderboard-container">
        <!-- Hero Section -->
        <div class="tera-lb-hero">
          <div class="tera-lb-hero-bg-glow"></div>
          <div class="tera-lb-hero-content">
            <div class="tera-lb-title-group">
              <h1>🏆 Agent Supervisor Leaderboard</h1>
              <p>Earn Agent Points and climb global ranks by supervising RWA AI intents and referring users to Robinhood Chain.</p>
            </div>
            <div class="tera-lb-hero-actions">
              <button class="tera-lb-flex-btn" onclick="openFlexRankModal()">
                <span>Flex Rank Card on X</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- User Stats Grid -->
        <div class="tera-lb-stats-grid">
          <div class="tera-lb-stat-card">
            <span class="tera-lb-stat-label">Global Rank</span>
            <span class="tera-lb-stat-value">#4</span>
            <span class="tera-lb-stat-badge">💎 Diamond Supervisor</span>
          </div>

          <div class="tera-lb-stat-card">
            <span class="tera-lb-stat-label">Total Agent Points</span>
            <span class="tera-lb-stat-value">18,400</span>
            <span class="tera-lb-stat-badge">⚡ +2,400 this week</span>
          </div>

          <div class="tera-lb-stat-card">
            <span class="tera-lb-stat-label">Intents Supervised</span>
            <span class="tera-lb-stat-value">184</span>
            <span class="tera-lb-stat-badge">🔒 100% Passed</span>
          </div>

          <div class="tera-lb-stat-card">
            <span class="tera-lb-stat-label">Referrals Active</span>
            <span class="tera-lb-stat-value">42 Users</span>
            <span class="tera-lb-stat-badge">🚀 Top Referrer</span>
          </div>
        </div>

        <!-- Referral Link Bar -->
        <div class="tera-lb-ref-bar">
          <div class="tera-lb-ref-info">
            <div class="tera-lb-ref-icon">🔗</div>
            <div>
              <div class="tera-lb-ref-text-title">Your Personal Referral Link</div>
              <div class="tera-lb-ref-text-sub">Earn 500 Agent Points for every supervisor who joins via your link</div>
            </div>
          </div>
          <div class="tera-lb-ref-input-group">
            <input type="text" class="tera-lb-ref-input" value="${myRefUrl}" readonly id="tera-ref-input" />
            <button type="button" class="tera-lb-copy-btn" id="tera-copy-ref-btn">Copy Link</button>
          </div>
        </div>

        <!-- Leaderboard Table -->
        <div class="tera-lb-table-card">
          <div class="tera-lb-table-header">
            <h3 class="tera-lb-table-title">Top Agent Supervisors</h3>
          </div>
          <div class="tera-lb-table-wrapper">
            <table class="tera-lb-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Supervisor Handle</th>
                  <th>Rank Tier</th>
                  <th>Intents Approved</th>
                  <th>Referrals</th>
                  <th>Agent Points</th>
                </tr>
              </thead>
              <tbody>
                ${TOP_SUPERVISORS.map((sup) => {
                  const isMe = sup.handle === myHandle;
                  const tier = getTierConfig(sup.tier);
                  const rankClass = sup.rank <= 3 ? `tera-lb-rank-${sup.rank}` : 'tera-lb-rank-other';
                  return `
                    <tr class="tera-lb-row ${isMe ? 'tera-lb-row-me' : ''}">
                      <td><span class="tera-lb-rank-num ${rankClass}">${sup.rank}</span></td>
                      <td>
                        <div class="tera-lb-user-cell">
                          <div class="tera-lb-avatar">${sup.handle[1].toUpperCase()}</div>
                          <div>
                            <div class="tera-lb-handle">${sup.handle} ${isMe ? '(You)' : ''}</div>
                            <div class="tera-lb-addr">${sup.address}</div>
                          </div>
                        </div>
                      </td>
                      <td><span class="tera-tier-pill tera-tier-${sup.tier}">${tier.label}</span></td>
                      <td><strong>${sup.intentsCount}</strong> intents</td>
                      <td><strong>${sup.referralsCount}</strong> users</td>
                      <td><strong style="color:#00e676">${sup.points.toLocaleString()}</strong> pts</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Copy Referral Link Event
    container.querySelector('#tera-copy-ref-btn').onclick = () => {
      const input = container.querySelector('#tera-ref-input');
      navigator.clipboard.writeText(input.value);
      showToast('Referral link copied to clipboard!');
    };
  };

  // Auto-render if root exists on load
  document.addEventListener('DOMContentLoaded', () => {
    window.renderTeraLeaderboard();
  });
})();
