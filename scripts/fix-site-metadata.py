#!/usr/bin/env python3
"""Repair the exported site's head metadata and the template leftovers in it.

    python3 scripts/fix-site-metadata.py [--check]

The site was exported from a Framer template called Oberon and rebranded by
client-side JavaScript: `public/tera/cms-loader.js` swaps the copy and
`public/tera/site.js` rewrites the mailto links once the page has loaded. Anything
that does not run JavaScript sees the template underneath -- link-preview
scrapers, view-source, curl, and crawlers on their first pass.

This fixes the source so the raw HTML is correct on its own. Four things:

  1. Drops the two `framer-search-index` meta tags. The JSON they point at is the
     original template's search corpus and carries Oberon's name, contact address
     and an entire unedited Terms of Service. Nothing on the site loads it.
  2. Adds OpenGraph and Twitter card tags. There were none at all, so every
     shared link rendered as a bare text card with no image.
  3. Rewrites `mailto:hi@oberonai.com` to the real address at source rather than
     leaving it to be patched after load.
  4. Removes the `data-framer-name="Oberon logo"` attributes.

Run with --check to report what would change without writing, which is what CI
should use to stop the template leaking back in.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "src" / "site"

ORIGIN = "https://terawallet.app"
CONTACT = "terawalletrh@outlook.com"
OG_IMAGE = f"{ORIGIN}/tera/og-card.png"
TWITTER_HANDLE = "@terawalletrh"

# Pages the export left without a description. The text follows the product's
# register: it says what the page is, and claims nothing the page does not do.
DESCRIPTIONS = {
    "/roadmap/": (
        "What Tera Wallet has shipped and what is still protocol work: execution, "
        "scoped sessions, and private policy proofs."
    ),
    "/whitepaper/": (
        "How Tera Wallet bounds an assistant's authority: typed intents, five "
        "deterministic review gates, and an owner signature at the end of every one."
    ),
    "/legal/privacy-policy/": "How Tera Wallet handles your data, what it keeps, and for how long.",
    "/legal/terms-of-service/": "The terms that apply to using Tera Wallet.",
    "/dashboard/bridge/": "Move assets onto Robinhood Chain and track delivery from your wallet.",
}

TEMPLATE_ORIGIN = "https://oberon.framer.website"

# The same three leftovers live in the hydration bundles under public/assets, and
# those re-render over the HTML once React takes the page over. Fixing only the
# HTML would leave the values correct for a scraper and wrong for the app, which
# is the arrangement that produced this mess in the first place.
ASSET_REPLACEMENTS = [
    ("hi@oberonai.com", CONTACT),
    ("Oberon logo", "Tera Wallet logo"),
    (TEMPLATE_ORIGIN, ORIGIN),
    ("} - Oberon`", "} - Tera Wallet`"),
]

SEARCH_INDEX = re.compile(
    r"^[ \t]*<meta name=\"framer-search-index(?:-fallback)?\"[^>]*>[ \t]*\r?\n", re.MULTILINE
)
# The export left empty `<!-- Open Graph -->` and `<!-- X -->` slots on 11 pages:
# the template had somewhere to put these tags and nobody ever filled them in.
# They are dropped so the head holds one social block rather than one real and one
# hollow. Only a run of blank lines is consumed, never real content.
EMPTY_SLOTS = re.compile(
    r"[ \t]*<!-- Open Graph -->(?:[ \t]*\r?\n)*[ \t]*<!-- X -->(?:[ \t]*\r?\n)*"
)
# Renamed rather than removed. `public/tera/site.css` styles the header logo
# through this attribute and `public/tera/site.js` selects it to inject the brand
# mark, so deleting it would drop those rules until React rehydrated the page and
# put the attribute back. Both of those files use the new value.
OBERON_LOGO = re.compile(r"data-framer-name=\"Oberon logo\"")
TERA_LOGO = 'data-framer-name="Tera Wallet logo"'
TITLE = re.compile(r"<title>(.*?)</title>", re.DOTALL)
DESCRIPTION = re.compile(r"<meta name=\"description\" content=\"(.*?)\"\s*/?>", re.DOTALL)
# Everything this script inserts, so a re-run replaces its own work rather than
# stacking a second copy of every tag.
# Matches the newline this script inserts ahead of the block as well as the block
# itself, so removing it restores the file to exactly its pre-insertion state.
# Without the leading newline the removal is not the inverse of the insertion and
# every run leaves one more blank line behind.
BLOCK = re.compile(
    r"(?:\r?\n)?[ \t]*<!-- tera:social -->.*?<!-- /tera:social -->", re.DOTALL
)


def url_for(path: Path) -> str:
    relative = path.parent.relative_to(SITE).as_posix()
    return f"{ORIGIN}/" if relative == "." else f"{ORIGIN}/{relative}/"


def escape(value: str) -> str:
    return (
        value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
    )


def social_block(url: str, title: str, description: str, indent: str, newline: str) -> str:
    tags = [
        ("property", "og:type", "website"),
        ("property", "og:site_name", "Tera Wallet"),
        ("property", "og:url", url),
        ("property", "og:title", title),
        ("property", "og:description", description),
        ("property", "og:image", OG_IMAGE),
        ("property", "og:image:width", "1200"),
        ("property", "og:image:height", "630"),
        ("property", "og:image:alt", "Tera Wallet - the agent proposes, you retain authority."),
        ("name", "twitter:card", "summary_large_image"),
        ("name", "twitter:site", TWITTER_HANDLE),
        ("name", "twitter:title", title),
        ("name", "twitter:description", description),
        ("name", "twitter:image", OG_IMAGE),
    ]
    # No robots tag is emitted here. The 404 page already carries its own noindex
    # from the export, and a second one would be a contradiction waiting to happen.
    lines = [f"{indent}<!-- tera:social -->"]
    lines += [f'{indent}<meta {kind}="{key}" content="{escape(value)}">' for kind, key, value in tags]
    lines.append(f"{indent}<!-- /tera:social -->")
    return newline.join(lines) + newline


def fix(path: Path) -> list[str]:
    raw = path.read_text(encoding="utf-8", newline="")
    newline = "\r\n" if "\r\n" in raw else "\n"
    text = raw
    changes: list[str] = []

    text, count = SEARCH_INDEX.subn("", text)
    if count:
        changes.append(f"removed {count} search-index tag(s)")

    text, count = OBERON_LOGO.subn(TERA_LOGO, text)
    if count:
        changes.append(f"renamed {count} logo attribute(s)")

    text, count = EMPTY_SLOTS.subn("", text)
    if count:
        changes.append("removed the empty social placeholders")

    if "hi@oberonai.com" in text:
        count = text.count("hi@oberonai.com")
        text = text.replace("hi@oberonai.com", CONTACT)
        changes.append(f"rewrote {count} contact link(s)")

    # The 404 page carries the template author's own site as the base for its
    # relative-link rewriter. The cross-origin check makes it inert here, so this
    # swap is behaviour-identical; it is the name in the served HTML that matters.
    if TEMPLATE_ORIGIN in text:
        count = text.count(TEMPLATE_ORIGIN)
        text = text.replace(TEMPLATE_ORIGIN, ORIGIN)
        changes.append(f"rewrote {count} template origin(s)")

    text = BLOCK.sub("", text)

    title_match = TITLE.search(text)
    if not title_match:
        raise SystemExit(f"{path} has no <title>, so it cannot be described.")
    title = " ".join(title_match.group(1).split())

    url = url_for(path)
    description_match = DESCRIPTION.search(text)
    if description_match:
        description = " ".join(description_match.group(1).split())
        anchor = description_match.group(0)
    else:
        description = DESCRIPTIONS.get(url.replace(ORIGIN, ""))
        if not description:
            raise SystemExit(f"{path} has no description and no fallback for {url}.")
        anchor = title_match.group(0)
        # Give the page a real description too, not only the social copy.
        text = text.replace(
            anchor, f'{anchor}{newline}    <meta name="description" content="{escape(description)}">', 1
        )
        anchor = f'<meta name="description" content="{escape(description)}">'
        changes.append("added a description")

    indent = "    "
    block = social_block(url, title, description, indent, newline)
    text = text.replace(anchor, f"{anchor}{newline}{block.rstrip(newline)}", 1)
    changes.append("added social tags")

    if text != raw:
        if "--check" not in sys.argv:
            path.write_text(text, encoding="utf-8", newline="")
        return changes
    return []


def fix_asset(path: Path) -> list[str]:
    """Rewrite the template leftovers in a hydration bundle.

    These are minified JavaScript, not a length-indexed format, so a replacement
    of a different length is safe. The values touched are a prop, an element name,
    a canonical URL and a title suffix -- none of them a key anything looks up.
    """
    raw = path.read_text(encoding="utf-8", newline="")
    text = raw
    changes = []
    for needle, replacement in ASSET_REPLACEMENTS:
        if needle in text:
            changes.append(f"{text.count(needle)}x {needle[:28]}")
            text = text.replace(needle, replacement)
    if text != raw and "--check" not in sys.argv:
        path.write_text(text, encoding="utf-8", newline="")
    return changes


def main() -> None:
    pages = sorted(SITE.rglob("index.html"))
    if not pages:
        raise SystemExit(f"No pages found under {SITE}")
    touched = 0
    for page in pages:
        changes = fix(page)
        if changes:
            touched += 1
            print(f"{page.relative_to(ROOT).as_posix()}: {', '.join(changes)}")

    for asset in sorted((ROOT / "public" / "assets").rglob("*.mjs")):
        changes = fix_asset(asset)
        if changes:
            touched += 1
            print(f"{asset.name[:38]}: {', '.join(changes)}")
    verb = "would change" if "--check" in sys.argv else "changed"
    print(f"\n{touched} of {len(pages)} pages {verb}.")
    if "--check" in sys.argv and touched:
        sys.exit(1)


if __name__ == "__main__":
    main()
