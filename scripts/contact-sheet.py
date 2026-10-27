"""Build one contact sheet of the finished games' title screens.

    python contact-sheet.py [out.png]

Reads .claude/temp/prod01/<slug>-title.png for the six production games, labels each tile and
writes .claude/temp/prod01/games-contact-sheet.png (3 x 2 grid, 640x360 tiles).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
TEMP = ROOT / ".claude" / "temp" / "prod01"
GAMES = [
    ("the-local-patch-2", "The Local Patch"),
    ("circuit-breaker-2", "Circuit Breaker"),
    ("the-silent-signal-2", "The Silent Signal"),
    ("the-silent-summit-2", "The Silent Summit"),
    ("echoes-in-the-deep-2", "Echoes in the Deep"),
    ("the-salt-line-2", "The Salt Line"),
]
TILE = (640, 360)
PAD = 16
LABEL = 34


def font(size: int):
    for name in ("seguisb.ttf", "segoeui.ttf", "arialbd.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else TEMP / "games-contact-sheet.png"
    tiles = []
    missing = []
    for slug, title in GAMES:
        png = TEMP / f"{slug}-title.png"
        if not png.exists():
            missing.append(slug)
            continue
        im = Image.open(png).convert("RGB")
        im = im.resize(TILE, Image.LANCZOS)
        tile = Image.new("RGB", (TILE[0], TILE[1] + LABEL), (18, 18, 22))
        tile.paste(im, (0, LABEL))
        draw = ImageDraw.Draw(tile)
        draw.text((12, 7), title, font=font(20), fill=(235, 235, 240))
        draw.text((TILE[0] - 120, 10), slug, font=font(13), fill=(120, 120, 130))
        tiles.append(tile)
    if not tiles:
        print("no title screens found", missing)
        return 1
    cols = 3
    rows = (len(tiles) + cols - 1) // cols
    w = cols * TILE[0] + (cols + 1) * PAD
    h = rows * (TILE[1] + LABEL) + (rows + 1) * PAD
    sheet = Image.new("RGB", (w, h), (10, 10, 12))
    for i, tile in enumerate(tiles):
        r, c = divmod(i, cols)
        sheet.paste(tile, (PAD + c * (TILE[0] + PAD), PAD + r * (TILE[1] + LABEL + PAD)))
    sheet.save(out, "PNG", optimize=True)
    print(f"wrote {out} ({sheet.width}x{sheet.height}), {len(tiles)} games")
    if missing:
        print("missing:", ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
