/**
 * The supervisor leaderboard.
 *
 * Drawn with the dashboard's own classes — .panel, .metric, .chip, .btn,
 * .pair — so it reads as the same product as the page an owner arrived from.
 *
 * The page is always here. An empty board is a real state, not a failure: a
 * board nobody has reached yet still has to show what it is and how someone
 * gets on it. So the heading, the figures and the table draw in every case,
 * and only the rows change.
 *
 * What does not happen is inventing a standing. Every value comes from
 * /api/leaderboard; when that cannot be read the page says which figures are
 * missing rather than filling them in.
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

  /**
   * The four figures above the table.
   *
   * Every one of them reads "—" until something has been counted. A zero here
   * would be a measurement; a dash is the absence of one, and on an empty board
   * those are different claims.
   */
  function statsPanel(data, you, empty) {
    const yourRank = you ? `#${esc(you.rank)}` : "—";
    const yourNote = you
      ? esc(`${you.tier} supervisor`)
      : empty
        ? "Nobody has been ranked yet."
        : "You are not on this board yet.";
    const yourPoints = you ? esc(count(you.points)) : "—";
    const pointsNote = you
      ? `${esc(count(you.intentsSigned))} intents signed`
      : "Points are earned by reviewing and signing.";
    return `
      <div class="lb-stats">
        <div><div class="section-label"><span>Your rank</span></div>
          <div class="metric"><strong>${yourRank}</strong><small>${yourNote}</small></div></div>
        <div><div class="section-label"><span>Your points</span></div>
          <div class="metric"><strong>${yourPoints}</strong><small>${pointsNote}</small></div></div>
        <div><div class="section-label"><span>Supervisors</span></div>
          <div class="metric"><strong>${esc(count(data?.totalSupervisors))}</strong>
          <small>Across the whole protocol</small></div></div>
        <div><div class="section-label"><span>Intents signed</span></div>
          <div class="metric"><strong>${esc(count(data?.totalIntentsSigned))}</strong>
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

  /** One row spanning the table, for the two states that have no entries. */
  const noticeRow = (message) =>
    `<tr><td colspan="6"><div class="empty">${esc(message)}</div></td></tr>`;

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

    const entries = Array.isArray(data?.leaderboard) ? data.leaderboard : [];
    const empty = !failure && entries.length === 0;
    const you = entries.find((entry) => entry.isYou) || null;

    const body = failure
      ? noticeRow(`${failure} Nothing is shown rather than a standing that was not counted.`)
      : empty
        ? noticeRow("Nobody is on the board yet. The first reviewed and signed proposal puts someone here — it may as well be yours.")
        : tableRows(entries, you?.tag);

    const shown = failure ? "unavailable" : `${count(entries.length)} shown`;

    container.innerHTML = `
      <div class="page-heading">
        <div>
          <p class="eyebrow">Tera Wallet</p>
          <h1>Supervisor board</h1>
        </div>
        <p>Points are earned by reviewing an agent's proposal and signing it yourself. Nothing here counts an action an agent took alone.</p>
      </div>

      ${statsPanel(data, you, empty)}

      <div class="content-grid">
        <section>
          <div class="section-label"><span>Ranked supervisors</span>
            <span>${esc(shown)}</span></div>
          <div class="table-scroll">
            <table>
              <thead><tr>
                <th>Rank</th><th>Supervisor</th><th>Tier</th>
                <th>Points</th><th>Intents</th><th>Referrals</th>
              </tr></thead>
              <tbody>${body}</tbody>
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
              : `<p class="micro" style="margin-top:16px">Sign an agent proposal to join the board and get a link to share.</p>`
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
