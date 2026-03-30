import * as THREE from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Keypoint } from '../../../../shared/types';

// Mixamo/Standard humanoid bone names
const BONE_NAMES = {
  hips: 'Hips',
  spine: 'Spine',
  spine2: 'Spine2',
  neck: 'Neck',
  head: 'Head',
  leftShoulder: 'LeftShoulder',
  rightShoulder: 'RightShoulder',
  leftArm: 'LeftArm',
  rightArm: 'RightArm',
  leftForeArm: 'LeftForeArm',
  rightForeArm: 'RightForeArm',
  leftHand: 'LeftHand',
  rightHand: 'RightHand',
  leftUpLeg: 'LeftUpLeg',
  rightUpLeg: 'RightUpLeg',
  leftLeg: 'LeftLeg',
  rightLeg: 'RightLeg',
  leftFoot: 'LeftFoot',
  rightFoot: 'RightFoot',
};

// Map COCO keypoints to bone rotations (used for reference)
const COCO_TO_BONE_ROTATIONS: Record<number, string[]> = {
  5: [BONE_NAMES.leftShoulder],
  6: [BONE_NAMES.rightShoulder],
  7: [BONE_NAMES.leftArm],
  8: [BONE_NAMES.rightArm],
  9: [BONE_NAMES.leftHand],
  10: [BONE_NAMES.rightHand],
  11: [BONE_NAMES.leftUpLeg],
  12: [BONE_NAMES.rightUpLeg],
  13: [BONE_NAMES.leftLeg],
  14: [BONE_NAMES.rightLeg],
  15: [BONE_NAMES.leftFoot],
  16: [BONE_NAMES.rightFoot],
};

// Prevent unused variable warning
void COCO_TO_BONE_ROTATIONS;

export class MixamoCharacter3D {
  public group: THREE.Group;
  public model: THREE.Object3D | null = null;
  private bones: Map<string, THREE.Bone> = new Map();
  private originalRotations: Map<string, THREE.Quaternion> = new Map();
  private originalPositions: Map<string, THREE.Vector3> = new Map();
  private loader: GLTFLoader;
  private onLoad?: () => void;
  private onError?: (error: Error) => void;

  constructor(
    modelUrl: string,
    onLoad?: () => void,
    onError?: (error: Error) => void
  ) {
    this.group = new THREE.Group();
    this.loader = new GLTFLoader();
    this.onLoad = onLoad;
    this.onError = onError;

    this.loadModel(modelUrl);
  }

  private loadModel(modelUrl: string) {
    this.loader.load(
      modelUrl,
      (gltf: GLTF) => {
        this.model = gltf.scene;

        // Find all bones in the model
        this.model.traverse((child) => {
          if (child instanceof THREE.Bone && child.name) {
            const bone = child as THREE.Bone;
            this.bones.set(bone.name, bone);
            this.originalRotations.set(bone.name, bone.quaternion.clone());
            this.originalPositions.set(bone.name, bone.position.clone());
          }
        });

        // Scale and position model
        this.model.scale.set(1, 1, 1);
        this.model.position.y = 0;

        // Enable shadows
        this.model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        this.group.add(this.model);
        this.onLoad?.();
      },
      undefined,
      (error: unknown) => {
        const err = new Error(`Failed to load model: ${error instanceof Error ? error.message : String(error)}`);
        this.onError?.(err);
      }
    );
  }

  public update(keypoints: Keypoint[], depthMap: Map<number, number>, lerpFactor: number = 0.1) {
    if (!this.model || this.bones.size === 0) return;

    // Helper to get 3D position from 2D keypoint
    const getKeypointPos = (kpIndex: number): THREE.Vector3 | null => {
      const kp = keypoints[kpIndex];
      if (!kp || kp.visibility < 1) return null;

      const x = (kp.x - 0.5) * 2;
      const y = -(kp.y - 0.5) * 2;
      const z = depthMap.get(kpIndex) || 0;

      return new THREE.Vector3(x, y, z);
    };

    // Calculate rotation from two keypoints
    const calculateBoneRotation = (fromKp: number, toKp: number): THREE.Quaternion | null => {
      const fromPos = getKeypointPos(fromKp);
      const toPos = getKeypointPos(toKp);

      if (!fromPos || !toPos) return null;

      const direction = new THREE.Vector3().subVectors(toPos, fromPos).normalize();
      const targetQuaternion = new THREE.Quaternion();

      // Create rotation matrix from direction
      const matrix = new THREE.Matrix4();
      const up = new THREE.Vector3(0, -1, 0);
      matrix.lookAt(new THREE.Vector3(0, 0, 0), direction, up);
      targetQuaternion.setFromRotationMatrix(matrix);

      return targetQuaternion;
    };

    // Apply rotation to a bone
    const applyBoneRotation = (boneName: string, targetRotation: THREE.Quaternion) => {
      const bone = this.bones.get(boneName);
      if (!bone) return;

      const original = this.originalRotations.get(boneName);
      if (!original) return;

      // Apply rotation with smoothing
      bone.quaternion.slerp(targetRotation, lerpFactor);
    };

    // Update shoulder bones
    const leftShoulderRot = calculateBoneRotation(5, 7);
    const rightShoulderRot = calculateBoneRotation(6, 8);
    if (leftShoulderRot) applyBoneRotation(BONE_NAMES.leftShoulder, leftShoulderRot);
    if (rightShoulderRot) applyBoneRotation(BONE_NAMES.rightShoulder, rightShoulderRot);

    // Update arm bones
    const leftArmRot = calculateBoneRotation(7, 9);
    const rightArmRot = calculateBoneRotation(8, 10);
    if (leftArmRot) applyBoneRotation(BONE_NAMES.leftArm, leftArmRot);
    if (rightArmRot) applyBoneRotation(BONE_NAMES.rightArm, rightArmRot);

    // Update hand bones
    const leftHandRot = calculateBoneRotation(9, 9); // Use wrist position
    const rightHandRot = calculateBoneRotation(10, 10);
    if (leftHandRot) applyBoneRotation(BONE_NAMES.leftHand, leftHandRot);
    if (rightHandRot) applyBoneRotation(BONE_NAMES.rightHand, rightHandRot);

    // Update leg bones
    const leftUpLegRot = calculateBoneRotation(11, 13);
    const rightUpLegRot = calculateBoneRotation(12, 14);
    if (leftUpLegRot) applyBoneRotation(BONE_NAMES.leftUpLeg, leftUpLegRot);
    if (rightUpLegRot) applyBoneRotation(BONE_NAMES.rightUpLeg, rightUpLegRot);

    const leftLegRot = calculateBoneRotation(13, 15);
    const rightLegRot = calculateBoneRotation(14, 16);
    if (leftLegRot) applyBoneRotation(BONE_NAMES.leftLeg, leftLegRot);
    if (rightLegRot) applyBoneRotation(BONE_NAMES.rightLeg, rightLegRot);

    // Update head rotation based on nose position
    const noseKp = keypoints[0];
    const headBone = this.bones.get(BONE_NAMES.head);
    const neckBone = this.bones.get(BONE_NAMES.neck);

    if (neckBone && noseKp && noseKp.visibility >= 1) {
      const nosePos = getKeypointPos(0);
      if (nosePos) {
        // Calculate head rotation from neck to nose direction
        const neckPos = getKeypointPos(5); // Approximate neck from shoulder
        if (neckPos) {
          const headDir = new THREE.Vector3().subVectors(nosePos, neckPos).normalize();
          const headMatrix = new THREE.Matrix4();
          headMatrix.lookAt(new THREE.Vector3(0, 0, 0), headDir, new THREE.Vector3(0, 1, 0));
          const headQuaternion = new THREE.Quaternion().setFromRotationMatrix(headMatrix);

          if (headBone) {
            headBone.quaternion.slerp(headQuaternion, lerpFactor);
          }
          if (neckBone) {
            neckBone.quaternion.slerp(headQuaternion, lerpFactor);
          }
        }
      }
    }

    // Update hips rotation based on hip keypoints
    const leftHipRot = calculateBoneRotation(11, 13);
    const rightHipRot = calculateBoneRotation(12, 14);
    if (leftHipRot) applyBoneRotation(BONE_NAMES.leftUpLeg, leftHipRot);
    if (rightHipRot) applyBoneRotation(BONE_NAMES.rightUpLeg, rightHipRot);
  }

  public dispose() {
    if (this.model) {
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (child.material) {
            const material = child.material as THREE.Material | THREE.Material[];
            if (Array.isArray(material)) {
              material.forEach(m => m.dispose());
            } else {
              material.dispose();
            }
          }
        }
      });
      this.group.remove(this.model);
    }
    this.bones.clear();
    this.originalRotations.clear();
    this.originalPositions.clear();
  }
}

export default MixamoCharacter3D;
