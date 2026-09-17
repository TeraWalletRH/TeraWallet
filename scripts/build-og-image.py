#!/usr/bin/env python3
"""Generate the link-preview card served as og:image.

    python3 scripts/build-og-image.py

The card is 1200x630, which is what X, Discord, Slack, LinkedIn and Telegram all
crop to. Pointing og:image at public/tera/logo.png instead would declare a square
image as a large-image card, and every one of those services would crop it
through the middle.

The card is drawn here rather than exported from a design tool so it can be
regenerated from a checkout. The PNG is committed, because a link preview has to
resolve on the deployed site without anyone having run a build step.

Pillow is the only requirement, and it is already used elsewhere in tooling. The
monospace face is whichever of the candidates below the machine has; the layout
is sized so that any of them fits.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public" / "tera" / "og-card.png"
LOGO = ROOT / "public" / "tera" / "logo.png"

WIDTH, HEIGHT = 1200, 630

# The site palette, from public/tera/site.css.
INK = (24, 37, 30)
PAPER = (242, 240, 238)
OLIVE = (118, 129, 67)
MUTED = (137, 145, 122)

# IBM Plex Mono is the product voice but is not installed anywhere by default.
# These are the closest faces that ship with each platform.
FONT_CANDIDATES = [
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/cour.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    "/System/Library/Fonts/Menlo.ttc",
]


def font(size):
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size)


def main():
    card = Image.new("RGB", (WIDTH, HEIGHT), INK)
    draw = ImageDraw.Draw(card)

    # A faint grid, at the weight the dashboard uses for its panel borders.
    grid = tuple(round(channel + (olive - channel) * 0.16) for channel, olive in zip(INK, OLIVE))
    for x in range(0, WIDTH + 1, 120):
        draw.line([(x, 0), (x, HEIGHT)], fill=grid, width=1)
    for y in range(0, HEIGHT + 1, 126):
        draw.line([(0, y), (WIDTH, y)], fill=grid, width=1)

    logo = Image.open(LOGO).convert("RGBA").resize((96, 96), Image.LANCZOS)
    card.paste(logo, (80, 78), logo)

    draw.text((200, 108), "Tera Wallet", font=font(40), fill=PAPER)
    draw.text((80, 250), "The agent proposes.", font=font(60), fill=PAPER)
    draw.text((80, 330), "You retain authority.", font=font(60), fill=OLIVE)

    draw.line([(80, 452), (WIDTH - 80, 452)], fill=OLIVE, width=2)

    small = font(25)
    draw.text((80, 492), "Private authorization for supervised real-world assets", font=small, fill=MUTED)
    draw.text((80, 536), "terawallet.app", font=small, fill=MUTED)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    card.save(OUTPUT, "PNG", optimize=True)
    # Plain ASCII: this runs on a Windows console whose default codepage cannot
    # encode the arrows and middots used elsewhere in this repo's tooling output.
    print(f"{OUTPUT.stat().st_size} bytes, {WIDTH}x{HEIGHT} -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
