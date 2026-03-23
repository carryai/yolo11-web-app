import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { ModelInfo } from '../../../../shared/types';
import { getAllModels, saveModel, deleteModel, DEFAULT_MODELS, getStorageUsage } from '../../services/modelStorage';
import { parseONNXModel, generateDefaultClassNames, isValidYOLOModel } from '../../services/onnxModelParser';

interface ModelLibraryProps {
  onClose: () => void;
  onLoadModel: (id: string) => void;
}

export const ModelLibrary: React.FC<ModelLibraryProps> = ({ onClose, onLoadModel }) => {
  const { currentModel, setCurrentModel } = useAppStore();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [storageInfo, setStorageInfo] = useState<{ used: number; quota: number }>({ used: 0, quota: 0 });
  const [showClassEditor, setShowClassEditor] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{
    id: string;
    name: string;
    blob: Blob;
    metadata: ModelInfo;
  } | null>(null);
  const [classNames, setClassNames] = useState<string[]>([]);
  const [newClassName, setNewClassName] = useState('');

  useEffect(() => {
    loadModels();
    loadStorageInfo();
  }, []);

  const loadModels = async () => {
    try {
      const savedModels = await getAllModels();
      console.log('Loaded from IndexedDB:', savedModels.map(m => ({ id: m.id, classes: m.classes })));
      // Combine with default models
      const allModels = [...DEFAULT_MODELS, ...savedModels.filter(m => !DEFAULT_MODELS.find(dm => dm.id === m.id))];
      console.log('All models:', allModels.map(m => ({ id: m.id, classes: m.classes })));
      setModels(allModels);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStorageInfo = async () => {
    const info = await getStorageUsage();
    setStorageInfo(info);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.name.endsWith('.onnx')) {
      alert('Please select a valid .onnx file');
      return;
    }

    setUploading(true);
    try {
      // Generate ID from filename
      const id = file.name.replace('.onnx', '').toLowerCase().replace(/[^a-z0-9]/g, '-');
      const name = file.name.replace('.onnx', '');

      // Read file as blob
      const blobObj = new Blob([await file.arrayBuffer()], { type: 'application/octet-stream' });

      // Parse ONNX model to extract metadata
      const metadata = await parseONNXModel(blobObj);

      // Validate model
      if (!isValidYOLOModel(metadata)) {
        throw new Error('Invalid YOLO model structure. Please ensure this is a valid YOLO ONNX model.');
      }

      // Check if this is a custom model (not 80 COCO classes)
      const isCustomModel = metadata.numClasses !== 80;

      if (isCustomModel) {
        // For custom models, show class editor before saving
        const defaultNames = generateDefaultClassNames(metadata.numClasses);
        setClassNames(defaultNames);
        setPendingUpload({
          id,
          name,
          blob: blobObj,
          metadata: {
            id,
            name,
            size: file.size,
            inputShape: metadata.inputShape,
            outputShape: metadata.outputShape,
            classes: defaultNames,
            isDefault: false,
            uploadDate: Date.now(),
            usageCount: 0,
            architecture: metadata.architecture,
          },
        });
        setShowClassEditor(true);
      } else {
        // For COCO models (80 classes), save directly
        const modelMetadata: ModelInfo = {
          id,
          name,
          size: file.size,
          inputShape: metadata.inputShape,
          outputShape: metadata.outputShape,
          classes: getCOCOClasses(),
          isDefault: false,
          uploadDate: Date.now(),
          usageCount: 0,
          architecture: metadata.architecture,
        };

        await saveModel(id, name, blobObj, modelMetadata);
        await loadModels();
        await loadStorageInfo();
        alert(`Model "${name}" uploaded successfully! (${metadata.numClasses} classes)`);
      }
    } catch (error) {
      console.error('Failed to upload model:', error);
      alert(`Failed to upload model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveClasses = async () => {
    if (!pendingUpload) return;

    try {
      // Update metadata with custom class names
      const updatedMetadata: ModelInfo = {
        ...pendingUpload.metadata,
        classes: classNames,
      };

      await saveModel(pendingUpload.id, pendingUpload.name, pendingUpload.blob, updatedMetadata);
      await loadModels();
      await loadStorageInfo();
      setShowClassEditor(false);
      setPendingUpload(null);
      alert(`Model "${pendingUpload.name}" uploaded successfully with ${classNames.length} classes!`);
    } catch (error) {
      console.error('Failed to save model:', error);
      alert(`Failed to save model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleAddClass = () => {
    if (newClassName.trim()) {
      setClassNames([...classNames, newClassName.trim()]);
      setNewClassName('');
    }
  };

  const handleRemoveClass = (index: number) => {
    setClassNames(classNames.filter((_, i) => i !== index));
  };

  const handleImportClasses = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const classes = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

      if (classes.length !== pendingUpload?.metadata.classes.length) {
        alert(`Warning: File contains ${classes.length} classes, but model expects ${pendingUpload?.metadata.classes.length} classes.`);
      }

      setClassNames(classes);
    } catch (error) {
      alert('Failed to import classes: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handleExportClasses = () => {
    const content = classNames.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pendingUpload?.name || 'classes'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (modelId: string) => {
    if (DEFAULT_MODELS.find(m => m.id === modelId)) {
      alert('Cannot delete default models');
      return;
    }

    if (!confirm('Are you sure you want to delete this model?')) return;

    try {
      await deleteModel(modelId);
      await loadModels();
      await loadStorageInfo();
      
      if (currentModel?.id === modelId) {
        setCurrentModel(null);
      }
    } catch (error) {
      console.error('Failed to delete model:', error);
    }
  };

  const handleLoad = (modelId: string) => {
    onLoadModel(modelId);
    onClose();
  };

  const storagePercent = storageInfo.quota > 0 ? (storageInfo.used / storageInfo.quota * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-bg-secondary rounded-xl border border-border-color w-full max-w-2xl p-6 max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Model Library</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-2xl">
            ×
          </button>
        </div>

        {/* Storage Info */}
        <div className="mb-4 p-3 bg-bg-tertiary rounded-lg">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-text-secondary">Storage Used</span>
            <span>{(storageInfo.used / 1024 / 1024).toFixed(1)}MB / {(storageInfo.quota / 1024 / 1024).toFixed(0)}MB</span>
          </div>
          <div className="w-full bg-bg-secondary rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all ${storagePercent > 80 ? 'bg-accent-red' : 'bg-accent-blue'}`}
              style={{ width: `${Math.min(storagePercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Upload Button */}
        <div className="mb-4">
          <label className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
            uploading ? 'border-accent-blue bg-bg-tertiary' : 'border-border-color hover:border-accent-blue'
          }`}>
            <input
              type="file"
              accept=".onnx"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading}
            />
            {uploading ? (
              <span className="text-accent-blue">⏳ Uploading...</span>
            ) : (
              <>
                <span className="text-2xl">📁</span>
                <span>Drop ONNX model file here or click to upload</span>
              </>
            )}
          </label>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {loading ? (
            <div className="text-center text-text-secondary py-8">Loading models...</div>
          ) : (
            models.map((model) => (
              <div
                key={model.id}
                className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                  currentModel?.id === model.id
                    ? 'bg-accent-blue/10 border-accent-blue'
                    : 'bg-bg-tertiary border-border-color hover:border-accent-blue'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{model.name}</span>
                    {model.isDefault && (
                      <span className="text-xs bg-accent-green/20 text-accent-green px-2 py-0.5 rounded">Default</span>
                    )}
                    {currentModel?.id === model.id && (
                      <span className="text-xs bg-accent-blue/20 text-accent-blue px-2 py-0.5 rounded">Active</span>
                    )}
                  </div>
                  <div className="text-sm text-text-secondary mt-1">
                    {model.classes.length} classes • {(model.size / 1024 / 1024).toFixed(1)}MB
                    {model.uploadDate && ` • Uploaded ${new Date(model.uploadDate).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleLoad(model.id)}
                    disabled={currentModel?.id === model.id}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      currentModel?.id === model.id
                        ? 'bg-bg-secondary text-text-secondary cursor-not-allowed'
                        : 'bg-accent-blue text-white hover:bg-blue-600'
                    }`}
                  >
                    {currentModel?.id === model.id ? 'Loaded' : 'Load'}
                  </button>
                  {!model.isDefault && (
                    <button
                      onClick={() => handleDelete(model.id)}
                      className="px-3 py-2 bg-accent-red/20 text-accent-red rounded-lg hover:bg-accent-red/30 transition-colors"
                    >
                      🗑
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Class Editor Modal for Custom Models */}
      {showClassEditor && pendingUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowClassEditor(false)}>
          <div
            className="bg-bg-secondary rounded-xl border border-border-color w-full max-w-3xl p-6 max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Configure Class Names for "{pendingUpload.name}"</h3>
              <button onClick={() => setShowClassEditor(false)} className="text-text-secondary hover:text-text-primary text-2xl">
                ×
              </button>
            </div>

            <div className="mb-4 p-3 bg-bg-tertiary rounded-lg">
              <p className="text-sm text-text-secondary">
                Model detected: <strong>{pendingUpload.metadata.architecture || 'Custom YOLO'}</strong> with <strong>{pendingUpload.metadata.classes.length}</strong> classes.
                <br />
                Enter class names below (one per line or add individually):
              </p>
            </div>

            {/* Import/Export Buttons */}
            <div className="flex gap-2 mb-4">
              <label className="px-3 py-2 bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-secondary cursor-pointer transition-colors text-sm">
                📥 Import Classes
                <input
                  type="file"
                  accept=".txt"
                  onChange={handleImportClasses}
                  className="hidden"
                />
              </label>
              <button
                onClick={handleExportClasses}
                className="px-3 py-2 bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-secondary transition-colors text-sm"
              >
                📤 Export Classes
              </button>
              <span className="text-sm text-text-secondary flex items-center">
                ({classNames.length} classes)
              </span>
            </div>

            {/* Class List */}
            <div className="flex-1 overflow-y-auto mb-4">
              <div className="grid grid-cols-2 gap-2">
                {classNames.map((className, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 bg-bg-tertiary rounded-lg"
                  >
                    <span className="text-sm text-text-secondary w-8">{index}.</span>
                    <span className="flex-1 text-sm">{className}</span>
                    <button
                      onClick={() => handleRemoveClass(index)}
                      className="text-text-secondary hover:text-accent-red transition-colors"
                      title="Remove class"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Add Class Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddClass()}
                placeholder="Enter class name..."
                className="flex-1 px-3 py-2 bg-bg-tertiary border border-border-color rounded-lg focus:outline-none focus:border-accent-blue"
              />
              <button
                onClick={handleAddClass}
                className="px-4 py-2 bg-accent-blue text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Add
              </button>
              <button
                onClick={handleSaveClasses}
                className="px-6 py-2 bg-accent-green text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
              >
                Save Model
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function getCOCOClasses(): string[] {
  return [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
    'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
    'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
    'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
    'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
    'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
    'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
    'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
    'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
    'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
    'toothbrush'
  ];
}
