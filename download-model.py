#!/usr/bin/env python3
"""Download YOLO ONNX models from Hugging Face."""

import urllib.request
import os

MODELS = {
    # YOLO11 models
    'yolo11n.onnx': "https://huggingface.co/ultralytics/assets/resolve/main/yolo11n.onnx",
    'yolo11n-pose.onnx': "https://huggingface.co/ultralytics/assets/resolve/main/yolo11n-pose.onnx",
    # YOLO12 models
    'yolo12n.onnx': "https://huggingface.co/ultralytics/assets/resolve/main/yolo12n.onnx",
    # YOLO26 models
    'yolo26n.onnx': "https://huggingface.co/ultralytics/assets/resolve/main/yolo26n.onnx",
    'yolo26n-pose.onnx': "https://huggingface.co/ultralytics/assets/resolve/main/yolo26n-pose.onnx",
}
OUTPUT_DIR = "client/public/models"

def download_model(model_name, model_url, output_path):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f"Downloading {model_name} from {model_url}...")

    try:
        urllib.request.urlretrieve(model_url, output_path)
        file_size = os.path.getsize(output_path) / 1024 / 1024
        print(f"✓ {model_name} downloaded successfully: {output_path} ({file_size:.1f}MB)")
    except Exception as e:
        print(f"✗ Download failed: {e}")
        print("\nYou can also:")
        print("1. Export from Ultralytics: model.export(format='onnx')")
        print("2. Download from https://huggingface.co/ultralytics")
        print("3. Upload via the app's Model Library UI")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        model_name = sys.argv[1]
        if model_name in MODELS:
            download_model(model_name, MODELS[model_name], os.path.join(OUTPUT_DIR, model_name))
        else:
            print(f"Unknown model: {model_name}")
            print("Available models:", ", ".join(MODELS.keys()))
    else:
        # Download all models
        for model_name, model_url in MODELS.items():
            download_model(model_name, model_url, os.path.join(OUTPUT_DIR, model_name))
