"""Render a 5-second 3D video of a cat dancing on a disco floor.

A small numpy ray marcher: the cat is a signed distance field built from
ellipsoids, capsules and cones, lit with soft shadows, ambient occlusion and
coloured rim lights. The floor reflects the cat and the camera slowly orbits.
Frames are rendered in parallel and piped to ffmpeg.

Usage: python3 dancing_cat_3d.py [output.mp4]
"""
import math
import subprocess
import sys
from multiprocessing import Pool

import numpy as np

W, H = 640, 480
SS = 2  # supersampling per axis
FPS = 30
SECONDS = 5
BEAT = 0.5  # seconds per beat (120 BPM)

FUR = np.array([0.95, 0.52, 0.18])
FUR_DARK = np.array([0.70, 0.30, 0.08])
CREAM = np.array([1.0, 0.88, 0.70])
PINK = np.array([1.0, 0.45, 0.55])
EYE_WHITE = np.array([0.97, 0.97, 0.95])
PUPIL = np.array([0.03, 0.03, 0.04])
MOUTH = np.array([0.45, 0.08, 0.12])
PALETTE = np.array([
    [1.0, 0.25, 0.45], [0.2, 0.75, 1.0], [1.0, 0.85, 0.2],
    [0.35, 1.0, 0.5], [0.7, 0.4, 1.0],
])

# Material ids
M_FUR, M_CREAM, M_WHITE, M_PUPIL, M_NOSE, M_MOUTH = range(6)
MAT_COLORS = {M_CREAM: CREAM, M_WHITE: EYE_WHITE, M_PUPIL: PUPIL, M_NOSE: PINK, M_MOUTH: MOUTH}

WALL_Z = -3.5
BALL_C = np.array([0.0, 2.9, -2.2])
BALL_R = 0.35


# ---------------------------------------------------------------- SDF helpers

def length(x, y, z):
    return np.sqrt(x * x + y * y + z * z)


def sd_sphere(x, y, z, c, r):
    return length(x - c[0], y - c[1], z - c[2]) - r


def sd_ellipsoid(x, y, z, c, r):
    px, py, pz = (x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]
    k0 = length(px, py, pz)
    k1 = length(px / r[0], py / r[1], pz / r[2])
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-6)


def sd_capsule(x, y, z, a, b, ra, rb=None):
    rb = ra if rb is None else rb
    ba = b - a
    px, py, pz = x - a[0], y - a[1], z - a[2]
    h = np.clip((px * ba[0] + py * ba[1] + pz * ba[2]) / ba.dot(ba), 0.0, 1.0)
    return length(px - ba[0] * h, py - ba[1] * h, pz - ba[2] * h) - (ra + (rb - ra) * h)


def sd_round_cone(qx, qy, qz, r1, r2, h):
    """Round cone along +y from the origin (Inigo Quilez)."""
    b = (r1 - r2) / h
    a = math.sqrt(1.0 - b * b)
    l = np.sqrt(qx * qx + qz * qz)
    k = -b * l + a * qy
    d_mid = a * l + b * qy - r1
    d_lo = np.sqrt(l * l + qy * qy) - r1
    d_hi = np.sqrt(l * l + (qy - h) ** 2) - r2
    return np.where(k < 0, d_lo, np.where(k > a * h, d_hi, d_mid))


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def rot_y(x, z, ang):
    c, s = math.cos(ang), math.sin(ang)
    return c * x - s * z, s * x + c * z


def rot_z(x, y, ang):
    c, s = math.cos(ang), math.sin(ang)
    return c * x - s * y, s * x + c * y


# ---------------------------------------------------------------- the cat rig

class Cat:
    def __init__(self, t):
        ph = t / BEAT * 2 * math.pi
        self.t = t
        self.root = np.array([math.sin(ph / 4) * 0.3, 0.0, 0.0])
        self.twist = math.sin(ph / 4) * 0.45           # turn left/right
        self.lean = math.sin(ph / 4) * 0.14            # hip sway tilt
        self.head_tilt = math.sin(ph / 2) * 0.22
        bounce = abs(math.sin(ph / 2)) * 0.12
        self.hip_y = 0.70 + bounce
        hy = self.hip_y

        self.body_c = np.array([0.0, hy + 0.42, 0.0])
        self.body_r = np.array([0.40, 0.52, 0.35])
        self.head_c = np.array([0.0, hy + 1.16, 0.04])

        # Arms: alternate raising overhead, pumping forward
        swing = math.sin(ph / 2)
        self.arms = []
        for side in (-1, 1):
            sh = np.array([side * 0.32, hy + 0.70, 0.05])
            a = 0.5 + 2.1 * (0.5 + 0.5 * side * swing)  # angle from straight down
            d = np.array([side * math.sin(a), -math.cos(a), 0.25 + 0.2 * math.cos(ph)])
            d /= np.linalg.norm(d)
            self.arms.append((sh, sh + d * 0.52))

        # Legs: step on alternate beats
        self.legs = []
        for side in (-1, 1):
            hip = np.array([side * 0.17, hy + 0.08, 0.0])
            lift = max(0.0, side * swing) * 0.22
            foot = np.array([side * 0.26, 0.09 + lift, 0.06 + lift * 0.4])
            self.legs.append((hip, foot))

        # Tail: wavy chain of capsules
        self.tail = []
        for i in range(7):
            k = i / 6
            self.tail.append(np.array([
                0.28 * math.sin(t * 7 + k * 3.0) * k,
                hy + 0.12 + k * 0.85,
                -0.30 - 0.45 * math.sin(k * 1.6),
            ]))

        self.mouth_open = 0.02 + 0.035 * abs(math.sin(ph / 2))
        self.blink = ((t + 1.0) % 2.2) < 0.1
        self.bound_c = self.root + np.array([0.0, 1.15, 0.0])
        self.bound_r = 1.75

    # Coordinate frames ----------------------------------------------------
    def to_local(self, x, y, z):
        x, y, z = x - self.root[0], y - self.root[1], z - self.root[2]
        x, z = rot_y(x, z, -self.twist)
        return x, y, z

    def to_upper(self, x, y, z):
        """Upper body leans around the hips."""
        x, yy = rot_z(x, y - self.hip_y, -self.lean)
        return x, yy + self.hip_y, z

    def to_head(self, ux, uy, uz):
        hx, hy = rot_z(ux - self.head_c[0], uy - self.head_c[1], -self.head_tilt)
        return hx, hy, uz - self.head_c[2]

    # Distance field -------------------------------------------------------
    def sdf(self, x, y, z, with_mat=False):
        lx, ly, lz = self.to_local(x, y, z)
        ux, uy, uz = self.to_upper(lx, ly, lz)
        hx, hy, hz = self.to_head(ux, uy, uz)

        # Fur parts, blended together
        d = sd_ellipsoid(ux, uy, uz, self.body_c, self.body_r)
        d = smin(d, sd_ellipsoid(hx, hy, hz, (0, 0, 0), (0.42, 0.35, 0.37)), 0.10)
        for side in (-1, 1):
            a = 0.35
            qx, qy = hx - side * 0.21, hy - 0.18
            ex, ey = rot_z(qx, qy, side * a)
            d = smin(d, sd_round_cone(ex, ey, hz * 1.8, 0.13, 0.025, 0.30) / 1.8, 0.04)
        for sh, hand in self.arms:
            d = smin(d, sd_capsule(ux, uy, uz, sh, hand, 0.085, 0.075), 0.08)
            d = smin(d, sd_sphere(ux, uy, uz, hand, 0.1), 0.04)
        for hip, foot in self.legs:
            d = smin(d, sd_capsule(lx, ly, lz, hip, foot, 0.11, 0.09), 0.08)
            d = smin(d, sd_ellipsoid(lx, ly, lz, foot + np.array([0, -0.01, 0.06]),
                                     (0.11, 0.08, 0.15)), 0.05)
        for i in range(len(self.tail) - 1):
            r0 = 0.075 - i * 0.006
            d = smin(d, sd_capsule(lx, ly, lz, self.tail[i], self.tail[i + 1], r0, r0 - 0.006), 0.05)

        if not with_mat:
            d = np.minimum(d, self._face(hx, hy, hz)[0])
            return d
        mat = np.full(d.shape, M_FUR)
        dd, mm = self._face(hx, hy, hz)
        take = dd < d
        return np.where(take, dd, d), np.where(take, mm, mat)

    def _face(self, hx, hy, hz):
        parts = []
        muzzle = np.minimum(
            sd_sphere(hx, hy, hz, (-0.07, -0.10, 0.29), 0.095),
            sd_sphere(hx, hy, hz, (0.07, -0.10, 0.29), 0.095))
        parts.append((muzzle, M_CREAM))
        parts.append((sd_ellipsoid(hx, hy, hz, (0, -0.035, 0.385), (0.045, 0.032, 0.03)), M_NOSE))
        parts.append((sd_ellipsoid(hx, hy, hz, (0, -0.19, 0.30),
                                   (0.045, self.mouth_open, 0.04)), M_MOUTH))
        eye_y = 0.0 if not self.blink else -0.03
        for side in (-1, 1):
            if self.blink:
                parts.append((sd_capsule(hx, hy, hz, np.array([side * 0.09, 0.04, 0.34]),
                                         np.array([side * 0.21, 0.04, 0.30]), 0.012), M_PUPIL))
                continue
            parts.append((sd_ellipsoid(hx, hy, hz, (side * 0.15, 0.04 + eye_y, 0.30),
                                       (0.085, 0.10, 0.06)), M_WHITE))
            parts.append((sd_ellipsoid(hx, hy, hz, (side * 0.145, 0.03, 0.345),
                                       (0.05, 0.065, 0.03)), M_PUPIL))
        d, m = parts[0][0], np.full(hx.shape, parts[0][1])
        for pd, pm in parts[1:]:
            take = pd < d
            d = np.where(take, pd, d)
            m = np.where(take, pm, m)
        return d, m

    def fur_color(self, x, y, z):
        lx, ly, lz = self.to_local(x, y, z)
        ux, uy, uz = self.to_upper(lx, ly, lz)
        hx, hy, hz = self.to_head(ux, uy, uz)
        col = np.tile(FUR, (len(x), 1))
        # Tabby stripes on the back, head top and tail
        stripe = (np.sin(uy * 26.0 + np.abs(ux) * 4) > 0.45) & (uz < 0.12)
        head_stripe = (hy > 0.20) & (np.abs(hx) < 0.14) & (np.sin(hx * 70) > 0.2) & (hz > -0.1)
        col[stripe | head_stripe] = FUR_DARK
        # Cream belly
        bx = (ux - self.body_c[0]) / self.body_r[0]
        by = (uy - self.body_c[1]) / self.body_r[1]
        belly = (uz > 0.12) & (bx * bx * 2.2 + (by + 0.1) ** 2 < 0.55)
        col[belly] = CREAM
        # Cream paws
        paws = ly < 0.17
        for _, hand in self.arms:
            paws |= length(ux - hand[0], uy - hand[1], uz - hand[2]) < 0.1
        col[paws] = CREAM
        return col


# ---------------------------------------------------------------- ray marching

def sphere_span(ro, rd, c, r):
    oc = ro - c
    b = (oc * rd).sum(1)
    cc = (oc * oc).sum(1) - r * r
    disc = b * b - cc
    ok = disc > 0
    s = np.sqrt(np.maximum(disc, 0))
    return ok, np.maximum(-b - s, 0.0), -b + s


def march(cat, ro, rd, tmax=None):
    """Return (hit mask, t) for rays against the cat SDF."""
    n = len(ro)
    t_out = np.full(n, np.inf)
    ok, t0, t1 = sphere_span(ro, rd, cat.bound_c, cat.bound_r)
    if tmax is not None:
        t1 = np.minimum(t1, tmax)
    ok &= t0 < t1
    idx = np.nonzero(ok)[0]
    t = t0[idx].copy()
    tend = t1[idx]
    o, d = ro[idx], rd[idx]
    for _ in range(90):
        if len(idx) == 0:
            break
        p = o + d * t[:, None]
        dist = cat.sdf(p[:, 0], p[:, 1], p[:, 2])
        hit = dist < 0.0015 * (1 + t)
        t_out[idx[hit]] = t[hit]
        t = t + dist * 0.9
        keep = ~hit & (t < tend)
        idx, t, tend, o, d = idx[keep], t[keep], tend[keep], o[keep], d[keep]
    return np.isfinite(t_out), t_out


def cat_normal(cat, p):
    e = 0.002
    ks = np.array([[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]], dtype=float)
    n = np.zeros_like(p)
    for k in ks:
        q = p + k * e
        n += k * cat.sdf(q[:, 0], q[:, 1], q[:, 2])[:, None]
    return n / np.linalg.norm(n, axis=1, keepdims=True)


def soft_shadow(cat, p, ldir):
    res = np.ones(len(p))
    ok, t0, t1 = sphere_span(p, np.broadcast_to(ldir, p.shape), cat.bound_c, cat.bound_r)
    idx = np.nonzero(ok)[0]
    if len(idx) == 0:
        return res
    t = np.maximum(t0[idx], 0.02)
    tend = t1[idx]
    o = p[idx]
    for _ in range(40):
        if len(idx) == 0:
            break
        q = o + ldir * t[:, None]
        h = cat.sdf(q[:, 0], q[:, 1], q[:, 2])
        res[idx] = np.minimum(res[idx], np.clip(10 * h / t, 0, 1))
        t = t + np.clip(h, 0.02, 0.25)
        keep = (h > 0.001) & (t < tend)
        res[idx[~keep & (h <= 0.001)]] = 0
        idx, t, tend, o = idx[keep], t[keep], tend[keep], o[keep]
    return res


def ambient_occlusion(cat, p, n):
    occ = np.zeros(len(p))
    for i in range(1, 6):
        h = 0.03 * i
        q = p + n * h
        occ += (h - cat.sdf(q[:, 0], q[:, 1], q[:, 2])) / (2 ** i)
    return np.clip(1 - 4 * occ, 0, 1)


# ---------------------------------------------------------------- scene shading

KEY = np.array([0.55, 0.85, 0.75])
KEY /= np.linalg.norm(KEY)


def shade_cat(cat, p, rd, t):
    n = cat_normal(cat, p)
    _, mat = cat.sdf(p[:, 0], p[:, 1], p[:, 2], with_mat=True)
    base = cat.fur_color(p[:, 0], p[:, 1], p[:, 2])
    for m, c in MAT_COLORS.items():
        base[mat == m] = c

    beat = (t / BEAT) % 1.0
    pulse = 0.6 + 0.4 * math.exp(-beat * 5)
    occ = ambient_occlusion(cat, p, n)[:, None]
    sh = soft_shadow(cat, p + n * 0.01, KEY)[:, None]
    dif = np.clip((n * KEY).sum(1), 0, 1)[:, None]
    sky = (0.5 + 0.5 * n[:, 1:2])
    col = base * (1.25 * dif * sh * np.array([1.0, 0.95, 0.85])
                  + 0.35 * sky * occ * np.array([0.6, 0.55, 0.9]))
    # Coloured rim lights
    for ldir, lc in (((-0.9, 0.3, -0.5), PALETTE[0]), ((0.9, 0.3, -0.5), PALETTE[1])):
        ld = np.array(ldir) / np.linalg.norm(ldir)
        rim = np.clip((n * ld).sum(1), 0, 1) ** 2
        col += (rim[:, None] * lc * 0.55 * pulse) * occ
    # Fresnel-ish rim from the camera view
    fres = np.clip(1 + (n * rd).sum(1), 0, 1) ** 3
    col += fres[:, None] * 0.25 * np.array([0.8, 0.6, 1.0]) * occ
    # Specular (glossy eyes and nose)
    hv = KEY - rd
    hv /= np.linalg.norm(hv, axis=1, keepdims=True)
    gloss = np.where(np.isin(mat, [M_WHITE, M_PUPIL, M_NOSE]), 1.0, 0.12)
    power = np.where(np.isin(mat, [M_WHITE, M_PUPIL, M_NOSE]), 80.0, 12.0)
    spec = np.clip((n * hv).sum(1), 0, 1) ** power * gloss
    col += (spec * sh[:, 0])[:, None]
    return col


def wall_color(p, t):
    col = np.tile(np.array([0.06, 0.03, 0.12]), (len(p), 1))
    col *= (0.6 + 0.4 * np.clip(p[:, 1:2] / 3.0, 0, 1))
    # Moving disco light spots
    for i in range(14):
        a = t * 0.9 + i * 2.39996
        sx = math.cos(a) * (1.5 + (i % 5) * 0.7)
        sy = 1.9 + math.sin(a * 1.3 + i) * 1.3
        d2 = (p[:, 0] - sx) ** 2 + (p[:, 1] - sy) ** 2
        col += np.exp(-d2 / 0.02)[:, None] * PALETTE[i % 5] * 0.9
    return col


def floor_color(p, t):
    beat = int(t / BEAT)
    size = 0.6
    fx, fz = p[:, 0] / size, p[:, 2] / size
    i, j = np.floor(fx).astype(int), np.floor(fz).astype(int)
    col = PALETTE[(i + j * 3 + beat) % 5].copy()
    dim = ((i + j + beat) % 2) == 1
    col[dim] *= 0.18
    col[~dim] *= 0.8
    # Grout lines
    gx, gz = np.abs(fx - np.round(fx)), np.abs(fz - np.round(fz))
    grout = np.minimum(gx, gz) < 0.03
    col[grout] = np.array([0.03, 0.02, 0.05])
    return col


def ball_color(p, rd, t):
    n = (p - BALL_C) / BALL_R
    # Spin the ball and quantise its normal into mirror facets
    nx, nz = rot_y(n[:, 0], n[:, 2], t * 1.5)
    lat = np.floor(np.arcsin(np.clip(n[:, 1], -1, 1)) * 8 / math.pi)
    lon = np.floor(np.arctan2(nz, nx) * 10 / math.pi)
    rnd = np.sin(lat * 12.9898 + lon * 78.233 + np.floor(t * 8)) * 43758.5453
    rnd -= np.floor(rnd)
    base = 0.35 + 0.35 * (n[:, 1:2] * 0.5 + 0.5)
    col = np.tile(np.array([0.75, 0.75, 0.85]), (len(p), 1)) * base
    sparkle = rnd > 0.85
    col[sparkle] = 0.6 + 0.6 * PALETTE[(lat[sparkle] + lon[sparkle]).astype(int) % 5]
    seam = (np.abs(np.sin(np.arcsin(np.clip(n[:, 1], -1, 1)) * 8)) < 0.12)
    col[seam] *= 0.4
    return col


def ray_ball(ro, rd):
    ok, t0, _ = sphere_span(ro, rd, BALL_C, BALL_R)
    oc = ro - BALL_C
    outside = (oc * oc).sum(1) > BALL_R * BALL_R
    return np.where(ok & outside & (t0 > 0), t0, np.inf)


def trace_environment(cat, ro, rd, t, depth=0):
    """Shade rays that hit the floor, wall or disco ball (not the cat)."""
    n = len(ro)
    col = np.zeros((n, 3))
    with np.errstate(divide="ignore", invalid="ignore"):
        t_floor = np.where(rd[:, 1] < -1e-4, -ro[:, 1] / rd[:, 1], np.inf)
        t_wall = np.where(rd[:, 2] < -1e-4, (WALL_Z - ro[:, 2]) / rd[:, 2], np.inf)
    t_ball = ray_ball(ro, rd)
    t_wall = np.where(t_wall > 0, t_wall, np.inf)
    t_floor = np.where(t_floor > 0, t_floor, np.inf)

    nearest = np.argmin(np.stack([t_floor, t_wall, t_ball]), axis=0)
    tmin = np.minimum(np.minimum(t_floor, t_wall), t_ball)
    none = ~np.isfinite(tmin)
    col[none] = np.array([0.05, 0.02, 0.10])

    m = (nearest == 2) & ~none
    if m.any():
        p = ro[m] + rd[m] * t_ball[m, None]
        col[m] = ball_color(p, rd[m], t)

    m = (nearest == 1) & ~none
    if m.any():
        p = ro[m] + rd[m] * t_wall[m, None]
        c = wall_color(p, t)
        c *= (0.55 + 0.45 * soft_shadow(cat, p, KEY))[:, None]
        col[m] = c

    m = (nearest == 0) & ~none
    if m.any():
        idx = np.nonzero(m)[0]
        p = ro[idx] + rd[idx] * t_floor[idx, None]
        c = floor_color(p, t)
        shadow = soft_shadow(cat, p + np.array([0, 0.001, 0]), KEY)
        c *= (0.35 + 0.65 * shadow)[:, None]
        # Contact shadow straight under the cat's feet
        ao = np.ones(len(p))
        for hgt in (0.05, 0.15, 0.3):
            q = p + np.array([0, hgt, 0])
            ao *= np.clip(0.4 + cat.sdf(q[:, 0], q[:, 1], q[:, 2]) / hgt * 0.6, 0.3, 1)
        c *= ao[:, None]
        if depth == 0:
            # Glossy floor reflection
            rr = rd[idx] * np.array([1, -1, 1])
            ro2 = p + rr * 0.002
            hit, tc = march(cat, ro2, rr)
            refl = np.zeros_like(c)
            if hit.any():
                ph = ro2[hit] + rr[hit] * tc[hit, None]
                refl[hit] = shade_cat(cat, ph, rr[hit], t)
            miss = ~hit
            if miss.any():
                refl[miss] = trace_environment(cat, ro2[miss], rr[miss], t, depth=1)
            fres = 0.25 + 0.35 * (1 - np.abs(rd[idx, 1])) ** 4
            c = c * (1 - fres[:, None]) + refl * fres[:, None]
        # Fade the floor into darkness with distance
        fog = np.exp(-np.maximum(t_floor[idx] - 5, 0) * 0.15)
        col[idx] = c * fog[:, None] + (1 - fog[:, None]) * np.array([0.05, 0.02, 0.1])
    return col


# ---------------------------------------------------------------- frame

def camera(t):
    a = 0.45 * math.sin(2 * math.pi * t / SECONDS)
    ro = np.array([4.4 * math.sin(a), 1.55 + 0.15 * math.sin(t * 1.3), 4.4 * math.cos(a)])
    target = np.array([0.0, 1.1, 0.0])
    fw = target - ro
    fw /= np.linalg.norm(fw)
    rt = np.cross(fw, [0, 1, 0])
    rt /= np.linalg.norm(rt)
    up = np.cross(rt, fw)
    return ro, fw, rt, up


def render_frame(frame):
    t = frame / FPS
    cat = Cat(t)
    ro, fw, rt, up = camera(t)
    w, h = W * SS, H * SS
    fov = math.tan(math.radians(42) / 2)
    xs = (np.arange(w) + 0.5) / w * 2 - 1
    ys = 1 - (np.arange(h) + 0.5) / h * 2
    px, py = np.meshgrid(xs * fov * w / h, ys * fov)
    rd = fw + px.reshape(-1, 1) * rt + py.reshape(-1, 1) * up
    rd /= np.linalg.norm(rd, axis=1, keepdims=True)
    ro_all = np.broadcast_to(ro, rd.shape).copy()

    col = np.zeros_like(rd)
    hit, tc = march(cat, ro_all, rd)
    if hit.any():
        p = ro_all[hit] + rd[hit] * tc[hit, None]
        col[hit] = shade_cat(cat, p, rd[hit], t)
    col[~hit] = trace_environment(cat, ro_all[~hit], rd[~hit], t)

    img = col.reshape(h, w, 3)
    img = img.reshape(H, SS, W, SS, 3).mean(axis=(1, 3))
    # Tone map, gamma and vignette
    img = img / (1 + 0.25 * img)
    img = np.clip(img, 0, 1) ** (1 / 1.6)
    vy, vx = np.meshgrid(np.linspace(-1, 1, H), np.linspace(-1, 1, W), indexing="ij")
    img *= (1 - 0.25 * (vx ** 2 + vy ** 2))[..., None]
    return (np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes()


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "dancing_cat_3d.mp4"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart",
        out,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    total = FPS * SECONDS
    with Pool() as pool:
        for i, data in enumerate(pool.imap(render_frame, range(total))):
            proc.stdin.write(data)
            print(f"\rframe {i + 1}/{total}", end="", flush=True)
    proc.stdin.close()
    proc.wait()
    print(f"\nWrote {out} ({SECONDS}s @ {FPS}fps, {W}x{H})")


if __name__ == "__main__":
    main()
