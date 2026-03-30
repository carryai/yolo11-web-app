# Mixamo 3D Character Setup

## How to Add a Mixamo Character

1. **Download a character from Mixamo:**
   - Go to [https://www.mixamo.com](https://www.mixamo.com)
   - Choose a character (free with Adobe account)
   - Click "Download"
   - Select format: **FBX** or **GLTF/GLB** (GLB recommended)
   - Skin: **With Skin**
   - Pose Space: **Local (Y-up)** or **Character Preview**

2. **Convert to GLB (if needed):**
   - If you downloaded FBX, convert to GLB using:
     - Online converter: https://convertio.co/fbx-glb/
     - Or use Blender: File > Import > FBX, then File > Export > glTF 2.0 (.glb)

3. **Place the model file:**
   - Copy your `.glb` or `.gltf` file to: `client/public/models/`
   - Recommended name: `character.glb`

4. **Update the model URL:**
   - In the app, open Settings (gear icon)
   - Enable 3D View
   - Select "Mixamo Character" as the model type
   - Enter the model URL: `/models/character.glb`

5. **Test:**
   - Load a YOLO-pose model (yolo11n-pose or yolo26n-pose)
   - Start webcam or upload an image with a person
   - Toggle to 3D View
   - You should see the 3D character mimicking the pose!

## Notes

- Keep model file size under 20MB for best performance
- The app maps standard Mixamo bone names to COCO keypoints
- For best results, use characters in T-pose or A-pose
- The character will be automatically scaled to fit the scene

## Supported Bone Names

The app looks for these standard Mixamo bone names:
- Hips, Spine, Spine2, Neck, Head
- LeftShoulder, LeftArm, LeftForeArm, LeftHand
- RightShoulder, RightArm, RightForeArm, RightHand
- LeftUpLeg, LeftLeg, LeftFoot
- RightUpLeg, RightLeg, RightFoot

## Troubleshooting

**Character not showing:**
- Check browser console for loading errors
- Verify the model file exists at the specified path
- Try a different model format (.glb recommended)

**Character not animating:**
- Ensure you're using a YOLO-pose model (not standard detection)
- Check that keypoints are being detected (should see skeleton in 2D view)
- Verify the model has standard Mixamo bone names

**Character too big/small:**
- The app auto-scales models, but you can modify the scale in code
- Edit `MixamoCharacter3D.ts` and adjust `this.model.scale.set(1, 1, 1)`
