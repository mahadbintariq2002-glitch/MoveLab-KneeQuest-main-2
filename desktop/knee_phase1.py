import cv2
import mediapipe as mp

# STEP 1: Initialize MediaPipe Pose
mp_pose = mp.solutions.pose
pose = mp_pose.Pose()
mp_draw = mp.solutions.drawing_utils

# STEP 2: Start webcam
cap = cv2.VideoCapture(0)

while cap.isOpened():
    success, frame = cap.read()

    if not success:
        break

    # STEP 3: Convert BGR → RGB (MediaPipe requirement)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    # STEP 4: Process image for pose detection
    results = pose.process(rgb)

    # STEP 5: If landmarks detected, draw them
    if results.pose_landmarks:
        mp_draw.draw_landmarks(
            frame,
            results.pose_landmarks,
            mp_pose.POSE_CONNECTIONS
        )

    # STEP 6: Show output
    cv2.imshow("Pose Detection", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()