"""Generate the macOS bundle icons and the menu-bar template mark."""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"


def png(width: int, height: int, rgba: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def fill(width: int, height: int, paint) -> bytes:
    pixels = bytearray(width * height * 4)
    for y in range(height):
        for x in range(width):
            pixels[(y * width + x) * 4 : (y * width + x) * 4 + 4] = bytes(paint(x, y, width, height))
    return bytes(pixels)


def app_icon(size: int) -> bytes:
    def paint(x: int, y: int, width: int, height: int):
        radius = width * 0.22
        inset = width * 0.08
        if x < inset or y < inset or x >= width - inset or y >= height - inset:
            return (0, 0, 0, 0)
        dx = min(x - inset, width - inset - 1 - x)
        dy = min(y - inset, height - inset - 1 - y)
        if dx * dx + dy * dy < (radius * 0.15) ** 2 and (x < inset + radius or x > width - inset - radius) and (
            y < inset + radius or y > height - inset - radius
        ):
            # Keep the corners square-cut only when they fall outside the rounded box.
            pass
        left = inset + radius
        right = width - inset - radius
        top = inset + radius
        bottom = height - inset - radius
        inside = (left <= x <= right or top <= y <= bottom) and inset <= x < width - inset and inset <= y < height - inset
        corner = None
        if x < left and y < top:
            corner = (left, top)
        elif x > right and y < top:
            corner = (right, top)
        elif x < left and y > bottom:
            corner = (left, bottom)
        elif x > right and y > bottom:
            corner = (right, bottom)
        if corner and (x - corner[0]) ** 2 + (y - corner[1]) ** 2 > radius**2:
            return (0, 0, 0, 0)
        if not inside and corner is None:
            return (0, 0, 0, 0)
        # Three pale bars on the workspace red.
        bar_top = int(height * 0.28)
        gap = max(2, width // 18)
        bar_w = max(2, width // 10)
        start = int(width * 0.30)
        heights = (0.28, 0.46, 0.36)
        for index, ratio in enumerate(heights):
            bar_x = start + index * (bar_w + gap)
            bar_h = int(height * ratio)
            if bar_x <= x < bar_x + bar_w and height - int(height * 0.24) - bar_h <= y < height - int(height * 0.24):
                return (246, 241, 231, 255)
        if bar_top <= y:
            return (152, 44, 38, 255)
        return (152, 44, 38, 255)

    return png(size, size, fill(size, size, paint))


def template(size: int = 22) -> bytes:
    def paint(x: int, y: int, width: int, height: int):
        gap = 2
        bar_w = 3
        start = 3
        heights = (8, 14, 11)
        baseline = height - 4
        for index, bar_h in enumerate(heights):
            bar_x = start + index * (bar_w + gap)
            if bar_x <= x < bar_x + bar_w and baseline - bar_h <= y < baseline:
                return (0, 0, 0, 255)
        return (0, 0, 0, 0)

    return png(size, size, fill(size, size, paint))


def icns(images: dict[str, bytes]) -> bytes:
    parts = b""
    for kind, data in images.items():
        parts += kind.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    return b"icns" + struct.pack(">I", len(parts) + 8) + parts


def ico(pngs: list[tuple[int, bytes]]) -> bytes:
    count = len(pngs)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = b""
    blobs = b""
    for size, data in pngs:
        dimension = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blobs += data
    return header + entries + blobs


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    sizes = {
        32: app_icon(32),
        64: app_icon(64),
        128: app_icon(128),
        256: app_icon(256),
        512: app_icon(512),
    }
    (ROOT / "32x32.png").write_bytes(sizes[32])
    (ROOT / "128x128.png").write_bytes(sizes[128])
    (ROOT / "128x128@2x.png").write_bytes(sizes[256])
    (ROOT / "icon.png").write_bytes(sizes[512])
    (ROOT / "tray-template.png").write_bytes(template())
    (ROOT / "icon.icns").write_bytes(
        icns(
            {
                "ic11": sizes[32],
                "ic12": sizes[64],
                "ic07": sizes[128],
                "ic08": sizes[256],
                "ic09": sizes[512],
            }
        )
    )
    (ROOT / "icon.ico").write_bytes(ico([(32, sizes[32]), (128, sizes[128]), (256, sizes[256])]))


if __name__ == "__main__":
    main()
