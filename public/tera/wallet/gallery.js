import { imageUrl, tokenLabel } from "../core/nft.js";

// A picture that fails to load is swapped for a label. Done with one listener
// rather than an onerror attribute, which the dashboard's Content-Security-
// Policy refuses to run (error events don't bubble, so it listens in capture).
if (typeof document !== "undefined")
  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.hasAttribute("data-nft-image")) return;
      image.replaceWith(Object.assign(document.createElement("span"), { textContent: "Image unavailable" }));
    },
    true,
  );

export function galleryView({ esc, tokens, loading, error, demo, owner, explorerUrl }) {
  if (demo) return '<div class="note">NFT discovery is unavailable in guided demo mode.</div>';
  const cards = tokens
    .map((token, index) => {
      const meta = token.metadata;
      const image = imageUrl(meta?.image || "");
      const title = meta?.name || tokenLabel(token, meta);
      return `<article class="nft-card"><div class="nft-image">${image ? `<img src="${esc(image)}" alt="${esc(title)}" loading="lazy" data-nft-image>` : "<span>Image unavailable</span>"}<b>#${esc(token.tokenId)}</b></div><div class="nft-copy"><small>${esc(token.collection || "Unnamed collection")}</small><h2>${esc(title)}</h2><p>${esc(meta?.description || "")}</p><div class="actions"><button class="btn" data-action="nft-send" data-index="${index}" ${!owner ? "disabled" : ""}>Send</button><a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(`${explorerUrl || "https://robinhoodchain.blockscout.com"}/token/${token.contract}?a=${encodeURIComponent(token.tokenId)}`)}">Explorer ?</a></div></div></article>`;
    })
    .join("");
  return `<section class="nft-gallery"><div class="section-label"><span>${tokens.length} NFT${tokens.length === 1 ? "" : "s"}</span></div><p class="micro">Metadata and pictures load directly from collection servers or the public IPFS gateway. Those hosts can see your network address and the token requested.</p>${error ? `<div class="note" role="alert">${esc(error)}</div>` : ""}${loading ? '<p role="status">Finding NFTs on Robinhood Chain…</p>' : tokens.length ? `<div class="nft-grid">${cards}</div>` : '<div class="empty">No NFTs found for this wallet.</div>'}</section>`;
}
