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
const BEAT_DURATION_MS = 1200; // Base beat duration - slower for kids
const TOTAL_PATTERNS = 6;
const PERFECT_TIMING_WINDOW = 250; // ms window for perfect timing - more forgiving
const GOOD_TIMING_WINDOW = 500; // ms window for good timing - more forgiving
const JAW_STATE_DEBOUNCE_MS = 100; // Debounce time for jaw state changes

// Responsive sizing
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

type BeatAction = 'open' | 'close';

interface BeatPattern {
  action: BeatAction;
  timing: number; // ms from pattern start
}

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
  'Nice timing!',
  'That\'s it!',
];

const getRandomEncouragement = () => {
  return encouragingPhrases[Math.floor(Math.random() * encouragingPhrases.length)];
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
    ctx.lineWidth = 2;

    landmarks.allMouthLandmarks.forEach((point) => {
      const x = point.x * videoWidth * scaleX;
      const y = point.y * videoHeight * scaleY;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  // Draw upper lip line
  if (landmarks.upperLip.length > 0) {
    ctx.strokeStyle = '#4ECDC4';
    ctx.lineWidth = 3;
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
    ctx.lineWidth = 3;
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

  // Draw mouth opening indicator line
  if (landmarks.mouthLeft && landmarks.mouthRight) {
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    const leftX = landmarks.mouthLeft.x * videoWidth * scaleX;
    const leftY = landmarks.mouthLeft.y * videoHeight * scaleY;
    const rightX = landmarks.mouthRight.x * videoWidth * scaleX;
    const rightY = landmarks.mouthRight.y * videoHeight * scaleY;
    ctx.moveTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export const JawRhythmTapGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredRounds = TOTAL_PATTERNS,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const isTablet = SCREEN_WIDTH >= 768;
  const isMobile = SCREEN_WIDTH < 600;
  
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalPatterns: number;
    perfectBeats: number;
    goodBeats: number;
    missedBeats: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [canPlay, setCanPlay] = useState(false);
  const [currentPattern, setCurrentPattern] = useState(0);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [jawState, setJawState] = useState<'open' | 'close'>('close');
  const [score, setScore] = useState(0);
  const [patternActive, setPatternActive] = useState(false);
  const [nextBeatIndex, setNextBeatIndex] = useState(0); // State for render
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const lastBeatChangeTimeRef = useRef<number>(0);
  const MIN_EMOJI_DISPLAY_TIME = 400; // Minimum time to show each emoji (ms)
  
  // Scoring
  const [perfectBeats, setPerfectBeats] = useState(0);
  const [goodBeats, setGoodBeats] = useState(0);
  const [missedBeats, setMissedBeats] = useState(0);
  const [totalBeats, setTotalBeats] = useState(0);
  
  // Pattern generation
  const [currentPatternBeats, setCurrentPatternBeats] = useState<BeatPattern[]>([]);
  const patternStartTimeRef = useRef<number>(0);
  const nextBeatIndexRef = useRef<number>(0);
  const lastJawStateRef = useRef<'open' | 'close'>('close');
  const lastJawStateChangeTimeRef = useRef<number>(0);
  const beatProcessedRef = useRef<Set<number>>(new Set());
  
  // Jaw detection
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : canPlay);
  const { 
    isOpen, 
    isDetecting, 
    hasCamera, 
    error: jawError,
  } = jawDetection;
  
  // Web-specific properties
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const landmarks = (jawDetection as any).landmarks as MouthLandmarks | null | undefined;
  
  // Refs
  const gameStartedRef = useRef(false);
  const beatTimersRef = useRef<NodeJS.Timeout[]>([]);
  const patternTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rhythmAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const previewRef = useRef<View>(null);
  const canvasRef = useRef<any>(null);
  
  // Animations
  const beatCircleScale = useRef(new Animated.Value(1)).current;
  const beatCircleOpacity = useRef(new Animated.Value(0.5)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;
  const rhythmIndicator = useRef(new Animated.Value(0)).current;
  const jawStateIndicatorScale = useRef(new Animated.Value(1)).current;
  const feedbackColor = useRef(new Animated.Value(0)).current; // 0 = red, 1 = yellow, 2 = green

  const generatePattern = useCallback((): BeatPattern[] => {
    const beats: BeatPattern[] = [];
    // Start with 4 beats, increase by 1 every 2 patterns for gradual difficulty
    const patternLength = 4 + Math.floor(currentPattern / 2);
    let currentTime = 0;
    // Slower progression for kids - only reduce by 30ms per pattern instead of 50ms
    // Ensure minimum interval of 800ms for very young children
    const beatInterval = Math.max(800, BEAT_DURATION_MS - (currentPattern * 30));
    
    // Generate alternating pattern: open, close, open, close...
    for (let i = 0; i < patternLength; i++) {
      const action: BeatAction = i % 2 === 0 ? 'open' : 'close';
      beats.push({
        action,
        timing: currentTime,
      });
      currentTime += beatInterval;
    }
    
    return beats;
  }, [currentPattern]);

  const triggerBeat = useCallback((action: BeatAction, fromCamera: boolean = false) => {
    if (!canPlay || !patternActive) return;
    
    const now = Date.now();
    const expectedBeat = currentPatternBeats[nextBeatIndexRef.current];
    
    if (!expectedBeat) return;
    
    // Check if this beat was already processed
    if (beatProcessedRef.current.has(nextBeatIndexRef.current)) {
      return;
    }
    
    // Check if action matches expected beat
    if (action !== expectedBeat.action) {
      return; // Wrong action, don't process
    }
    
    const timingDiff = Math.abs(now - (patternStartTimeRef.current + expectedBeat.timing));
    
    // Mark this beat as processed
    beatProcessedRef.current.add(nextBeatIndexRef.current);
    
    if (timingDiff <= PERFECT_TIMING_WINDOW) {
      // Perfect timing
      setPerfectBeats(prev => prev + 1);
      setScore(prev => prev + 20);
      
      // Green feedback
      Animated.sequence([
        Animated.timing(feedbackColor, {
          toValue: 2,
          duration: 100,
          useNativeDriver: false,
        }),
        Animated.timing(feedbackColor, {
          toValue: 0,
          duration: 300,
          useNativeDriver: false,
        }),
      ]).start();
      
      Animated.sequence([
        Animated.parallel([
          Animated.spring(beatCircleScale, {
            toValue: 1.4,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(celebrationOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.spring(beatCircleScale, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(celebrationOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
      
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
      
      if (fromCamera) {
        const encouragement = getRandomEncouragement();
        speak(encouragement);
      }
    } else if (timingDiff <= GOOD_TIMING_WINDOW) {
      // Good timing
      setGoodBeats(prev => prev + 1);
      setScore(prev => prev + 10);
      
      // Yellow feedback
      Animated.sequence([
        Animated.timing(feedbackColor, {
          toValue: 1,
          duration: 100,
          useNativeDriver: false,
        }),
        Animated.timing(feedbackColor, {
          toValue: 0,
          duration: 300,
          useNativeDriver: false,
        }),
      ]).start();
      
      Animated.spring(beatCircleScale, {
        toValue: 1.2,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }).start(() => {
        Animated.spring(beatCircleScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }).start();
      });
      
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
      
      if (fromCamera) {
        speak('Good!');
      }
    } else {
      // Too early or too late - still count as attempt but mark as missed
      setMissedBeats(prev => prev + 1);
      
      // Red feedback
      Animated.sequence([
        Animated.timing(feedbackColor, {
          toValue: 0,
          duration: 100,
          useNativeDriver: false,
        }),
        Animated.timing(feedbackColor, {
          toValue: 0,
          duration: 200,
          useNativeDriver: false,
        }),
      ]).start();
    }
    
    setTotalBeats(prev => prev + 1);
    nextBeatIndexRef.current++;
    setNextBeatIndex(nextBeatIndexRef.current); // Sync state for render
    
    // Update jaw state indicator
    Animated.sequence([
      Animated.spring(jawStateIndicatorScale, {
        toValue: 1.3,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.spring(jawStateIndicatorScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
    
    setJawState(action);
  }, [canPlay, patternActive, currentPatternBeats, feedbackColor]);

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

  // Camera-based jaw detection with improved state tracking
  useEffect(() => {
    if (!canPlay || !patternActive || !isDetecting) return;
    
    const currentState = isOpen ? 'open' : 'close';
    const now = Date.now();
    
    // Debounce rapid state changes to prevent false triggers
    if (currentState !== lastJawStateRef.current) {
      const timeSinceLastChange = now - lastJawStateChangeTimeRef.current;
      
      // Only process if enough time has passed since last change
      if (timeSinceLastChange > JAW_STATE_DEBOUNCE_MS) {
        const previousState = lastJawStateRef.current;
        lastJawStateRef.current = currentState;
        lastJawStateChangeTimeRef.current = now;
        
        // Only trigger beat if we have a valid state transition
        // This prevents triggering on initial state or rapid flickering
        if (previousState !== undefined && previousState !== currentState) {
          // Trigger beat detection with camera flag
          triggerBeat(currentState, true);
        }
      }
    }
  }, [isOpen, canPlay, patternActive, isDetecting, triggerBeat]);

  const finishGame = useCallback(async () => {
    // Cleanup all timers and animations
    if (patternTimeoutRef.current) {
      clearTimeout(patternTimeoutRef.current);
      patternTimeoutRef.current = null;
    }
    beatTimersRef.current.forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    beatTimersRef.current = [];
    
    if (rhythmAnimationRef.current) {
      rhythmAnimationRef.current.stop();
      rhythmAnimationRef.current = null;
    }
    
    setPatternActive(false);
    setGameFinished(true);
    clearScheduledSpeech();
    
    // Reset jaw state tracking
    lastJawStateRef.current = 'close';
    lastJawStateChangeTimeRef.current = 0;

    const totalPatterns = currentPattern > 0 ? currentPattern : 1;
    const accuracy = totalBeats > 0 
      ? ((perfectBeats + goodBeats) / totalBeats) * 100 
      : 0;
    const xp = perfectBeats * 30 + goodBeats * 15;

    setFinalStats({
      totalPatterns,
      perfectBeats,
      goodBeats,
      missedBeats,
      accuracy,
      xpAwarded: xp,
    });

    try {
      await logGameAndAward({
        type: 'jaw-rhythm-tap',
        correct: perfectBeats + goodBeats,
        total: totalBeats,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['jaw-awareness', 'rhythm', 'coordination', 'timing'],
        incorrectAttempts: missedBeats,
        meta: {
          perfectBeats,
          goodBeats,
          missedBeats,
        },
      });
      onComplete?.();
    } catch (e) {
      console.warn('Failed to save game log:', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [perfectBeats, goodBeats, missedBeats, totalBeats, currentPattern, onComplete]);

  const startPattern = useCallback(() => {
    if (currentPattern >= requiredRounds) {
      finishGame();
      return;
    }
    
    const nextPattern = currentPattern + 1;
    setCurrentPattern(nextPattern);
    
    const pattern = generatePattern();
    setCurrentPatternBeats(pattern);
    setCurrentBeat(0);
    nextBeatIndexRef.current = 0;
    setNextBeatIndex(0); // Sync state
    beatProcessedRef.current.clear();
    patternStartTimeRef.current = Date.now();
    lastBeatChangeTimeRef.current = Date.now();
    setPatternActive(true);
    
    speak(`Pattern ${nextPattern}! Follow the rhythm!`);
    
    // Stop previous rhythm animation
    if (rhythmAnimationRef.current) {
      rhythmAnimationRef.current.stop();
    }
    
    // Animate rhythm indicator - use same interval as pattern generation
    // Calculate beat interval matching pattern generation
    const beatInterval = Math.max(800, BEAT_DURATION_MS - (currentPattern * 30));
    rhythmIndicator.setValue(0);
    rhythmAnimationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(rhythmIndicator, {
          toValue: 1,
          duration: beatInterval,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(rhythmIndicator, {
          toValue: 0,
          duration: beatInterval,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    rhythmAnimationRef.current.start();
    
    // Schedule beat indicators
    beatTimersRef.current.forEach(timer => clearTimeout(timer));
    beatTimersRef.current = [];
    
    pattern.forEach((beat, index) => {
      // Show emoji earlier (400ms before beat) so kids have time to see it and prepare
      const previewTime = Math.max(0, beat.timing - 400);
      
      // Preview timer - show the emoji early with minimum display time check
      const previewTimer = setTimeout(() => {
        const now = Date.now();
        // Only change emoji if enough time has passed since last change
        if (now - lastBeatChangeTimeRef.current >= MIN_EMOJI_DISPLAY_TIME || index === 0) {
          setCurrentBeat(index);
          lastBeatChangeTimeRef.current = now;
        } else {
          // If too soon, schedule it for later
          const delay = MIN_EMOJI_DISPLAY_TIME - (now - lastBeatChangeTimeRef.current);
          setTimeout(() => {
            setCurrentBeat(index);
            lastBeatChangeTimeRef.current = Date.now();
          }, delay);
        }
      }, previewTime) as unknown as NodeJS.Timeout;
      beatTimersRef.current.push(previewTimer);
      
      // Beat timer - actual beat timing
      const timer = setTimeout(() => {
        // Visual indicator for expected beat
        Animated.sequence([
          Animated.timing(beatCircleOpacity, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(beatCircleOpacity, {
            toValue: 0.5,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
        
        // Keep emoji visible - don't change it immediately
        // The emoji will stay until the next preview timer fires
        
        // If beat was missed, mark it (only if we haven't moved past this beat)
        if (!beatProcessedRef.current.has(index) && index === nextBeatIndexRef.current) {
          setMissedBeats(prev => prev + 1);
          setTotalBeats(prev => prev + 1);
          // Mark as processed to prevent double counting
          beatProcessedRef.current.add(index);
          nextBeatIndexRef.current++;
          setNextBeatIndex(nextBeatIndexRef.current); // Sync state
        }
      }, beat.timing) as unknown as NodeJS.Timeout;
      
      beatTimersRef.current.push(timer);
    });
    
    // End pattern after last beat + buffer (use calculated beat interval from above)
    const patternDuration = pattern[pattern.length - 1].timing + beatInterval * 2;
    if (patternTimeoutRef.current) {
      clearTimeout(patternTimeoutRef.current);
    }
    
    patternTimeoutRef.current = setTimeout(() => {
      setPatternActive(false);
      
      // Check if all beats were hit - mark any remaining unprocessed beats as missed
      for (let i = nextBeatIndexRef.current; i < pattern.length; i++) {
        if (!beatProcessedRef.current.has(i)) {
          setMissedBeats(prev => prev + 1);
          setTotalBeats(prev => prev + 1);
          beatProcessedRef.current.add(i);
        }
      }
      
      // Stop rhythm animation
      if (rhythmAnimationRef.current) {
        rhythmAnimationRef.current.stop();
      }
      
      // Update progress
      Animated.timing(progressBarWidth, {
        toValue: (nextPattern / requiredRounds) * 100,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
      
      // Show success animation instead of TTS
      const hitBeats = beatProcessedRef.current.size;
      const totalPatternBeats = pattern.length;
      if (hitBeats === totalPatternBeats || hitBeats >= totalPatternBeats * 0.7) {
        setShowRoundSuccess(true);
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
      }
      
      // Start next pattern or finish
      setTimeout(() => {
        setShowRoundSuccess(false);
        if (nextPattern < requiredRounds) {
          startPattern();
        } else {
          finishGame();
        }
      }, 2500);
    }, patternDuration) as unknown as NodeJS.Timeout;
  }, [currentPattern, requiredRounds, generatePattern, progressBarWidth, finishGame]);

  const startGame = useCallback(() => {
    if (gameStartedRef.current) return;
    
    if (!hasCamera) {
      if (Platform.OS === 'web') {
        const checkCamera = (attempts = 0) => {
          if (hasCamera) {
            gameStartedRef.current = true;
            setCanPlay(true);
            // Wait for detection to be ready before starting
            const waitForDetection = () => {
              if (isDetecting) {
                speak('Open and close your jaw to follow the rhythm!');
                setTimeout(() => {
                  startPattern();
                }, 2000);
              } else if (attempts < 10) {
                setTimeout(waitForDetection, 200);
              } else {
                // Start anyway if detection takes too long
                speak('Open and close your jaw to follow the rhythm!');
                setTimeout(() => {
                  startPattern();
                }, 2000);
              }
            };
            setTimeout(waitForDetection, 500);
          } else if (jawError) {
            speak('Camera access denied. Please allow camera access and refresh the page.');
            return; // Don't retry if there's an error
          } else if (attempts < 10) {
            setTimeout(() => checkCamera(attempts + 1), 1000);
          } else {
            speak('Camera not available. Please check your browser permissions and refresh the page.');
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
    
    // Wait for detection to be ready before starting
    const waitForDetection = (attempts = 0) => {
      if (isDetecting || attempts >= 10) {
        speak('Open and close your jaw to follow the rhythm!');
        setTimeout(() => {
          startPattern();
        }, 2000);
      } else {
        setTimeout(() => waitForDetection(attempts + 1), 200);
      }
    };
    waitForDetection();
  }, [hasCamera, jawError, isDetecting, startPattern]);

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

  // Setup canvas overlay for landmarks visualization (web only)
  useEffect(() => {
    if (Platform.OS !== 'web' || !hasCamera) return;

    const setupCanvas = (attempts = 0) => {
      let container: HTMLElement | null = null;
      
      const videoElement = document.querySelector('video[data-jaw-preview-video]') as HTMLVideoElement;
      if (videoElement?.parentElement) {
        container = videoElement.parentElement as HTMLElement;
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
  }, [hasCamera, previewContainerId]);

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
      if (patternTimeoutRef.current) {
        clearTimeout(patternTimeoutRef.current);
        patternTimeoutRef.current = null;
      }
      beatTimersRef.current.forEach(timer => {
        if (timer) clearTimeout(timer);
      });
      beatTimersRef.current = [];
      if (rhythmAnimationRef.current) {
        rhythmAnimationRef.current.stop();
        rhythmAnimationRef.current = null;
      }
      // Reset game state on unmount
      setPatternActive(false);
      setCanPlay(false);
      gameStartedRef.current = false;
    };
  }, []);

  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.perfectBeats + finalStats.goodBeats}
        total={finalStats.totalPatterns * 4}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.xpAwarded}
        onContinue={() => {
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  const beatCircleSize = getResponsiveSize(200, isTablet, isMobile);
  
  // Get feedback color based on animated value
  const feedbackColorValue = feedbackColor.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ['#EF4444', '#F59E0B', '#22C55E'], // Red, Yellow, Green
  });

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#334155']}
        style={styles.gradient}
      >
        {/* Full-screen camera container - Always render so hook can find it */}
        <View
          ref={previewRef}
          style={[
            StyleSheet.absoluteFill,
            styles.cameraContainer,
            { zIndex: 1 }
          ]}
          nativeID={previewContainerId || 'jaw-preview-container'}
          {...(Platform.OS === 'web' && { 
            'data-native-id': previewContainerId || 'jaw-preview-container',
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
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Jaw Rhythm Tap</Text>
            <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
              {canPlay ? (patternActive ? 'Follow the rhythm!' : 'Get ready...') : 'Loading...'}
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
              Pattern {currentPattern} / {requiredRounds}
            </Text>
          </View>
        )}

        {/* Main Game Area */}
        <View style={styles.playArea}>
          {/* Rhythm Indicator Circle */}
          <View style={styles.rhythmArea}>
            <Animated.View
              style={[
                styles.beatCircle,
                {
                  width: beatCircleSize,
                  height: beatCircleSize,
                  borderRadius: beatCircleSize / 2,
                  transform: [
                    { scale: beatCircleScale },
                  ],
                  opacity: beatCircleOpacity,
                  borderColor: feedbackColorValue,
                  borderWidth: Animated.add(
                    Animated.multiply(rhythmIndicator, new Animated.Value(8)),
                    new Animated.Value(4)
                  ),
                },
              ]}
            >
              <Animated.View
                style={{
                  transform: [{ scale: jawStateIndicatorScale }],
                }}
              >
                <Text style={[styles.beatEmoji, { fontSize: beatCircleSize * 0.3 }]}>
                  {currentPatternBeats[currentBeat]?.action === 'open' ? '😮' : '😐'}
                </Text>
              </Animated.View>
            </Animated.View>
            
            <Text style={[styles.instructionText, isMobile && styles.instructionTextMobile]}>
              {currentPatternBeats[currentBeat]?.action === 'open' 
                ? 'Open your jaw!' 
                : currentPatternBeats[currentBeat]?.action === 'close'
                ? 'Close your jaw!'
                : currentPatternBeats.length > 0 && currentBeat === 0
                ? 'Get ready...'
                : 'Follow the rhythm!'}
            </Text>
            
            {/* Current Jaw State Indicator */}
            {canPlay && isDetecting && (
              <View style={styles.jawStateIndicator}>
                <Text style={styles.jawStateLabel}>Your jaw:</Text>
                <Text style={styles.jawStateValue}>
                  {isOpen ? '😮 OPEN' : '😐 CLOSED'}
                </Text>
              </View>
            )}

            {/* Beat Timeline Indicator */}
            {patternActive && currentPatternBeats.length > 0 && (
              <View style={styles.beatTimeline}>
                {currentPatternBeats.map((beat, index) => {
                  const isUpcoming = index >= nextBeatIndex;
                  const isCurrent = index === nextBeatIndex;
                  const isPast = index < nextBeatIndex;
                  
                  return (
                    <View
                      key={index}
                      style={[
                        styles.beatDot,
                        isCurrent && styles.beatDotCurrent,
                        isPast && styles.beatDotPast,
                        isUpcoming && !isCurrent && styles.beatDotUpcoming,
                      ]}
                    >
                      <Text style={styles.beatDotEmoji}>
                        {beat.action === 'open' ? '😮' : '😐'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

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
            <Text style={styles.celebrationText}>✨ Perfect! ✨</Text>
          </Animated.View>

          {/* Stats */}
          <View style={[styles.statsContainer, isMobile && styles.statsContainerMobile]}>
            <Text style={[styles.statsText, isMobile && styles.statsTextMobile]}>
              Score: {score} • Perfect: {perfectBeats} • Good: {goodBeats}
            </Text>
            <Text style={[styles.statsSubtext, isMobile && styles.statsSubtextMobile]}>
              Missed: {missedBeats} • Pattern {currentPattern} / {requiredRounds}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={[styles.skillsContainer, isMobile && styles.skillsContainerMobile]}>
          <View style={styles.skillItem}>
            <Ionicons name="musical-notes" size={isMobile ? 18 : 20} color="#FFFFFF" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Rhythm</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="time" size={isMobile ? 18 : 20} color="#FFFFFF" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Timing</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="game-controller" size={isMobile ? 18 : 20} color="#FFFFFF" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Coordination</Text>
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
  cameraContainer: {
    backgroundColor: '#000000',
  },
  cameraLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraLoadingText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    zIndex: 10,
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
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
    zIndex: 10,
  },
  errorBannerMobile: {
    padding: 10,
    marginHorizontal: 12,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  progressBarContainer: {
    position: 'absolute',
    top: 80,
    width: '85%',
    alignItems: 'center',
    zIndex: 5,
    alignSelf: 'center',
  },
  progressBarContainerMobile: {
    top: 70,
    width: '90%',
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
  },
  progressTextMobile: {
    fontSize: 12,
  },
  playArea: {
    flex: 1,
    position: 'relative',
    zIndex: 2,
  },
  rhythmArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  beatCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  beatEmoji: {
    textAlign: 'center',
  },
  instructionText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 30,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  instructionTextMobile: {
    fontSize: 22,
    marginTop: 24,
  },
  jawStateIndicator: {
    marginTop: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  jawStateLabel: {
    fontSize: 12,
    color: '#CBD5E1',
    marginBottom: 4,
  },
  jawStateValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  celebration: {
    position: 'absolute',
    top: '30%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  celebrationText: {
    fontSize: 36,
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
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    borderRadius: 12,
  },
  statsContainerMobile: {
    bottom: 80,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: 12,
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
    zIndex: 10,
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
  beatTimeline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 30,
    paddingHorizontal: 20,
    flexWrap: 'wrap',
  },
  beatDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
    marginVertical: 4,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  beatDotCurrent: {
    backgroundColor: 'rgba(34, 197, 94, 0.4)',
    borderColor: '#22C55E',
    borderWidth: 3,
    transform: [{ scale: 1.2 }],
  },
  beatDotPast: {
    backgroundColor: 'rgba(34, 197, 94, 0.6)',
    borderColor: '#22C55E',
    opacity: 0.7,
  },
  beatDotUpcoming: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    opacity: 0.5,
  },
  beatDotEmoji: {
    fontSize: 20,
  },
});
