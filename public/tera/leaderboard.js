/**
 * Tera Wallet - Viral Leaderboard & Agent Supervisor Rank Cards
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

  window.shareRankToX = function (rank, tag, points, intents) {
    const refTag = tag || '@tera_owner';
    const text =
      `Ranked #${rank} Agent Supervisor on @TeraWalletRH 🏆\n\n` +
      `⚡ Tier: ${points > 2000 ? 'Grandmaster' : 'Master'} Supervisor\n` +
      `✅ Supervised Intents: ${intents || 42}\n` +
      `🔒 Safety Gates Passed: 100%\n\n` +
      `Join me on Robinhood Chain L2 👇`;

    const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`https://terawallet.app/dashboard/?ref=${encodeURIComponent(refTag)}`)}`;
    window.open(shareUrl, '_blank');
  };

  window.initLeaderboardUI = async function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div style="padding: 40px; text-align: center; color: #a0aec0;">Loading Agent Supervisor Leaderboard…</div>`;

    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();

      const userRank = data.leaderboard[0] || {
        rank: 1,
        tag: '@astra',
        points: 3450,
        tier: 'Grandmaster',
        tierBadge: '🏆',
        intentsSigned: 142,
        referrals: 38,
      };

      container.innerHTML = `
        <div class="tera-leaderboard-hero">
          <div class="tera-leaderboard-hero-bg"></div>
          <div class="tera-rank-card-header">
            <div class="tera-rank-user-info">
              <div class="tera-rank-badge-icon">${userRank.tierBadge}</div>
              <div class="tera-rank-user-details">
                <h2>${userRank.tag} <span class="tera-rank-tier-pill">${userRank.tier} Supervisor</span></h2>
                <div style="color: #a0aec0; font-size: 13px;">Supervising RWA Workflows on Robinhood Chain L2</div>
              </div>
            </div>
          </div>

          <div class="tera-rank-stats-grid">
            <div class="tera-stat-item">
              <div class="tera-stat-label">Global Rank</div>
              <div class="tera-stat-val">#${userRank.rank}</div>
            </div>
            <div class="tera-stat-item">
              <div class="tera-stat-label">Supervisor Points</div>
              <div class="tera-stat-val" style="color: #00e676;">${userRank.points.toLocaleString()}</div>
            </div>
            <div class="tera-stat-item">
              <div class="tera-stat-label">Intents Signed</div>
              <div class="tera-stat-val">${userRank.intentsSigned}</div>
            </div>
            <div class="tera-stat-item">
              <div class="tera-stat-label">Referred Users</div>
              <div class="tera-stat-val">${userRank.referrals}</div>
            </div>
          </div>

          <div class="tera-rank-actions">
            <button type="button" class="tera-share-trigger-btn" onclick="shareRankToX(${userRank.rank}, '${userRank.tag}', ${userRank.points}, ${userRank.intentsSigned})">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              Flex Rank on X
            </button>

            <button type="button" class="tera-share-trigger-btn" style="background: rgba(255,255,255,0.06); color: #ffffff; border-color: rgba(255,255,255,0.15);" onclick="navigator.clipboard.writeText('https://terawallet.app/dashboard/?ref=${encodeURIComponent(userRank.tag)}'); alert('Referral link copied!');">
              🔗 Copy Referral Link
            </button>
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff;">Top Supervisor Ranks</h3>
          <span style="font-size: 13px; color: #a0aec0;">Total Protocol Volume: $${(data.totalVolumeUsd || 3840000).toLocaleString()}</span>
        </div>

        <div class="tera-table-container">
          <table class="tera-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Supervisor Tag</th>
                <th>Tier</th>
                <th>Points</th>
                <th>Intents</th>
                <th>Referrals</th>
              </tr>
            </thead>
            <tbody>
              ${data.leaderboard
                .map(
                  (item) => `
                <tr>
                  <td class="tera-rank-number ${item.rank === 1 ? 'tera-rank-top-1' : item.rank === 2 ? 'tera-rank-top-2' : item.rank === 3 ? 'tera-rank-top-3' : ''}">
                    ${item.rank === 1 ? '🥇 #1' : item.rank === 2 ? '🥈 #2' : item.rank === 3 ? '🥉 #3' : `#${item.rank}`}
                  </td>
                  <td>
                    <div class="tera-tag-cell">
                      <span>${item.tierBadge}</span>
                      <span>${item.tag}</span>
                    </div>
                  </td>
                  <td><span class="tera-rank-tier-pill">${item.tier}</span></td>
                  <td><span class="tera-points-badge">${item.points.toLocaleString()} pts</span></td>
                  <td>${item.intentsSigned}</td>
                  <td>${item.referrals}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: #ff5252;">Failed to load leaderboard data.</div>`;
    }
  };
})();
