#!/usr/bin/env python3
"""Download YOLO11n ONNX model from Hugging Face."""

import urllib.request
import os

MODEL_URL = "https://huggingface.co/ultralytics/assets/resolve/main/yolo11n.onnx"
OUTPUT_PATH = "client/public/models/yolo11n.onnx"

def download_model():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    
    print(f"Downloading YOLO11n model from {MODEL_URL}...")
    
    try:
        urllib.request.urlretrieve(MODEL_URL, OUTPUT_PATH)
        file_size = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
        print(f"✓ Model downloaded successfully: {OUTPUT_PATH} ({file_size:.1f}MB)")
    except Exception as e:
        print(f"✗ Download failed: {e}")
        print("\nYou can also:")
        print("1. Export from Ultralytics: model.export(format='onnx')")
        print("2. Download from https://huggingface.co/ultralytics")
        print("3. Upload via the app's Model Library UI")

if __name__ == "__main__":
    download_model()
