/**
 * Web version of jaw detection using MediaPipe Face Detection
 * Similar to the hand gesture project, but for jaw/mouth detection
 */

import { useEffect, useRef, useState } from 'react';

export interface MouthLandmarks {
  upperLip: Array<{ x: number; y: number }>;
  lowerLip: Array<{ x: number; y: number }>;
  mouthLeft: { x: number; y: number } | null;
  mouthRight: { x: number; y: number } | null;
  allMouthLandmarks?: Array<{ x: number; y: number }>; // All mouth region landmarks for visualization
}

export interface JawDetectionResult {
  isOpen: boolean;
  ratio: number;
  isDetecting: boolean;
  hasCamera: boolean;
  error?: string;
  device: any;
  frameProcessor: any;
  previewContainerId?: string; // ID for preview container on web
  landmarks?: MouthLandmarks | null; // Landmarks for visualization (web only)
  lateralPosition?: 'left' | 'center' | 'right'; // Lateral jaw position
  lateralAmount?: number; // -1 (left) to 1 (right), 0 = center
  protrusion?: number; // 0 (retracted) to 1 (protruded)
  tongueElevation?: number; // 0 (down) to 1 (up/touching roof)
  tonguePosition?: { x: number; y: number }; // Normalized tongue tip position
  isTongueVisible?: boolean; // Whether tongue is detected in mouth
  smileAmount?: number; // 0 (neutral) to 1 (big smile)
  cheekExpansion?: number; // 0 (normal) to 1 (expanded)
}

// Constants for jaw detection
// Thresholds adjusted for normalized coordinates (0-1 range from MediaPipe)
// Based on observed values: closed ~0.022-0.030, open ~0.035-0.045
const OPEN_THRESHOLD = 0.038;  // Increased to require more obvious mouth opening (prevents false positives)
const CLOSE_THRESHOLD = 0.028; // Set between closed (~0.022-0.030) and open (~0.038+) for hysteresis
const EMA_ALPHA = 0.25;
const THROTTLE_MS = 80; // ~12 fps

// MediaPipe types - dynamic import to avoid issues in non-web environments
let FaceLandmarker: any = null;
let FilesetResolver: any = null;

let faceLandmarker: any = null;
let isInitialized = false;

/**
 * Load MediaPipe library dynamically (same pattern as eye tracking)
 */
async function loadMediaPipeLibrary(): Promise<boolean> {
  if (FaceLandmarker && FilesetResolver) {
    return true;
  }

  try {
    if (typeof window === 'undefined') {
      return false;
    }

    // Dynamic import for web only (same as eye tracking)
    const mediapipeModule = await import('@mediapipe/tasks-vision');
    FaceLandmarker = mediapipeModule.FaceLandmarker;
    FilesetResolver = mediapipeModule.FilesetResolver;

    if (!FaceLandmarker || !FilesetResolver) {
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
 * Initialize MediaPipe Face Landmarker (same pattern as eye tracking)
 */
async function initializeFaceLandmarker(): Promise<boolean> {
  if (isInitialized && faceLandmarker) {
    return true;
  }

  try {
    if (typeof window === 'undefined') {
      console.warn('Jaw detection only works in browser environment');
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

    // Create Face Landmarker
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: 'GPU',
      },
      outputFaceBlendshapes: false,
      runningMode: 'VIDEO',
      numFaces: 1,
    });

    isInitialized = true;
    return true;
  } catch (error) {
    console.error('Failed to initialize face landmarker:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message, error.stack);
    }
    return false;
  }
}

/**
 * Calculate distance between two points
 */
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate mean point from array of points
 */
function meanPoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (let i = 0; i < points.length; i++) {
    sx += points[i].x;
    sy += points[i].y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Process video frame and detect jaw state
 * Similar to hand gesture project but for mouth/jaw detection
 */
// Global refs for lateral position state (shared across frames)
let globalCurrentLateralPosition: 'left' | 'center' | 'right' = 'center';

// Global baseline for cheek expansion (calibrated on first frame)
let cheekBaseline: number | null = null;
let cheekBaselineFrames = 0;
const CHEEK_CALIBRATION_FRAMES = 30; // Calibrate over first 30 frames

async function processFrame(
  videoElement: HTMLVideoElement | HTMLCanvasElement,
  ema: React.MutableRefObject<number>,
  currentIsOpen: React.MutableRefObject<boolean>,
  emaLateral?: React.MutableRefObject<number>
): Promise<{ 
  ratio: number; 
  isOpen: boolean; 
  landmarks?: MouthLandmarks;
  lateralPosition?: 'left' | 'center' | 'right';
  lateralAmount?: number;
  protrusion?: number;
  tongueElevation?: number;
  tonguePosition?: { x: number; y: number };
  isTongueVisible?: boolean;
  smileAmount?: number;
  cheekExpansion?: number;
} | null> {
  if (!faceLandmarker || !isInitialized) {
    return null;
  }

  try {
    const timestamp = performance.now();
    
    // Get image data from video element (same pattern as eye tracking)
    let imageData: ImageData;
    let width: number;
    let height: number;
    
    if (videoElement instanceof HTMLVideoElement) {
      width = videoElement.videoWidth || 640;
      height = videoElement.videoHeight || 480;
      
      // Create canvas to extract frame
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      ctx.drawImage(videoElement, 0, 0, width, height);
      imageData = ctx.getImageData(0, 0, width, height);
    } else {
      width = videoElement.width || 640;
      height = videoElement.height || 480;
      const ctx = videoElement.getContext('2d');
      if (!ctx) return null;
      imageData = ctx.getImageData(0, 0, width, height);
    }

    // Validate imageData before processing
    if (!imageData || imageData.width === 0 || imageData.height === 0 || !imageData.data) {
      return null;
    }

    // Detect face landmarks (same as eye tracking)
    // Add extra validation to prevent MediaPipe errors
    if (!faceLandmarker || typeof faceLandmarker.detectForVideo !== 'function') {
      return null;
    }
    
    let result;
    try {
      result = faceLandmarker.detectForVideo(imageData, timestamp);
    } catch (detectError) {
      // MediaPipe can throw errors during processing - handle gracefully
      // These errors are non-critical and shouldn't crash the app
      return null;
    }
    
    if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
      return null;
    }

    const landmarks = result.faceLandmarks[0];
    
    // MediaPipe Face Mesh has 468 landmarks
    // Key mouth landmarks:
    // - Upper lip top center: 13
    // - Lower lip bottom center: 14
    // - Mouth left corner: 61
    // - Mouth right corner: 291
    // - Upper lip top region: 12, 13, 14, 15 (for averaging)
    // - Lower lip bottom region: 18, 19, 20 (for averaging)
    
    // Get upper lip top points (average for stability)
    const upperLipPoints = [
      landmarks[12],
      landmarks[13],
      landmarks[14],
      landmarks[15],
    ].filter(Boolean);
    
    // Get lower lip bottom points (average for stability)
    const lowerLipPoints = [
      landmarks[18],
      landmarks[19],
      landmarks[20],
    ].filter(Boolean);
    
    // Get mouth corners
    const mouthLeft = landmarks[61];
    const mouthRight = landmarks[291];

    if (!upperLipPoints.length || !lowerLipPoints.length || !mouthLeft || !mouthRight) {
      return null;
    }

    // Calculate mean points (similar to hand gesture project's meanPoint function)
    const upperLip = meanPoint(upperLipPoints);
    const lowerLip = meanPoint(lowerLipPoints);

    // Calculate mouth width (normalization factor) - distance between corners
    const mouthWidth = dist(mouthLeft, mouthRight);
    
    // Calculate vertical gap between lips
    const gap = dist(upperLip, lowerLip);
    
    // Calculate ratio (gap / mouth width) - same as native version
    const rawRatio = gap / Math.max(1, mouthWidth);

    // Apply EMA smoothing (same as native version)
    const smoothed = ema.current === 0 
      ? rawRatio 
      : EMA_ALPHA * rawRatio + (1 - EMA_ALPHA) * ema.current;
    ema.current = smoothed;

    // Calculate jaw protrusion (forward movement)
    // Use lower face position relative to upper face
    const verticalDisplacement = lowerLip.y - (upperLip.y + 0.02); // Baseline offset
    // Normalize protrusion: 0 (retracted) to 1 (protruded)
    const protrusion = Math.max(0, Math.min(1, (verticalDisplacement + 0.05) * 10));

    // Calculate lateral position (left/right jaw movement) using MediaPipe FaceMesh
    // Use reliable landmarks that are always present: mouth corners and lower face
    // For lateral detection, we compare the position of lower face relative to face center
    
    const noseTip = landmarks[4]; // Nose tip for face center
    // Try multiple chin landmark indices as they may vary
    const chinCenter = landmarks[175] || landmarks[199] || landmarks[18] || lowerLip;
    
    // Use mouth corners and lower lip points for lateral detection
    // These are more reliable than jawline landmarks which may not always be detected
    const leftFacePoints = [
      mouthLeft, // Left mouth corner
      landmarks[61], // Left mouth area
      landmarks[78], landmarks[80], landmarks[81], landmarks[82], // Left lower face
    ].filter(Boolean);
    
    const rightFacePoints = [
      mouthRight, // Right mouth corner  
      landmarks[291], // Right mouth area
      landmarks[308], landmarks[310], landmarks[311], landmarks[312], // Right lower face
    ].filter(Boolean);
    
    let lateralPosition: 'left' | 'center' | 'right' = 'center';
    let lateralAmount = 0;
    
    // Use face center based on mouth corners (most reliable)
    const faceCenterX = (mouthLeft.x + mouthRight.x) / 2;
    
    // Method 1: Use chin position relative to face center (simple and reliable)
    if (chinCenter && noseTip) {
      const chinOffset = chinCenter.x - faceCenterX;
      // Normalize by mouth width for consistent sensitivity across face sizes
      lateralAmount = Math.max(-1, Math.min(1, (chinOffset / Math.max(0.01, mouthWidth)) * 2.5));
    } 
    // Method 2: Use asymmetry of left/right face points if available
    else if (leftFacePoints.length >= 2 && rightFacePoints.length >= 2) {
      const leftFaceCenter = meanPoint(leftFacePoints);
      const rightFaceCenter = meanPoint(rightFacePoints);
      const leftDistance = Math.abs(leftFaceCenter.x - faceCenterX);
      const rightDistance = Math.abs(rightFaceCenter.x - faceCenterX);
      const asymmetry = (rightDistance - leftDistance) / Math.max(0.01, (leftDistance + rightDistance) / 2);
      lateralAmount = Math.max(-1, Math.min(1, asymmetry * 2));
    }
    // Method 3: Fallback to lower lip position
    else {
      const lowerLipOffset = lowerLip.x - faceCenterX;
      lateralAmount = Math.max(-1, Math.min(1, (lowerLipOffset / Math.max(0.01, mouthWidth)) * 2));
    }
    
    // Apply EMA smoothing to lateral amount if emaLateral ref provided
    if (emaLateral) {
      const smoothedLateral = emaLateral.current === 0
        ? lateralAmount
        : EMA_ALPHA * lateralAmount + (1 - EMA_ALPHA) * emaLateral.current;
      emaLateral.current = smoothedLateral;
      lateralAmount = smoothedLateral;
    }
    
    // Determine position with hysteresis
    const LATERAL_LEFT_THRESHOLD = -0.12;
    const LATERAL_RIGHT_THRESHOLD = 0.12;
    const LATERAL_CENTER_THRESHOLD_LEFT = -0.08;
    const LATERAL_CENTER_THRESHOLD_RIGHT = 0.08;
    
    // Use global position for hysteresis
    const wasLeft = globalCurrentLateralPosition === 'left';
    const wasRight = globalCurrentLateralPosition === 'right';
    
    // Hysteresis logic: need stronger signal to change state
    if (wasLeft) {
      // Currently left, need to go past center threshold to change
      if (lateralAmount > LATERAL_CENTER_THRESHOLD_RIGHT) {
        lateralPosition = lateralAmount > LATERAL_RIGHT_THRESHOLD ? 'right' : 'center';
      } else {
        lateralPosition = 'left';
      }
    } else if (wasRight) {
      // Currently right, need to go past center threshold to change
      if (lateralAmount < LATERAL_CENTER_THRESHOLD_LEFT) {
        lateralPosition = lateralAmount < LATERAL_LEFT_THRESHOLD ? 'left' : 'center';
      } else {
        lateralPosition = 'right';
      }
    } else {
      // Currently center, can go either way
      if (lateralAmount < LATERAL_LEFT_THRESHOLD) {
        lateralPosition = 'left';
      } else if (lateralAmount > LATERAL_RIGHT_THRESHOLD) {
        lateralPosition = 'right';
      } else {
        lateralPosition = 'center';
      }
    }
    
    // Update global position for next frame
    globalCurrentLateralPosition = lateralPosition;

    // Hysteresis threshold to prevent flicker (same as native version)
    const wasOpen = currentIsOpen.current;
    const nextIsOpen = wasOpen
      ? smoothed > CLOSE_THRESHOLD
      : smoothed > OPEN_THRESHOLD;
    
    // Update state
    const stateChanged = wasOpen !== nextIsOpen;
    currentIsOpen.current = nextIsOpen;

    // Keep optional advanced metrics defined even when specific detectors are unavailable.
    const rawSmileAmount = 0;
    const cheekExpansion = 0;
    const tongueElevation = 0;
    const tonguePosition: { x: number; y: number } | undefined = undefined;
    const isTongueVisible = false;

    // Log only on state changes (reduced logging for performance)
    if (stateChanged) {
      // Only log state changes, not every frame
      // Removed detailed logging to reduce console clutter
    }

    // Prepare landmarks for visualization
    const mouthLandmarks: MouthLandmarks = {
      upperLip: upperLipPoints,
      lowerLip: lowerLipPoints,
      mouthLeft: mouthLeft,
      mouthRight: mouthRight,
      allMouthLandmarks: [
        ...upperLipPoints,
        ...lowerLipPoints,
        mouthLeft,
        mouthRight,
        // Add more mouth region landmarks for better visualization
        landmarks[11], landmarks[12], landmarks[13], landmarks[14], landmarks[15], landmarks[16],
        landmarks[17], landmarks[18], landmarks[19], landmarks[20], landmarks[21],
        landmarks[61], landmarks[78], landmarks[80], landmarks[81], landmarks[82], landmarks[84],
        landmarks[87], landmarks[88], landmarks[89], landmarks[90], landmarks[95],
        landmarks[291], landmarks[308], landmarks[310], landmarks[311], landmarks[312], landmarks[314],
        landmarks[317], landmarks[318], landmarks[319], landmarks[320], landmarks[324],
      ].filter(Boolean) as Array<{ x: number; y: number }>,
    };

    return { 
      ratio: smoothed, 
      isOpen: nextIsOpen, 
      landmarks: mouthLandmarks,
      lateralPosition,
      lateralAmount,
      protrusion,
      tongueElevation,
      tonguePosition,
      isTongueVisible,
      smileAmount: rawSmileAmount,
      cheekExpansion
    };
  } catch (error) {
    console.error('Error processing frame:', error);
    return null;
  }
}

/**
 * Web version of jaw detection hook using MediaPipe
 */
export function useJawDetectionWeb(
  isActive: boolean = true
): JawDetectionResult {
  const [isOpen, setIsOpen] = useState(false);
  const [ratio, setRatio] = useState(0);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [hasCamera, setHasCamera] = useState(false);
  const [landmarks, setLandmarks] = useState<MouthLandmarks | null>(null);
  const [lateralPosition, setLateralPosition] = useState<'left' | 'center' | 'right'>('center');
  const [lateralAmount, setLateralAmount] = useState(0);
  const [protrusion, setProtrusion] = useState(0);
  const [tongueElevation, setTongueElevation] = useState(0);
  const [tonguePosition, setTonguePosition] = useState<{ x: number; y: number } | undefined>(undefined);
  const [isTongueVisible, setIsTongueVisible] = useState(false);
  const [smileAmount, setSmileAmount] = useState(0);
  const [cheekExpansion, setCheekExpansion] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ema = useRef(0);
  const emaLateral = useRef(0); // EMA for lateral position smoothing
  const emaTongueElevation = useRef(0); // EMA for tongue elevation smoothing
  const emaCheekExpansion = useRef(0); // EMA for cheek expansion smoothing
  const lastTimestamp = useRef(0);
  const currentIsOpen = useRef(false);
  const processingIntervalRef = useRef<number | null>(null);

  // Initialize MediaPipe - always initialize on web, not dependent on isActive
  useEffect(() => {
    if (typeof window !== 'undefined') {
      initializeFaceLandmarker().catch((err) => {
        console.error('Failed to initialize face landmarker:', err);
        setError('Failed to initialize face detection');
      });
    }
  }, []); // Run once on mount

  // Setup webcam - always setup on web, not dependent on isActive
  // isActive only controls frame processing, not camera initialization
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // Only setup camera once, regardless of isActive
    // isActive controls frame processing, not camera initialization
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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 }
        });
        streamRef.current = stream;
        setHasCamera(true);
        setError(undefined); // Clear any previous errors

        // Create video element for processing (hidden)
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true; // Mute to avoid feedback
        video.style.display = 'none';
        video.style.position = 'absolute';
        video.style.opacity = '0';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.pointerEvents = 'none';
        document.body.appendChild(video);

        video.addEventListener('loadedmetadata', () => {
          video.play();
          videoRef.current = video;
        });

        // Check if preview video already exists to avoid duplicates
        let previewVideo = document.querySelector('video[data-jaw-preview-video]') as HTMLVideoElement;
        
        if (!previewVideo) {
          // Create preview video element and inject into container
          previewVideo = document.createElement('video');
          previewVideo.setAttribute('data-jaw-preview-video', 'true'); // Custom attribute for easier lookup
        }
        
        previewVideo.srcObject = stream;
        previewVideo.autoplay = true;
        previewVideo.playsInline = true;
        previewVideo.muted = true;
        previewVideo.setAttribute('playsinline', 'true');
        previewVideo.setAttribute('webkit-playsinline', 'true');
        previewVideo.setAttribute('muted', 'true');
        
        // Make sure video is visible and properly styled
        previewVideo.style.width = '100%';
        previewVideo.style.height = '100%';
        previewVideo.style.objectFit = 'cover';
        previewVideo.style.borderRadius = '0'; // No border radius for full-screen
        previewVideo.style.display = 'block';
        previewVideo.style.position = 'absolute';
        previewVideo.style.top = '0';
        previewVideo.style.left = '0';
        previewVideo.style.right = '0';
        previewVideo.style.bottom = '0';
        previewVideo.style.zIndex = '1';
        previewVideo.style.backgroundColor = '#000000';
        
        // Set up event listeners before injecting
        previewVideo.addEventListener('loadedmetadata', () => {
          previewVideo.play().catch(err => {
            console.error('Error playing preview video:', err);
          });
        });
        
        previewVideo.addEventListener('error', (e) => {
          console.error('❌ Preview video error:', e);
        });
        
        // Find the preview container and inject video
        // Use a more aggressive approach - check periodically and also use MutationObserver
        const findAndInjectPreview = () => {
          // Try multiple selectors
          let container: HTMLElement | null = null;
          
          // Method 1: data-native-id attribute (React Native Web converts nativeID to data-native-id)
          container = document.querySelector('[data-native-id="jaw-preview-container"]') as HTMLElement;
          
          // Method 2: nativeID attribute (direct attribute)
          if (!container) {
            container = document.querySelector('[nativeID="jaw-preview-container"]') as HTMLElement;
          }
          
          // Method 3: Search all divs by nativeID attribute
          if (!container) {
            const allDivs = Array.from(document.querySelectorAll('div'));
            container = allDivs.find(div => {
              const nativeId = div.getAttribute('data-native-id') || div.getAttribute('nativeID') || (div as any).nativeID;
              return nativeId === 'jaw-preview-container';
            }) as HTMLElement || null;
          }
          
          
          if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
            // Validate container is full-screen (must be >80% of screen size)
            const rect = container.getBoundingClientRect();
            const isFullScreen = rect.width > window.innerWidth * 0.8 && 
                                 rect.height > window.innerHeight * 0.8;
            
            if (!isFullScreen) {
              // Not the right container, keep looking
              return false;
            }
            
            // Check if video is already in this container to avoid duplicates
            const existingVideo = container.querySelector('video[data-jaw-preview-video]');
            if (!existingVideo) {
              // Don't clear innerHTML - it conflicts with React
              // Instead, just append the video (appendChild will work fine)
              // Make sure container can display content
              const containerStyle = window.getComputedStyle(container);
              if (containerStyle.display === 'none') {
                (container as any).style.display = 'block';
              }
              
              // Append video - don't clear container first to avoid React conflicts
              container.appendChild(previewVideo);
            } else {
              // Update existing video's stream instead of creating duplicate
              (existingVideo as HTMLVideoElement).srcObject = stream;
            }
            
            // Verify stream
            if (!previewVideo.srcObject) {
              console.error('Video srcObject is null!');
            }
            
            // Set up play handler
            const attemptPlay = () => {
              if (previewVideo.paused) {
                previewVideo.play()
                  .catch(err => {
                    console.error('Video play failed:', err);
                  });
              }
            };
            
            // Try playing when video is ready
            if (previewVideo.readyState >= 2) {
              attemptPlay();
            } else {
              previewVideo.addEventListener('loadedmetadata', attemptPlay, { once: true });
              previewVideo.addEventListener('canplay', attemptPlay, { once: true });
              previewVideo.addEventListener('loadeddata', attemptPlay, { once: true });
            }
            
            // Also try after a delay
            setTimeout(attemptPlay, 200);
            setTimeout(attemptPlay, 500);
            setTimeout(attemptPlay, 1000);
            
            return true; // Success
          }
          
          return false; // Not found yet
        };
        
        // Try immediately
        if (!findAndInjectPreview()) {
          // Use MutationObserver to watch for container creation
          const observer = new MutationObserver(() => {
            if (findAndInjectPreview()) {
              observer.disconnect();
            }
          });
          
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-native-id', 'nativeID']
          });
          
          // Also try periodically as fallback - increased attempts to 100
          let attempts = 0;
          const interval = setInterval(() => {
            attempts++;
            if (findAndInjectPreview() || attempts >= 100) {
              clearInterval(interval);
              observer.disconnect();
              if (attempts >= 100) {
                // Container not found after many attempts
                // Don't fallback to small container - let game component handle it
                console.warn('⚠️ Camera preview container not found after 100 attempts. The game component will try to move the video.');
              }
            }
          }, 100);
        }

        // Start processing frames
        const processFrames = async () => {
          try {
            if (!videoRef.current || !isActive) return;

            const now = Date.now();
            if (now - lastTimestamp.current < THROTTLE_MS) {
              return;
            }
            lastTimestamp.current = now;

            const result = await processFrame(videoRef.current, ema, currentIsOpen, emaLateral);
            
            if (result) {
              setIsDetecting(true);
              setRatio(result.ratio);
              setIsOpen(result.isOpen);
              currentIsOpen.current = result.isOpen;
              if (result.landmarks) {
                setLandmarks(result.landmarks);
              }
              if (result.lateralPosition !== undefined) {
                setLateralPosition(result.lateralPosition);
              }
              if (result.lateralAmount !== undefined) {
                setLateralAmount(result.lateralAmount);
              }
              if (result.protrusion !== undefined) {
                setProtrusion(result.protrusion);
              }
            } else {
              setIsDetecting(false);
              setLandmarks(null);
            }
          } catch (error) {
            // Silently handle frame processing errors to prevent app crashes
            // MediaPipe can throw errors during initialization or processing
            console.warn('Frame processing error (non-critical):', error instanceof Error ? error.message : 'Unknown error');
            setIsDetecting(false);
            // Don't clear landmarks on error - keep last valid landmarks
            // setLandmarks(null);
          }
        };

        // Process frames at ~12-15 fps (only when isActive is true)
        // Start the interval, but processFrames will check isActive
        const startProcessing = () => {
          if (processingIntervalRef.current) {
            clearInterval(processingIntervalRef.current);
          }
          processingIntervalRef.current = window.setInterval(processFrames, THROTTLE_MS);
        };
        startProcessing();

      } catch (err: any) {
        console.error('❌ Failed to setup camera:', err);
        let errorMessage = err.message || 'Failed to access camera';
        
        // Handle specific error cases
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = 'Camera permission denied. Please allow camera access in your browser settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMessage = 'No camera found. Please connect a camera and refresh the page.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMessage = 'Camera is in use by another application. Please close other apps using the camera and refresh.';
        } else if (errorMessage.toLowerCase().includes('device in use') || errorMessage.toLowerCase().includes('in use')) {
          errorMessage = 'Camera is in use. Please close other applications using the camera and refresh the page.';
        }
        
        console.error('Setting error:', errorMessage);
        setError(errorMessage);
        setHasCamera(false);
      }
    };

    setupCamera();

    return () => {
      // Cleanup - stop all camera tracks and remove video elements
      
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
        videoRef.current.remove();
        videoRef.current = null;
      }
      
      // Clean up preview video and canvas
      const container = document.querySelector('[data-native-id="jaw-preview-container"]') as HTMLElement;
      if (container) {
        const previewVideo = container.querySelector('video');
        if (previewVideo && previewVideo.srcObject) {
          const stream = previewVideo.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
        }
        // Don't clear innerHTML - it conflicts with React
        // Just stop the video stream and let React handle cleanup
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
      
      setHasCamera(false);
    };
  }, []); // Run once on mount, camera should initialize immediately

  // Control frame processing based on isActive
  useEffect(() => {
    if (!isActive && processingIntervalRef.current) {
      // Pause processing when not active (but keep camera running)
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    } else if (isActive && !processingIntervalRef.current && videoRef.current) {
      // Resume processing when active
      const processFrames = async () => {
        try {
          if (!videoRef.current || !isActive) return;

          const now = Date.now();
          if (now - lastTimestamp.current < THROTTLE_MS) {
            return;
          }
          lastTimestamp.current = now;

          const result = await processFrame(videoRef.current, ema, currentIsOpen, emaLateral);
        
          if (result) {
            setIsDetecting(true);
            setRatio(result.ratio);
            setIsOpen(result.isOpen);
            currentIsOpen.current = result.isOpen;
            if (result.landmarks) {
              setLandmarks(result.landmarks);
            }
            if (result.lateralPosition !== undefined) {
              setLateralPosition(result.lateralPosition);
            }
            if (result.lateralAmount !== undefined) {
              setLateralAmount(result.lateralAmount);
            }
            if (result.protrusion !== undefined) {
              setProtrusion(result.protrusion);
            }
            if (result.tongueElevation !== undefined) {
              setTongueElevation(result.tongueElevation);
            }
            if (result.tonguePosition !== undefined) {
              setTonguePosition(result.tonguePosition);
            }
            if (result.isTongueVisible !== undefined) {
              setIsTongueVisible(result.isTongueVisible);
            }
            if (result.smileAmount !== undefined) {
              setSmileAmount(result.smileAmount);
            }
            if (result.cheekExpansion !== undefined) {
              setCheekExpansion(result.cheekExpansion);
            }
          } else {
            setIsDetecting(false);
            setLandmarks(null);
          }
        } catch {
          setIsDetecting(false);
        }
      };
      processingIntervalRef.current = window.setInterval(processFrames, THROTTLE_MS);
    }
  }, [isActive]);

  return {
    isOpen,
    ratio,
    isDetecting,
    hasCamera,
    error,
    device: null, // Not used on web (we use video element directly)
    frameProcessor: null, // Not used on web (we process frames in JS)
    previewContainerId: 'jaw-preview-container', // ID for preview container
    landmarks, // Landmarks for visualization
    lateralPosition, // Lateral jaw position (left/center/right)
    lateralAmount, // Lateral amount (-1 to 1)
    protrusion, // Jaw protrusion (0 to 1)
    tongueElevation,
    tonguePosition,
    isTongueVisible,
    smileAmount,
    cheekExpansion,
  };
}
