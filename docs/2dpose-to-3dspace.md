# 2D Pose to 3D Space Visualization

This document explains how the YOLO-pose 2D keypoints are visualized in 3D space, the estimation techniques used, and how to tune parameters for better results.

## Overview

YOLO-pose models output **2D keypoints only** - each keypoint has `(x, y, visibility)` where:
- `x, y`: Normalized coordinates (0-1) relative to image dimensions
- `visibility`: 0 (not labeled), 1 (occluded), or 2 (visible)

True 3D pose estimation would require:
- Multi-view cameras (stereo vision)
- A 2D-to-3D lifting model (MotionBERT, VideoPose3D, etc.)
- Or a depth camera (Kinect, RealSense)

This implementation uses **heuristic depth estimation** to create a plausible 3D visualization from single-view 2D poses.

---

## Keypoint Mapping

### COCO 17 Keypoints

The system uses the standard COCO pose format with 17 keypoints:

| ID | Name | Description |
|----|------|-------------|
| 0 | nose | Nose tip |
| 1 | left_eye | Left eye |
| 2 | right_eye | Right eye |
| 3 | left_ear | Left ear |
| 4 | right_ear | Right ear |
| 5 | left_shoulder | Left shoulder |
| 6 | right_shoulder | Right shoulder |
| 7 | left_elbow | Left elbow |
| 8 | right_elbow | Right elbow |
| 9 | left_wrist | Left wrist |
| 10 | right_wrist | Right wrist |
| 11 | left_hip | Left hip |
| 12 | right_hip | Right hip |
| 13 | left_knee | Left knee |
| 14 | right_knee | Right knee |
| 15 | left_ankle | Left ankle |
| 16 | right_ankle | Right ankle |

### Skeleton Connections

```typescript
const KEYPOINT_CONNECTIONS: [number, number][] = [
  [0, 1], [0, 2],     // nose to eyes
  [1, 3], [2, 4],     // eyes to ears
  [0, 5], [0, 6],     // nose to shoulders
  [5, 7], [7, 9],     // left arm
  [6, 8], [8, 10],    // right arm
  [5, 11], [6, 12],   // shoulders to hips
  [11, 13], [13, 15], // left leg
  [12, 14], [14, 16], // right leg
  [5, 6],             // shoulders connection
  [11, 12],           // hips connection
];
```

---

## 2D to 3D Coordinate Transformation

### X-Y Plane Mapping

```typescript
// Convert normalized 2D keypoints to 3D world coordinates
const x = (keypoint.x - 0.5) * 3;  // Range: -1.5 to 1.5
const y = -(keypoint.y - 0.5) * 3; // Flip Y axis (up is positive)
const z = depthMap.get(index) || 0; // Estimated depth
```

**Why 3.0 scale?**
- Provides a comfortable viewing range in Three.js units
- A person at full arm span fits within ~3 units width
- Matches typical perspective camera framing

### Depth (Z-axis) Estimation

When `estimateDepth=true`, the system estimates depth using anatomical heuristics:

```typescript
// 1. Calculate apparent shoulder width in 2D
const shoulderWidth2D = distance(leftShoulder, rightShoulder);

// 2. Compare to expected shoulder width (0.15 normalized)
const depthFactor = expectedShoulderWidth / shoulderWidth2D;

// 3. Estimate depth for each keypoint based on body segment
//    - Shoulders/hips closer = positive Z (toward camera)
//    - Extended limbs = varying Z based on foreshortening
```

**Depth cues used:**
1. **Shoulder width**: Narrower = person turned sideways = depth variation
2. **Hip width**: Same principle as shoulders
3. **Limb foreshortening**: Shorter apparent length = more depth component
4. **Anatomical hierarchy**: Core body parts get priority depth estimation

---

## Visualization Modes

### 1. Stick Model (`stick`)
- Joints: Spheres at keypoint positions
- Bones: Cylinders connecting joints
- Fastest rendering, clearest pose structure

### 2. Mannequin Model (`mannequin`)
- Stick figure + simplified body volumes
- Torso: Capsule
- Head: Sphere at nose position
- Pelvis: Scaled sphere

### 3. Volumetric Model (`volumetric`)
- Mannequin + limb volumes
- Arms/legs: Capsules for realistic appearance
- More GPU intensive but visually clearer

### 4. Mixamo Model (`mixamo`)
- Full 3D character rigged to keypoints
- Requires external `.glb`/`.gltf` model
- Maps COCO keypoints to bone rotations
- See `client/public/models/MIXAMO.md` for setup

---

## Parameter Tuning

### Input Size (Settings Panel)

| Value | Use Case | Trade-off |
|-------|----------|-----------|
| 320 | Fast motion, low-end hardware | Faster, less accurate |
| 480 | Balanced | Good speed/accuracy |
| 640 | Static poses, high accuracy | Slower, more precise |

### IoU Threshold (Settings Panel)

Controls non-maximum suppression for overlapping detections:

```typescript
// Lower = more aggressive NMS (fewer duplicate detections)
// Higher = more lenient (may show duplicate boxes)
// Recommended: 0.40 - 0.50
```

### Confidence Threshold

```typescript
// Filter out low-confidence detections
// Recommended: 0.45 - 0.55 for pose models
// Higher = fewer false positives but may lose partial occlusions
```

### Depth Estimation Toggle

```typescript
// In Settings Panel or via props
estimateDepth: boolean

// false = 2.5D flat mode (keypoints on single plane)
// true = heuristic depth estimation (more realistic but approximate)
```

---

## Common Issues and Solutions

### Issue: Multiple People Cause Violent View Shifting

**Cause:** Detections were assigned to figures by array index, so when detection order changed, figures "teleported" to new positions.

**Solution:** Implemented **stable tracking by centroid proximity**:
```typescript
// Match detections to existing figures by bbox centroid distance
const MATCH_THRESHOLD = 0.3; // 30% of image width
if (distance < MATCH_THRESHOLD) {
  // Update existing figure
} else {
  // Create new figure
}
```

### Issue: White Background Flickering

**Cause:** Three.js renderer had `alpha: true` making canvas transparent, and scene was reinitialized on every detection count change.

**Solution:**
```typescript
// Use opaque renderer
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: false
});

// Set explicit clear color matching scene background
renderer.setClearColor(0x1a1a2e, 1);

// Initialize scene once, don't recreate on detection changes
useEffect(() => { /* init */ }, []); // Empty dependency array
```

### Issue: False Detections Causing Figure Pop-in

**Solution:** Add temporal filtering (future enhancement):
```typescript
// Require detections to persist for N frames before creating figures
// Or use exponential moving average on confidence scores
const NEW_DETECTION_THRESHOLD = 0.50;
const TRACKED_DETECTION_THRESHOLD = 0.40;
```

---

## Camera Controls

The 3D view uses Three.js OrbitControls:

| Action | Control |
|--------|---------|
| Rotate | Left-click + drag |
| Zoom | Scroll wheel |
| Pan | Right-click + drag |

### Camera Defaults

```typescript
camera.position.set(0, 1, 8); // Behind and slightly above
camera.lookAt(0, 1, 0);        // Look at torso center
```

---

## Performance Optimization

### For Low-End Hardware

1. Use `stick` model type (simplest geometry)
2. Disable `estimateDepth`
3. Reduce input size to 320
4. Limit figure count: `maxFigures = 3`

### For High-Quality Rendering

1. Use `volumetric` or `mixamo` models
2. Enable `estimateDepth` for realism
3. Increase `renderer.setPixelRatio()` cap
4. Use `antialias: true` (already enabled)

---

## Future Enhancements

### True 3D Pose Estimation

To get actual 3D poses (not heuristic visualization):

1. **Stereo Vision**: Two cameras with known baseline
   - Triangulate keypoints from two views
   - Accurate but requires calibration

2. **Monocular 3D Models**:
   - MotionBERT: Transformer for 3D pose lifting
   - VideoPose3D: Temporal 2D-to-3D conversion
   - Run as pre-processing before visualization

3. **Depth Camera**:
   - Intel RealSense, Azure Kinect
   - Direct depth measurement per pixel
   - Most accurate but requires hardware

### Improved Tracking

Current tracking uses simple centroid matching. Improvements:
- Kalman filtering for smoother trajectories
- Hungarian algorithm for optimal assignment
- ReID features for occlusion recovery

---

## Code References

| Component | File |
|-----------|------|
| Main 3D visualizer | `client/src/components/PoseVisualizer3D/PoseVisualizer3D.tsx` |
| Mixamo character | `client/src/components/PoseVisualizer3D/MixamoCharacter3D.ts` |
| 2D canvas overlay | `client/src/components/VideoCanvas/VideoCanvas.tsx` |
| Settings panel | `client/src/components/SettingsPanel/SettingsPanel.tsx` |
| Model storage | `client/src/services/modelStorage.ts` |
| ONNX inference | `client/src/services/onnxInference.ts` |

---

## References

- [COCO Keypoints Dataset](https://cocodataset.org/#keypoints-eval)
- [YOLO-Pose Paper](https://arxiv.org/abs/2304.00501)
- [MotionBERT: 3D Pose Lifting](https://arxiv.org/abs/2302.07174)
- [VideoPose3D](https://github.com/facebookresearch/VideoPose3D)
- [Three.js Documentation](https://threejs.org/docs/)
