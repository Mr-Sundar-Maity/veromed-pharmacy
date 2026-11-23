import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, RotateCcw, Upload, X } from 'lucide-react';

interface CameraPrescriptionModalProps {
  open: boolean;
  uploading: boolean;
  onClose: () => void;
  onCaptureFile: (file: File) => Promise<void>;
}

export const CameraPrescriptionModal: React.FC<CameraPrescriptionModalProps> = ({
  open,
  uploading,
  onClose,
  onCaptureFile,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraState, setCameraState] = useState<'initializing' | 'live' | 'captured' | 'unavailable'>('initializing');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);

  function stopStream() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function startCamera() {
    stopStream();
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
      setCapturedUrl(null);
    }
    setCapturedFile(null);
    setCameraError(null);
    setCameraState('initializing');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      setCameraError('Live camera streaming is not supported in this browser environment. Use camera file capture below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraState('live');
    } catch (err) {
      setCameraState('unavailable');
      setCameraError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera permission was denied. You can still take or select a prescription photo using device photo capture below.'
          : 'No live camera hardware was detected. Use device camera capture or choose a prescription photo below.'
      );
    }
  }

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }
    void startCamera();
    return () => {
      stopStream();
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    };
  }, [capturedUrl]);

  if (!open) return null;

  function handleSnapPhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = new File([blob], `prescription_camera_${stamp}.jpg`, { type: 'image/jpeg' });
        const preview = URL.createObjectURL(blob);
        stopStream();
        setCapturedUrl(preview);
        setCapturedFile(file);
        setCameraState('captured');
      },
      'image/jpeg',
      0.92
    );
  }

  function handleFallbackFilePicked(file: File) {
    stopStream();
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(URL.createObjectURL(file));
    setCapturedFile(file);
    setCameraError(null);
    setCameraState('captured');
  }

  async function handleConfirmAnalyze() {
    if (!capturedFile) return;
    await onCaptureFile(capturedFile);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-rx-title"
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 id="camera-rx-title" className="font-display text-base font-bold text-slate-900">
                Scan Prescription with Camera
              </h2>
              <p className="text-xs text-slate-600 truncate">
                Take a clear picture of your prescription for AI medicine extraction &amp; pharmacy availability matching
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close camera scanner"
            disabled={uploading}
            onClick={() => {
              stopStream();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Viewfinder / Captured Preview */}
          <div className="relative bg-slate-900 rounded-xl overflow-hidden aspect-[4/3] flex items-center justify-center">
            {cameraState === 'captured' && capturedUrl ? (
              <img
                src={capturedUrl}
                alt="Captured prescription preview"
                className="w-full h-full object-contain bg-slate-950"
              />
            ) : cameraState === 'unavailable' ? (
              <div className="p-6 text-center max-w-md space-y-3 text-slate-200">
                <Camera className="w-10 h-10 text-teal-400 mx-auto" />
                <p className="text-sm font-semibold text-white">Camera Device Fallback</p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {cameraError}
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" />
                  <span>Take Photo / Select Prescription Image</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFallbackFilePicked(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {/* Prescription Alignment Frame Guide */}
                <div className="pointer-events-none absolute inset-6 border-2 border-dashed border-white/60 rounded-lg flex items-end justify-center p-2">
                  <span className="bg-slate-950/75 text-white text-[11px] font-medium px-2.5 py-1 rounded">
                    Align prescription text inside frame before capturing
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Modal Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Or choose photo from device</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFallbackFilePicked(file);
                  e.target.value = '';
                }}
              />
            </label>

            <div className="flex items-center gap-2">
              {cameraState === 'captured' ? (
                <>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => void startCamera()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retake</span>
                  </button>
                  <button
                    type="button"
                    disabled={uploading || !capturedFile}
                    onClick={() => void handleConfirmAnalyze()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {uploading
                        ? 'Finding Medicines & Pharmacies...'
                        : 'Find Medicines & Suggest Pharmacies'}
                    </span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={cameraState !== 'live'}
                  onClick={handleSnapPhoto}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Camera className="w-4 h-4" />
                  <span>Capture Photo</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
