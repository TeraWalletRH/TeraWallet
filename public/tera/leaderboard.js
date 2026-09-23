/**
 * The supervisor leaderboard.
 *
 * Drawn with the dashboard's own classes — .panel, .metric, .chip, .btn,
 * .pair — so it reads as the same product as the page an owner arrived from.
 *
 * Every value shown here comes from /api/leaderboard. When that call fails the
 * page says so and shows nothing, rather than falling back to figures written
 * into this file: a rank invented by the page and presented as the reader's own
 * is the one thing a leaderboard must never do.
 */

(function () {
  "use strict";

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
    );

  const count = (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—");

  const referralUrl = (tag) =>
    `https://terawallet.app/dashboard/?ref=${encodeURIComponent(String(tag ?? ""))}`;

  /** The site's toast, rather than an alert() that blocks the page. */
  function toast(message) {
    const node = document.createElement("div");
    node.className = "toast";
    node.setAttribute("role", "status");
    node.textContent = message;
    document.body.append(node);
    setTimeout(() => node.remove(), 4000);
  }

  function shareText(entry) {
    return (
      `Ranked #${entry.rank} supervising agent actions on Tera.\n\n` +
      `${count(entry.points)} supervisor points · ${count(entry.intentsSigned)} intents reviewed and signed by me, not for me.\n\n` +
      `Robinhood Chain`
    );
  }

  function shareToX(entry) {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(
      shareText(entry),
    )}&url=${encodeURIComponent(referralUrl(entry.tag))}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const short = (address) =>
    typeof address === "string" && address.length > 14
      ? `${address.slice(0, 8)}…${address.slice(-6)}`
      : address || "";

  function statsPanel(data, you) {
    // The reader's own standing leads, at the size the dashboard gives its one
    // large figure. The protocol totals are context and are demoted to match.
    return `
      <div class="lb-stats">
        <div><div class="section-label"><span>Your rank</span></div>
          <div class="metric"><strong>${you ? `#${esc(you.rank)}` : "—"}</strong>
          <small>${you ? esc(`${you.tier} supervisor`) : "You are not on this board yet."}</small></div></div>
        <div><div class="section-label"><span>Your points</span></div>
          <div class="metric"><strong>${you ? esc(count(you.points)) : "—"}</strong>
          <small>${you ? `${esc(count(you.intentsSigned))} intents signed` : "Points are earned by reviewing and signing."}</small></div></div>
        <div><div class="section-label"><span>Supervisors</span></div>
          <div class="metric"><strong>${esc(count(data.totalSupervisors))}</strong>
          <small>Across the whole protocol</small></div></div>
        <div><div class="section-label"><span>Intents signed</span></div>
          <div class="metric"><strong>${esc(count(data.totalIntentsSigned))}</strong>
          <small>By an owner, never by an agent alone</small></div></div>
      </div>`;
  }

  function tableRows(entries, youTag) {
    return entries
      .map((entry) => {
        const mine = youTag && entry.tag === youTag;
        return `<tr class="${mine ? "lb-you" : ""}">
          <td class="lb-rank ${Number(entry.rank) <= 3 ? "lead" : ""}">#${esc(entry.rank)}</td>
          <td><span class="lb-tag">${esc(entry.tag)}</span>
            <span class="lb-address">${esc(short(entry.address))}</span></td>
          <td><span class="chip muted">${esc(entry.tier)}</span></td>
          <td>${esc(count(entry.points))}</td>
          <td>${esc(count(entry.intentsSigned))}</td>
          <td>${esc(count(entry.referrals))}</td>
        </tr>`;
      })
      .join("");
  }

  window.initLeaderboardUI = async function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div class="empty">Reading the board…</div>`;

    let data = null;
    let failure = "";
    try {
      const response = await fetch("/api/leaderboard");
      if (!response.ok) throw new Error(`The board could not be read (${response.status}).`);
      data = await response.json();
    } catch (error) {
      failure = error instanceof Error ? error.message : "The board could not be read.";
    }

    const entries = Array.isArray(data?.leaderboard) ? data.leaderboard : null;
    if (!entries) {
      // No invented board. A page that cannot read the rankings says so.
      container.innerHTML = `
        <div class="page-heading"><div><p class="eyebrow">Tera Wallet</p>
          <h1>Supervisor board</h1></div></div>
        <div class="note"><strong>Unavailable</strong>${esc(
          failure || "The board could not be read.",
        )} Nothing is shown rather than a standing that was not counted.</div>`;
      return;
    }

    const you = entries.find((entry) => entry.isYou) || null;

    container.innerHTML = `
      <div class="page-heading">
        <div>
          <p class="eyebrow">Tera Wallet</p>
          <h1>Supervisor board</h1>
        </div>
        <p>Points are earned by reviewing an agent's proposal and signing it yourself. Nothing here counts an action an agent took alone.</p>
      </div>

      ${statsPanel(data, you)}

      <div class="content-grid">
        <section>
          <div class="section-label"><span>Ranked supervisors</span>
            <span>${esc(count(entries.length))} shown</span></div>
          <div class="table-scroll">
            <table>
              <thead><tr>
                <th>Rank</th><th>Supervisor</th><th>Tier</th>
                <th>Points</th><th>Intents</th><th>Referrals</th>
              </tr></thead>
              <tbody>${tableRows(entries, you?.tag)}</tbody>
            </table>
          </div>
        </section>

        <aside>
          <div class="section-label"><span>Your referral</span></div>
          <p class="micro">A referral link carries your tag and nothing else. It does not identify you to the person who opens it, and it cannot act on your behalf.</p>
          <div class="actions" style="margin-top:20px">
            <button type="button" class="btn primary" data-lb="share"${you ? "" : " disabled"}>Share rank on X</button>
            <button type="button" class="btn" data-lb="copy"${you ? "" : " disabled"}>Copy referral link</button>
          </div>
          ${
            you
              ? ""
              : `<p class="micro" style="margin-top:16px">Sign an agent proposal to join the board.</p>`
          }
        </aside>
      </div>`;

    const share = container.querySelector('[data-lb="share"]');
    const copy = container.querySelector('[data-lb="copy"]');
    if (share && you) share.addEventListener("click", () => shareToX(you));
    if (copy && you)
      copy.addEventListener("click", () => {
        navigator.clipboard
          ?.writeText(referralUrl(you.tag))
          .then(() => toast("Referral link copied."))
          .catch(() => toast("Unable to copy the link."));
      });
  };
})();
