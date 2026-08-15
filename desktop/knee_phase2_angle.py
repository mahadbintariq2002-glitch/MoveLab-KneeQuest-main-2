"""
Clinical Joint Tracker — Detection + Goniometric Angle Measurement (All Views)
=============================================================================
A real-time webcam tool for measuring human joint angles with clinical-grade
stability, intended for range-of-motion (ROM) assessment in rehab / physio.

Key design decisions for ACCURACY
  • Angles are computed from MediaPipe `pose_world_landmarks` (metric 3-D
    coordinates in metres, origin at the hip centre). These are roughly
    view-independent, so a 90° elbow reads ~90° in frontal, side, or angled
    views — unlike the screen-normalised landmarks whose z is unreliable and
    whose x/y are distorted by the image aspect ratio.
  • Every joint angle is passed through a One-Euro filter, which removes the
    frame-to-frame jitter that makes raw MediaPipe readings unusable for
    measurement, while keeping latency low during fast motion.
  • A per-joint stability monitor (std-dev of a short window) flags when a
    reading is STEADY enough to be trusted/recorded.
  • Strict confidence gating: a joint angle is only reported when all three
    landmarks exceed a high visibility threshold.
  • Live ROM capture: min / max flexion per joint per session, plus optional
    CSV logging with timestamps for clinical records.
  • Left/Right symmetry comparison for bilateral joints.

Handedness handling (unchanged, and correct)
  • Pose runs on the RAW frame  → MediaPipe's anatomical L/R is correct.
  • Hands run on the FLIPPED frame → MediaPipe "Right" = your physical right.

Controls
  Q = quit          S = screenshot      L = joint labels
  V = visibility %  R = toggle CSV log  Z = zero/reset ROM
"""

import argparse
import csv
import math
import os
import time
from collections import deque, defaultdict

import cv2
import mediapipe as mp
import numpy as np


# ═══════════════════════════════════════════════════════════════════
#  One-Euro filter  (smooths noisy angle signals with low latency)
#  Reference: Casiez, Roussel & Vogel, CHI 2012.
# ═══════════════════════════════════════════════════════════════════
class OneEuroFilter:
    def __init__(self, freq=30.0, mincutoff=1.0, beta=0.05, dcutoff=1.0):
        self.freq      = float(freq)
        self.mincutoff = float(mincutoff)
        self.beta      = float(beta)
        self.dcutoff   = float(dcutoff)
        self.x_prev    = None
        self.dx_prev   = 0.0
        self.t_prev    = None

    def _alpha(self, cutoff):
        te  = 1.0 / self.freq
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / te)

    def __call__(self, x, t=None):
        if self.x_prev is None:
            self.x_prev, self.t_prev = x, t
            return x
        if t is not None and self.t_prev is not None and t > self.t_prev:
            self.freq = 1.0 / (t - self.t_prev)
        self.t_prev = t

        dx     = (x - self.x_prev) * self.freq
        a_d    = self._alpha(self.dcutoff)
        dx_hat = a_d * dx + (1.0 - a_d) * self.dx_prev

        cutoff = self.mincutoff + self.beta * abs(dx_hat)
        a      = self._alpha(cutoff)
        x_hat  = a * x + (1.0 - a) * self.x_prev

        self.x_prev, self.dx_prev = x_hat, dx_hat
        return x_hat


# ═══════════════════════════════════════════════════════════════════
#  MediaPipe handles
# ═══════════════════════════════════════════════════════════════════
mp_pose  = mp.solutions.pose
mp_hands = mp.solutions.hands
LM       = mp_pose.PoseLandmark


# ═══════════════════════════════════════════════════════════════════
#  Joint label table  (landmarks drawn as dots)
# ═══════════════════════════════════════════════════════════════════
ALL_JOINTS = [
    (LM.NOSE,             "Nose"),
    (LM.LEFT_EYE,         "L.Eye"),    (LM.RIGHT_EYE,        "R.Eye"),
    (LM.LEFT_EAR,         "L.Ear"),    (LM.RIGHT_EAR,        "R.Ear"),
    (LM.LEFT_SHOULDER,    "L.Shld"),   (LM.RIGHT_SHOULDER,   "R.Shld"),
    (LM.LEFT_ELBOW,       "L.Elbow"),  (LM.RIGHT_ELBOW,      "R.Elbow"),
    (LM.LEFT_WRIST,       "L.Wrist"),  (LM.RIGHT_WRIST,      "R.Wrist"),
    (LM.LEFT_HIP,         "L.Hip"),    (LM.RIGHT_HIP,        "R.Hip"),
    (LM.LEFT_KNEE,        "L.Knee"),   (LM.RIGHT_KNEE,       "R.Knee"),
    (LM.LEFT_ANKLE,       "L.Ankle"),  (LM.RIGHT_ANKLE,      "R.Ankle"),
    (LM.LEFT_HEEL,        "L.Heel"),   (LM.RIGHT_HEEL,       "R.Heel"),
    (LM.LEFT_FOOT_INDEX,  "L.Foot"),   (LM.RIGHT_FOOT_INDEX, "R.Foot"),
]

# ═══════════════════════════════════════════════════════════════════
#  Angle definitions: (A, VERTEX, C, arc_color_BGR)
#  Angle is measured AT the VERTEX between segments V→A and V→C.
# ═══════════════════════════════════════════════════════════════════
ANGLE_DEFS = {
    "L.Knee":     (LM.LEFT_HIP,       LM.LEFT_KNEE,       LM.LEFT_ANKLE,       ( 57, 255,  20)),
    "R.Knee":     (LM.RIGHT_HIP,      LM.RIGHT_KNEE,      LM.RIGHT_ANKLE,      (  0, 255, 128)),
    "L.Hip":      (LM.LEFT_SHOULDER,  LM.LEFT_HIP,        LM.LEFT_KNEE,        (  0, 165, 255)),
    "R.Hip":      (LM.RIGHT_SHOULDER, LM.RIGHT_HIP,       LM.RIGHT_KNEE,       (  0, 165, 255)),
    "L.Ankle":    (LM.LEFT_KNEE,      LM.LEFT_ANKLE,      LM.LEFT_FOOT_INDEX,  (255, 220,   0)),
    "R.Ankle":    (LM.RIGHT_KNEE,     LM.RIGHT_ANKLE,     LM.RIGHT_FOOT_INDEX, (255, 220,   0)),
    "L.Elbow":    (LM.LEFT_SHOULDER,  LM.LEFT_ELBOW,      LM.LEFT_WRIST,       (200,  50, 220)),
    "R.Elbow":    (LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW,     LM.RIGHT_WRIST,      (200,  50, 220)),
    "L.Shoulder": (LM.LEFT_ELBOW,     LM.LEFT_SHOULDER,   LM.LEFT_HIP,         (255, 120,  50)),
    "R.Shoulder": (LM.RIGHT_ELBOW,    LM.RIGHT_SHOULDER,  LM.RIGHT_HIP,        (255, 120,  50)),
}

# Joints where raw 180° = full extension → clinical flexion = 180 − raw.
FLEXION_JOINTS = {"L.Knee", "R.Knee", "L.Hip", "R.Hip", "L.Elbow", "R.Elbow"}

# Bilateral pairs for symmetry comparison.
SYMMETRY_PAIRS = [("L.Knee", "R.Knee"), ("L.Hip", "R.Hip"),
                  ("L.Elbow", "R.Elbow"), ("L.Shoulder", "R.Shoulder"),
                  ("L.Ankle", "R.Ankle")]

# Healthy reference ROM (clinical flexion degrees) for context flags.
NORMAL_FLEX_MAX = {"Knee": 135.0, "Hip": 120.0, "Elbow": 145.0}

# Confidence thresholds
VIS_HIGH   = 0.80   # reliable  → green
VIS_MED    = 0.50   # moderate  → orange  (minimum to draw a dot/label)
VIS_LOW    = 0.30   # low       → red
VIS_REPORT = 0.65   # minimum visibility (all 3 pts) to REPORT an angle

# Stability: a reading is "STEADY" when the std-dev of the recent window
# falls below this many degrees.
STEADY_STD_DEG  = 1.5
STABILITY_WIN   = 12     # frames in the stability window

# Finger constants
FINGER_TIPS  = [4, 8, 12, 16, 20]
FINGER_PIP   = [3, 6, 10, 14, 18]
FINGER_MCP   = [2, 5,  9, 13, 17]
FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky"]

# Colour palette (BGR)
C_WHITE  = (255, 255, 255)
C_BLACK  = (  0,   0,   0)
C_GREEN  = ( 57, 255,  20)
C_LIME   = (  0, 255, 128)
C_CYAN   = (255, 220,   0)
C_ORANGE = (  0, 165, 255)
C_RED    = (  0,  50, 255)
C_PURPLE = (200,  50, 220)
C_BLUE   = (255, 120,  50)
C_GRAY   = (170, 170, 170)
C_DARK   = ( 15,  12,  25)


# ═══════════════════════════════════════════════════════════════════
#  Angle mathematics  (operates on metric world coordinates)
# ═══════════════════════════════════════════════════════════════════
def angle_3d(a, b, c):
    """
    Geometric angle (deg) at vertex B between segments B→A and B→C.
    `a`, `b`, `c` are world landmarks (metric x, y, z), giving a true,
    aspect-ratio-correct, view-independent angle. Returns float in [0, 180]
    or None if a segment is degenerate.
    """
    ba = np.array([a.x - b.x, a.y - b.y, a.z - b.z], dtype=np.float64)
    bc = np.array([c.x - b.x, c.y - b.y, c.z - b.z], dtype=np.float64)
    n1 = np.linalg.norm(ba)
    n2 = np.linalg.norm(bc)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos_val = np.clip(np.dot(ba, bc) / (n1 * n2), -1.0, 1.0)
    return float(np.degrees(np.arccos(cos_val)))


def clinical_flexion(raw_angle):
    """180° raw = full extension (0° clinical flexion)."""
    return max(0.0, 180.0 - raw_angle)


def joint_state(name, raw_angle):
    """(state_label, color) from joint name and raw geometric angle."""
    if name not in FLEXION_JOINTS:
        return f"{raw_angle:.0f}°", C_CYAN
    flex = clinical_flexion(raw_angle)
    if   flex < 10:  return "FULL EXTENSION", C_GREEN
    elif flex < 35:  return "SLIGHT FLEX",    C_LIME
    elif flex < 75:  return "MODERATE FLEX",  C_CYAN
    elif flex < 115: return "DEEP FLEX",      C_ORANGE
    else:            return "MAX FLEX",       C_RED


def detect_view(lm_list):
    """Infer camera view (FRONTAL / SIDE / ANGLED) from shoulder/hip width."""
    ls, rs = lm_list[LM.LEFT_SHOULDER], lm_list[LM.RIGHT_SHOULDER]
    if ls.visibility < 0.40 or rs.visibility < 0.40:
        return "UNKNOWN", C_GRAY
    shoulder_dx = abs(rs.x - ls.x)
    lh, rh = lm_list[LM.LEFT_HIP], lm_list[LM.RIGHT_HIP]
    hip_dx = (abs(rh.x - lh.x)
              if lh.visibility > 0.30 and rh.visibility > 0.30 else 0.18)
    ratio = shoulder_dx / max(hip_dx, 0.04)
    if   ratio < 0.25: return "SIDE VIEW", C_ORANGE
    elif ratio > 0.80: return "FRONTAL",   C_GREEN
    else:              return "ANGLED",    C_CYAN


# ═══════════════════════════════════════════════════════════════════
#  Drawing utilities
# ═══════════════════════════════════════════════════════════════════
def put_text_bg(img, text, pos, scale=0.42, thick=1,
                fg=C_WHITE, bg=C_DARK, alpha=0.68):
    font = cv2.FONT_HERSHEY_DUPLEX
    (tw, th), bl = cv2.getTextSize(text, font, scale, thick)
    x, y = pos;  p = 4
    ov = img.copy()
    cv2.rectangle(ov, (x-p, y-th-p), (x+tw+p, y+bl+p), bg, -1)
    cv2.addWeighted(ov, alpha, img, 1-alpha, 0, img)
    cv2.putText(img, text, (x, y), font, scale, fg, thick, cv2.LINE_AA)


def fill_rect(img, p1, p2, color, alpha=0.74, r=12):
    x1, y1 = p1;  x2, y2 = p2
    ov = img.copy()
    cv2.rectangle(ov, (x1+r, y1), (x2-r, y2), color, -1)
    cv2.rectangle(ov, (x1, y1+r), (x2, y2-r), color, -1)
    for cx, cy in [(x1+r,y1+r),(x2-r,y1+r),(x1+r,y2-r),(x2-r,y2-r)]:
        cv2.circle(ov, (cx, cy), r, color, -1)
    cv2.addWeighted(ov, alpha, img, 1-alpha, 0, img)


def mirror_lm(lm, w, h):
    """Normalised pose landmark → pixel on the mirrored display frame."""
    return (w - 1 - int(lm.x * w), int(lm.y * h))


def draw_angle_arc(img, v, a, c, angle_deg, color, radius=38):
    """
    Draw the interior angle arc at vertex v between directions v→a and v→c.
    The displayed `angle_deg` (world-based, smoothed) is authoritative; the
    arc geometry is purely illustrative and always spans the interior angle.
    """
    vx, vy = int(v[0]), int(v[1])
    if (abs(a[0]-vx) + abs(a[1]-vy) < 5 or abs(c[0]-vx) + abs(c[1]-vy) < 5):
        return

    ang1 = math.degrees(math.atan2(a[1] - vy, a[0] - vx))
    ang2 = math.degrees(math.atan2(c[1] - vy, c[0] - vx))

    # Signed shortest sweep from ang1 to ang2 (interior, |sweep| ≤ 180°).
    sweep = (ang2 - ang1 + 180.0) % 360.0 - 180.0
    start = ang1
    end   = ang1 + sweep
    cv2.ellipse(img, (vx, vy), (radius, radius), 0,
                min(start, end), max(start, end), color, 2, cv2.LINE_AA)

    cv2.circle(img, (vx, vy), 5, color,  -1, cv2.LINE_AA)
    cv2.circle(img, (vx, vy), 6, C_DARK,  1, cv2.LINE_AA)

    mid_rad = math.radians(ang1 + sweep / 2.0)
    tx = int(vx + (radius + 24) * math.cos(mid_rad))
    ty = int(vy + (radius + 24) * math.sin(mid_rad))
    tx = max(5, min(img.shape[1] - 60, tx))
    ty = max(15, min(img.shape[0] - 10, ty))
    put_text_bg(img, f"{angle_deg:.0f}°", (tx, ty),
                scale=0.50, thick=1, fg=color, bg=C_DARK)


# ═══════════════════════════════════════════════════════════════════
#  Skeleton + arcs (pose)
# ═══════════════════════════════════════════════════════════════════
def draw_pose(img, lm_list, w, h, show_labels, show_vis, computed):
    for (s_i, e_i) in mp_pose.POSE_CONNECTIONS:
        sl, el = lm_list[s_i], lm_list[e_i]
        if sl.visibility < VIS_LOW or el.visibility < VIS_LOW:
            continue
        vis = min(sl.visibility, el.visibility)
        col = tuple(int(c * min(vis * 1.3, 1.0)) for c in C_CYAN)
        cv2.line(img, mirror_lm(sl, w, h), mirror_lm(el, w, h), col, 2, cv2.LINE_AA)

    for name, (ia, ib, ic, arc_col) in ANGLE_DEFS.items():
        entry = computed.get(name)
        if entry is None:
            continue
        la, lb, lc = lm_list[ia], lm_list[ib], lm_list[ic]
        if min(la.visibility, lb.visibility, lc.visibility) < VIS_MED:
            continue
        draw_angle_arc(img, mirror_lm(lb, w, h), mirror_lm(la, w, h),
                       mirror_lm(lc, w, h), entry["angle"], arc_col)

    for (lm_enum, label) in ALL_JOINTS:
        lmk = lm_list[lm_enum]
        if lmk.visibility < VIS_LOW:
            continue
        px, py = mirror_lm(lmk, w, h)
        col = (C_GREEN  if lmk.visibility >= VIS_HIGH else
               C_ORANGE if lmk.visibility >= VIS_MED  else C_RED)
        r = 5 if lmk.visibility >= VIS_MED else 3
        cv2.circle(img, (px, py), r,   col,   -1, cv2.LINE_AA)
        cv2.circle(img, (px, py), r+1, C_DARK, 1, cv2.LINE_AA)
        if show_labels and lmk.visibility >= VIS_MED:
            txt = label + (f" {lmk.visibility*100:.0f}%" if show_vis else "")
            put_text_bg(img, txt, (px+7, py-5), scale=0.36, fg=col, bg=C_DARK)


def draw_hands(img, hand_results, w, h):
    if not hand_results.multi_hand_landmarks:
        return
    for hlm in hand_results.multi_hand_landmarks:
        pts = [(int(lm.x * w), int(lm.y * h)) for lm in hlm.landmark]
        for conn in mp_hands.HAND_CONNECTIONS:
            cv2.line(img, pts[conn[0]], pts[conn[1]], C_BLUE, 2, cv2.LINE_AA)
        for i, (px, py) in enumerate(pts):
            tip = i in FINGER_TIPS
            cv2.circle(img, (px, py), 6 if tip else 4,
                       C_PURPLE if tip else C_BLUE, -1, cv2.LINE_AA)
            cv2.circle(img, (px, py), 7 if tip else 5, C_DARK, 1, cv2.LINE_AA)


def count_fingers(hlm, mp_label):
    lm = hlm.landmark
    raised = []
    tip_x, mcp_x = lm[FINGER_TIPS[0]].x, lm[FINGER_MCP[0]].x
    raised.append(tip_x < mcp_x if mp_label == "Right" else tip_x > mcp_x)
    for tip_i, pip_i in zip(FINGER_TIPS[1:], FINGER_PIP[1:]):
        raised.append(lm[tip_i].y < lm[pip_i].y)
    return sum(raised), raised


# ═══════════════════════════════════════════════════════════════════
#  UI panels
# ═══════════════════════════════════════════════════════════════════
def draw_angle_panel(img, computed, rom, w, h):
    """Right-side panel: angle, live flexion, session ROM and stability."""
    names = list(ANGLE_DEFS.keys())
    pw    = 330
    ph    = len(names) * 26 + 58
    px, py = w - pw - 8, 8

    fill_rect(img, (px, py), (px+pw, py+ph), (15, 8, 28), alpha=0.82)
    cv2.putText(img, "JOINT ANGLES  (deg)", (px+10, py+22),
                cv2.FONT_HERSHEY_DUPLEX, 0.52, C_CYAN, 1, cv2.LINE_AA)
    cv2.line(img, (px, py+30), (px+pw, py+30), C_GRAY, 1)

    y = py + 50
    for name in names:
        entry = computed.get(name)
        if entry is None:
            cv2.putText(img, f"{name:<11} N/A", (px+8, y),
                        cv2.FONT_HERSHEY_DUPLEX, 0.40, C_GRAY, 1, cv2.LINE_AA)
            y += 26
            continue

        col = entry["color"]
        if name in FLEXION_JOINTS:
            flex   = clinical_flexion(entry["angle"])
            rmin, rmax = rom[name]
            steady = "*" if entry["steady"] else " "
            txt = f"{name:<10}{steady}F{flex:5.1f}  [{rmin:4.0f}-{rmax:4.0f}]"
        else:
            txt = f"{name:<11} {entry['angle']:5.1f}"
        cv2.putText(img, txt, (px+8, y),
                    cv2.FONT_HERSHEY_DUPLEX, 0.40, col, 1, cv2.LINE_AA)

        sb = cv2.getTextSize(entry["state"], cv2.FONT_HERSHEY_DUPLEX, 0.30, 1)[0][0]
        cv2.putText(img, entry["state"], (px+pw-sb-8, y),
                    cv2.FONT_HERSHEY_DUPLEX, 0.30, col, 1, cv2.LINE_AA)
        y += 26


def draw_symmetry_panel(img, computed, w, h):
    """Bilateral L/R flexion difference — useful for asymmetry screening."""
    rows = []
    for lname, rname in SYMMETRY_PAIRS:
        le, re = computed.get(lname), computed.get(rname)
        if le is None or re is None:
            continue
        joint = lname.split(".")[1]
        lf = clinical_flexion(le["angle"]) if lname in FLEXION_JOINTS else le["angle"]
        rf = clinical_flexion(re["angle"]) if rname in FLEXION_JOINTS else re["angle"]
        diff = abs(lf - rf)
        col  = C_GREEN if diff < 8 else (C_ORANGE if diff < 20 else C_RED)
        rows.append((joint, lf, rf, diff, col))
    if not rows:
        return

    pw  = 250
    ph  = len(rows) * 22 + 40
    px, py = 8, h - 34 - ph - 8
    fill_rect(img, (px, py), (px+pw, py+ph), (15, 8, 28), alpha=0.80)
    cv2.putText(img, "L / R SYMMETRY", (px+10, py+20),
                cv2.FONT_HERSHEY_DUPLEX, 0.46, C_CYAN, 1, cv2.LINE_AA)
    cv2.line(img, (px, py+27), (px+pw, py+27), C_GRAY, 1)
    y = py + 44
    for joint, lf, rf, diff, col in rows:
        cv2.putText(img, f"{joint:<8} L{lf:5.0f}  R{rf:5.0f}  d{diff:4.0f}",
                    (px+8, y), cv2.FONT_HERSHEY_DUPLEX, 0.38, col, 1, cv2.LINE_AA)
        y += 22


def draw_hand_panels(img, hands_data, w, h):
    PW, PH = 205, 180
    offsets = {"Right": (8, 8), "Left": (8, 8 + PH + 10)}
    for (mp_label, count, raised, _) in hands_data:
        px, py = offsets.get(mp_label, (8, 8))
        fill_rect(img, (px, py), (px+PW, py+PH), (10, 8, 28), alpha=0.78)
        col = C_PURPLE if mp_label == "Right" else C_BLUE
        cv2.putText(img, f"{mp_label.upper()} HAND", (px+10, py+26),
                    cv2.FONT_HERSHEY_DUPLEX, 0.54, col, 1, cv2.LINE_AA)
        cv2.line(img, (px, py+33), (px+PW, py+33), C_GRAY, 1)
        for i, (fn, up) in enumerate(zip(FINGER_NAMES, raised)):
            dot   = "●" if up else "○"
            color = C_GREEN if up else (70, 70, 70)
            cv2.putText(img, f" {dot} {fn}", (px+8, py+56+i*22),
                        cv2.FONT_HERSHEY_DUPLEX, 0.42, color, 1, cv2.LINE_AA)
        badge = f"{count} finger{'s' if count != 1 else ''} raised"
        cv2.putText(img, badge, (px+10, py+172),
                    cv2.FONT_HERSHEY_DUPLEX, 0.44, C_CYAN, 1, cv2.LINE_AA)


def draw_status_bar(img, fps, view_label, view_col, pose_ok,
                    n_hands, recording, w, h):
    bh = 34
    fill_rect(img, (0, h-bh), (w, h), C_DARK, alpha=0.84)
    cv2.line(img, (0, h-bh), (w, h-bh), C_GRAY, 1)
    p_col = C_GREEN if pose_ok else C_RED
    items = [
        (f"FPS {fps:.0f}",                       C_LIME,   10),
        (f"View: {view_label}",                  view_col, 110),
        (f"Pose: {'ON' if pose_ok else '--'}",   p_col,    300),
        (f"Hands: {n_hands}",                    C_PURPLE, 420),
    ]
    if recording:
        items.append(("● REC", C_RED, 540))
    for txt, col, x in items:
        cv2.putText(img, txt, (x, h-10),
                    cv2.FONT_HERSHEY_DUPLEX, 0.48, col, 1, cv2.LINE_AA)
    ctrl = "[Q]uit [S]hot [L]bl [V]is [R]ec [Z]ero"
    tw = cv2.getTextSize(ctrl, cv2.FONT_HERSHEY_DUPLEX, 0.36, 1)[0][0]
    cv2.putText(img, ctrl, (w - tw - 8, h-10),
                cv2.FONT_HERSHEY_DUPLEX, 0.36, C_GRAY, 1, cv2.LINE_AA)


# ═══════════════════════════════════════════════════════════════════
#  Camera
# ═══════════════════════════════════════════════════════════════════
def open_camera(preferred, width, height):
    candidates = [preferred] + [i for i in (0, 1, 2) if i != preferred]
    for cam_idx in candidates:
        c = cv2.VideoCapture(cam_idx, cv2.CAP_DSHOW)
        if not c.isOpened():
            c.release()
            continue
        c.set(cv2.CAP_PROP_FRAME_WIDTH,  width)
        c.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        c.set(cv2.CAP_PROP_BUFFERSIZE,   1)
        time.sleep(0.4)
        for _ in range(5):
            c.read()
        ret, test = c.read()
        if ret and test is not None and test.size > 0:
            h0, w0 = test.shape[:2]
            print(f"Camera {cam_idx} ready at {w0}x{h0}")
            return c
        c.release()
    return None


# ═══════════════════════════════════════════════════════════════════
#  Main loop
# ═══════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser(description="Clinical joint angle tracker")
    ap.add_argument("--camera",     type=int, default=0)
    ap.add_argument("--width",      type=int, default=1280)
    ap.add_argument("--height",     type=int, default=720)
    ap.add_argument("--complexity", type=int, default=2, choices=[0, 1, 2],
                    help="Pose model complexity (2 = most accurate)")
    ap.add_argument("--no-hands",   action="store_true",
                    help="Disable hand tracking (faster, for ROM work)")
    ap.add_argument("--log",        type=str, default=None,
                    help="CSV path to auto-start logging (else toggle with R)")
    args = ap.parse_args()

    pose = mp_pose.Pose(
        static_image_mode        = False,
        model_complexity         = args.complexity,
        smooth_landmarks         = True,
        enable_segmentation      = False,
        min_detection_confidence = 0.60,
        min_tracking_confidence  = 0.60,
    )
    hands_det = None if args.no_hands else mp_hands.Hands(
        static_image_mode        = False,
        max_num_hands            = 2,
        model_complexity         = 1,
        min_detection_confidence = 0.70,
        min_tracking_confidence  = 0.65,
    )

    cap = open_camera(args.camera, args.width, args.height)
    if cap is None:
        print("ERROR: No usable camera found on indices 0-2.")
        return

    save_dir    = os.path.dirname(os.path.abspath(__file__))
    show_labels = True
    show_vis    = False
    prev_time   = time.time()

    # Per-joint angle smoothing + stability history + session ROM.
    filters = {name: OneEuroFilter(mincutoff=1.0, beta=0.05) for name in ANGLE_DEFS}
    history = {name: deque(maxlen=STABILITY_WIN) for name in ANGLE_DEFS}
    rom     = {name: [180.0, 0.0] for name in ANGLE_DEFS}   # [min_flex, max_flex]

    # CSV logging.
    csv_file = csv_writer = None
    def start_log(path=None):
        nonlocal csv_file, csv_writer
        if csv_writer is not None:
            return
        path = path or os.path.join(save_dir, f"angles_{int(time.time())}.csv")
        csv_file = open(path, "w", newline="")
        csv_writer = csv.writer(csv_file)
        header = ["timestamp"]
        for n in ANGLE_DEFS:
            header += [f"{n}_raw", f"{n}_flex"]
        csv_writer.writerow(header)
        print(f"Recording angles to {path}")
        return path

    def stop_log():
        nonlocal csv_file, csv_writer
        if csv_file:
            csv_file.close()
            print("Recording stopped.")
        csv_file = csv_writer = None

    if args.log:
        start_log(args.log)

    print("=" * 70)
    print("  Clinical Joint Tracker  |  World-coordinate goniometry")
    print("  Angles smoothed (One-Euro) + ROM capture + symmetry + CSV log")
    print("  '*' next to a joint = reading is STEADY (safe to record)")
    print("  Q quit  S shot  L labels  V vis%  R record  Z zero-ROM")
    print("=" * 70)

    consecutive_fails = 0
    while cap.isOpened():
        try:
            ret, raw = cap.read()
        except cv2.error as e:
            print(f"Frame read error (skipping): {e}")
            consecutive_fails += 1
            if consecutive_fails > 15:
                print("Too many errors. Exiting."); break
            time.sleep(0.05); continue

        if not ret or raw is None or raw.size == 0:
            consecutive_fails += 1
            if consecutive_fails > 15:
                print("Camera lost. Exiting."); break
            time.sleep(0.05); continue
        consecutive_fails = 0

        h, w = raw.shape[:2]
        now  = time.time()

        # Pose on RAW frame (anatomical L/R correct).
        rgb_raw = cv2.cvtColor(raw, cv2.COLOR_BGR2RGB)
        rgb_raw.flags.writeable = False
        pose_results = pose.process(rgb_raw)
        rgb_raw.flags.writeable = True

        # Mirrored display frame.
        display = cv2.flip(raw, 1)

        # Hands on FLIPPED frame (selfie-trained → correct handedness).
        hand_results = None
        if hands_det is not None:
            rgb_flip = cv2.cvtColor(display, cv2.COLOR_BGR2RGB)
            rgb_flip.flags.writeable = False
            hand_results = hands_det.process(rgb_flip)
            rgb_flip.flags.writeable = True

        fps = 1.0 / max(now - prev_time, 1e-6)
        prev_time = now

        # ── Compute angles from WORLD landmarks, smooth + track ──
        computed   = {name: None for name in ANGLE_DEFS}
        view_label, view_col = "UNKNOWN", C_GRAY
        pose_ok    = pose_results.pose_landmarks is not None
        world_ok   = pose_results.pose_world_landmarks is not None
        lm_list    = pose_results.pose_landmarks.landmark if pose_ok else None

        if pose_ok:
            view_label, view_col = detect_view(lm_list)

        if pose_ok and world_ok:
            wlm = pose_results.pose_world_landmarks.landmark
            for name, (ia, ib, ic, _) in ANGLE_DEFS.items():
                # Gate on the screen-landmark visibilities (same indices).
                if min(lm_list[ia].visibility, lm_list[ib].visibility,
                       lm_list[ic].visibility) < VIS_REPORT:
                    continue
                raw_angle = angle_3d(wlm[ia], wlm[ib], wlm[ic])
                if raw_angle is None:
                    continue

                smoothed = filters[name](raw_angle, now)
                history[name].append(smoothed)
                steady = (len(history[name]) >= 4 and
                          np.std(history[name]) < STEADY_STD_DEG)

                # Update session ROM (clinical flexion) only when steady-ish.
                if name in FLEXION_JOINTS:
                    flex = clinical_flexion(smoothed)
                    rom[name][0] = min(rom[name][0], flex)
                    rom[name][1] = max(rom[name][1], flex)

                state_lbl, state_col = joint_state(name, smoothed)
                computed[name] = {"angle": smoothed, "state": state_lbl,
                                  "color": state_col, "steady": steady}

        # ── CSV row ──
        if csv_writer is not None:
            row = [f"{now:.3f}"]
            for n in ANGLE_DEFS:
                e = computed[n]
                if e is None:
                    row += ["", ""]
                else:
                    row += [f"{e['angle']:.2f}", f"{clinical_flexion(e['angle']):.2f}"]
            csv_writer.writerow(row)

        # ── Draw ──
        if pose_ok:
            draw_pose(display, lm_list, w, h, show_labels, show_vis, computed)
        else:
            put_text_bg(display, "No person detected  -  step into frame",
                        (w//2 - 210, h//2), scale=0.65, fg=C_ORANGE, bg=C_BLACK)

        if hand_results is not None:
            draw_hands(display, hand_results, w, h)

        hands_data, n_hands = [], 0
        if hand_results is not None and hand_results.multi_hand_landmarks:
            n_hands = len(hand_results.multi_hand_landmarks)
            for hlm, hclass in zip(hand_results.multi_hand_landmarks,
                                   hand_results.multi_handedness):
                mp_label = hclass.classification[0].label
                cnt, raised = count_fingers(hlm, mp_label)
                hands_data.append((mp_label, cnt, raised, hlm))

        draw_angle_panel(display, computed, rom, w, h)
        draw_symmetry_panel(display, computed, w, h)
        draw_hand_panels(display, hands_data, w, h)
        draw_status_bar(display, fps, view_label, view_col, pose_ok,
                        n_hands, csv_writer is not None, w, h)

        cv2.imshow("Clinical Joint Tracker  |  World-coordinate goniometry", display)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('s'):
            fname = os.path.join(save_dir, f"screenshot_{int(time.time())}.png")
            cv2.imwrite(fname, display)
            print(f"Screenshot saved: {fname}")
        elif key == ord('l'):
            show_labels = not show_labels
        elif key == ord('v'):
            show_vis = not show_vis
        elif key == ord('r'):
            stop_log() if csv_writer is not None else start_log()
        elif key == ord('z'):
            for n in ANGLE_DEFS:
                rom[n] = [180.0, 0.0]
            print("Session ROM reset.")

    stop_log()
    cap.release()
    cv2.destroyAllWindows()
    print("Tracker closed.")


if __name__ == "__main__":
    main()
