import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
import type { MouthLandmarks } from '@/hooks/useJawDetectionWeb';
import { logGameAndAward } from '@/utils/api';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

// Conditional import for VisionCamera
let Camera: any = null;
if (Platform.OS !== 'web') {
  try {
    const visionCamera = require('react-native-vision-camera');
    Camera = visionCamera.Camera;
  } catch (e) {
    console.warn('react-native-vision-camera not available:', e);
  }
}

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

const DEFAULT_TTS_RATE = 0.75;
const ROUND_DURATION_MS = 5000; // 5 seconds per round
const TOTAL_ROUNDS = 6;
const PROTRUSION_THRESHOLD = 0.3; // Minimum protrusion to push objects
const COLLECTION_DEPTH = 0.15; // Depth threshold for object collection (easier to reach)

// Enhanced responsive sizing
const getResponsiveSize = (baseSize: number, isTablet: boolean, isMobile: boolean) => {
  if (isTablet) return baseSize * 1.5;
  if (isMobile) return baseSize * 1.1; // Slightly larger for touch
  return baseSize;
};

// Adaptive particle count based on device (optimized for performance)
const getMaxParticles = (isTablet: boolean, isMobile: boolean) => {
  if (isMobile) return 20; // Reduced for mobile performance
  if (isTablet) return 40;
  return 50;
};

let scheduledSpeechTimers: ReturnType<typeof setTimeout>[] = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    Speech.stop();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    Speech.speak(text, { rate });
  } catch (e) {
    console.warn('speak error', e);
  }
}

// Particle type for 3D depth visualization
type Particle = {
  id: number;
  depth: Animated.Value;
  x: number;
  y: number;
  size: number;
  opacity: Animated.Value;
  speed: number;
  color: string;
};

// Object type with proper collection tracking
type GameObject = {
  id: number;
  depth: number; // Use number instead of Animated.Value for state
  x: number;
  collected: boolean;
  targetDepth: number;
  glowScale: Animated.Value; // For glow effect when being pushed
  pulseAnim: Animated.Value; // For pulse animation
};

/**
 * Draw mouth landmarks on canvas overlay (web only)
 */
function drawLandmarks(canvas: HTMLCanvasElement, landmarks: MouthLandmarks) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const container = canvas.parentElement;
  if (!container) return;
  
  const video = container.querySelector('video') as HTMLVideoElement;
  if (!video || !video.videoWidth || !video.videoHeight) return;

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const scaleX = canvas.width / videoWidth;
  const scaleY = canvas.height / videoHeight;

  // Draw all mouth landmarks as subtle points
  if (landmarks.allMouthLandmarks) {
    ctx.strokeStyle = '#FF6B6B';
    ctx.fillStyle = '#FF6B6B';
    ctx.lineWidth = 1.5;

    landmarks.allMouthLandmarks.forEach((point) => {
      const x = point.x * videoWidth * scaleX;
      const y = point.y * videoHeight * scaleY;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  // Draw upper lip line
  if (landmarks.upperLip.length > 0) {
    ctx.strokeStyle = '#4ECDC4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    landmarks.upperLip.forEach((point, index) => {
      const x = point.x * videoWidth * scaleX;
      const y = point.y * videoHeight * scaleY;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  // Draw lower lip line
  if (landmarks.lowerLip.length > 0) {
    ctx.strokeStyle = '#45B7D1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    landmarks.lowerLip.forEach((point, index) => {
      const x = point.x * videoWidth * scaleX;
      const y = point.y * videoHeight * scaleY;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }
}

export const JawPushChallengeGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredRounds = TOTAL_ROUNDS,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const isTablet = SCREEN_WIDTH >= 768;
  const isMobile = SCREEN_WIDTH < 600;
  const maxParticles = getMaxParticles(isTablet, isMobile);
  
  // Encouraging phrases for protrusion feedback
  const encouragingPhrases = [
    'Great job!',
    'Well done!',
    'Excellent!',
    'Amazing!',
    'Fantastic!',
    'Perfect!',
    'Wonderful!',
    'Super!',
    'You got it!',
    'Keep it up!',
    'Nice push!',
    'That\'s it!',
    'Keep pushing!',
  ];
  
  const getRandomEncouragement = () => {
    return encouragingPhrases[Math.floor(Math.random() * encouragingPhrases.length)];
  };
  
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    correctMatches: number;
    matchAccuracy: number;
    objectsPushed: number;
    attentionScore: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [canPlay, setCanPlay] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [objectsPushed, setObjectsPushed] = useState(0);
  const [score, setScore] = useState(0);
  const [lastProtrusionFeedback, setLastProtrusionFeedback] = useState(0); // Track last feedback time
  const [isPushing, setIsPushing] = useState(false); // Track if actively pushing
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Scoring
  const [correctMatches, setCorrectMatches] = useState(0);
  const [matchFrames, setMatchFrames] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  
  // Jaw detection
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : canPlay);
  const { 
    isDetecting, 
    hasCamera, 
    error: jawError,
  } = jawDetection;
  
  // Web-specific properties (type assertion needed)
  const protrusion = (jawDetection as any).protrusion as number | undefined;
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const landmarks = (jawDetection as any).landmarks as MouthLandmarks | null | undefined;
  
  // Refs
  const canPlayRef = useRef<boolean>(false);
  const currentProtrusionRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const gameStartedRef = useRef(false);
  const roundActiveRef = useRef(false);
  const frameCheckRef = useRef<number | null>(null);
  const previewRef = useRef<View>(null);
  const canvasRef = useRef<any>(null);
  const collectionCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const protrusionUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProtrusionUpdateRef = useRef<number>(0);
  const gameObjectsRef = useRef<GameObject[]>([]);
  
  // Objects as state for proper re-rendering
  const [gameObjects, setGameObjects] = useState<GameObject[]>([]);
  
  // Sync ref with state
  useEffect(() => {
    gameObjectsRef.current = gameObjects;
  }, [gameObjects]);
  
  // Animations
  const protrusionMeter = useRef(new Animated.Value(0)).current;
  const protrusionRingScale = useRef(new Animated.Value(1)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;
  const particleSpawnAnim = useRef(new Animated.Value(0)).current;

  // Timeouts
  const roundTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gameStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const particleSpawnIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Sync refs
  useEffect(() => {
    canPlayRef.current = canPlay;
  }, [canPlay]);

  // Update protrusion ref and meter with real-time feedback
  useEffect(() => {
    if (protrusion !== undefined && canPlay && roundActiveRef.current) {
      currentProtrusionRef.current = protrusion;
      
      // Update protrusion meter with smooth animation
      Animated.timing(protrusionMeter, {
        toValue: protrusion,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
      
      // Real-time feedback when protrusion threshold is reached
      const now = Date.now();
      if (protrusion >= PROTRUSION_THRESHOLD && (now - lastProtrusionFeedback) > 2000) {
        setLastProtrusionFeedback(now);
        const encouragement = getRandomEncouragement();
        speak(encouragement);
        
        // Scale ring animation
        Animated.sequence([
          Animated.timing(protrusionRingScale, {
            toValue: 1.15,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(protrusionRingScale, {
            toValue: 1,
            duration: 200,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start();
        
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
      }
      
      // Haptic feedback at milestones
      if (protrusion >= 0.5 && protrusion < 0.52) {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {}
      } else if (protrusion >= 0.7 && protrusion < 0.72) {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
      }
    }
  }, [protrusion, canPlay, lastProtrusionFeedback]);

  // Cleanup objects function
  const cleanupObjects = useCallback(() => {
    gameObjects.forEach(obj => {
      obj.glowScale.stopAnimation();
      obj.pulseAnim.stopAnimation();
      obj.glowScale.removeAllListeners();
      obj.pulseAnim.removeAllListeners();
    });
    setGameObjects([]);
  }, [gameObjects]);

  // Cleanup particles function
  const cleanupParticles = useCallback(() => {
    particlesRef.current.forEach(particle => {
      particle.depth.stopAnimation();
      particle.opacity.stopAnimation();
      particle.depth.removeAllListeners();
      particle.opacity.removeAllListeners();
    });
    particlesRef.current = [];
  }, []);

  // Helper function to update objects with protrusion
  const updateObjectsWithProtrusion = useCallback((currentProtrusion: number) => {
    // Calculate push amount (normalized 0-1)
    const pushAmount = (currentProtrusion - PROTRUSION_THRESHOLD) / (1 - PROTRUSION_THRESHOLD);
    
    // Update all objects smoothly using ref to avoid dependency issues
    setGameObjects(prevObjects => {
      const hasChanges = prevObjects.some(obj => {
        if (obj.collected) return false;
        const newDepth = Math.max(0, obj.targetDepth - pushAmount * 0.7);
        return Math.abs(obj.depth - newDepth) > 0.01; // Only update if significant change
      });
      
      if (!hasChanges) return prevObjects; // Prevent unnecessary updates
      
      return prevObjects.map(obj => {
        if (obj.collected) return obj;
        
        // Move object forward based on protrusion
        // Objects start at depth 0.8-0.9, move to 0.0-0.1 when collected
        const newDepth = Math.max(0, obj.targetDepth - pushAmount * 0.7);
        
        // Add glow effect when being pushed
        Animated.timing(obj.glowScale, {
          toValue: 1 + pushAmount * 0.3, // Scale up to 1.3x when pushing hard
          duration: 100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
        
        return {
          ...obj,
          depth: newDepth,
        };
      });
    });
  }, []);

  // Update object positions based on protrusion - debounced for performance
  useEffect(() => {
    if (!canPlay || protrusion === undefined || !roundActiveRef.current) {
      setIsPushing(false);
      if (protrusionUpdateTimeoutRef.current) {
        clearTimeout(protrusionUpdateTimeoutRef.current);
        protrusionUpdateTimeoutRef.current = null;
      }
      return;
    }
    
    // Check if we have objects using ref to avoid dependency
    if (gameObjectsRef.current.length === 0) {
      setIsPushing(false);
      return;
    }
    
    const isPushingNow = protrusion >= PROTRUSION_THRESHOLD;
    setIsPushing(isPushingNow);
    
    if (!isPushingNow) return;
    
    // Debounce updates to reduce re-renders (update every 50ms max)
    const now = Date.now();
    if (now - lastProtrusionUpdateRef.current < 50) {
      if (protrusionUpdateTimeoutRef.current) {
        clearTimeout(protrusionUpdateTimeoutRef.current);
      }
      protrusionUpdateTimeoutRef.current = setTimeout(() => {
        lastProtrusionUpdateRef.current = Date.now();
        updateObjectsWithProtrusion(protrusion);
      }, 50 - (now - lastProtrusionUpdateRef.current)) as unknown as NodeJS.Timeout;
      return;
    }
    
    lastProtrusionUpdateRef.current = now;
    updateObjectsWithProtrusion(protrusion);
  }, [protrusion, canPlay, updateObjectsWithProtrusion]);

  // Continuous collection checking using interval
  useEffect(() => {
    if (!canPlay || !roundActiveRef.current) {
      if (collectionCheckIntervalRef.current) {
        clearInterval(collectionCheckIntervalRef.current);
        collectionCheckIntervalRef.current = null;
      }
      return;
    }

    collectionCheckIntervalRef.current = setInterval(() => {
      // Use ref to check objects without causing dependency issues
      const currentObjects = gameObjectsRef.current;
      if (currentObjects.length === 0) return;
      
      let hasNewCollection = false;
      const updatedObjects = currentObjects.map(obj => {
        if (obj.collected || obj.depth > COLLECTION_DEPTH) return obj;
        
        // Object reached collection depth
        hasNewCollection = true;
        
        // Celebration animation
        Animated.sequence([
          Animated.parallel([
            Animated.timing(celebrationOpacity, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.spring(obj.glowScale, {
              toValue: 1.5,
              tension: 50,
              friction: 7,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(celebrationOpacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.spring(obj.glowScale, {
              toValue: 1,
              tension: 50,
              friction: 7,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
        
        setObjectsPushed(prev => prev + 1);
        setScore(prev => prev + 15);
        
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
        
        const encouragement = getRandomEncouragement();
        speak(encouragement);
        
        return {
          ...obj,
          collected: true,
          depth: 0, // Fully collected
        };
      });
      
      // Only update state if there was a collection
      if (hasNewCollection) {
        setGameObjects(updatedObjects);
      }
    }, 50) as unknown as NodeJS.Timeout; // Check every 50ms for responsive collection

    return () => {
      if (collectionCheckIntervalRef.current) {
        clearInterval(collectionCheckIntervalRef.current);
        collectionCheckIntervalRef.current = null;
      }
    };
  }, [canPlay, getRandomEncouragement]);

  // Particle system for 3D depth visualization
  useEffect(() => {
    if (!canPlay || !roundActiveRef.current) {
      cleanupParticles();
      return;
    }

    // Spawn particles at intervals
    const spawnParticle = () => {
      if (particlesRef.current.length < maxParticles) {
        const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A'];
        const particle: Particle = {
          id: Date.now() + Math.random(),
          depth: new Animated.Value(0.9 + Math.random() * 0.1),
          x: Math.random() * SCREEN_WIDTH,
          y: Math.random() * SCREEN_HEIGHT,
          size: 3 + Math.random() * 5,
          opacity: new Animated.Value(0.2 + Math.random() * 0.3),
          speed: 0.005 + Math.random() * 0.015,
          color: colors[Math.floor(Math.random() * colors.length)],
        };
        particlesRef.current.push(particle);
      }
    };

    particleSpawnIntervalRef.current = setInterval(spawnParticle, isMobile ? 300 : 200) as unknown as NodeJS.Timeout;

    // Update particle positions based on protrusion
    const updateParticles = () => {
      if (!roundActiveRef.current) return;
      
      const currentProtrusion = currentProtrusionRef.current;
      particlesRef.current.forEach((particle) => {
        // Use getValue() or listener to get current value safely
        let currentDepth = 0.9;
        try {
          currentDepth = (particle.depth as any)._value || 0.9;
        } catch {
          // Fallback if _value not accessible
          particle.depth.addListener(({ value }) => {
            currentDepth = value;
          });
        }
        const newDepth = Math.max(0, currentDepth - currentProtrusion * particle.speed);
        
        if (newDepth <= 0) {
          // Particle reached front, reset to back
          particle.depth.setValue(0.9 + Math.random() * 0.1);
          particle.x = Math.random() * SCREEN_WIDTH;
          particle.y = Math.random() * SCREEN_HEIGHT;
        } else {
          Animated.timing(particle.depth, {
            toValue: newDepth,
            duration: 100,
            easing: Easing.linear,
            useNativeDriver: false,
          }).start();
        }
      });
    };

    const interval = setInterval(updateParticles, isMobile ? 150 : 100);
    
    return () => {
      if (particleSpawnIntervalRef.current) {
        clearInterval(particleSpawnIntervalRef.current);
        particleSpawnIntervalRef.current = null;
      }
      clearInterval(interval);
    };
  }, [canPlay, maxParticles, SCREEN_WIDTH, SCREEN_HEIGHT, cleanupParticles]);

  // Frame-based match checking (replaces interval-based)
  useEffect(() => {
    if (!canPlay || !roundActiveRef.current) {
      if (frameCheckRef.current !== null) {
        cancelAnimationFrame(frameCheckRef.current);
        frameCheckRef.current = null;
      }
      return;
    }

    const checkFrame = () => {
      if (roundActiveRef.current && canPlayRef.current) {
        const currentProtrusion = currentProtrusionRef.current;
        setTotalFrames(prev => prev + 1);
        
        if (currentProtrusion >= PROTRUSION_THRESHOLD) {
          setMatchFrames(prev => prev + 1);
        }
      }
      
      if (roundActiveRef.current) {
        frameCheckRef.current = requestAnimationFrame(checkFrame);
      }
    };

    frameCheckRef.current = requestAnimationFrame(checkFrame);

    return () => {
      if (frameCheckRef.current !== null) {
        cancelAnimationFrame(frameCheckRef.current);
        frameCheckRef.current = null;
      }
    };
  }, [canPlay]);

  // Web: Explicitly set data-native-id attribute on container element
  useEffect(() => {
    if (Platform.OS !== 'web' || !previewContainerId) return;

    const setAttribute = () => {
      try {
        let element: HTMLElement | null = null;
        
        // Try to get element from ref
        if (previewRef.current) {
          const refElement = (previewRef.current as any)?.base || 
                            (previewRef.current as any)?.current ||
                            previewRef.current;
          if (refElement) {
            if (refElement.nodeType === 1) {
              element = refElement;
            } else if (refElement._nativeNode) {
              element = refElement._nativeNode;
            } else if (refElement._internalFiberInstanceHandleDEV?.stateNode) {
              element = refElement._internalFiberInstanceHandleDEV.stateNode;
            }
          }
        }
        
        // Also try to find by nativeID
        if (!element) {
          element = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
        }
        
        // Set data-native-id attribute if element found
        if (element) {
          if (!element.getAttribute('data-native-id')) {
            element.setAttribute('data-native-id', previewContainerId);
          }
          // Also set the hardcoded ID the hook looks for
          if (!element.getAttribute('data-native-id-backup')) {
            element.setAttribute('data-native-id-backup', 'jaw-preview-container');
          }
        }
      } catch (e) {
        // Silently fail
      }
    };
    
    // Try immediately and with delays
    setAttribute();
    const timeouts = [100, 300, 500, 1000, 2000].map(delay => 
      setTimeout(setAttribute, delay)
    );
    
    return () => timeouts.forEach(clearTimeout);
  }, [previewContainerId]);

  // Web: Ensure container is properly set up - let hook handle video injection
  useEffect(() => {
    if (Platform.OS !== 'web' || !previewContainerId) return;

    const setupContainer = () => {
      // Try multiple selectors to find container - hook looks for 'jaw-preview-container'
      let container = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
      
      if (!container) {
        container = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
      }
      
      // Also try the hardcoded ID the hook uses
      if (!container) {
        container = document.querySelector('[data-native-id="jaw-preview-container"]') as HTMLElement;
      }
      
      if (!container && previewRef.current) {
        try {
          const refElement = (previewRef.current as any)?.base || 
                            (previewRef.current as any)?.current ||
                            previewRef.current;
          if (refElement) {
            // Try to get the DOM element
            if (refElement.nodeType === 1) {
              container = refElement;
            } else if (refElement._nativeNode) {
              container = refElement._nativeNode;
            } else if (refElement._internalFiberInstanceHandleDEV) {
              // React Native Web internal structure
              const stateNode = refElement._internalFiberInstanceHandleDEV?.stateNode;
              if (stateNode) container = stateNode;
            }
          }
        } catch (e) {
          // Ignore
        }
      }

      if (!container) {
        // Container not found - try to create/find it via React Native Web structure
        const allDivs = Array.from(document.querySelectorAll('div'));
        container = allDivs.find(div => {
          const nativeId = div.getAttribute('data-native-id') || 
                          div.getAttribute('nativeID') || 
                          (div as any).nativeID;
          return nativeId === previewContainerId || nativeId === 'jaw-preview-container';
        }) as HTMLElement || null;
      }

      if (!container) return;

      // Force container to be full-screen and visible
      const containerStyle = (container as any).style || {};
      containerStyle.position = 'absolute';
      containerStyle.top = '0';
      containerStyle.left = '0';
      containerStyle.right = '0';
      containerStyle.bottom = '0';
      containerStyle.width = '100%';
      containerStyle.height = '100%';
      containerStyle.zIndex = '1';
      containerStyle.display = 'block';
      containerStyle.visibility = 'visible';
      containerStyle.opacity = '1';
      containerStyle.backgroundColor = 'transparent';
      containerStyle.overflow = 'hidden';

      // Only style existing video if it's in our container - don't move videos
      // Let the hook handle video injection to avoid React conflicts
      const existingVideo = container.querySelector('video[data-jaw-preview-video]') as HTMLVideoElement;
      
      if (existingVideo) {
        // Ensure video is properly styled
        existingVideo.style.display = 'block';
        existingVideo.style.position = 'absolute';
        existingVideo.style.opacity = '1';
        existingVideo.style.width = '100%';
        existingVideo.style.height = '100%';
        existingVideo.style.objectFit = 'cover';
        existingVideo.style.top = '0';
        existingVideo.style.left = '0';
        existingVideo.style.right = '0';
        existingVideo.style.bottom = '0';
        existingVideo.style.zIndex = '1';
        existingVideo.style.borderRadius = '0';
        
        // Try to play if paused
        if (existingVideo.paused && existingVideo.srcObject) {
          existingVideo.play().catch(() => {
            // Ignore play errors
          });
        }
      }

      // Hide duplicate videos outside our container (don't remove - let React handle cleanup)
      const allVideos = document.querySelectorAll('video[data-jaw-preview-video]');
      allVideos.forEach((video) => {
        const videoElement = video as HTMLVideoElement;
        if (!container.contains(videoElement)) {
          // Hide duplicate videos instead of removing them to avoid React conflicts
          videoElement.style.display = 'none';
          videoElement.style.visibility = 'hidden';
          videoElement.style.opacity = '0';
          videoElement.style.pointerEvents = 'none';
        } else {
          // Ensure video in container is visible
          videoElement.style.display = 'block';
          videoElement.style.visibility = 'visible';
          videoElement.style.opacity = '1';
        }
      });
    };

    // Run immediately and periodically - less frequent to reduce conflicts
    setupContainer();
    const interval = setInterval(setupContainer, 500);

    return () => clearInterval(interval);
  }, [previewContainerId, hasCamera, isDetecting, canPlay]);

  // Web: Draw landmarks on canvas
  useEffect(() => {
    if (Platform.OS !== 'web' || !landmarks) return;

    const draw = () => {
      if (!canvasRef.current || !landmarks) return;
      
      const canvas = canvasRef.current;
      drawLandmarks(canvas, landmarks);
      
      if (canPlay && landmarks) {
        requestAnimationFrame(draw);
      }
    };

    if (canPlay && landmarks) {
      // Get canvas element from ref
      if (previewRef.current) {
        const container = (previewRef.current as any)?.base || 
                         (previewRef.current as any)?.current ||
                         previewRef.current;
        if (container && typeof document !== 'undefined') {
          let canvas = container.querySelector('canvas');
          if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.zIndex = '2';
            canvas.style.pointerEvents = 'none';
            canvas.width = SCREEN_WIDTH;
            canvas.height = SCREEN_HEIGHT;
            container.appendChild(canvas);
            (canvasRef as any).current = canvas;
          }
          draw();
        }
      }
    }
  }, [landmarks, canPlay, SCREEN_WIDTH, SCREEN_HEIGHT]);

  const finishGame = useCallback(async () => {
    // Cleanup all timers and intervals
    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
      roundTimeoutRef.current = null;
    }
    if (frameCheckRef.current !== null) {
      cancelAnimationFrame(frameCheckRef.current);
      frameCheckRef.current = null;
    }
    if (gameStartTimeoutRef.current) {
      clearTimeout(gameStartTimeoutRef.current);
      gameStartTimeoutRef.current = null;
    }
    if (particleSpawnIntervalRef.current) {
      clearInterval(particleSpawnIntervalRef.current);
      particleSpawnIntervalRef.current = null;
    }
    
    roundActiveRef.current = false;
    cleanupObjects();
    cleanupParticles();
    setGameFinished(true);
    clearScheduledSpeech();

    const totalRounds = currentRound > 0 ? currentRound : 1;
    const matchAccuracy = totalFrames > 0 ? (matchFrames / totalFrames) * 100 : 0;
    const attentionScore = Math.min(100, Math.round(matchAccuracy * 0.6 + (objectsPushed / (totalRounds * 3)) * 40));
    const xp = correctMatches * 50 + objectsPushed * 5;

    setFinalStats({
      totalRounds,
      correctMatches,
      matchAccuracy,
      objectsPushed,
      attentionScore,
      xpAwarded: xp,
    });

    try {
      await logGameAndAward({
        type: 'jaw-push-challenge',
        correct: correctMatches,
        total: totalRounds,
        accuracy: matchAccuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['jaw-awareness', 'jaw-protrusion', 'oral-motor-control', 'strength'],
        incorrectAttempts: totalRounds - correctMatches,
        meta: {
          objectsPushed,
          matchAccuracy,
          attentionScore,
        },
      });
      onComplete?.();
    } catch (e) {
      console.warn('Failed to save game log:', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [correctMatches, currentRound, matchFrames, totalFrames, objectsPushed, onComplete, cleanupObjects, cleanupParticles]);

  const startRound = useCallback(() => {
    setCurrentRound(prev => {
      const nextRound = prev + 1;
      if (nextRound > requiredRounds) {
        finishGame();
        return prev;
      }
      return nextRound;
    });
    
    // Cleanup previous round objects
    cleanupObjects();
    
    // Reset round state
    roundActiveRef.current = true;
    setMatchFrames(0);
    setTotalFrames(0);
    setLastProtrusionFeedback(0); // Reset feedback timer
    setIsPushing(false);
    
    // Generate objects at different depths - make them more visible
    const objectCount = 3;
    const newObjects: GameObject[] = [];
    
    for (let i = 0; i < objectCount; i++) {
      const objX = 150 + (SCREEN_WIDTH - 300) * (i / (objectCount - 1 || 1)); // Spread evenly
      const targetDepth = 0.8 + Math.random() * 0.1; // Start at 0.8-0.9 depth (far away)
      
      newObjects.push({
        id: Date.now() + i,
        depth: targetDepth,
        x: objX,
        collected: false,
        targetDepth,
        glowScale: new Animated.Value(1),
        pulseAnim: new Animated.Value(1),
      });
    }
    
    setGameObjects(newObjects);
    
    // Start pulse animation for all objects
    newObjects.forEach(obj => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(obj.pulseAnim, {
            toValue: 1.1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(obj.pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    });
    
    speak('Push your jaw forward to collect the objects!');

    // After ROUND_DURATION_MS, check results and start next round
    roundTimeoutRef.current = (setTimeout(() => {
      roundActiveRef.current = false;
      
      const matchRate = totalFrames > 0
        ? matchFrames / totalFrames
        : 0;
      
      // Show success animation instead of TTS
      if (matchRate >= 0.6) {
        setCorrectMatches(prev => prev + 1);
        setShowRoundSuccess(true);
        
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
      }

      // Update progress
      setCurrentRound(prevRound => {
        Animated.timing(progressBarWidth, {
          toValue: (prevRound / requiredRounds) * 100,
          duration: 400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }).start();
        return prevRound;
      });

      // Start next round
      setTimeout(() => {
        setShowRoundSuccess(false);
        startRound();
      }, 2500);
    }, ROUND_DURATION_MS)) as unknown as NodeJS.Timeout;
  }, [requiredRounds, finishGame, progressBarWidth, SCREEN_WIDTH, cleanupObjects]);

  const startGame = useCallback(() => {
    if (gameStartedRef.current) return;
    
    // Wait for camera and detection to be ready
    const waitForDetection = (attempts = 0) => {
      if (hasCamera && isDetecting) {
        gameStartedRef.current = true;
        setCanPlay(true);
        speak('Push your jaw forward to push objects!');

        gameStartTimeoutRef.current = (setTimeout(() => {
          startRound();
        }, 2000)) as unknown as NodeJS.Timeout;
      } else if (jawError) {
        speak('Camera access denied. Please allow camera access and refresh the page.');
      } else if (attempts < 10) {
        setTimeout(() => waitForDetection(attempts + 1), 500);
      } else {
        speak('Camera not available. Please check your browser permissions.');
      }
    };
    
    if (!hasCamera) {
      if (Platform.OS === 'web') {
        setTimeout(() => waitForDetection(), 500);
        return;
      } else {
        speak('Camera not available. Please use a dev build.');
        return;
      }
    }
    
    waitForDetection();
  }, [hasCamera, isDetecting, jawError, startRound]);

  useEffect(() => {
    if (hasCamera && isDetecting && !gameStartedRef.current) {
      startGame();
    } else if (!hasCamera && Platform.OS === 'web' && !jawError) {
      const timeout = setTimeout(() => {
        if (hasCamera && isDetecting && !gameStartedRef.current) {
          startGame();
        }
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [hasCamera, isDetecting, jawError, startGame]);

  useEffect(() => {
    return () => {
      clearScheduledSpeech();
      if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);
      if (frameCheckRef.current !== null) cancelAnimationFrame(frameCheckRef.current);
      if (gameStartTimeoutRef.current) clearTimeout(gameStartTimeoutRef.current);
      if (particleSpawnIntervalRef.current) clearInterval(particleSpawnIntervalRef.current);
      if (collectionCheckIntervalRef.current) clearInterval(collectionCheckIntervalRef.current);
      if (protrusionUpdateTimeoutRef.current) clearTimeout(protrusionUpdateTimeoutRef.current);
      cleanupObjects();
      cleanupParticles();
    };
  }, [cleanupObjects, cleanupParticles]);

  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.correctMatches}
        total={finalStats.totalRounds}
        accuracy={finalStats.matchAccuracy}
        xpAwarded={finalStats.xpAwarded}
        onContinue={() => {
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  const matchAccuracy = totalFrames > 0 ? (matchFrames / totalFrames) * 100 : 0;
  const objectSize = getResponsiveSize(isMobile ? 65 : 50, isTablet, isMobile); // Larger on mobile for visibility
  const protrusionPercent = Math.round((protrusion || 0) * 100);
  
  // Color for protrusion meter based on level
  const getProtrusionColor = () => {
    const prot = protrusion || 0;
    if (prot < 0.3) return '#EF4444'; // Red
    if (prot < 0.6) return '#F59E0B'; // Yellow/Orange
    return '#22C55E'; // Green
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#334155']}
        style={styles.gradient}
      >
        {/* Full-screen camera container - Always render so hook can find it */}
        {previewContainerId && (
          <View
            ref={previewRef}
            style={[
              StyleSheet.absoluteFill,
              styles.cameraContainer,
              { zIndex: 1 }
            ]}
            nativeID={previewContainerId}
            {...(Platform.OS === 'web' && { 
              'data-native-id': previewContainerId,
              'data-jaw-preview-container': 'true',
              // Also set the hardcoded ID the hook looks for
              'data-native-id-backup': 'jaw-preview-container'
            })}
            collapsable={false}
          >
            {Platform.OS === 'web' ? (
              <>
                {(!hasCamera || !isDetecting) && (
                  <View style={styles.cameraLoading}>
                    <Text style={styles.cameraLoadingText}>
                      {!hasCamera ? 'Requesting camera access...' : 'Loading camera...'}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              hasCamera && jawDetection.device && Camera && (
                <Camera
                  style={StyleSheet.absoluteFill}
                  device={jawDetection.device}
                  isActive={canPlay}
                  frameProcessor={jawDetection.frameProcessor}
                  frameProcessorFps={30}
                />
              )
            )}
          </View>
        )}

        {/* Header Overlay */}
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              onBack();
            }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Jaw Push Challenge</Text>
            <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
              {canPlay ? 'Push your jaw forward!' : 'Get ready...'}
            </Text>
          </View>
        </View>

        {/* Error Banner */}
        {jawError && (
          <View style={[styles.errorBanner, isMobile && styles.errorBannerMobile]}>
            <Ionicons name="alert-circle" size={24} color="#EF4444" />
            <Text style={styles.errorText}>{jawError}</Text>
          </View>
        )}

        {/* Enhanced Protrusion Meter - Large Circular */}
        {canPlay && (
          <View style={[styles.protrusionMeterContainer, isMobile && styles.protrusionMeterContainerMobile]}>
            <Text style={[styles.protrusionMeterLabel, isMobile && styles.protrusionMeterLabelMobile]}>
              Push Strength
            </Text>
            <View style={styles.protrusionRingContainer}>
              <Animated.View
                style={[
                  styles.protrusionRing,
                  {
                    transform: [{ scale: protrusionRingScale }],
                  },
                ]}
              >
                <View style={[styles.protrusionRingInner, { borderColor: getProtrusionColor() }]}>
                  <Text style={[styles.protrusionPercent, isMobile && styles.protrusionPercentMobile]}>
                    {protrusionPercent}%
                  </Text>
                  {isPushing && (
                    <View style={styles.pushingIndicator}>
                      <Text style={styles.pushingText}>PUSHING!</Text>
                    </View>
                  )}
                </View>
              </Animated.View>
              {/* Progress ring */}
              <View style={styles.protrusionRingProgress}>
                <Animated.View
                  style={[
                    styles.protrusionRingFill,
                    {
                      height: protrusionMeter.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                      backgroundColor: getProtrusionColor(),
                    },
                  ]}
                />
              </View>
            </View>
            {protrusionPercent >= 30 && (
              <Text style={[styles.protrusionHint, isMobile && styles.protrusionHintMobile]}>
                {isPushing ? 'Great! Keep pushing! 💪' : 'Push your jaw forward!'}
              </Text>
            )}
            {protrusionPercent < 30 && canPlay && (
              <Text style={[styles.protrusionHint, isMobile && styles.protrusionHintMobile, { color: '#F59E0B' }]}>
                Push harder! 🎯
              </Text>
            )}
          </View>
        )}

        {/* Progress Bar */}
        {canPlay && (
          <View style={[styles.progressBarContainer, isMobile && styles.progressBarContainerMobile]}>
            <View style={styles.progressBarBackground}>
              <Animated.View
                style={[
                  styles.progressBarFill,
                  {
                    width: progressBarWidth.interpolate({
                      inputRange: [0, 100],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, isMobile && styles.progressTextMobile]}>
              Round {currentRound} / {requiredRounds}
            </Text>
          </View>
        )}

        {/* Game Area with Particles */}
        <View style={styles.gameArea}>
          {/* Particles for 3D depth visualization */}
          {particlesRef.current.map((particle) => {
            // Get current depth value safely
            let depth = 0.9;
            try {
              depth = (particle.depth as any)._value || 0.9;
            } catch {
              // Fallback
              depth = 0.9;
            }
            const scale = 0.2 + (1 - depth) * 0.8;
            const yPos = SCREEN_HEIGHT * 0.5 - (1 - depth) * SCREEN_HEIGHT * 0.4;
            const opacity = depth * 0.5 + 0.2;
            
            return (
              <Animated.View
                key={particle.id}
                style={[
                  styles.particle,
                  {
                    left: particle.x,
                    top: yPos,
                    width: particle.size * scale,
                    height: particle.size * scale,
                    backgroundColor: particle.color,
                    opacity: opacity,
                    transform: [{ scale: particle.depth }],
                  },
                ]}
              />
            );
          })}

          {/* Game Objects - rendered from state */}
          {canPlay && roundActiveRef.current && gameObjects.map((obj) => {
            // Don't render if collected
            if (obj.collected) return null;
            
            // Calculate scale based on depth (objects get bigger as they come forward)
            // Depth: 0.9 (far) -> scale 0.5, Depth: 0.0 (close) -> scale 1.0
            const scale = 0.5 + (1 - obj.depth) * 0.5;
            
            // Calculate Y position (objects move up as they come forward)
            const yPos = SCREEN_HEIGHT * 0.5 - (1 - obj.depth) * SCREEN_HEIGHT * 0.25;
            
            // Glow effect when being pushed
            const glowOpacity = isPushing && obj.depth < obj.targetDepth * 0.7 ? 0.8 : 0.3;
            
            return (
              <Animated.View
                key={obj.id}
                style={[
                  styles.object,
                  {
                    left: obj.x - (objectSize * scale) / 2, // Center the object
                    top: yPos - (objectSize * scale) / 2,
                    width: objectSize * scale,
                    height: objectSize * scale,
                    zIndex: 10,
                    transform: [
                      { scale: obj.pulseAnim },
                      { scale: obj.glowScale },
                    ],
                  },
                ]}
              >
                {/* Glow effect */}
                <Animated.View
                  style={[
                    styles.objectGlow,
                    {
                      width: objectSize * scale * 1.5,
                      height: objectSize * scale * 1.5,
                      borderRadius: (objectSize * scale * 1.5) / 2,
                      opacity: glowOpacity,
                      backgroundColor: isPushing ? '#FFD700' : '#4ECDC4',
                    },
                  ]}
                />
                <Text style={[styles.objectEmoji, { fontSize: objectSize * scale * 0.6 }]}>🎯</Text>
              </Animated.View>
            );
          })}

          {/* Celebration Effect */}
          <Animated.View
            style={[
              styles.celebration,
              {
                opacity: celebrationOpacity,
              },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.celebrationText}>💥 Collected! 💥</Text>
          </Animated.View>
        </View>

        {/* Stats Overlay */}
        <View style={[styles.statsContainer, isMobile && styles.statsContainerMobile]}>
          <Text style={[styles.statsText, isMobile && styles.statsTextMobile]}>
            Score: {score} • Pushed: {objectsPushed}
          </Text>
          <Text style={[styles.statsSubtext, isMobile && styles.statsSubtextMobile]}>
            Accuracy: {Math.round(matchAccuracy)}% • Round {currentRound} / {requiredRounds}
          </Text>
        </View>

        {/* Skills Footer */}
        <View style={[styles.skillsContainer, isMobile && styles.skillsContainerMobile]}>
          <View style={styles.skillItem}>
            <Ionicons name="medical" size={isMobile ? 18 : 20} color="#FFFFFF" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Jaw Protrusion</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="fitness" size={isMobile ? 18 : 20} color="#FFFFFF" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Strength</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="game-controller" size={isMobile ? 18 : 20} color="#FFFFFF" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Motor Control</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Round Success Animation */}
      <RoundSuccessAnimation
        visible={showRoundSuccess}
        stars={3}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    zIndex: 20,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginRight: 12,
    minWidth: 60, // Touch target size
    minHeight: 44,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 4,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  titleMobile: {
    fontSize: 20,
  },
  subtitle: {
    fontSize: 14,
    color: '#CBD5E1',
    marginTop: 2,
  },
  subtitleMobile: {
    fontSize: 12,
  },
  cameraContainer: {
    backgroundColor: 'transparent',
  },
  cameraLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  cameraLoadingText: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  errorBanner: {
    position: 'absolute',
    top: 60,
    width: '90%',
    backgroundColor: '#FEE2E2',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#EF4444',
    zIndex: 25,
    alignSelf: 'center',
  },
  errorBannerMobile: {
    top: 80,
    padding: 12,
    width: '95%',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    marginLeft: 12,
    flex: 1,
  },
  protrusionMeterContainer: {
    position: 'absolute',
    top: 80,
    right: 20,
    alignItems: 'center',
    zIndex: 15,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    padding: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  protrusionMeterContainerMobile: {
    top: 100,
    right: 10,
    padding: 14,
    minWidth: 120,
  },
  protrusionMeterLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  protrusionMeterLabelMobile: {
    fontSize: 12,
  },
  protrusionRingContainer: {
    width: 100,
    height: 100,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  protrusionRing: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protrusionRingInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  protrusionRingProgress: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 6,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
  },
  protrusionRingFill: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
  },
  pushingIndicator: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(34, 197, 94, 0.3)',
  },
  pushingText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#22C55E',
  },
  protrusionPercent: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  protrusionPercentMobile: {
    fontSize: 18,
  },
  protrusionHint: {
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 8,
    textAlign: 'center',
  },
  protrusionHintMobile: {
    fontSize: 10,
  },
  progressBarContainer: {
    position: 'absolute',
    top: 80,
    left: 20,
    width: '60%',
    zIndex: 15,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  progressBarContainerMobile: {
    top: 100,
    left: 10,
    width: '65%',
    padding: 12,
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#22C55E',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  progressTextMobile: {
    fontSize: 12,
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  particle: {
    position: 'absolute',
    borderRadius: 50,
  },
  object: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 7,
  },
  objectGlow: {
    position: 'absolute',
    alignSelf: 'center',
  },
  objectEmoji: {
    textAlign: 'center',
    zIndex: 1,
  },
  celebration: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  celebrationText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFD700',
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  statsContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    padding: 12,
    marginHorizontal: 20,
    borderRadius: 12,
    zIndex: 15,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statsContainerMobile: {
    bottom: 80,
    marginHorizontal: 12,
    padding: 12,
  },
  statsText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  statsTextMobile: {
    fontSize: 16,
  },
  statsSubtext: {
    fontSize: 14,
    color: '#CBD5E1',
  },
  statsSubtextMobile: {
    fontSize: 12,
  },
  skillsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    zIndex: 20,
  },
  skillsContainerMobile: {
    paddingHorizontal: 12,
    paddingBottom: 16,
    paddingTop: 8,
  },
  skillItem: {
    alignItems: 'center',
    flex: 1,
  },
  skillText: {
    fontSize: 12,
    color: '#CBD5E1',
    marginTop: 4,
    textAlign: 'center',
  },
  skillTextMobile: {
    fontSize: 10,
    marginTop: 2,
  },
});
