"""Render a 5-second video of a cartoon cat dancing.

Frames are drawn with Pillow and piped to ffmpeg as raw RGB.
Usage: python3 dancing_cat.py [output.mp4]
"""
import math
import subprocess
import sys

from PIL import Image, ImageDraw

W, H = 640, 480
SS = 2  # supersampling factor for anti-aliasing
FPS = 30
SECONDS = 5
BEAT = 0.5  # seconds per beat (120 BPM)

FUR = (240, 150, 60)
FUR_DARK = (200, 110, 35)
BELLY = (255, 225, 180)
OUTLINE = (40, 25, 20)
PINK = (255, 140, 160)


def s(v):
    return int(round(v * SS))


def ellipse(d, cx, cy, rx, ry, fill, outline=OUTLINE, width=3):
    d.ellipse([s(cx - rx), s(cy - ry), s(cx + rx), s(cy + ry)],
              fill=fill, outline=outline, width=s(width))


def limb(d, x0, y0, x1, y1, thick, fill):
    """Rounded limb from (x0, y0) to (x1, y1) with a paw at the end."""
    d.line([s(x0), s(y0), s(x1), s(y1)], fill=OUTLINE, width=s(thick + 6))
    d.line([s(x0), s(y0), s(x1), s(y1)], fill=fill, width=s(thick))
    ellipse(d, x1, y1, thick * 0.75, thick * 0.65, fill)


def polar(x, y, length, angle_deg):
    a = math.radians(angle_deg)
    return x + length * math.sin(a), y + length * math.cos(a)


def draw_background(d, t):
    # Dark stage gradient
    for y in range(0, H * SS, SS * 4):
        k = y / (H * SS)
        d.rectangle([0, y, W * SS, y + SS * 4],
                    fill=(int(30 + 30 * k), int(10 + 15 * k), int(60 + 40 * k)))

    # Disco floor tiles that flash on the beat
    beat = int(t / BEAT)
    palette = [(255, 80, 120), (80, 200, 255), (255, 220, 70), (120, 255, 140), (190, 110, 255)]
    rows, cols = 4, 10
    top = 340
    for r in range(rows):
        y0 = top + r * (H - top) / rows
        y1 = top + (r + 1) * (H - top) / rows
        for c in range(cols):
            # Perspective: widen tiles toward the bottom
            spread0 = 0.6 + 0.4 * (y0 - top) / (H - top)
            spread1 = 0.6 + 0.4 * (y1 - top) / (H - top)
            cw = W / cols
            xa = W / 2 + (c * cw - W / 2) * spread0
            xb = W / 2 + ((c + 1) * cw - W / 2) * spread0
            xc = W / 2 + ((c + 1) * cw - W / 2) * spread1
            xd = W / 2 + (c * cw - W / 2) * spread1
            col = palette[(r * 3 + c + beat) % len(palette)]
            if (r + c + beat) % 2:
                col = tuple(v // 3 for v in col)
            d.polygon([(s(xa), s(y0)), (s(xb), s(y0)), (s(xc), s(y1)), (s(xd), s(y1))],
                      fill=col, outline=(20, 10, 30))

    # Disco ball with rotating sparkle
    ellipse(d, W / 2, 40, 28, 28, (200, 200, 215), outline=(90, 90, 110))
    for i in range(6):
        a = t * 3 + i * math.pi / 3
        x = W / 2 + 18 * math.cos(a)
        y = 40 + 18 * math.sin(a) * 0.5
        ellipse(d, x, y, 3, 3, (255, 255, 255), outline=None)
    d.line([s(W / 2), 0, s(W / 2), s(12)], fill=(150, 150, 160), width=s(2))

    # Light rays sweeping from the ball
    for i in range(5):
        a = math.sin(t * 1.5 + i * 1.3) * 60 + (i - 2) * 25
        ex, ey = polar(W / 2, 40, 520, a)
        col = palette[i]
        d.line([s(W / 2), s(40), s(ex), s(ey)], fill=tuple(v // 2 for v in col), width=s(2))

    # Floating music notes
    for i in range(4):
        phase = (t * 0.6 + i * 0.25) % 1.0
        x = 80 + i * 160 + 20 * math.sin(t * 3 + i)
        y = 320 - phase * 260
        col = palette[i]
        ellipse(d, x, y, 8, 6, col, outline=None)
        d.line([s(x + 7), s(y), s(x + 7), s(y - 28)], fill=col, width=s(3))
        d.line([s(x + 7), s(y - 28), s(x + 18), s(y - 20)], fill=col, width=s(3))


def draw_cat(d, t):
    beat_phase = (t / BEAT) * 2 * math.pi
    bounce = abs(math.sin(beat_phase / 2)) * 22       # hop on each beat
    sway = math.sin(beat_phase / 4) * 25               # side-to-side groove
    lean = math.sin(beat_phase / 4) * 10               # body tilt in degrees
    squash = 1 + 0.06 * math.cos(beat_phase)

    cx = W / 2 + sway
    ground = 400
    hip_y = ground - 70 - bounce
    body_cy = hip_y - 45

    # Tail (behind body): wavy curve
    pts = []
    for i in range(14):
        k = i / 13
        x = cx + 45 + k * 70
        y = hip_y - 10 - k * 90 + math.sin(t * 8 + k * 4) * 18 * k
        pts.append((s(x), s(y)))
    d.line(pts, fill=OUTLINE, width=s(20), joint="curve")
    d.line(pts, fill=FUR, width=s(14), joint="curve")
    ellipse(d, pts[-1][0] / SS, pts[-1][1] / SS, 8, 8, FUR_DARK)

    # Legs: alternating steps
    step = math.sin(beat_phase / 2)
    for side, sgn in ((-1, 1), (1, -1)):
        hx = cx + side * 22
        lift = max(0, sgn * step) * 30
        fx = hx + side * 18 + sgn * step * 10
        fy = min(ground, ground - lift + bounce * 0.2) - 4
        limb(d, hx, hip_y, fx, fy, 18, FUR)

    # Body
    ellipse(d, cx, body_cy, 48 / squash, 58 * squash, FUR)
    ellipse(d, cx, body_cy + 8, 28 / squash, 38 * squash, BELLY, outline=None)

    # Arms: wave overhead, alternating, like disco pointing
    shoulder_y = body_cy - 30
    arm_swing = math.sin(beat_phase / 2)
    for side in (-1, 1):
        sx = cx + side * 40
        angle = 180 - side * (35 + 85 * (0.5 + 0.5 * side * arm_swing))
        ex, ey = polar(sx, shoulder_y, 62, angle + lean)
        limb(d, sx, shoulder_y, ex, ey, 16, FUR)

    # Head bobbing with a tilt
    head_tilt = math.sin(beat_phase / 2) * 12 + lean
    hx, hy = polar(cx, body_cy - 50, 45, 180 + lean * 0.5)
    hy += math.cos(beat_phase) * 3

    def rot(px, py):
        a = math.radians(head_tilt)
        dx, dy = px, py
        return hx + dx * math.cos(a) - dy * math.sin(a), hy + dx * math.sin(a) + dy * math.cos(a)

    # Ears
    for side in (-1, 1):
        outer = [rot(side * 48, -10), rot(side * 40, -68), rot(side * 10, -42)]
        inner = [rot(side * 40, -22), rot(side * 37, -56), rot(side * 18, -40)]
        d.polygon([(s(x), s(y)) for x, y in outer], fill=FUR, outline=OUTLINE, width=s(3))
        d.polygon([(s(x), s(y)) for x, y in inner], fill=PINK)

    ellipse(d, hx, hy, 52, 45, FUR)
    # Forehead stripes
    for dx in (-12, 0, 12):
        a0, a1 = rot(dx, -42), rot(dx * 0.8, -26)
        d.line([s(a0[0]), s(a0[1]), s(a1[0]), s(a1[1])], fill=FUR_DARK, width=s(5))

    # Eyes: blink occasionally, otherwise happy closed-arc on strong beats
    blink = (t % 2.2) < 0.12
    for side in (-1, 1):
        ex, ey = rot(side * 19, -4)
        if blink:
            d.line([s(ex - 9), s(ey), s(ex + 9), s(ey)], fill=OUTLINE, width=s(3))
        else:
            ellipse(d, ex, ey, 10, 12, (255, 255, 255), width=2)
            look = math.sin(beat_phase / 4) * 3
            ellipse(d, ex + look, ey + 1, 6, 8, (30, 30, 30), outline=None)
            ellipse(d, ex + look + 2, ey - 3, 2.2, 2.2, (255, 255, 255), outline=None)

    # Cheeks
    for side in (-1, 1):
        ex, ey = rot(side * 32, 12)
        ellipse(d, ex, ey, 8, 5, (255, 170, 170), outline=None)

    # Nose and mouth (mouth opens on the beat, like singing)
    nx, ny = rot(0, 10)
    d.polygon([(s(nx - 6), s(ny - 3)), (s(nx + 6), s(ny - 3)), (s(nx), s(ny + 4))], fill=PINK)
    mouth_open = 4 + 6 * abs(math.sin(beat_phase / 2))
    mx, my = rot(0, 20)
    ellipse(d, mx, my + mouth_open / 2, 7, mouth_open / 2 + 1, (120, 30, 40), width=2)

    # Whiskers
    for side in (-1, 1):
        for k in (-1, 0, 1):
            a0 = rot(side * 22, 12 + k * 5)
            a1 = rot(side * 62, 6 + k * 10)
            d.line([s(a0[0]), s(a0[1]), s(a1[0]), s(a1[1])], fill=OUTLINE, width=s(2))

    # Shadow-free ground cue: small dust puffs on landing
    land = abs(math.sin(beat_phase / 2))
    if land < 0.25:
        alpha = 1 - land / 0.25
        for side in (-1, 1):
            ellipse(d, cx + side * 55, ground - 4, 10 * alpha + 2, 5 * alpha + 1,
                    (220, 220, 240), outline=None)


def render_frame(t):
    img = Image.new("RGB", (W * SS, H * SS))
    d = ImageDraw.Draw(img)
    draw_background(d, t)
    draw_cat(d, t)
    return img.resize((W, H), Image.LANCZOS)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "dancing_cat.mp4"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart",
        out,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(FPS * SECONDS):
        proc.stdin.write(render_frame(i / FPS).tobytes())
    proc.stdin.close()
    proc.wait()
    print(f"Wrote {out} ({SECONDS}s @ {FPS}fps, {W}x{H})")


if __name__ == "__main__":
    main()
