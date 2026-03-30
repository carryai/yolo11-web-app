import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import * as THREE from 'three';
import { Detection, Keypoint } from '../../../../shared/types';
import { MixamoCharacter3D } from './MixamoCharacter3D';

// COCO keypoints skeleton connections
const KEYPOINT_CONNECTIONS: [number, number][] = [
  [0, 1], [0, 2],     // nose to eyes
  [1, 3], [2, 4],     // eyes to ears
  [0, 5], [0, 6],     // nose to shoulders
  [5, 7], [7, 9],     // left arm
  [6, 8], [8, 10],    // right arm
  [5, 11], [6, 12],   // shoulders to hips
  [11, 13], [13, 15], // left leg
  [12, 14], [14, 16], // right leg
  [5, 6],             // shoulders connection (for depth estimation)
  [11, 12],           // hips connection (for depth estimation)
];

const KEYPOINT_COLORS = [
  '#FF6B6B', // nose - red
  '#4ECDC4', // left_eye - teal
  '#4ECDC4', // right_eye - teal
  '#FFA07A', // left_ear - light salmon
  '#FFA07A', // right_ear - light salmon
  '#45B7D1', // left_shoulder - cyan
  '#45B7D1', // right_shoulder - cyan
  '#98D8C8', // left_elbow - mint
  '#98D8C8', // right_elbow - mint
  '#F7DC6F', // left_wrist - yellow
  '#F7DC6F', // right_wrist - yellow
  '#BB8FCE', // left_hip - purple
  '#BB8FCE', // right_hip - purple
  '#F1948A', // left_knee - coral
  '#F1948A', // right_knee - coral
  '#82E0AA', // left_ankle - green
  '#82E0AA', // right_ankle - green
];

export type HumanModelType = 'stick' | 'mannequin' | 'volumetric' | 'mixamo';

interface PoseVisualizer3DProps {
  detections: Detection[];
  containerWidth?: number;
  containerHeight?: number;
  modelType?: HumanModelType;
  estimateDepth?: boolean; // Enable heuristic depth estimation
}

interface StickFigure {
  group: THREE.Group;
  joints: THREE.Object3D[];
  bones: THREE.Object3D[];
  bodyParts: Map<string, THREE.Object3D>; // For volumetric models
  mixamoCharacter?: MixamoCharacter3D; // For Mixamo models
}

/**
 * PoseVisualizer3D - 3D human pose visualization from YOLO-pose 2D keypoints
 *
 * IMPORTANT: YOLO-pose only provides 2D keypoints (x, y). This component offers
 * two visualization modes:
 *
 * 1. 2.5D Flat Mode (estimateDepth=false):
 *    - Keypoints displayed on a flat plane
 *    - User can rotate camera to view from different angles
 *    - Good for understanding pose structure
 *
 * 2. Heuristic Depth Estimation (estimateDepth=true):
 *    - Uses anatomical knowledge to estimate Z positions
 *    - Shoulder/hip width variations suggest body rotation
 *    - Limb foreshortening suggests depth
 *    - APPROXIMATION ONLY - not accurate for complex poses
 *
 * For TRUE 3D pose estimation, you would need:
 * - Multi-view cameras (stereo vision)
 * - A 2D-to-3D lifting model (MotionBERT, VideoPose3D, etc.)
 * - Depth camera (Kinect, RealSense)
 */
export const PoseVisualizer3D: React.FC<PoseVisualizer3DProps> = ({
  detections,
  containerWidth = 800,
  containerHeight = 600,
  modelType = 'stick',
  estimateDepth = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<any>(null);
  const figuresRef = useRef<Map<number, StickFigure>>(new Map());
  const mixamoModelsRef = useRef<Map<number, MixamoCharacter3D>>(new Map());
  const animationFrameRef = useRef<number>();
  const previousKeypointsRef = useRef<Map<number, Keypoint[]>>(new Map());
  const [mixamoModelUrl] = useState(() =>
    localStorage.getItem('mixamoModelUrl') || '/models/character.glb'
  );

  // Filter detections to only those with keypoints (pose models)
  const poseDetections = useMemo(() =>
    detections.filter(d => d.keypoints && d.keypoints.length > 0),
    [detections]
  );

  // Calculate depth from stereo keypoints (shoulders, hips)
  const estimateDepthFromPose = useCallback((keypoints: Keypoint[]): Map<number, number> => {
    const depthMap = new Map<number, number>();

    if (!estimateDepth) {
      // No depth estimation - all keypoints at z=0
      keypoints.forEach((_, i) => depthMap.set(i, 0));
      return depthMap;
    }

    // Get key shoulder and hip keypoints
    const leftShoulder = keypoints[5];
    const rightShoulder = keypoints[6];

    // Calculate shoulder width in 2D
    let shoulderWidth2D = 0;
    if (leftShoulder && rightShoulder) {
      const dx = rightShoulder.x - leftShoulder.x;
      const dy = rightShoulder.y - leftShoulder.y;
      shoulderWidth2D = Math.sqrt(dx * dx + dy * dy);
    }

    // Expected shoulder width (normalized)
    const expectedShoulderWidth = 0.15; // Approximate from training data

    // Depth factor: if shoulders appear narrower than expected, body is rotated
    const shoulderDepthFactor = shoulderWidth2D > 0
      ? Math.sqrt(Math.max(0, expectedShoulderWidth * expectedShoulderWidth - shoulderWidth2D * shoulderWidth2D))
      : 0;

    // Assign depth to each keypoint based on anatomical position
    keypoints.forEach((kp, i) => {
      let z = 0;

      // Body centerline (spine) - estimate depth from shoulder rotation
      if (i === 0) { // nose - in front of shoulders
        z = shoulderDepthFactor * 0.3;
      } else if ([1, 2, 3, 4].includes(i)) { // head keypoints
        z = shoulderDepthFactor * 0.2;
      } else if ([5, 6].includes(i)) { // shoulders
        z = (i === 5 ? 1 : -1) * shoulderDepthFactor * 0.5;
      } else if ([7, 8, 9, 10].includes(i)) { // arms - approximate from shoulder
        const shoulderIdx = i < 8 ? 5 : 6;
        const shoulder = keypoints[shoulderIdx];
        if (shoulder) {
          const dx = kp.x - shoulder.x;
          const dy = kp.y - shoulder.y;
          const armLength2D = Math.sqrt(dx * dx + dy * dy);
          const expectedArmLength = 0.25;
          if (armLength2D < expectedArmLength) {
            z = Math.sqrt(expectedArmLength * expectedArmLength - armLength2D * armLength2D);
          }
        }
      } else if ([11, 12].includes(i)) { // hips
        z = (i === 11 ? 1 : -1) * shoulderDepthFactor * 0.3;
      } else if ([13, 14, 15, 16].includes(i)) { // legs
        const hipIdx = i < 14 ? 11 : 12;
        const hip = keypoints[hipIdx];
        if (hip) {
          const dx = kp.x - hip.x;
          const dy = kp.y - hip.y;
          const legLength2D = Math.sqrt(dx * dx + dy * dy);
          const expectedLegLength = 0.35;
          if (legLength2D < expectedLegLength) {
            z = Math.sqrt(expectedLegLength * expectedLegLength - legLength2D * legLength2D);
          }
        }
      }

      depthMap.set(i, z);
    });

    return depthMap;
  }, [estimateDepth]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) {
      console.warn('PoseVisualizer3D: containerRef.current is null');
      return;
    }

    const container = containerRef.current;
    const width = container.clientWidth || containerWidth;
    const height = container.clientHeight || containerHeight;

    console.log('PoseVisualizer3D: Initializing with dimensions', width, 'x', height);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 10, 30);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      width / height,
      0.1,
      1000
    );
    camera.position.set(0, 1, 8);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false, // Use opaque background for better performance and no transparency issues
      preserveDrawingBuffer: false, // Prevents trailing artifacts
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x1a1a2e, 1); // Explicitly set clear color to match scene background

    // Style the canvas for proper display with z-index to prevent stacking issues
    renderer.domElement.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; z-index: 1;';

    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(5, 8, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffaa88, 0.2);
    rimLight.position.set(0, 5, -8);
    scene.add(rimLight);

    // Grid helper for depth perception and "floor"
    const gridHelper = new THREE.GridHelper(20, 20, 0x444466, 0x222233);
    gridHelper.position.y = -2.5;
    scene.add(gridHelper);

    // Reference plane at z=0
    const planeGeometry = new THREE.PlaneGeometry(10, 5);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x333355,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    });
    const referencePlane = new THREE.Mesh(planeGeometry, planeMaterial);
    referencePlane.position.z = 0;
    referencePlane.rotation.x = Math.PI / 2;
    referencePlane.position.y = 0;
    scene.add(referencePlane);

    // Axes helper for orientation
    const axesHelper = new THREE.AxesHelper(1);
    axesHelper.position.set(-4, -2, 0);
    scene.add(axesHelper);

    // OrbitControls for interactive camera
    import('three/examples/jsm/controls/OrbitControls.js').then(({ OrbitControls }) => {
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.minDistance = 3;
      controls.maxDistance = 20;
      controls.enablePan = true;
      controls.target.set(0, 0, 0);
      controls.update();
      controlsRef.current = controls;
    }).catch(() => {
      console.log('OrbitControls not available');
    });

    // Handle resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;

      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;

      console.log('PoseVisualizer3D: Resize to', newWidth, 'x', newHeight);

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    // Use ResizeObserver for more reliable size detection
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    window.addEventListener('resize', handleResize);

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      // Smooth auto-rotation when idle (optional)
      if (poseDetections.length === 0 && scene) {
        scene.rotation.y += 0.001;
      }

      // Explicitly clear renderer before rendering to prevent trailing artifacts
      renderer.clear(true, true, true); // color, depth, stencil
      renderer.render(scene, camera);
    };

    animate();

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      if (controlsRef.current) {
        controlsRef.current.dispose();
      }

      // Dispose all figures
      figuresRef.current.forEach((figure) => {
        figure.joints.forEach(joint => {
          if ((joint as THREE.Mesh).geometry) {
            (joint as THREE.Mesh).geometry.dispose();
            ((joint as THREE.Mesh).material as THREE.Material)?.dispose();
          }
        });
        figure.bones.forEach(bone => {
          if ((bone as THREE.Mesh).geometry) {
            (bone as THREE.Mesh).geometry.dispose();
            ((bone as THREE.Mesh).material as THREE.Material)?.dispose();
          }
        });
        figure.bodyParts.forEach(part => {
          if ((part as THREE.Mesh).geometry) {
            (part as THREE.Mesh).geometry.dispose();
            ((part as THREE.Mesh).material as THREE.Material)?.dispose();
          }
        });
        scene.remove(figure.group);
      });
      figuresRef.current.clear();
      previousKeypointsRef.current.clear();

      // Dispose Mixamo characters
      mixamoModelsRef.current.forEach((character) => {
        character.dispose();
        scene.remove(character.group);
      });
      mixamoModelsRef.current.clear();

      // Dispose scene objects
      scene.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) {
          const mesh = object as THREE.Mesh;
          mesh.geometry.dispose();
          if (mesh.material) {
            const material = mesh.material as THREE.Material | THREE.Material[];
            if (Array.isArray(material)) {
              material.forEach(m => m.dispose());
            } else {
              material.dispose();
            }
          }
        }
      });

      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []); // Only initialize once - don't reinitialize on detection changes

  // Create or update stick figures based on detections
  useEffect(() => {
    if (!sceneRef.current) {
      console.warn('PoseVisualizer3D: No scene available for updating figures');
      return;
    }

    const scene = sceneRef.current;
    const numDetected = poseDetections.length;

    // Calculate figure spacing
    const spacing = 2.5;
    const totalWidth = (numDetected - 1) * spacing;
    const startX = -totalWidth / 2;

    // Track which figure IDs are in use to prevent duplicates
    const usedIds = new Set<number>();

    // Create or update figures for each detection
    poseDetections.forEach((detection, index) => {
      if (!detection.keypoints) return;

      const figureId = index;
      const xPos = startX + index * spacing;
      const depthMap = estimateDepthFromPose(detection.keypoints);
      usedIds.add(figureId);

      if (modelType === 'mixamo') {
        // Handle Mixamo character
        if (!mixamoModelsRef.current.has(figureId)) {
          // Create new Mixamo character
          const character = new MixamoCharacter3D(
            mixamoModelUrl,
            () => console.log(`Mixamo character ${figureId} loaded`),
            (error) => console.error(`Mixamo character ${figureId} error:`, error)
          );
          character.group.position.x = xPos;
          mixamoModelsRef.current.set(figureId, character);
          scene.add(character.group);
          console.log('PoseVisualizer3D: Created Mixamo character', figureId);
        } else {
          // Update existing Mixamo character
          const character = mixamoModelsRef.current.get(figureId)!;
          if (character.group.position.x !== xPos) {
            character.group.position.x = xPos;
          }
          character.update(detection.keypoints, depthMap, 0.15);
        }
      } else {
        // Handle stick/mannequin/volumetric models
        if (!figuresRef.current.has(figureId)) {
          // Create new figure
          const figure = createFigure(detection.keypoints, xPos, depthMap, modelType);
          figuresRef.current.set(figureId, figure);
          scene.add(figure.group);
          console.log('PoseVisualizer3D: Created figure', figureId, 'of type', modelType);
        } else {
          // Update existing figure
          const figure = figuresRef.current.get(figureId)!;
          updateFigure(figure, detection.keypoints, xPos, depthMap, modelType);
        }
      }

      // Store keypoints for next frame interpolation
      previousKeypointsRef.current.set(figureId, [...detection.keypoints]);
    });

    // Remove figures that are no longer needed (prevents multiple person rendering issues)
    figuresRef.current.forEach((figure, id) => {
      if (!usedIds.has(id)) {
        console.log('PoseVisualizer3D: Removing stale figure', id);
        figure.joints.forEach(joint => {
          if ((joint as THREE.Mesh).geometry) {
            (joint as THREE.Mesh).geometry.dispose();
            ((joint as THREE.Mesh).material as THREE.Material)?.dispose();
          }
        });
        figure.bones.forEach(bone => {
          if ((bone as THREE.Mesh).geometry) {
            (bone as THREE.Mesh).geometry.dispose();
            ((bone as THREE.Mesh).material as THREE.Material)?.dispose();
          }
        });
        figure.bodyParts.forEach(part => {
          if ((part as THREE.Mesh).geometry) {
            (part as THREE.Mesh).geometry.dispose();
            ((part as THREE.Mesh).material as THREE.Material)?.dispose();
          }
        });
        scene.remove(figure.group);
        figuresRef.current.delete(id);
      }
    });

    // Remove stale Mixamo characters
    mixamoModelsRef.current.forEach((character, id) => {
      if (!usedIds.has(id)) {
        console.log('PoseVisualizer3D: Removing stale Mixamo character', id);
        character.dispose();
        scene.remove(character.group);
        mixamoModelsRef.current.delete(id);
      }
    });
  }, [poseDetections, modelType, estimateDepthFromPose, mixamoModelUrl]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-[#1a1a2e]"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        zIndex: 0
      }}
    >
      {/* Detection count overlay */}
      <div className="absolute top-4 left-4 z-10 bg-black/50 backdrop-blur-sm text-white px-4 py-2 rounded-lg pointer-events-none">
        <span className="text-sm font-medium">
          {poseDetections.length} person{poseDetections.length !== 1 ? 's' : ''} detected
        </span>
        {estimateDepth && (
          <span className="text-xs ml-2 opacity-70">(depth estimated)</span>
        )}
      </div>

      {/* Mode indicator */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-black/50 backdrop-blur-sm text-white px-4 py-2 rounded-lg text-xs pointer-events-none">
        <span>Model: {modelType}</span>
        <span className="mx-2">|</span>
        <span>Mode: {estimateDepth ? '3D Estimated' : '2.5D Flat'}</span>
      </div>

      {/* Instructions overlay */}
      <div className="absolute top-4 right-4 z-10 bg-black/50 backdrop-blur-sm text-white px-4 py-2 rounded-lg text-xs pointer-events-none">
        <span>Drag: rotate | Scroll: zoom | Right-drag: pan</span>
      </div>

      {/* Depth estimation disclaimer */}
      {estimateDepth && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-black/50 backdrop-blur-sm text-white px-4 py-2 rounded-lg text-xs opacity-70 pointer-events-none">
          <span>Note: Depth is heuristically estimated from 2D pose. For accurate 3D, use multi-view or depth sensors.</span>
        </div>
      )}
    </div>
  );
};

// Create a figure based on model type
function createFigure(
  keypoints: Keypoint[],
  xOffset: number,
  depthMap: Map<number, number>,
  modelType: HumanModelType
): StickFigure {
  const group = new THREE.Group();
  group.position.x = xOffset;

  const joints: THREE.Object3D[] = [];
  const bones: THREE.Object3D[] = [];
  const bodyParts = new Map<string, THREE.Object3D>();

  if (modelType === 'stick') {
    return createStickFigure(keypoints, depthMap, group, joints, bones, bodyParts);
  } else if (modelType === 'mannequin') {
    return createMannequinFigure(keypoints, depthMap, group, joints, bones, bodyParts);
  } else {
    return createVolumetricFigure(keypoints, depthMap, group, joints, bones, bodyParts);
  }
}

// Create stick figure (spheres + cylinders)
function createStickFigure(
  keypoints: Keypoint[],
  depthMap: Map<number, number>,
  group: THREE.Group,
  joints: THREE.Object3D[],
  bones: THREE.Object3D[],
  bodyParts: Map<string, THREE.Object3D>
): StickFigure {
  // Create joint spheres with depth sorting enabled
  keypoints.forEach((keypoint, index) => {
    const geometry = new THREE.SphereGeometry(0.08, 16, 16);
    const material = new THREE.MeshStandardMaterial({
      color: KEYPOINT_COLORS[index],
      metalness: 0.3,
      roughness: 0.7,
      emissive: KEYPOINT_COLORS[index],
      emissiveIntensity: 0.2,
      depthTest: true,
      depthWrite: true,
    });

    const joint = new THREE.Mesh(geometry, material);
    joint.castShadow = true;
    joint.receiveShadow = true;
    joint.renderOrder = 1; // Render joints after bones

    const x = (keypoint.x - 0.5) * 3;
    const y = -(keypoint.y - 0.5) * 3;
    const z = depthMap.get(index) || 0;

    joint.position.set(x, y, z);
    joint.visible = keypoint.visibility >= 1;

    group.add(joint);
    joints.push(joint);
  });

  // Create bone cylinders
  KEYPOINT_CONNECTIONS.forEach(([i, j]) => {
    const kp1 = keypoints[i];
    const kp2 = keypoints[j];

    if (!kp1 || !kp2 || kp1.visibility < 1 || kp2.visibility < 1) return;

    const pos1 = new THREE.Vector3(
      (kp1.x - 0.5) * 3,
      -(kp1.y - 0.5) * 3,
      depthMap.get(i) || 0
    );
    const pos2 = new THREE.Vector3(
      (kp2.x - 0.5) * 3,
      -(kp2.y - 0.5) * 3,
      depthMap.get(j) || 0
    );

    const bone = createBone(pos1, pos2, KEYPOINT_COLORS[i], 0.03);
    group.add(bone);
    bones.push(bone);
  });

  return { group, joints, bones, bodyParts };
}

// Create mannequin figure (simplified body volumes)
function createMannequinFigure(
  keypoints: Keypoint[],
  depthMap: Map<number, number>,
  group: THREE.Group,
  joints: THREE.Object3D[],
  bones: THREE.Object3D[],
  bodyParts: Map<string, THREE.Object3D>
): StickFigure {
  // First create the basic skeleton
  createStickFigure(keypoints, depthMap, group, joints, bones, bodyParts);

  // Add simplified body volumes
  const shoulderLeft = keypoints[5];
  const shoulderRight = keypoints[6];
  const hipLeft = keypoints[11];
  const hipRight = keypoints[12];

  if (shoulderLeft && shoulderRight && shoulderLeft.visibility >= 1 && shoulderRight.visibility >= 1) {
    // Torso (capsule)
    const torsoX = ((shoulderLeft.x + shoulderRight.x) / 2 - 0.5) * 3;
    const torsoY = -((shoulderLeft.y + shoulderRight.y) / 2 + 0.15) * 3;
    const torsoZ = ((depthMap.get(5) || 0) + (depthMap.get(6) || 0)) / 2;

    const torsoGeometry = new THREE.CapsuleGeometry(0.25, 0.6, 8, 16);
    const torsoMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      metalness: 0.2,
      roughness: 0.7,
      transparent: true,
      opacity: 0.7,
    });
    const torso = new THREE.Mesh(torsoGeometry, torsoMaterial);
    torso.position.set(torsoX, torsoY, torsoZ);
    torso.castShadow = true;
    group.add(torso);
    bodyParts.set('torso', torso);
  }

  if (shoulderLeft && shoulderRight && hipLeft && hipRight) {
    // Pelvis
    const pelvisX = ((shoulderLeft.x + shoulderRight.x) / 2 - 0.5) * 3;
    const pelvisY = -((shoulderLeft.y + shoulderRight.y) / 2 + 0.3) * 3;
    const pelvisZ = ((depthMap.get(5) || 0) + (depthMap.get(6) || 0)) / 2;

    const pelvisGeometry = new THREE.SphereGeometry(0.18, 16, 16);
    const pelvisMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      metalness: 0.2,
      roughness: 0.7,
      transparent: true,
      opacity: 0.7,
    });
    const pelvis = new THREE.Mesh(pelvisGeometry, pelvisMaterial);
    pelvis.position.set(pelvisX, pelvisY, pelvisZ);
    pelvis.scale.y = 0.7;
    pelvis.castShadow = true;
    group.add(pelvis);
    bodyParts.set('pelvis', pelvis);
  }

  // Head (sphere at nose position)
  const nose = keypoints[0];
  if (nose && nose.visibility >= 1) {
    const headGeometry = new THREE.SphereGeometry(0.12, 16, 16);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xffdbac,
      metalness: 0.1,
      roughness: 0.8,
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.set(
      (nose.x - 0.5) * 3,
      -(nose.y - 0.5) * 3 - 0.1,
      (depthMap.get(0) || 0) + 0.05
    );
    head.castShadow = true;
    group.add(head);
    bodyParts.set('head', head);
  }

  return { group, joints, bones, bodyParts };
}

// Create volumetric figure (more detailed body parts)
function createVolumetricFigure(
  keypoints: Keypoint[],
  depthMap: Map<number, number>,
  group: THREE.Group,
  joints: THREE.Object3D[],
  bones: THREE.Object3D[],
  bodyParts: Map<string, THREE.Object3D>
): StickFigure {
  // Start with mannequin base
  createMannequinFigure(keypoints, depthMap, group, joints, bones, bodyParts);

  // Add limb volumes (capsules for arms and legs)
  const addLimb = (
    kp1Idx: number,
    kp2Idx: number,
    name: string,
    radius: number,
    color: number
  ) => {
    const kp1 = keypoints[kp1Idx];
    const kp2 = keypoints[kp2Idx];

    if (!kp1 || !kp2 || kp1.visibility < 1 || kp2.visibility < 1) return;

    const pos1 = new THREE.Vector3(
      (kp1.x - 0.5) * 3,
      -(kp1.y - 0.5) * 3,
      depthMap.get(kp1Idx) || 0
    );
    const pos2 = new THREE.Vector3(
      (kp2.x - 0.5) * 3,
      -(kp2.y - 0.5) * 3,
      depthMap.get(kp2Idx) || 0
    );

    const direction = new THREE.Vector3().subVectors(pos2, pos1);
    const length = direction.length();
    direction.normalize();

    const limbGeometry = new THREE.CapsuleGeometry(radius, length, 8, 16);
    const limbMaterial = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.2,
      roughness: 0.7,
      transparent: true,
      opacity: 0.6,
    });
    const limb = new THREE.Mesh(limbGeometry, limbMaterial);

    // Position at midpoint
    const midpoint = new THREE.Vector3().addVectors(pos1, pos2).multiplyScalar(0.5);
    limb.position.copy(midpoint);

    // Rotate to align
    const axis = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction);
    limb.setRotationFromQuaternion(quaternion);

    limb.castShadow = true;
    group.add(limb);
    bodyParts.set(name, limb);
  };

  // Arms
  addLimb(5, 7, 'leftUpperArm', 0.06, 0x45B7D1);
  addLimb(7, 9, 'leftLowerArm', 0.05, 0x98D8C8);
  addLimb(6, 8, 'rightUpperArm', 0.06, 0x45B7D1);
  addLimb(8, 10, 'rightLowerArm', 0.05, 0x98D8C8);

  // Legs
  addLimb(11, 13, 'leftThigh', 0.08, 0xBB8FCE);
  addLimb(13, 15, 'leftShin', 0.07, 0xF1948A);
  addLimb(12, 14, 'rightThigh', 0.08, 0xBB8FCE);
  addLimb(14, 16, 'rightShin', 0.07, 0xF1948A);

  return { group, joints, bones, bodyParts };
}

// Update figure with new keypoints
function updateFigure(
  figure: StickFigure,
  keypoints: Keypoint[],
  xOffset: number,
  depthMap: Map<number, number>,
  modelType: HumanModelType
) {
  figure.group.position.x = xOffset;

  const lerpFactor = 0.3; // Smooth interpolation

  // Update joint positions
  keypoints.forEach((keypoint, index) => {
    if (index < figure.joints.length) {
      const joint = figure.joints[index];
      const targetX = (keypoint.x - 0.5) * 3;
      const targetY = -(keypoint.y - 0.5) * 3;
      const targetZ = depthMap.get(index) || 0;

      joint.position.x = THREE.MathUtils.lerp(joint.position.x, targetX, lerpFactor);
      joint.position.y = THREE.MathUtils.lerp(joint.position.y, targetY, lerpFactor);
      joint.position.z = THREE.MathUtils.lerp(joint.position.z, targetZ, lerpFactor);
      joint.visible = keypoint.visibility >= 1;
    }
  });

  // Remove old bones
  figure.bones.forEach(bone => {
    figure.group.remove(bone);
    if ((bone as THREE.Mesh).geometry) {
      (bone as THREE.Mesh).geometry.dispose();
      ((bone as THREE.Mesh).material as THREE.Material)?.dispose();
    }
  });
  figure.bones.length = 0;

  // Recreate bones
  KEYPOINT_CONNECTIONS.forEach(([i, j]) => {
    const kp1 = keypoints[i];
    const kp2 = keypoints[j];

    if (!kp1 || !kp2 || kp1.visibility < 1 || kp2.visibility < 1) return;
    if (i >= figure.joints.length || j >= figure.joints.length) return;

    const joint1 = figure.joints[i];
    const joint2 = figure.joints[j];

    if (!joint1.visible || !joint2.visible) return;

    const bone = createBone(joint1.position, joint2.position, KEYPOINT_COLORS[i], 0.03);
    figure.group.add(bone);
    figure.bones.push(bone);
  });

  // Update body parts for volumetric models
  if (modelType !== 'stick') {
    updateBodyParts(figure, keypoints, depthMap, modelType);
  }
}

// Helper to create a bone cylinder between two points
function createBone(pos1: THREE.Vector3, pos2: THREE.Vector3, color: string, radius: number): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(pos2, pos1);
  const length = direction.length();
  direction.normalize();

  const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.2,
    roughness: 0.8,
    depthTest: true,
    depthWrite: true,
  });

  const bone = new THREE.Mesh(geometry, material);

  // Position at midpoint
  const midpoint = new THREE.Vector3().addVectors(pos1, pos2).multiplyScalar(0.5);
  bone.position.copy(midpoint);

  // Rotate to align with direction
  const axis = new THREE.Vector3(0, 1, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction);
  bone.setRotationFromQuaternion(quaternion);

  bone.castShadow = true;
  bone.receiveShadow = true;
  bone.renderOrder = 0; // Render bones before joints

  return bone;
}

// Update body parts positions for mannequin/volumetric models
function updateBodyParts(
  figure: StickFigure,
  keypoints: Keypoint[],
  depthMap: Map<number, number>,
  modelType: HumanModelType
) {
  // Update torso position
  const torso = figure.bodyParts.get('torso') as THREE.Mesh;
  const shoulderLeft = keypoints[5];
  const shoulderRight = keypoints[6];

  if (torso && shoulderLeft && shoulderRight) {
    const targetX = ((shoulderLeft.x + shoulderRight.x) / 2 - 0.5) * 3;
    const targetY = -((shoulderLeft.y + shoulderRight.y) / 2 + 0.15) * 3;
    const targetZ = ((depthMap.get(5) || 0) + (depthMap.get(6) || 0)) / 2;

    torso.position.x = THREE.MathUtils.lerp(torso.position.x, targetX, 0.3);
    torso.position.y = THREE.MathUtils.lerp(torso.position.y, targetY, 0.3);
    torso.position.z = THREE.MathUtils.lerp(torso.position.z, targetZ, 0.3);
  }

  // Update head position
  const head = figure.bodyParts.get('head') as THREE.Mesh;
  const nose = keypoints[0];

  if (head && nose && nose.visibility >= 1) {
    const targetX = (nose.x - 0.5) * 3;
    const targetY = -(nose.y - 0.5) * 3 - 0.1;
    const targetZ = (depthMap.get(0) || 0) + 0.05;

    head.position.x = THREE.MathUtils.lerp(head.position.x, targetX, 0.3);
    head.position.y = THREE.MathUtils.lerp(head.position.y, targetY, 0.3);
    head.position.z = THREE.MathUtils.lerp(head.position.z, targetZ, 0.3);
  }

  // For volumetric model, update limb capsules
  if (modelType === 'volumetric') {
    const updateLimb = (
      kp1Idx: number,
      kp2Idx: number,
      limbName: string
    ) => {
      const kp1 = keypoints[kp1Idx];
      const kp2 = keypoints[kp2Idx];
      const limb = figure.bodyParts.get(limbName) as THREE.Mesh;

      if (!limb || !kp1 || !kp2 || kp1.visibility < 1 || kp2.visibility < 1) return;

      const pos1 = new THREE.Vector3(
        (kp1.x - 0.5) * 3,
        -(kp1.y - 0.5) * 3,
        depthMap.get(kp1Idx) || 0
      );
      const pos2 = new THREE.Vector3(
        (kp2.x - 0.5) * 3,
        -(kp2.y - 0.5) * 3,
        depthMap.get(kp2Idx) || 0
      );

      const direction = new THREE.Vector3().subVectors(pos2, pos1);
      const length = direction.length();
      direction.normalize();

      const midpoint = new THREE.Vector3().addVectors(pos1, pos2).multiplyScalar(0.5);

      limb.position.x = THREE.MathUtils.lerp(limb.position.x, midpoint.x, 0.3);
      limb.position.y = THREE.MathUtils.lerp(limb.position.y, midpoint.y, 0.3);
      limb.position.z = THREE.MathUtils.lerp(limb.position.z, midpoint.z, 0.3);

      // Scale length - store original length in userData
      const originalLength = limb.userData.originalLength || length;
      limb.userData.originalLength = originalLength;
      limb.scale.y = THREE.MathUtils.lerp(limb.scale.y, length / originalLength, 0.3);

      const axis = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction);
      limb.setRotationFromQuaternion(quaternion);
    };

    updateLimb(5, 7, 'leftUpperArm');
    updateLimb(7, 9, 'leftLowerArm');
    updateLimb(6, 8, 'rightUpperArm');
    updateLimb(8, 10, 'rightLowerArm');
    updateLimb(11, 13, 'leftThigh');
    updateLimb(13, 15, 'leftShin');
    updateLimb(12, 14, 'rightThigh');
    updateLimb(14, 16, 'rightShin');
  }
}

export default PoseVisualizer3D;
