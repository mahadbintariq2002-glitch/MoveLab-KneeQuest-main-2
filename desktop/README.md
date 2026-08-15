# MoveLab — Desktop Tracker (Python)

The original laptop/webcam version of MoveLab. Same goniometry idea as the
mobile web app, in Python + OpenCV + MediaPipe.

## Files
- **`knee_phase2_angle.py`** — main clinical tracker. World-coordinate joint
  angles, One-Euro smoothing, steady-reading flag, session ROM capture,
  Left/Right symmetry, and CSV logging. **Use this one.**
- `joint_tracker.py`, `knee_phase1.py` — earlier prototypes kept for reference.

## Install & run
```bash
pip install -r requirements.txt
python knee_phase2_angle.py                       # default camera
python knee_phase2_angle.py --no-hands --log s.csv  # ROM session, log to CSV
```

## Controls
`Q` quit · `S` screenshot · `L` labels · `V` visibility% · `R` record CSV · `Z` zero ROM

## Options
`--camera N` · `--width` / `--height` · `--complexity 0|1|2` · `--no-hands` · `--log path.csv`

> The mobile web app (in the repo root) is the recommended way to run on a
> phone — better camera and runs on the phone GPU.
