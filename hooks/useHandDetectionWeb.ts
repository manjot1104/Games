/**
 * Web version of hand detection using MediaPipe Hand Landmarker
 * Tracks finger tip positions for tracing games
 */

import { useEffect, useRef, useState } from 'react';

export interface HandLandmarks {
  indexFingerTip: { x: number; y: number } | null;
  middleFingerTip: { x: number; y: number } | null;
  ringFingerTip: { x: number; y: number } | null;
  pinkyFingerTip: { x: number; y: number } | null;
  thumbTip: { x: number; y: number } | null;
  allLandmarks?: Array<{ 
    index: number; 
    name: string; 
    x: number; 
    y: number; 
    z: number;
  }>; // All 21 landmarks with names and coordinates (x, y, z)
}

export interface HandDetectionResult {
  handPosition: { x: number; y: number } | null; // Screen coordinates of finger tip
  isDetecting: boolean;
  hasCamera: boolean;
  error?: string;
  previewContainerId?: string;
  landmarks?: HandLandmarks | null;
}

// Constants for hand detection
const EMA_ALPHA = 0.3; // Smoothing factor for hand position
const THROTTLE_MS = 80; // ~12 fps

/**
 * Get human-readable name for landmark index
 * MediaPipe Hand Landmarks has 21 landmarks per hand
 */
function getLandmarkName(index: number): string {
  const names: { [key: number]: string } = {
    0: 'WRIST',
    1: 'THUMB_CMC', // Thumb carpometacarpal joint
    2: 'THUMB_MCP', // Thumb metacarpophalangeal joint
    3: 'THUMB_IP',  // Thumb interphalangeal joint
    4: 'THUMB_TIP',
    5: 'INDEX_FINGER_MCP', // Index finger metacarpophalangeal joint
    6: 'INDEX_FINGER_PIP', // Index finger proximal interphalangeal joint
    7: 'INDEX_FINGER_DIP', // Index finger distal interphalangeal joint
    8: 'INDEX_FINGER_TIP',
    9: 'MIDDLE_FINGER_MCP',
    10: 'MIDDLE_FINGER_PIP',
    11: 'MIDDLE_FINGER_DIP',
    12: 'MIDDLE_FINGER_TIP',
    13: 'RING_FINGER_MCP',
    14: 'RING_FINGER_PIP',
    15: 'RING_FINGER_DIP',
    16: 'RING_FINGER_TIP',
    17: 'PINKY_MCP',
    18: 'PINKY_PIP',
    19: 'PINKY_DIP',
    20: 'PINKY_TIP',
  };
  return names[index] || `UNKNOWN_${index}`;
}

// MediaPipe types - dynamic import to avoid issues in non-web environments
let HandLandmarker: any = null;
let FilesetResolver: any = null;

let handLandmarker: any = null;
let isInitialized = false;

/**
 * Load MediaPipe library dynamically
 */
async function loadMediaPipeLibrary(): Promise<boolean> {
  if (HandLandmarker && FilesetResolver) {
    return true;
  }

  try {
    if (typeof window === 'undefined') {
      return false;
    }

    // Dynamic import for web only
    const mediapipeModule = await import('@mediapipe/tasks-vision');
    HandLandmarker = mediapipeModule.HandLandmarker;
    FilesetResolver = mediapipeModule.FilesetResolver;

    if (!HandLandmarker || !FilesetResolver) {
      console.error('MediaPipe modules not found in package');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to load MediaPipe library:', error);
    return false;
  }
}

/**
 * Initialize MediaPipe Hand Landmarker
 */
async function initializeHandLandmarker(): Promise<boolean> {
  if (isInitialized && handLandmarker) {
    return true;
  }

  try {
    if (typeof window === 'undefined') {
      console.warn('Hand detection only works in browser environment');
      return false;
    }

    // Load MediaPipe library first
    const libraryLoaded = await loadMediaPipeLibrary();
    if (!libraryLoaded) {
      console.error('Failed to load MediaPipe library');
      return false;
    }

    // Initialize MediaPipe FilesetResolver
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );

    // Try GPU first, fallback to CPU if GPU fails
    let delegate = 'GPU';
    try {
      // Create Hand Landmarker with GPU
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2, // Track up to 2 hands (more flexible)
        minHandDetectionConfidence: 0.1, // Very low threshold for easier detection
        minHandPresenceConfidence: 0.1, // Very low threshold for easier detection
        minTrackingConfidence: 0.1, // Very low threshold for easier detection
      });

      isInitialized = true;
      console.log('✅ Hand Landmarker initialized successfully with GPU');
      return true;
    } catch (gpuError) {
      console.warn('⚠️ GPU initialization failed, trying CPU fallback:', gpuError);
      delegate = 'CPU';
      
      try {
        // Fallback to CPU
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.1,
          minHandPresenceConfidence: 0.1,
          minTrackingConfidence: 0.1,
        });

        isInitialized = true;
        console.log('✅ Hand Landmarker initialized successfully with CPU fallback');
        return true;
      } catch (cpuError) {
        console.error('❌ Both GPU and CPU initialization failed:', cpuError);
        throw cpuError; // Re-throw to be caught by outer catch
      }
    }
  } catch (error) {
    console.error('❌ Failed to initialize hand landmarker:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message, error.stack);
      // Provide more specific error messages
      if (error.message.includes('network') || error.message.includes('fetch')) {
        console.error('💡 Network error: Check internet connection and CDN accessibility');
      } else if (error.message.includes('GPU') || error.message.includes('WebGL')) {
        console.error('💡 GPU error: GPU acceleration not available, CPU fallback should have been used');
      } else if (error.message.includes('WASM')) {
        console.error('💡 WASM error: MediaPipe WASM files may not be loading correctly');
      }
    }
    return false;
  }
}

/**
 * Process video frame and detect hand landmarks
 */
async function processFrame(
  videoElement: HTMLVideoElement | HTMLCanvasElement,
  emaX: React.MutableRefObject<number>,
  emaY: React.MutableRefObject<number>
): Promise<{ 
  handPosition: { x: number; y: number } | null;
  landmarks?: HandLandmarks;
} | null> {
  if (!handLandmarker || !videoElement) {
    return null;
  }

  try {
    // Check if video is ready
    if (videoElement instanceof HTMLVideoElement) {
      if (videoElement.readyState < 2) {
        return null;
      }
      // Ensure video has valid dimensions
      if (!videoElement.videoWidth || !videoElement.videoHeight) {
        console.warn('⚠️ Video element has no dimensions:', {
          videoWidth: videoElement.videoWidth,
          videoHeight: videoElement.videoHeight,
          readyState: videoElement.readyState
        });
        return null;
      }
    }

    const timestamp = performance.now();
    
    // Create ImageData from video frame
    let imageData: ImageData;
    let width: number;
    let height: number;
    
    if (videoElement instanceof HTMLVideoElement) {
      width = videoElement.videoWidth;
      height = videoElement.videoHeight;
      
      // Validate video dimensions before proceeding
      if (!width || !height || width === 0 || height === 0) {
        if (Math.random() < 0.1) { // Log occasionally
          console.warn('⚠️ Video has invalid dimensions, waiting for video to load...', {
            videoWidth: videoElement.videoWidth,
            videoHeight: videoElement.videoHeight,
            readyState: videoElement.readyState,
            clientWidth: videoElement.clientWidth,
            clientHeight: videoElement.clientHeight
          });
        }
        return null;
      }
      
      // Ensure video is actually playing and has frames
      if (videoElement.paused || videoElement.ended) {
        if (Math.random() < 0.1) { // Log occasionally
          console.warn('⚠️ Video is paused or ended, attempting to play...', {
            paused: videoElement.paused,
            ended: videoElement.ended,
            readyState: videoElement.readyState
          });
        }
        videoElement.play().catch(err => console.warn('Failed to play:', err));
        return null;
      }
      
      // Create canvas to extract frame
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(videoElement, 0, 0, width, height);
      imageData = ctx.getImageData(0, 0, width, height);
      
      // Validate that we got actual image data (not just black frames)
      if (imageData && imageData.data) {
        // Check if frame has any non-zero pixels (basic validation - skip alpha channel)
        let hasContent = false;
        let pixelCount = 0;
        let nonBlackPixels = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
          pixelCount++;
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          // Check if pixel is not black (allow some threshold for noise)
          if (r > 10 || g > 10 || b > 10) {
            hasContent = true;
            nonBlackPixels++;
          }
        }
        
        // Log frame statistics occasionally to verify camera is working
        if (Math.random() < 0.1) { // Log ~10% of frames
          const contentPercent = (nonBlackPixels / pixelCount) * 100;
          console.log('📸 Frame content check:', {
            totalPixels: pixelCount,
            nonBlackPixels,
            contentPercent: contentPercent.toFixed(2) + '%',
            hasContent,
            videoWidth: videoElement.videoWidth,
            videoHeight: videoElement.videoHeight,
            readyState: videoElement.readyState
          });
        }
        
        if (!hasContent) {
          if (Math.random() < 0.2) { // Log more frequently if black
            console.warn('⚠️ Frame appears to be empty/black - camera may not be working');
          }
          // Don't return null here - let MediaPipe try anyway, it might still work
        }
      }
    } else {
      width = videoElement.width;
      height = videoElement.height;
      
      // Validate canvas dimensions before proceeding
      if (!width || !height || width === 0 || height === 0) {
        if (Math.random() < 0.1) { // Log occasionally
          console.warn('⚠️ Canvas has invalid dimensions:', {
            width: videoElement.width,
            height: videoElement.height
          });
        }
        return null;
      }
      
      const ctx = videoElement.getContext('2d');
      if (!ctx) return null;
      imageData = ctx.getImageData(0, 0, width, height);
    }

    // Validate imageData before processing
    if (!imageData || imageData.width === 0 || imageData.height === 0 || !imageData.data) {
      console.warn('⚠️ Invalid imageData:', {
        hasImageData: !!imageData,
        width: imageData?.width,
        height: imageData?.height,
        hasData: !!imageData?.data
      });
      return null;
    }
    
    // Validate MediaPipe is ready
    if (!handLandmarker || typeof handLandmarker.detectForVideo !== 'function') {
      console.warn('⚠️ HandLandmarker not ready:', {
        hasHandLandmarker: !!handLandmarker,
        hasDetectForVideo: handLandmarker && typeof handLandmarker.detectForVideo === 'function'
      });
      return null;
    }
    
    let result;
    try {
      // MediaPipe HandLandmarker.detectForVideo accepts ImageData directly (same as FaceLandmarker)
      console.log('🔍 Calling detectForVideo with ImageData, timestamp:', timestamp, 'dimensions:', width, 'x', height);
      result = handLandmarker.detectForVideo(imageData, timestamp);
      
      // Debug: Log full result structure to understand what MediaPipe returns
      // Always log when we have a result to debug the structure
      if (result) {
        const resultKeys = Object.keys(result);
        console.log('📊 Full detection result structure:', {
          hasResult: !!result,
          resultKeys: resultKeys,
          hasLandmarks: !!(result && result.landmarks),
          landmarksType: result?.landmarks ? typeof result.landmarks : 'none',
          landmarksIsArray: Array.isArray(result?.landmarks),
          landmarksLength: result?.landmarks?.length || 0,
          landmarksContent: result?.landmarks?.[0] ? 'has content' : 'empty',
        });
        
        // Log each property in detail
        resultKeys.forEach(key => {
          const value = (result as any)[key];
          console.log(`  🔑 ${key}:`, {
            type: typeof value,
            isArray: Array.isArray(value),
            length: Array.isArray(value) ? value.length : 'N/A',
            hasContent: Array.isArray(value) && value.length > 0 ? 'yes' : 'no',
            firstItem: Array.isArray(value) && value.length > 0 ? value[0] : 'N/A'
          });
        });
        
        // Also check for alternative property names
        if (result.landmarks && result.landmarks.length === 0) {
          console.log('🔍 Checking for alternative landmark properties...');
          const altNames = ['landmarkLists', 'handLandmarks', 'hands', 'detections', 'handedness'];
          altNames.forEach(name => {
            if ((result as any)[name]) {
              const val = (result as any)[name];
              console.log(`  ✅ Found ${name}:`, {
                type: typeof val,
                isArray: Array.isArray(val),
                length: Array.isArray(val) ? val.length : 'N/A',
                content: Array.isArray(val) && val.length > 0 ? val[0] : val
              });
            }
          });
        }
      }
      
      console.log('📊 Detection result:', {
        hasResult: !!result,
        hasLandmarks: !!(result && result.landmarks),
        landmarksCount: result?.landmarks?.length || 0
      });
    } catch (detectError) {
      // MediaPipe can throw errors during processing - handle gracefully
      console.error('❌ MediaPipe detection error:', detectError);
      if (detectError instanceof Error) {
        console.error('Error message:', detectError.message);
        console.error('Error stack:', detectError.stack);
      }
      return null;
    }
    
    if (!result) {
      console.warn('⚠️ No detection result returned');
      return null;
    }
    
    // MediaPipe HandLandmarker returns result.landmarks as an array of hands
    // Each hand has an array of 21 landmarks
    let landmarks = result.landmarks;
    
    // Check for alternative property names (some MediaPipe versions use different names)
    if (!landmarks || (Array.isArray(landmarks) && landmarks.length === 0)) {
      // Try alternative property names
      if ((result as any).landmarkLists) {
        landmarks = (result as any).landmarkLists;
        console.log('📋 Using landmarkLists property');
      }
      if ((!landmarks || landmarks.length === 0) && (result as any).handLandmarks) {
        landmarks = (result as any).handLandmarks;
        console.log('📋 Using handLandmarks property');
      }
    }
    
    if (!landmarks) {
      console.warn('⚠️ Result has no landmarks property:', {
        resultKeys: Object.keys(result),
        resultType: typeof result,
        resultString: JSON.stringify(result).substring(0, 500)
      });
      return null;
    }
    
    if (!Array.isArray(landmarks)) {
      console.warn('⚠️ Landmarks is not an array:', {
        type: typeof landmarks,
        value: landmarks,
        resultKeys: Object.keys(result)
      });
      return null;
    }
    
    if (landmarks.length === 0) {
      // This is expected when no hand is detected - MediaPipe returns empty array
      // Log more frequently to help debug
      if (Math.random() < 0.2) { // Log ~20% of the time
        console.log('⏳ No hands detected in frame (MediaPipe returned empty landmarks array)');
        console.log('💡 Tips: Ensure hand is visible, good lighting, clear background');
      }
      return null;
    }
    
    console.log('✅ Landmarks detected! Count:', landmarks.length);

    const handLandmarks = landmarks[0];
    if (!handLandmarks || !Array.isArray(handLandmarks)) {
      console.warn('⚠️ Invalid landmarks structure:', handLandmarks);
      return null;
    }
    
    // Log all 21 landmarks with their indices
    console.log('👋 All 21 Hand Landmarks:');
    handLandmarks.forEach((landmark: any, index: number) => {
      console.log(`  Landmark ${index}:`, {
        x: landmark.x,
        y: landmark.y,
        z: landmark.z || 'N/A', // z coordinate (depth)
        name: getLandmarkName(index)
      });
    });
    
    // Also log as a complete array for easy access
    const allLandmarksArray = handLandmarks.map((lm: any, idx: number) => ({
      index: idx,
      name: getLandmarkName(idx),
      x: lm.x,
      y: lm.y,
      z: lm.z || 0
    }));
    console.log('📋 Complete landmarks array:', allLandmarksArray);
    
    // MediaPipe Hand Landmarks has 21 landmarks per hand
    // Key finger tip landmarks:
    // - Landmark 4: Thumb tip
    // - Landmark 8: Index finger tip (primary)
    // - Landmark 12: Middle finger tip
    // - Landmark 16: Ring finger tip
    // - Landmark 20: Pinky finger tip
    
    // Extract finger tip positions (normalized coordinates 0-1)
    const indexFingerTip = handLandmarks[8] ? { x: handLandmarks[8].x, y: handLandmarks[8].y } : null;
    const middleFingerTip = handLandmarks[12] ? { x: handLandmarks[12].x, y: handLandmarks[12].y } : null;
    const ringFingerTip = handLandmarks[16] ? { x: handLandmarks[16].x, y: handLandmarks[16].y } : null;
    const pinkyFingerTip = handLandmarks[20] ? { x: handLandmarks[20].x, y: handLandmarks[20].y } : null;
    const thumbTip = handLandmarks[4] ? { x: handLandmarks[4].x, y: handLandmarks[4].y } : null;

    console.log('🖐️ Finger tip positions:', {
      indexFingerTip,
      middleFingerTip,
      ringFingerTip,
      pinkyFingerTip,
      thumbTip,
      landmark8: landmarks[8],
      landmark12: landmarks[12],
      landmark16: landmarks[16],
      landmark20: landmarks[20],
      landmark4: landmarks[4]
    });

    // Prioritize index finger, fallback to any detected finger tip
    const fingerTip = indexFingerTip || middleFingerTip || ringFingerTip || pinkyFingerTip || thumbTip;

    if (!fingerTip) {
      console.warn('⚠️ No finger tip found in landmarks');
      return null;
    }
    
    console.log('✅ Using finger tip:', fingerTip);

    // Apply EMA smoothing to reduce jitter
    const smoothedX = emaX.current === 0 
      ? fingerTip.x 
      : EMA_ALPHA * fingerTip.x + (1 - EMA_ALPHA) * emaX.current;
    const smoothedY = emaY.current === 0 
      ? fingerTip.y 
      : EMA_ALPHA * fingerTip.y + (1 - EMA_ALPHA) * emaY.current;
    
    emaX.current = smoothedX;
    emaY.current = smoothedY;

    // Map all 21 landmarks with x, y, z coordinates
    const allLandmarksMapped = handLandmarks.map((lm: any, idx: number) => ({
      index: idx,
      name: getLandmarkName(idx),
      x: lm.x,
      y: lm.y,
      z: lm.z || 0, // Include z coordinate (depth)
    }));

    return {
      handPosition: { x: smoothedX, y: smoothedY }, // Normalized coordinates (0-1)
      landmarks: {
        indexFingerTip,
        middleFingerTip,
        ringFingerTip,
        pinkyFingerTip,
        thumbTip,
        allLandmarks: allLandmarksMapped, // All 21 landmarks with names and coordinates
      },
    };
  } catch (error) {
    console.warn('Frame processing error (non-critical):', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Web version of hand detection hook using MediaPipe
 */
export function useHandDetectionWeb(
  isActive: boolean = true
): HandDetectionResult {
  const [handPosition, setHandPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [hasCamera, setHasCamera] = useState(false);
  const [landmarks, setLandmarks] = useState<HandLandmarks | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const emaX = useRef(0);
  const emaY = useRef(0);
  const lastTimestamp = useRef(0);
  const processingIntervalRef = useRef<number | null>(null);
  const previewContainerId = 'hand-preview-container';

  // Initialize MediaPipe - always initialize on web, not dependent on isActive
  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('🚀 Initializing Hand Landmarker...');
      initializeHandLandmarker()
        .then((success) => {
          if (success) {
            console.log('✅ Hand Landmarker initialization complete');
          } else {
            console.error('❌ Hand Landmarker initialization failed');
            setError('Failed to initialize hand detection');
          }
        })
        .catch((err) => {
          console.error('❌ Failed to initialize hand landmarker:', err);
          setError('Failed to initialize hand detection');
        });
    }
  }, []); // Run once on mount

  // Setup webcam - always setup on web, not dependent on isActive
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const setupCamera = async () => {
      try {
        // First, stop any existing camera streams to prevent "device in use" error
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => {
            track.stop();
          });
          streamRef.current = null;
        }
        
        // Also check for any video elements that might have active streams
        const existingVideos = document.querySelectorAll('video');
        existingVideos.forEach(video => {
          if (video.srcObject) {
            const stream = video.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            video.srcObject = null;
          }
        });

        // Request camera permission
        console.log('📹 Requesting camera access...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 }
        });
        streamRef.current = stream;
        setHasCamera(true);
        setError(undefined); // Clear any previous errors
        console.log('✅ Camera access granted, stream:', stream);

        // Create video element for processing
        // Note: Some browsers/MediaPipe may require video to be visible (even if tiny)
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true; // Mute to avoid feedback
        // Make video visible but very small (some browsers require visibility for MediaPipe)
        video.style.position = 'fixed';
        video.style.top = '0';
        video.style.left = '0';
        video.style.width = '160px'; // Small but visible
        video.style.height = '120px';
        video.style.opacity = '0.01'; // Nearly invisible but technically visible
        video.style.pointerEvents = 'none';
        video.style.zIndex = '-1';
        video.setAttribute('playsinline', 'true');
        document.body.appendChild(video);
        
        // Set videoRef immediately so frame processing can find it
        videoRef.current = video;
        console.log('📹 Video element created and assigned to videoRef');

        video.addEventListener('loadedmetadata', () => {
          console.log('📹 Video metadata loaded:', {
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            readyState: video.readyState
          });
          video.play().catch(err => {
            console.warn('Failed to play processing video:', err);
          });
        });

        // Also wait for video to start playing
        video.addEventListener('playing', () => {
          console.log('✅ Processing video is playing, ready for hand detection', {
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            readyState: video.readyState,
            paused: video.paused,
            ended: video.ended
          });
          
          // Test: Draw a frame to canvas to verify video has content
          setTimeout(() => {
            const testCanvas = document.createElement('canvas');
            testCanvas.width = video.videoWidth;
            testCanvas.height = video.videoHeight;
            const testCtx = testCanvas.getContext('2d');
            if (testCtx) {
              testCtx.drawImage(video, 0, 0);
              const testImageData = testCtx.getImageData(0, 0, testCanvas.width, testCanvas.height);
              let hasContent = false;
              for (let i = 0; i < testImageData.data.length; i += 4) {
                if (testImageData.data[i] > 10 || testImageData.data[i + 1] > 10 || testImageData.data[i + 2] > 10) {
                  hasContent = true;
                  break;
                }
              }
              console.log('📹 Video content test:', {
                hasContent,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight,
                streamActive: stream.active,
                streamTracks: stream.getTracks().length
              });
            }
          }, 1000);
        });

        // Add error handler
        video.addEventListener('error', (e) => {
          console.error('❌ Processing video error:', e);
        });
        
        // Monitor video stream
        stream.getTracks().forEach(track => {
          console.log('📹 Video track:', {
            kind: track.kind,
            enabled: track.enabled,
            readyState: track.readyState,
            settings: track.getSettings()
          });
          
          track.addEventListener('ended', () => {
            console.warn('⚠️ Video track ended');
          });
        });

        // Check if preview video already exists to avoid duplicates
        let previewVideo = document.querySelector(`video[data-hand-preview-video]`) as HTMLVideoElement;
        
        if (!previewVideo) {
          // Create preview video element and inject into container
          previewVideo = document.createElement('video');
          previewVideo.setAttribute('data-hand-preview-video', 'true');
        }
        
        previewVideo.srcObject = stream;
        previewVideo.autoplay = true;
        previewVideo.playsInline = true;
        previewVideo.muted = true;
        previewVideo.style.width = '100%';
        previewVideo.style.height = '100%';
        previewVideo.style.objectFit = 'contain';

        // Find or create preview container
        let container = document.getElementById(previewContainerId) as HTMLElement;
        if (!container) {
          // Try to find by data attribute
          container = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
        }
        if (!container) {
          // Try backup ID
          container = document.querySelector(`[data-native-id-backup="${previewContainerId}"]`) as HTMLElement;
        }

        if (container) {
          // Check if video already exists in container to avoid duplicates
          const existingVideo = container.querySelector('video[data-hand-preview-video]') as HTMLVideoElement;
          if (existingVideo) {
            // Reuse existing video element
            existingVideo.srcObject = stream;
            existingVideo.style.display = 'block';
            existingVideo.style.visibility = 'visible';
            existingVideo.style.opacity = '1';
          } else {
            // Append video without clearing container (to avoid React conflicts)
            container.appendChild(previewVideo);
          }
          
          // Wait for video to be ready
          previewVideo.addEventListener('loadedmetadata', () => {
            previewVideo.play().catch(err => {
              console.warn('Failed to play preview video:', err);
            });
          });
        } else {
          // Container not found yet, wait a bit and try again
          setTimeout(() => {
            let retryContainer = document.getElementById(previewContainerId) as HTMLElement;
            if (!retryContainer) {
              retryContainer = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
            }
            if (!retryContainer) {
              retryContainer = document.querySelector(`[data-native-id-backup="${previewContainerId}"]`) as HTMLElement;
            }
            if (retryContainer) {
              // Check if video already exists
              const existingVideo = retryContainer.querySelector('video[data-hand-preview-video]') as HTMLVideoElement;
              if (existingVideo) {
                // Reuse existing video element
                existingVideo.srcObject = stream;
                existingVideo.style.display = 'block';
                existingVideo.style.visibility = 'visible';
                existingVideo.style.opacity = '1';
              } else {
                // Append video without clearing container
                retryContainer.appendChild(previewVideo);
              }
              previewVideo.addEventListener('loadedmetadata', () => {
                previewVideo.play().catch(err => {
                  console.warn('Failed to play preview video:', err);
                });
              });
            }
          }, 100);
        }

      } catch (err) {
        console.error('Camera setup error:', err);
        setHasCamera(false);
        if (err instanceof Error) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setError('Camera permission denied. Please allow camera access to play this game.');
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setError('No camera found. Please connect a camera to play this game.');
          } else {
            setError(`Camera error: ${err.message}`);
          }
        } else {
          setError('Failed to access camera');
        }
      }
    };

    setupCamera();

    // Cleanup on unmount
    return () => {
      if (processingIntervalRef.current) {
        clearInterval(processingIntervalRef.current);
        processingIntervalRef.current = null;
      }
      
      // Stop all tracks from the stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop();
        });
        streamRef.current = null;
      }
      
      // Clean up processing video element
      if (videoRef.current) {
        if (videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
        }
        videoRef.current.srcObject = null;
        // Use remove() instead of removeChild to avoid errors
        videoRef.current.remove();
        videoRef.current = null;
      }

      // Clean up preview video - stop streams but let React handle DOM cleanup
      const container = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
      if (container) {
        const videos = container.querySelectorAll('video');
        videos.forEach(video => {
          if (video.srcObject) {
            const stream = video.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
          }
          // Hide video instead of removing to avoid React conflicts
          (video as HTMLElement).style.display = 'none';
        });
      }
      
      // Also check for any preview videos by data attribute
      const previewVideo = document.querySelector(`video[data-hand-preview-video]`) as HTMLVideoElement;
      if (previewVideo && previewVideo.srcObject) {
        const stream = previewVideo.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        previewVideo.srcObject = null;
        // Hide instead of removing
        previewVideo.style.display = 'none';
      }
      
      setHasCamera(false);
    };
  }, []); // Run once on mount

  // Process frames when active
  useEffect(() => {
    console.log('🔄 Frame processing useEffect triggered:', {
      isActive,
      hasVideoRef: !!videoRef.current,
      isInitialized,
      hasCamera,
      videoReadyState: videoRef.current instanceof HTMLVideoElement ? videoRef.current.readyState : 'N/A',
      videoWidth: videoRef.current instanceof HTMLVideoElement ? videoRef.current.videoWidth : 'N/A',
      videoHeight: videoRef.current instanceof HTMLVideoElement ? videoRef.current.videoHeight : 'N/A'
    });
    
    if (!isActive) {
      console.log('⏸️ Frame processing paused: isActive is false');
      return;
    }
    
    if (!hasCamera) {
      console.log('⏸️ Frame processing paused: hasCamera is false');
      return;
    }
    
    if (!videoRef.current) {
      console.log('⏸️ Frame processing paused: videoRef.current is null - waiting for video element...');
      // Retry after a short delay
      const retryTimeout = setTimeout(() => {
        if (videoRef.current) {
          console.log('✅ Video element found after retry');
        }
      }, 1000);
      return () => clearTimeout(retryTimeout);
    }

    const processFrames = async () => {
      try {
        if (!videoRef.current) {
          console.warn('⚠️ processFrames: videoRef.current is null');
          return;
        }
        
        if (!isActive) {
          return;
        }
        
        if (!isInitialized) {
          console.warn('⚠️ processFrames: MediaPipe not initialized yet');
          return;
        }

        // Check video readiness
        if (videoRef.current instanceof HTMLVideoElement) {
          if (videoRef.current.readyState < 2) {
            if (Math.random() < 0.05) { // Log occasionally
              console.warn('⚠️ Video not ready, readyState:', videoRef.current.readyState);
            }
            return;
          }
          if (!videoRef.current.videoWidth || !videoRef.current.videoHeight) {
            if (Math.random() < 0.05) { // Log occasionally
              console.warn('⚠️ Video has no dimensions');
            }
            return;
          }
        }

        const now = Date.now();
        if (now - lastTimestamp.current < THROTTLE_MS) {
          return;
        }
        lastTimestamp.current = now;

        console.log('🎬 Processing frame...', {
          timestamp: now,
          videoWidth: videoRef.current instanceof HTMLVideoElement ? videoRef.current.videoWidth : 'N/A',
          videoHeight: videoRef.current instanceof HTMLVideoElement ? videoRef.current.videoHeight : 'N/A',
          readyState: videoRef.current instanceof HTMLVideoElement ? videoRef.current.readyState : 'N/A'
        });
        
        const result = await processFrame(videoRef.current, emaX, emaY);
        
        if (result && result.handPosition) {
          console.log('✅ Hand detected! Position:', result.handPosition, 'Landmarks:', result.landmarks);
          setIsDetecting(true);
          setHandPosition(result.handPosition);
          if (result.landmarks) {
            setLandmarks(result.landmarks);
          }
        } else {
          // Only log occasionally to avoid spam
          if (Math.random() < 0.1) { // Log ~10% of the time
            console.log('⏳ No hand detected in this frame');
          }
          setIsDetecting(false);
          setHandPosition(null);
          setLandmarks(null);
          // Reset EMA when hand is lost
          emaX.current = 0;
          emaY.current = 0;
        }
      } catch (error) {
        // Log frame processing errors
        console.error('❌ Frame processing error:', error instanceof Error ? error.message : 'Unknown error', error);
        setIsDetecting(false);
        setHandPosition(null);
        setLandmarks(null);
      }
    };

    // Start processing frames
    const startProcessing = () => {
      if (processingIntervalRef.current) {
        clearInterval(processingIntervalRef.current);
        processingIntervalRef.current = null;
      }
      console.log('▶️ Starting frame processing interval, THROTTLE_MS:', THROTTLE_MS);
      processingIntervalRef.current = window.setInterval(processFrames, THROTTLE_MS);
      // Also try processing immediately
      console.log('🚀 Calling processFrames immediately...');
      processFrames();
    };
    startProcessing();

    // Cleanup
    return () => {
      console.log('🧹 Cleaning up frame processing interval');
      if (processingIntervalRef.current) {
        clearInterval(processingIntervalRef.current);
        processingIntervalRef.current = null;
      }
    };
  }, [isActive, isInitialized, hasCamera]);

  return {
    handPosition,
    isDetecting,
    hasCamera,
    error,
    previewContainerId,
    landmarks,
  };
}

