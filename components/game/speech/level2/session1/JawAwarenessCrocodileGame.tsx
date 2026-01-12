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
  View
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
const CYCLE_DURATION_MS = 3000; // 3 seconds open, 3 seconds closed
const TOTAL_CYCLES = 6;
const MATCH_THRESHOLD = 0.7; // 70% of frames must match for success

// Responsive sizing based on screen dimensions
const getResponsiveSize = (baseSize: number, isTablet: boolean, isMobile: boolean) => {
  if (isTablet) return baseSize * 1.3;
  if (isMobile) return baseSize * 0.9;
  return baseSize;
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

  // Draw mouth opening indicator
  if (landmarks.upperLip.length > 0 && landmarks.lowerLip.length > 0) {
    const upperCenter = landmarks.upperLip[Math.floor(landmarks.upperLip.length / 2)];
    const lowerCenter = landmarks.lowerLip[Math.floor(landmarks.lowerLip.length / 2)];
    
    ctx.strokeStyle = '#FFD93D';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(upperCenter.x * videoWidth * scaleX, upperCenter.y * videoHeight * scaleY);
    ctx.lineTo(lowerCenter.x * videoWidth * scaleX, lowerCenter.y * videoHeight * scaleY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

type ModelState = 'open' | 'closed' | 'transitioning';

export const JawAwarenessCrocodileGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredRounds = TOTAL_CYCLES,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const isTablet = SCREEN_WIDTH >= 768;
  const isMobile = SCREEN_WIDTH < 600;
  
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    correctMatches: number;
    matchAccuracy: number;
    avgOpenHoldMs: number;
    falseOpens: number;
    attentionScore: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [modelState, setModelState] = useState<ModelState>('closed');
  const [canPlay, setCanPlay] = useState(false);
  const [currentCycle, setCurrentCycle] = useState(0);
  
  // Scoring
  const [correctMatches, setCorrectMatches] = useState(0);
  const [matchFrames, setMatchFrames] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [falseOpens, setFalseOpens] = useState(0);
  const openStartTimeRef = useRef<number | null>(null);
  const openHoldTimesRef = useRef<number[]>([]);
  
  // Jaw detection
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : canPlay);
  const { isOpen: childJawOpen, isDetecting, hasCamera, error: jawError } = jawDetection;
  // Web-specific properties (type assertion needed)
  const previewContainerId = (jawDetection as any).previewContainerId;
  const landmarks = (jawDetection as any).landmarks;
  
  // Refs for state management
  const currentJawOpenRef = useRef<boolean>(false);
  const canPlayRef = useRef<boolean>(false);
  const lastChildStateRef = useRef<boolean>(false);
  const matchCheckRef = useRef<{ matches: number; total: number }>({ matches: 0, total: 0 });
  const hasGivenOpenFeedbackRef = useRef<boolean>(false);
  const previousJawOpenForFeedbackRef = useRef<boolean>(false);
  const gameStartedRef = useRef(false);
  const modelStateRef = useRef<ModelState>('closed');
  const stableJawStateRef = useRef<{ state: boolean; since: number } | null>(null);
  const MIN_STABLE_DURATION_MS = 200; // Jaw must be in same state for 200ms to count
  
  // Animations
  const emojiScale = useRef(new Animated.Value(1)).current;
  const emojiOpacity = useRef(new Animated.Value(0)).current;
  const mouthScale = useRef(new Animated.Value(1)).current;
  const starScale = useRef(new Animated.Value(0)).current;
  const starOpacity = useRef(new Animated.Value(0)).current;
  const particleOpacity = useRef(new Animated.Value(0)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  // Timeouts and intervals
  const cycleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const matchCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const gameStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<View>(null);

  // Encouraging phrases
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
  ];
  
  const getRandomEncouragement = () => {
    return encouragingPhrases[Math.floor(Math.random() * encouragingPhrases.length)];
  };

  // Sync refs with state
  useEffect(() => {
    currentJawOpenRef.current = childJawOpen;
  }, [childJawOpen]);
  
  useEffect(() => {
    canPlayRef.current = canPlay;
  }, [canPlay]);

  useEffect(() => {
    modelStateRef.current = modelState;
  }, [modelState]);

  // Reset feedback flag when model state changes to 'open' - ensure fresh state for each round
  useEffect(() => {
    if (modelState === 'open') {
      // Reset all feedback tracking to ensure fresh detection for this round
      hasGivenOpenFeedbackRef.current = false;
      previousJawOpenForFeedbackRef.current = false;
      lastChildStateRef.current = false;
      // Also reset current jaw state ref to ensure we detect a fresh transition
      currentJawOpenRef.current = childJawOpen;
    }
  }, [modelState, childJawOpen]);

  // Direct feedback when child opens mouth during open phase - strict detection
  useEffect(() => {
    // Only check during open phase when game is active and detecting
    if (modelState !== 'open' || !canPlay || !isDetecting) {
      // Update previous state even when not checking to track transitions
      previousJawOpenForFeedbackRef.current = childJawOpen;
      return;
    }
    
    // Check for actual transition from closed to open
    // previousJawOpenForFeedbackRef should be false (closed) and childJawOpen should be true (open)
    const wasClosed = previousJawOpenForFeedbackRef.current === false;
    const isNowOpen = childJawOpen === true;
    const justOpened = wasClosed && isNowOpen;
    
    // Update previous state for next check
    const previousState = previousJawOpenForFeedbackRef.current;
    previousJawOpenForFeedbackRef.current = childJawOpen;
    
    // Only give feedback if:
    // 1. Child just transitioned from closed to open (actual transition detected)
    // 2. We haven't given feedback yet for this round's open phase
    // 3. Model is actually in 'open' state
    // 4. Detection is working
    // 5. This is a real transition (not just state persistence)
    if (justOpened && !hasGivenOpenFeedbackRef.current && isDetecting) {
      // Add a small delay to ensure the state is stable
      const feedbackTimer = setTimeout(() => {
        // Triple-check conditions before giving feedback
        if (
          currentJawOpenRef.current === true && 
          modelState === 'open' && 
          canPlayRef.current && 
          isDetecting &&
          !hasGivenOpenFeedbackRef.current // Double-check we haven't given it yet
        ) {
          hasGivenOpenFeedbackRef.current = true;
          const encouragement = getRandomEncouragement();
          speak(encouragement);
          
          try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {}
        }
      }, 200); // Slightly longer delay to ensure stable detection
      
      return () => clearTimeout(feedbackTimer);
    }
    
    // Update last child state for tracking
    if (lastChildStateRef.current !== childJawOpen) {
      lastChildStateRef.current = childJawOpen;
    }
  }, [childJawOpen, modelState, canPlay, isDetecting]);

  // Pulse animation for emoji when active
  useEffect(() => {
    if (canPlay && modelState === 'open') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [canPlay, modelState, pulseAnim]);

  const finishGame = useCallback(async () => {
    if (cycleTimeoutRef.current) {
      clearTimeout(cycleTimeoutRef.current);
      cycleTimeoutRef.current = null;
    }
    if (matchCheckIntervalRef.current) {
      clearInterval(matchCheckIntervalRef.current);
      matchCheckIntervalRef.current = null;
    }
    if (gameStartTimeoutRef.current) {
      clearTimeout(gameStartTimeoutRef.current);
      gameStartTimeoutRef.current = null;
    }
    
    setGameFinished(true);
    clearScheduledSpeech();

    const totalCycles = currentCycle > 0 ? currentCycle : 1;
    const matchAccuracy = totalFrames > 0 ? (matchFrames / totalFrames) * 100 : 0;
    const avgOpenHoldMs = openHoldTimesRef.current.length > 0
      ? openHoldTimesRef.current.reduce((a, b) => a + b, 0) / openHoldTimesRef.current.length
      : 0;
    const attentionScore = Math.min(100, Math.round(matchAccuracy * 0.7 + (correctMatches / totalCycles) * 30));
    const xp = correctMatches * 50;

    setFinalStats({
      totalRounds: totalCycles,
      correctMatches,
      matchAccuracy,
      avgOpenHoldMs,
      falseOpens,
      attentionScore,
      xpAwarded: xp,
    });

    try {
      await logGameAndAward({
        type: 'jaw-awareness-crocodile',
        correct: correctMatches,
        total: totalCycles,
        accuracy: matchAccuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['jaw-awareness', 'oral-motor-control', 'imitation', 'speech-therapy'],
        incorrectAttempts: totalCycles - correctMatches,
        meta: {
          openCloseCycles: totalCycles,
          matchAccuracy,
          avgOpenHoldMs,
          falseOpens,
          attentionScore,
        },
      });
      onComplete?.();
    } catch (e) {
      console.warn('Failed to save game log:', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [correctMatches, currentCycle, matchFrames, totalFrames, falseOpens, onComplete]);

  const startCycle = useCallback(() => {
    setCurrentCycle(prev => {
      const nextCycle = prev + 1;
      if (nextCycle > requiredRounds) {
        finishGame();
        return prev;
      }
      return nextCycle;
    });
    
    // Reset ALL feedback and detection state for new cycle
    matchCheckRef.current = { matches: 0, total: 0 };
    hasGivenOpenFeedbackRef.current = false;
    previousJawOpenForFeedbackRef.current = false; // Reset this too!
    lastChildStateRef.current = false;
    stableJawStateRef.current = null; // Reset stability tracking for new cycle
    openStartTimeRef.current = null; // Reset open hold tracking

    // Clear any scheduled speech first, then speak the instruction
    clearScheduledSpeech();
    
    // Set model state first
    setModelState('open');
    
    // Small delay to ensure speech system is ready and state is set
    setTimeout(() => {
      speak('Open your mouth!', DEFAULT_TTS_RATE);
    }, 200);

    // Animate emoji mouth opening
    Animated.parallel([
      Animated.spring(mouthScale, {
        toValue: 1.3,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(emojiScale, {
        toValue: 1.1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Check for matches during open phase - fresh detection for this round
    let isOpenPhase = true;
    const checkMatches = () => {
      const currentCanPlay = canPlayRef.current;
      const currentModelState = modelStateRef.current; // Use ref for current state
      
      // Only check matches if:
      // 1. We're in the open phase
      // 2. Game can play
      // 3. Model is actually in 'open' state
      // 4. Detection is working
      if (isOpenPhase && currentCanPlay && currentModelState === 'open' && isDetecting) {
        const currentState = currentJawOpenRef.current;
        const now = Date.now();
        
        // Track stable jaw state (prevents false positives from flickering)
        // This ensures we only count stable states, not rapid flickering
        if (stableJawStateRef.current?.state === currentState) {
          // Same state, check if it's been stable long enough
          if (now - stableJawStateRef.current.since >= MIN_STABLE_DURATION_MS) {
            matchCheckRef.current.total++;
            setTotalFrames(prev => prev + 1);
            
            // Only count as match if child's jaw is actually open (matching model's open state)
            if (currentState === true) {
              matchCheckRef.current.matches++;
              setMatchFrames(prev => prev + 1);
              
              if (!openStartTimeRef.current) {
                openStartTimeRef.current = Date.now();
              }
            } else {
              // Jaw is closed when it should be open - not a match
              if (openStartTimeRef.current) {
                const holdTime = Date.now() - openStartTimeRef.current;
                openHoldTimesRef.current.push(holdTime);
                openStartTimeRef.current = null;
              }
            }
          }
        } else {
          // State changed, reset stability tracking - fresh detection for this round
          stableJawStateRef.current = { state: currentState, since: now };
        }
        
        // Update last child state for tracking
        if (lastChildStateRef.current !== currentState) {
          lastChildStateRef.current = currentState;
        }
      }
    };

    matchCheckIntervalRef.current = setInterval(checkMatches, 100) as unknown as NodeJS.Timeout;

    // After CYCLE_DURATION_MS, model closes
    cycleTimeoutRef.current = (setTimeout(() => {
      isOpenPhase = false;
      if (matchCheckIntervalRef.current) {
        clearInterval(matchCheckIntervalRef.current);
        matchCheckIntervalRef.current = null;
      }

      const matchRate = matchCheckRef.current.total > 0
        ? matchCheckRef.current.matches / matchCheckRef.current.total
        : 0;
      
      if (matchRate >= MATCH_THRESHOLD) {
        setCorrectMatches(prev => prev + 1);
        
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}

        Animated.parallel([
          Animated.spring(starScale, {
            toValue: 1.2,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(starOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(particleOpacity, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(particleOpacity, {
              toValue: 0,
              duration: 800,
              useNativeDriver: true,
            }),
          ]),
        ]).start();

        // Don't speak - we'll show animation when cycle completes
      }

      setModelState('closed');
      // Reset feedback flag for closed phase (in case we need it later)
      hasGivenOpenFeedbackRef.current = false;
      previousJawOpenForFeedbackRef.current = childJawOpen; // Track current state
      
      // Clear any scheduled speech and speak the instruction
      clearScheduledSpeech();
      setTimeout(() => {
        speak('Close your mouth!');
      }, 100);

      Animated.parallel([
        Animated.spring(mouthScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(emojiScale, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();

      // Check for matches during closed phase - fresh detection for this phase
      matchCheckRef.current = { matches: 0, total: 0 };
      stableJawStateRef.current = null; // Reset stability tracking for closed phase
      // Reset feedback tracking for closed phase
      hasGivenOpenFeedbackRef.current = false;
      previousJawOpenForFeedbackRef.current = childJawOpen; // Track current state for closed phase
      let isClosedPhase = true;
      const checkClosedMatches = () => {
        const currentCanPlay = canPlayRef.current;
        const currentModelState = modelStateRef.current; // Use ref for current state
        
        // Only check matches if:
        // 1. We're in the closed phase
        // 2. Game can play
        // 3. Model is actually in 'closed' state
        // 4. Detection is working
        if (isClosedPhase && currentCanPlay && currentModelState === 'closed' && isDetecting) {
          const currentState = currentJawOpenRef.current;
          const now = Date.now();
          
          // Track stable jaw state (prevents false positives from flickering)
          if (stableJawStateRef.current?.state === currentState) {
            // Same state, check if it's been stable long enough
            if (now - stableJawStateRef.current.since >= MIN_STABLE_DURATION_MS) {
              matchCheckRef.current.total++;
              setTotalFrames(prev => prev + 1);
              
              // Only count as match if child's jaw is actually closed (matching model's closed state)
              if (currentState === false) {
                matchCheckRef.current.matches++;
                setMatchFrames(prev => prev + 1);
              } else {
                // Jaw is open when it should be closed - false open
                setFalseOpens(prev => prev + 1);
              }
            }
          } else {
            // State changed, reset stability tracking
            stableJawStateRef.current = { state: currentState, since: now };
          }
        }
      };

      matchCheckIntervalRef.current = setInterval(checkClosedMatches, 100) as unknown as NodeJS.Timeout;

      // After CYCLE_DURATION_MS, start next cycle or finish
      cycleTimeoutRef.current = (setTimeout(() => {
        isClosedPhase = false;
        if (matchCheckIntervalRef.current) {
          clearInterval(matchCheckIntervalRef.current);
          matchCheckIntervalRef.current = null;
        }

        setCurrentCycle(prevCycle => {
          Animated.timing(progressBarWidth, {
            toValue: (prevCycle / requiredRounds) * 100,
            duration: 400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
          }).start();
          return prevCycle;
        });

        Animated.parallel([
          Animated.timing(starOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(starScale, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();

        // Show success animation before starting next cycle
        setShowRoundSuccess(true);
        setTimeout(() => {
          setShowRoundSuccess(false);
          startCycle();
        }, 2500);
      }, CYCLE_DURATION_MS)) as unknown as NodeJS.Timeout;
    }, CYCLE_DURATION_MS)) as unknown as NodeJS.Timeout;
  }, [requiredRounds, finishGame, progressBarWidth]);

  const startGame = useCallback(() => {
    if (gameStartedRef.current) return;
    
    if (!hasCamera) {
      if (Platform.OS === 'web') {
        const checkCamera = (attempts = 0) => {
          if (hasCamera) {
            gameStartedRef.current = true;
            setCanPlay(true);
            speak('Watch the emoji and copy its mouth!');
          } else if (jawError) {
            speak('Camera access denied. Please allow camera access and refresh the page.');
          } else if (attempts < 5) {
            setTimeout(() => checkCamera(attempts + 1), 1000);
          } else {
            speak('Camera not available. Please check your browser permissions.');
          }
        };
        setTimeout(() => checkCamera(), 500);
        return;
      } else {
        speak('Camera not available. Please use a dev build.');
        return;
      }
    }

    gameStartedRef.current = true;
    setCanPlay(true);
    speak('Watch the emoji and copy its mouth!');
    
    Animated.parallel([
      Animated.spring(emojiScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(emojiOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    gameStartTimeoutRef.current = setTimeout(() => {
      startCycle();
    }, 2000) as unknown as NodeJS.Timeout;
  }, [hasCamera, jawError, startCycle]);

  useEffect(() => {
    if (hasCamera && !gameStartedRef.current) {
      startGame();
    } else if (!hasCamera && Platform.OS === 'web' && !jawError) {
      const timeout = setTimeout(() => {
        if (hasCamera && !gameStartedRef.current) {
          startGame();
        }
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [hasCamera, jawError, startGame]);

  // Web: Explicitly set data-native-id attribute on container element
  useEffect(() => {
    if (Platform.OS !== 'web' || !previewContainerId) return;

    const setAttribute = () => {
      try {
        let element: HTMLElement | null = null;
        
        // Try to find by data-native-id first
        if (previewContainerId) {
          element = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
        }
        
        // Try nativeID attribute
        if (!element && previewContainerId) {
          element = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
        }
        
        // Try by ref
        if (!element && previewRef.current) {
          try {
            const refElement = (previewRef.current as any)?.base || 
                             (previewRef.current as any)?._nativeNode ||
                             previewRef.current;
            if (refElement && refElement.setAttribute) {
              element = refElement;
            }
          } catch {}
        }
        
        // Try querySelector with nativeID
        if (!element && previewContainerId) {
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
          if (!element.getAttribute('data-jaw-preview-container')) {
            element.setAttribute('data-jaw-preview-container', 'true');
          }
        }
      } catch (e) {
        // Silently fail
      }
    };

    // Try immediately
    setAttribute();
    
    // Retry with delay to catch late mounting
    const timeout = setTimeout(setAttribute, 100);
    const timeout2 = setTimeout(setAttribute, 500);
    
    return () => {
      clearTimeout(timeout);
      clearTimeout(timeout2);
    };
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
                           (previewRef.current as any)?._nativeNode ||
                           previewRef.current;
          if (refElement) {
            container = refElement;
          }
        } catch {}
      }
      
      // Try to find by walking DOM
      if (!container) {
        const allDivs = Array.from(document.querySelectorAll('div'));
        container = allDivs.find((div) => {
          const nativeId = div.getAttribute('data-native-id') || 
                          div.getAttribute('nativeID') || 
                          (div as any).nativeID;
          return nativeId === previewContainerId || nativeId === 'jaw-preview-container';
        }) as HTMLElement || null;
      }

      if (!container) return;

      // Ensure attributes are set
      if (!container.getAttribute('data-native-id')) {
        container.setAttribute('data-native-id', previewContainerId);
      }
      if (!container.getAttribute('data-jaw-preview-container')) {
        container.setAttribute('data-jaw-preview-container', 'true');
      }
    };

    // Try immediately
    setupContainer();
    
    // Retry with delays
    const timeout1 = setTimeout(setupContainer, 100);
    const timeout2 = setTimeout(setupContainer, 500);
    const timeout3 = setTimeout(setupContainer, 1000);
    
    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
      clearTimeout(timeout3);
    };
  }, [previewContainerId, hasCamera, isDetecting, canPlay]);

  // Setup canvas overlay for web
  useEffect(() => {
    if (Platform.OS !== 'web' || !hasCamera) return;

    const setupCanvas = (attempts = 0) => {
      let container: HTMLElement | null = null;
      
      const videoElement = document.querySelector('video[data-jaw-preview-video]') as HTMLVideoElement;
      if (videoElement?.parentElement) {
        container = videoElement.parentElement as HTMLElement;
      }
      
      if (!container && previewRef.current) {
        try {
          const refNode = (previewRef.current as any)?._nativeNode || 
                         (previewRef.current as any)?._node ||
                         (previewRef.current as any)?.current;
          if (refNode instanceof HTMLElement) {
            container = refNode;
          }
        } catch (e) {}
      }
      
      if (!container) {
        container = document.querySelector('[data-native-id="jaw-preview-container"]') as HTMLElement;
      }
      
      if (!container) {
        if (attempts < 30) {
          setTimeout(() => setupCanvas(attempts + 1), 100);
        }
        return;
      }

      let canvas = container.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '100';
        canvas.style.borderRadius = '12px';
        canvas.style.backgroundColor = 'transparent';
        container.appendChild(canvas);
        canvasRef.current = canvas;
      }

      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        canvas.width = container.offsetWidth;
        canvas.height = container.offsetHeight;
      }
    };

    setupCanvas();
  }, [hasCamera, previewContainerId, landmarks]);

  // Update canvas when landmarks change
  useEffect(() => {
    if (Platform.OS !== 'web' || !landmarks) return;
    
    const ensureCanvasAndDraw = (attempt = 0): boolean => {
      let container: HTMLElement | null = null;
      
      const videoElement = document.querySelector('video[data-jaw-preview-video]') as HTMLVideoElement;
      if (videoElement?.parentElement) {
        container = videoElement.parentElement as HTMLElement;
      }
      
      if (!container) {
        container = document.querySelector('[data-native-id="jaw-preview-container"]') as HTMLElement;
      }
      
      if (!container) {
        if (attempt < 20) {
          setTimeout(() => ensureCanvasAndDraw(attempt + 1), 100);
        }
        return false;
      }
      
      let canvas = container.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '100';
        canvas.style.borderRadius = '12px';
        canvas.style.backgroundColor = 'transparent';
        container.appendChild(canvas);
        canvasRef.current = canvas;
      }
      
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        canvas.width = container.offsetWidth;
        canvas.height = container.offsetHeight;
      }
      
      try {
        drawLandmarks(canvas, landmarks);
        return true;
      } catch (error) {
        return false;
      }
    };
    
    ensureCanvasAndDraw(0);
  }, [landmarks]);

  useEffect(() => {
    return () => {
      clearScheduledSpeech();
      if (cycleTimeoutRef.current) clearTimeout(cycleTimeoutRef.current);
      if (matchCheckIntervalRef.current) clearInterval(matchCheckIntervalRef.current);
      if (gameStartTimeoutRef.current) clearTimeout(gameStartTimeoutRef.current);
    };
  }, []);

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
  const emojiSize = getResponsiveSize(150, isTablet, isMobile);
  const cameraPreviewSize = getResponsiveSize(120, isTablet, isMobile);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#E0F2FE', '#BAE6FD', '#7DD3FC']}
        style={styles.gradient}
      >
        {/* Header Overlay */}
        <View style={[styles.header, { zIndex: 20 }]}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              onBack();
            }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Jaw Awareness</Text>
            <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
              {canPlay ? 'Copy the emoji!' : 'Get ready...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
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

          {/* Camera Status Overlay - Small corner indicator */}
          {hasCamera && (
            <View style={[
              styles.cameraStatusOverlay,
              {
                width: cameraPreviewSize,
                height: cameraPreviewSize * 1.33,
                top: isMobile ? 10 : 20,
                right: isMobile ? 10 : 20,
              }
            ]}>
              <View style={styles.cameraOverlay}>
                <View style={[
                  styles.jawStatusIndicator,
                  childJawOpen ? styles.jawOpen : styles.jawClosed
                ]}>
                  <Text style={styles.jawStatusText}>
                    {childJawOpen ? 'OPEN ✅' : 'CLOSED ⛔'}
                  </Text>
                </View>
                {!isDetecting && (
                  <Text style={styles.detectionWarning}>
                    Position your face
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Error Message */}
          {jawError && (
            <View style={[styles.errorBanner, isMobile && styles.errorBannerMobile]}>
              <Ionicons name="alert-circle" size={24} color="#EF4444" />
              <Text style={styles.errorText}>{jawError}</Text>
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
                Round {currentCycle} / {requiredRounds}
              </Text>
            </View>
          )}

          {/* Model Emoji */}
          <View style={styles.emojiContainer}>
            <Animated.View
              style={[
                styles.emojiWrapper,
                {
                  transform: [
                    { scale: Animated.multiply(emojiScale, pulseAnim) },
                  ],
                  opacity: emojiOpacity,
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.emojiMain,
                  {
                    width: emojiSize,
                    height: emojiSize,
                    transform: [{ scaleY: mouthScale }],
                  },
                ]}
              >
                <Text style={[styles.emojiText, { fontSize: emojiSize * 0.75 }]}>
                  {modelState === 'open' ? '😮' : '😐'}
                </Text>
              </Animated.View>

              <View style={[styles.modelIndicator, isMobile && styles.modelIndicatorMobile]}>
                <Text style={[styles.modelIndicatorText, isMobile && styles.modelIndicatorTextMobile]}>
                  {modelState === 'open' ? 'OPEN YOUR MOUTH' : 'CLOSE YOUR MOUTH'}
                </Text>
              </View>
            </Animated.View>
          </View>

          {/* Star Reward */}
          <Animated.View
            style={[
              styles.starContainer,
              {
                transform: [{ scale: starScale }],
                opacity: starOpacity,
              },
            ]}
          >
            <Text style={[styles.starEmoji, { fontSize: getResponsiveSize(60, isTablet, isMobile) }]}>⭐</Text>
          </Animated.View>

          {/* Particle Effects */}
          <Animated.View
            style={[
              styles.particles,
              {
                opacity: particleOpacity,
              },
            ]}
            pointerEvents="none"
          >
            {[...Array(8)].map((_, i) => {
              const angle = (i * 45) * (Math.PI / 180);
              const distance = getResponsiveSize(80, isTablet, isMobile);
              return (
                <View
                  key={i}
                  style={[
                    styles.particle,
                    {
                      transform: [
                        { translateX: Math.cos(angle) * distance },
                        { translateY: Math.sin(angle) * distance },
                      ],
                    },
                  ]}
                >
                  <Text style={[styles.particleEmoji, { fontSize: getResponsiveSize(24, isTablet, isMobile) }]}>✨</Text>
                </View>
              );
            })}
          </Animated.View>

          {/* Stats */}
          <View style={[styles.statsContainer, isMobile && styles.statsContainerMobile]}>
            <Text style={[styles.statsText, isMobile && styles.statsTextMobile]}>
              Matches: {correctMatches} / {currentCycle}
            </Text>
            <Text style={[styles.statsSubtext, isMobile && styles.statsSubtextMobile]}>
              Accuracy: {Math.round(matchAccuracy)}% • False Opens: {falseOpens}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={[styles.skillsContainer, isMobile && styles.skillsContainerMobile]}>
          <View style={styles.skillItem}>
            <Ionicons name="medical" size={isMobile ? 18 : 20} color="#0F172A" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Jaw Awareness</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="copy" size={isMobile ? 18 : 20} color="#0F172A" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Imitation</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="musical-notes" size={isMobile ? 18 : 20} color="#0F172A" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Oral Motor</Text>
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
    backgroundColor: 'rgba(224, 242, 254, 0.95)', // Semi-transparent background for visibility over camera
    position: 'relative',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginRight: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginLeft: 4,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  titleMobile: {
    fontSize: 20,
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginTop: 2,
  },
  subtitleMobile: {
    fontSize: 12,
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    position: 'relative',
  },
  cameraContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
  },
  cameraLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  cameraLoadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  cameraStatusOverlay: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 15,
    backgroundColor: 'transparent',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
    alignItems: 'center',
  },
  jawStatusIndicator: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 4,
  },
  jawOpen: {
    backgroundColor: '#22C55E',
  },
  jawClosed: {
    backgroundColor: '#64748B',
  },
  jawStatusText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  detectionWarning: {
    color: '#FCD34D',
    fontSize: 8,
    textAlign: 'center',
  },
  errorBanner: {
    position: 'absolute',
    top: 40,
    width: '90%',
    backgroundColor: '#FEE2E2',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#EF4444',
    zIndex: 15,
  },
  errorBannerMobile: {
    top: 60,
    padding: 12,
    width: '95%',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    marginLeft: 12,
    flex: 1,
  },
  progressBarContainer: {
    position: 'absolute',
    top: 20,
    width: '85%',
    alignItems: 'center',
    zIndex: 5,
  },
  progressBarContainerMobile: {
    top: 60,
    width: '90%',
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
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
    color: '#0F172A',
  },
  progressTextMobile: {
    fontSize: 12,
  },
  emojiContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  emojiWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiMain: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  emojiText: {
    textAlign: 'center',
  },
  modelIndicator: {
    marginTop: 20,
    backgroundColor: '#3B82F6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
  },
  modelIndicatorMobile: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  modelIndicatorText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modelIndicatorTextMobile: {
    fontSize: 14,
  },
  starContainer: {
    position: 'absolute',
    top: '35%',
    alignItems: 'center',
    zIndex: 8,
  },
  starEmoji: {
    textAlign: 'center',
  },
  particles: {
    position: 'absolute',
    top: '35%',
    width: 0,
    height: 0,
    zIndex: 7,
  },
  particle: {
    position: 'absolute',
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  particleEmoji: {
    textAlign: 'center',
  },
  statsContainer: {
    position: 'absolute',
    bottom: 100,
    alignItems: 'center',
  },
  statsContainerMobile: {
    bottom: 80,
  },
  statsText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 4,
  },
  statsTextMobile: {
    fontSize: 16,
  },
  statsSubtext: {
    fontSize: 14,
    color: '#475569',
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
    color: '#475569',
    marginTop: 4,
    textAlign: 'center',
  },
  skillTextMobile: {
    fontSize: 10,
    marginTop: 2,
  },
});
