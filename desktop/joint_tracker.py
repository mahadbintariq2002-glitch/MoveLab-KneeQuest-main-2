"""
Joint Tracker — Complete (Detection + Angle Measurement, All Views)
====================================================================
Fixes applied
  • RIGHT hand now correctly labelled RIGHT:
      Hands are processed on the FLIPPED (selfie) frame because MediaPipe
      Hands was trained on selfie images. On a mirrored frame, "Right"
      output = your physical right hand. ✓
  • Pose L/R always anatomically correct:
      Pose is still processed on the RAW frame. Landmarks are then mirrored
      only for drawing on the display frame.
  • Precise 3D angle measurement using (x, y, z):
      Works in frontal, side, and angled views.
  • Live angle arc drawn at every joint vertex.
  • Clinical state labels (EXTENSION / SLIGHT / MODERATE / DEEP FLEX).
  • Automatic camera-view detection (FRONTAL / SIDE / ANGLED).

Controls: Q = quit   S = screenshot   L = joint labels   V = visibility %
"""

import cv2
import mediapipe as mp
import numpy as np
import time
import os

# ═══════════════════════════════════════════════════════════════════
#  MediaPipe initialisation
# ═══════════════════════════════════════════════════════════════════
mp_pose  = mp.solutions.pose
mp_hands = mp.solutions.hands
mp_draw  = mp.solutions.drawing_utils

pose = mp_pose.Pose(
    static_image_mode        = False,
    model_complexity         = 2,        # most accurate model
    smooth_landmarks         = True,
    enable_segmentation      = False,
    min_detection_confidence = 0.60,
    min_tracking_confidence  = 0.60,
)

hands_det = mp_hands.Hands(
    static_image_mode        = False,
    max_num_hands            = 2,
    model_complexity         = 1,
    min_detection_confidence = 0.70,
    min_tracking_confidence  = 0.65,
)

LM = mp_pose.PoseLandmark

# ═══════════════════════════════════════════════════════════════════
#  Joint label table  (all 21 visible landmark types we care about)
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
#  Angle definitions
#  Each entry: (landmark_A, landmark_VERTEX, landmark_C, arc_color_BGR)
#  The angle is measured AT the VERTEX between segments V→A and V→C.
# ═══════════════════════════════════════════════════════════════════
ANGLE_DEFS = {
    # Lower body
    "L.Knee":     (LM.LEFT_HIP,       LM.LEFT_KNEE,       LM.LEFT_ANKLE,       ( 57, 255,  20)),
    "R.Knee":     (LM.RIGHT_HIP,      LM.RIGHT_KNEE,      LM.RIGHT_ANKLE,      (  0, 255, 128)),
    "L.Hip":      (LM.LEFT_SHOULDER,  LM.LEFT_HIP,        LM.LEFT_KNEE,        (  0, 165, 255)),
    "R.Hip":      (LM.RIGHT_SHOULDER, LM.RIGHT_HIP,       LM.RIGHT_KNEE,       (  0, 165, 255)),
    "L.Ankle":    (LM.LEFT_KNEE,      LM.LEFT_ANKLE,      LM.LEFT_FOOT_INDEX,  (255, 220,   0)),
    "R.Ankle":    (LM.RIGHT_KNEE,     LM.RIGHT_ANKLE,     LM.RIGHT_FOOT_INDEX, (255, 220,   0)),
    # Upper body
    "L.Elbow":    (LM.LEFT_SHOULDER,  LM.LEFT_ELBOW,      LM.LEFT_WRIST,       (200,  50, 220)),
    "R.Elbow":    (LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW,     LM.RIGHT_WRIST,      (200,  50, 220)),
    "L.Shoulder": (LM.LEFT_ELBOW,     LM.LEFT_SHOULDER,   LM.LEFT_HIP,         (255, 120,  50)),
    "R.Shoulder": (LM.RIGHT_ELBOW,    LM.RIGHT_SHOULDER,  LM.RIGHT_HIP,        (255, 120,  50)),
}

# Joints where "180° = full extension" → clinical flexion = 180 − raw
FLEXION_JOINTS = {"L.Knee", "R.Knee", "L.Hip", "R.Hip", "L.Elbow", "R.Elbow"}

# Confidence thresholds
VIS_HIGH = 0.80   # reliable  → green dot
VIS_MED  = 0.50   # moderate  → orange dot  (minimum to show label & angle)
VIS_LOW  = 0.30   # low       → red dot     (still drawn, no label)

# ═══════════════════════════════════════════════════════════════════
#  Finger detection constants
# ═══════════════════════════════════════════════════════════════════
FINGER_TIPS  = [4, 8, 12, 16, 20]   # Thumb, Index, Middle, Ring, Pinky tips
FINGER_PIP   = [3, 6, 10, 14, 18]   # PIP joints (used for curl detection)
FINGER_MCP   = [2, 5,  9, 13, 17]   # MCP joints
FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky"]

# ═══════════════════════════════════════════════════════════════════
#  Colour palette  (BGR)
# ═══════════════════════════════════════════════════════════════════
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
#  3-D angle mathematics
# ═══════════════════════════════════════════════════════════════════
def angle_3d(a, b, c):
    """
    Geometric angle (degrees) at vertex B between segments B→A and B→C.
    Uses MediaPipe's x, y, z coordinates so it works in every view:
      • frontal view  → x, y carry most information
      • side view     → y, z carry most information
      • angled view   → all three axes contribute
    Returns float in [0, 180] or None if degenerate.
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
    """180° = full extension (0° clinical flex). Decreasing raw → increasing flex."""
    return max(0.0, 180.0 - raw_angle)


def joint_state(name, raw_angle):
    """
    Returns (state_label, color) based on the joint name and raw geometric angle.
    For flexion joints: colour reflects how much the joint is bent.
    """
    if name not in FLEXION_JOINTS:
        # Non-flexion joints: just show the angle value
        return f"{raw_angle:.0f}\u00b0", C_CYAN

    flex = clinical_flexion(raw_angle)
    if   flex < 10:  return "FULL EXTENSION",  C_GREEN
    elif flex < 35:  return "SLIGHT FLEX",      C_LIME
    elif flex < 75:  return "MODERATE FLEX",    C_CYAN
    elif flex < 115: return "DEEP FLEX",        C_ORANGE
    else:            return "MAX FLEX",         C_RED


def detect_view(lm_list):
    """
    Infer camera view angle from shoulder separation.
    FRONTAL: both shoulders clearly separated horizontally.
    SIDE:    shoulders nearly stacked (one behind the other).
    ANGLED:  in between.
    """
    ls = lm_list[LM.LEFT_SHOULDER]
    rs = lm_list[LM.RIGHT_SHOULDER]
    if ls.visibility < 0.40 or rs.visibility < 0.40:
        return "UNKNOWN", C_GRAY

    shoulder_dx = abs(rs.x - ls.x)

    lh = lm_list[LM.LEFT_HIP]
    rh = lm_list[LM.RIGHT_HIP]
    hip_dx = (abs(rh.x - lh.x)
              if lh.visibility > 0.30 and rh.visibility > 0.30
              else 0.18)

    ratio = shoulder_dx / max(hip_dx, 0.04)

    if   ratio < 0.25: return "SIDE VIEW",  C_ORANGE
    elif ratio > 0.80: return "FRONTAL",    C_GREEN
    else:              return "ANGLED",     C_CYAN


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
    """Semi-transparent filled rounded rectangle."""
    x1, y1 = p1;  x2, y2 = p2
    ov = img.copy()
    cv2.rectangle(ov, (x1+r, y1), (x2-r, y2), color, -1)
    cv2.rectangle(ov, (x1, y1+r), (x2, y2-r), color, -1)
    for cx, cy in [(x1+r,y1+r),(x2-r,y1+r),(x1+r,y2-r),(x2-r,y2-r)]:
        cv2.circle(ov, (cx, cy), r, color, -1)
    cv2.addWeighted(ov, alpha, img, 1-alpha, 0, img)


def mirror_lm(lm, w, h):
    """Pose landmark → pixel on the mirrored display frame."""
    return (w - 1 - int(lm.x * w), int(lm.y * h))


def draw_angle_arc(img, v, a, c, angle_deg, color, radius=40):
    """
    Draw the interior angle arc at vertex v between directions v→a and v→c.
    The arc always spans the interior angle (≤ 180°).
    Places the degree text at the arc midpoint.
    """
    vx, vy = int(v[0]), int(v[1])

    # Pixel distance guard – don't draw if points are too close
    if (abs(a[0]-vx) + abs(a[1]-vy) < 5 or
            abs(c[0]-vx) + abs(c[1]-vy) < 5):
        return

    ang1 = np.degrees(np.arctan2(a[1] - vy, a[0] - vx))
    ang2 = np.degrees(np.arctan2(c[1] - vy, c[0] - vx))

    # Normalise to get the shorter arc (interior angle ≤ 180°)
    span = (ang2 - ang1) % 360.0
    if span > 180.0:
        span -= 360.0   # negative span → go counter-clockwise

    start = int(ang1)
    end   = int(ang1 + span)
    if start > end:
        start, end = end, start

    cv2.ellipse(img, (vx, vy), (radius, radius), 0,
                start, end, color, 2, cv2.LINE_AA)

    # Bright vertex dot
    cv2.circle(img, (vx, vy), 5, color, -1, cv2.LINE_AA)
    cv2.circle(img, (vx, vy), 6, C_DARK, 1, cv2.LINE_AA)

    # Degree text at arc midpoint
    mid_rad = np.radians((start + end) / 2.0)
    tx = int(vx + (radius + 24) * np.cos(mid_rad))
    ty = int(vy + (radius + 24) * np.sin(mid_rad))
    tx = max(5, min(img.shape[1] - 60, tx))
    ty = max(15, min(img.shape[0] - 10, ty))
    put_text_bg(img, f"{angle_deg:.0f}\u00b0", (tx, ty),
                scale=0.50, thick=1, fg=color, bg=C_DARK)


# ═══════════════════════════════════════════════════════════════════
#  Skeleton drawing (pose)
# ═══════════════════════════════════════════════════════════════════
def draw_pose(img, lm_list, w, h, show_labels, show_vis, computed):
    """
    Draw pose skeleton with angle arcs on the mirrored display frame.
    Landmark x-coordinates are mirrored so LEFT/RIGHT labels are correct.
    """
    # — Connections —
    for (s_i, e_i) in mp_pose.POSE_CONNECTIONS:
        sl = lm_list[s_i];  el = lm_list[e_i]
        if sl.visibility < VIS_LOW or el.visibility < VIS_LOW:
            continue
        s_px = mirror_lm(sl, w, h)
        e_px = mirror_lm(el, w, h)
        vis  = min(sl.visibility, el.visibility)
        col  = tuple(int(c * min(vis * 1.3, 1.0)) for c in C_CYAN)
        cv2.line(img, s_px, e_px, col, 2, cv2.LINE_AA)

    # — Angle arcs —
    for name, (ia, ib, ic, arc_col) in ANGLE_DEFS.items():
        entry = computed.get(name)
        if entry is None:
            continue
        raw_angle, _, _ = entry
        la = lm_list[ia];  lb = lm_list[ib];  lc = lm_list[ic]
        if min(la.visibility, lb.visibility, lc.visibility) < VIS_MED:
            continue
        a_px = mirror_lm(la, w, h)
        b_px = mirror_lm(lb, w, h)
        c_px = mirror_lm(lc, w, h)
        draw_angle_arc(img, b_px, a_px, c_px, raw_angle, arc_col, radius=38)

    # — Joint dots + labels —
    for (lm_enum, label) in ALL_JOINTS:
        lmk = lm_list[lm_enum]
        if lmk.visibility < VIS_LOW:
            continue
        px, py = mirror_lm(lmk, w, h)
        col = (C_GREEN  if lmk.visibility >= VIS_HIGH else
               C_ORANGE if lmk.visibility >= VIS_MED  else C_RED)
        r = 5 if lmk.visibility >= VIS_MED else 3
        cv2.circle(img, (px, py), r,   col,    -1, cv2.LINE_AA)
        cv2.circle(img, (px, py), r+1, C_DARK,  1, cv2.LINE_AA)
        if show_labels and lmk.visibility >= VIS_MED:
            txt = label + (f" {lmk.visibility*100:.0f}%" if show_vis else "")
            put_text_bg(img, txt, (px+7, py-5), scale=0.36, fg=col, bg=C_DARK)


# ═══════════════════════════════════════════════════════════════════
#  Hand skeleton drawing  (coords already in display/mirrored space)
# ═══════════════════════════════════════════════════════════════════
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


# ═══════════════════════════════════════════════════════════════════
#  Finger counting
#  Hands are processed on the FLIPPED frame, so:
#    MediaPipe "Right" label  = your physical right hand ✓
#    MediaPipe "Left"  label  = your physical left hand  ✓
#  Landmark x-coords are in mirrored/display space:
#    Right hand thumb extends towards LOWER x when raised.
#    Left  hand thumb extends towards HIGHER x when raised.
# ═══════════════════════════════════════════════════════════════════
def count_fingers(hlm, mp_label):
    lm = hlm.landmark
    raised = []

    # Thumb  (compare tip x vs MCP x in display space)
    tip_x = lm[FINGER_TIPS[0]].x
    mcp_x = lm[FINGER_MCP[0]].x
    if mp_label == "Right":
        raised.append(tip_x < mcp_x)   # right thumb extends left on display
    else:
        raised.append(tip_x > mcp_x)   # left  thumb extends right on display

    # Index / Middle / Ring / Pinky  (tip above PIP = raised)
    for tip_i, pip_i in zip(FINGER_TIPS[1:], FINGER_PIP[1:]):
        raised.append(lm[tip_i].y < lm[pip_i].y)

    return sum(raised), raised


# ═══════════════════════════════════════════════════════════════════
#  UI panels
# ═══════════════════════════════════════════════════════════════════
def draw_angle_panel(img, computed, w, h):
    """Right-side panel: all joint angles + state labels."""
    n   = len(computed)
    pw  = 300
    ph  = n * 28 + 52
    px  = w - pw - 8
    py  = 8

    fill_rect(img, (px, py), (px+pw, py+ph), (15, 8, 28), alpha=0.80)
    cv2.putText(img, "JOINT ANGLES",
                (px+10, py+24), cv2.FONT_HERSHEY_DUPLEX, 0.54, C_CYAN, 1, cv2.LINE_AA)
    cv2.line(img, (px, py+32), (px+pw, py+32), C_GRAY, 1)

    y = py + 54
    for name, entry in computed.items():
        if entry is None:
            cv2.putText(img, f"{name:<13}  N/A",
                        (px+8, y), cv2.FONT_HERSHEY_DUPLEX, 0.40, C_GRAY, 1, cv2.LINE_AA)
        else:
            raw, state_lbl, state_col = entry
            # Show both raw angle AND flexion for flexion joints
            if name in FLEXION_JOINTS:
                flex = clinical_flexion(raw)
                cv2.putText(img, f"{name:<13} {raw:>5.1f}° | Flex {flex:.0f}°",
                            (px+8, y), cv2.FONT_HERSHEY_DUPLEX, 0.38, state_col, 1, cv2.LINE_AA)
            else:
                cv2.putText(img, f"{name:<13} {raw:>5.1f}°",
                            (px+8, y), cv2.FONT_HERSHEY_DUPLEX, 0.40, state_col, 1, cv2.LINE_AA)
            # State badge on right side
            bw = cv2.getTextSize(state_lbl, cv2.FONT_HERSHEY_DUPLEX, 0.30, 1)[0][0]
            cv2.putText(img, state_lbl,
                        (px+pw-bw-8, y), cv2.FONT_HERSHEY_DUPLEX, 0.30, state_col, 1, cv2.LINE_AA)
        y += 28


def draw_hand_panels(img, hands_data, w, h, angle_panel_bottom):
    """
    Hand panels: both placed on the LEFT side of the display to avoid
    overlap with the angle panel on the right.
    Right hand panel → top-left
    Left  hand panel → below right hand panel
    """
    PW, PH = 205, 180
    offsets = {"Right": (8, 8), "Left": (8, 8 + PH + 10)}

    for (mp_label, count, raised, _) in hands_data:
        px, py = offsets.get(mp_label, (8, 8))
        fill_rect(img, (px, py), (px+PW, py+PH), (10, 8, 28), alpha=0.78)

        col = C_PURPLE if mp_label == "Right" else C_BLUE
        cv2.putText(img, f"{mp_label.upper()} HAND",
                    (px+10, py+26), cv2.FONT_HERSHEY_DUPLEX, 0.54, col, 1, cv2.LINE_AA)
        cv2.line(img, (px, py+33), (px+PW, py+33), C_GRAY, 1)

        for i, (fn, up) in enumerate(zip(FINGER_NAMES, raised)):
            dot   = "\u25cf" if up else "\u25cb"
            color = C_GREEN if up else (70, 70, 70)
            cv2.putText(img, f" {dot} {fn}",
                        (px+8, py+56+i*22),
                        cv2.FONT_HERSHEY_DUPLEX, 0.42, color, 1, cv2.LINE_AA)

        badge = f"{count} finger{'s' if count != 1 else ''} raised"
        cv2.putText(img, badge, (px+10, py+172),
                    cv2.FONT_HERSHEY_DUPLEX, 0.44, C_CYAN, 1, cv2.LINE_AA)


def draw_legend(img, w, h):
    """Confidence legend at bottom-right, above status bar."""
    x0 = w - 220;  y0 = h - 140
    fill_rect(img, (x0, y0), (w-8, y0+78), C_DARK, alpha=0.72)
    cv2.putText(img, "Landmark confidence",
                (x0+8, y0+18), cv2.FONT_HERSHEY_DUPLEX, 0.36, C_GRAY, 1, cv2.LINE_AA)
    for i, (col, txt) in enumerate([
            (C_GREEN,  "> 80%  reliable"),
            (C_ORANGE, "50-80%  moderate"),
            (C_RED,    "< 50%  unreliable")]):
        y = y0 + 36 + i * 18
        cv2.circle(img, (x0+14, y-5), 5, col, -1, cv2.LINE_AA)
        cv2.putText(img, txt, (x0+26, y),
                    cv2.FONT_HERSHEY_DUPLEX, 0.34, col, 1, cv2.LINE_AA)


def draw_status_bar(img, fps, view_label, view_col, pose_ok, n_hands, w, h):
    """Bottom status bar."""
    bh = 34
    fill_rect(img, (0, h-bh), (w, h), C_DARK, alpha=0.84)
    cv2.line(img, (0, h-bh), (w, h-bh), C_GRAY, 1)

    p_col = C_GREEN if pose_ok else C_RED
    items = [
        (f"FPS {fps:.0f}",                C_LIME,   10),
        (f"View: {view_label}",           view_col, 110),
        (f"Pose: {'ON' if pose_ok else '--'}", p_col, 300),
        (f"Hands: {n_hands}",             C_PURPLE, 430),
    ]
    for txt, col, x in items:
        cv2.putText(img, txt, (x, h-10),
                    cv2.FONT_HERSHEY_DUPLEX, 0.48, col, 1, cv2.LINE_AA)

    ctrl = "[Q]Quit  [S]Screenshot  [L]Labels  [V]Vis%"
    tw = cv2.getTextSize(ctrl, cv2.FONT_HERSHEY_DUPLEX, 0.36, 1)[0][0]
    cv2.putText(img, ctrl, (w - tw - 8, h-10),
                cv2.FONT_HERSHEY_DUPLEX, 0.36, C_GRAY, 1, cv2.LINE_AA)


# ═══════════════════════════════════════════════════════════════════
#  Main loop
# ═══════════════════════════════════════════════════════════════════
def main():
    # ── Camera open: try indices 0, 1, 2 ──────────────────────────────
    cap = None
    for cam_idx in [0, 1, 2]:
        _c = cv2.VideoCapture(cam_idx, cv2.CAP_DSHOW)   # DirectShow – more stable on Windows
        if not _c.isOpened():
            _c.release()
            continue

        # Set resolution FIRST before any read – avoids Mat stride mismatch
        _c.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
        _c.set(cv2.CAP_PROP_FRAME_HEIGHT,  720)
        _c.set(cv2.CAP_PROP_BUFFERSIZE,      1)

        # Brief warm-up so driver can apply the resolution
        time.sleep(0.4)

        # Drain 5 stale frames at the new resolution
        for _ in range(5):
            _c.read()

        # Confirm a valid frame comes through
        ret, test = _c.read()
        if ret and test is not None and test.size > 0:
            cap = _c
            h0, w0 = test.shape[:2]
            print(f"Camera {cam_idx} ready at {w0}x{h0}")
            break

        _c.release()

    if cap is None:
        print("ERROR: No usable camera found on indices 0-2.")
        return

    show_labels = True
    show_vis    = False
    prev_time   = time.time()
    save_dir    = os.path.dirname(os.path.abspath(__file__))

    print("=" * 68)
    print("  Joint Tracker  |  Precise Detection + Angle Measurement")
    print("  All views: FRONTAL / SIDE / ANGLED")
    print("  L / R labels = YOUR anatomical left and right  [OK]")
    print("  Q=quit   S=screenshot   L=labels   V=visibility%")
    print("=" * 68)

    consecutive_fails = 0
    while cap.isOpened():
        try:
            ret, raw = cap.read()
        except cv2.error as e:
            print(f"Frame read error (skipping): {e}")
            consecutive_fails += 1
            if consecutive_fails > 15:
                print("Too many errors. Exiting.")
                break
            time.sleep(0.05)
            continue

        if not ret or raw is None or raw.size == 0:
            consecutive_fails += 1
            if consecutive_fails > 15:
                print("Camera lost. Exiting.")
                break
            time.sleep(0.05)
            continue
        consecutive_fails = 0

        h, w = raw.shape[:2]

        # ── Step 1: Run POSE on the RAW (unflipped) frame ─────────
        #    MediaPipe Pose is NOT selfie-biased; it uses body anatomy
        #    to determine LEFT/RIGHT correctly on the raw frame.
        rgb_raw = cv2.cvtColor(raw, cv2.COLOR_BGR2RGB)
        rgb_raw.flags.writeable = False
        pose_results = pose.process(rgb_raw)
        rgb_raw.flags.writeable = True

        # ── Step 2: Build the mirrored DISPLAY frame ───────────────
        display = cv2.flip(raw, 1)

        # ── Step 3: Run HANDS on the FLIPPED (selfie) frame ───────
        #    MediaPipe Hands was trained on selfie images. On a mirrored
        #    frame: "Right" output = your physical right hand ✓
        rgb_flip = cv2.cvtColor(display, cv2.COLOR_BGR2RGB)
        rgb_flip.flags.writeable = False
        hand_results = hands_det.process(rgb_flip)
        rgb_flip.flags.writeable = True

        # ── FPS ────────────────────────────────────────────────────
        now = time.time()
        fps = 1.0 / max(now - prev_time, 1e-6)
        prev_time = now

        # ── Step 4: Compute all joint angles ───────────────────────
        computed   = {name: None for name in ANGLE_DEFS}
        view_label = "UNKNOWN"
        view_col   = C_GRAY
        pose_ok    = pose_results.pose_landmarks is not None

        if pose_ok:
            lm_list = pose_results.pose_landmarks.landmark
            view_label, view_col = detect_view(lm_list)

            for name, (ia, ib, ic, _) in ANGLE_DEFS.items():
                la = lm_list[ia]
                lb = lm_list[ib]
                lc = lm_list[ic]
                if min(la.visibility, lb.visibility, lc.visibility) < VIS_MED:
                    continue
                raw_angle = angle_3d(la, lb, lc)
                if raw_angle is not None:
                    state_lbl, state_col = joint_state(name, raw_angle)
                    computed[name] = (raw_angle, state_lbl, state_col)

        # ── Step 5: Draw pose skeleton + arcs on DISPLAY ──────────
        if pose_ok:
            draw_pose(display, lm_list, w, h,
                      show_labels, show_vis, computed)
        else:
            put_text_bg(display,
                        "No person detected  –  step into frame",
                        (w//2 - 210, h//2), scale=0.65,
                        fg=C_ORANGE, bg=C_BLACK)

        # ── Step 6: Draw hand skeleton on DISPLAY ─────────────────
        #    Hand landmarks from the FLIPPED frame are already in
        #    display coordinates – no extra mirroring needed.
        draw_hands(display, hand_results, w, h)

        # ── Step 7: Process hand data (count fingers) ──────────────
        hands_data = []
        n_hands    = 0
        if hand_results.multi_hand_landmarks:
            n_hands = len(hand_results.multi_hand_landmarks)
            for hlm, hclass in zip(hand_results.multi_hand_landmarks,
                                   hand_results.multi_handedness):
                mp_label = hclass.classification[0].label   # "Left" or "Right"
                cnt, raised = count_fingers(hlm, mp_label)
                hands_data.append((mp_label, cnt, raised, hlm))

        # ── Step 8: Draw UI panels ─────────────────────────────────
        angle_panel_h = len(computed) * 28 + 52
        draw_angle_panel(display, computed, w, h)
        draw_hand_panels(display, hands_data, w, h, angle_panel_h)
        draw_legend(display, w, h)
        draw_status_bar(display, fps, view_label, view_col,
                        pose_ok, n_hands, w, h)

        cv2.imshow("Joint Tracker  |  Angles + All Views", display)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('s'):
            fname = os.path.join(save_dir, f"screenshot_{int(time.time())}.png")
            cv2.imwrite(fname, display)
            print(f"Screenshot saved: {fname}")
        elif key == ord('l'):
            show_labels = not show_labels
            print(f"Labels: {'ON' if show_labels else 'OFF'}")
        elif key == ord('v'):
            show_vis = not show_vis
            print(f"Visibility %: {'ON' if show_vis else 'OFF'}")

    cap.release()
    cv2.destroyAllWindows()
    print("Tracker closed.")


if __name__ == "__main__":
    main()
