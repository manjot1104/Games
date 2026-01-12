import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
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
const HOLD_DURATION_MS = 3000; // 3 seconds hold required
const TOTAL_ROUNDS = 6;
const MIN_HOLD_TIME = 2000; // Minimum 2 seconds to count

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

type HoldTarget = 'open' | 'close';

type RoundType = 
  | 'falling-stars'      // Round 1: Catch falling stars with open jaw
  | 'bubble-blowing'    // Round 2: Blow bubbles with sustained open
  | 'mirror-mimic'      // Round 3: Mimic mouth movements
  | 'chewy-snack'       // Round 4: Chew virtual food (repeated open/close)
  | 'star-collection'   // Round 5: Collect stars with timed holds
  | 'final-challenge';  // Round 6: Combination challenge

interface RoundConfig {
  type: RoundType;
  name: string;
  instruction: string;
  targetAction: 'open' | 'close' | 'alternate' | 'timed-open';
  duration: number;
  targetCount?: number; // For rounds requiring multiple actions
}

const ROUND_CONFIGS: RoundConfig[] = [
  {
    type: 'falling-stars',
    name: 'Catch the Stars!',
    instruction: 'Open your jaw wide to catch the falling stars!',
    targetAction: 'open',
    duration: 10000, // 10 seconds
    targetCount: 5, // Catch 5 stars
  },
  {
    type: 'bubble-blowing',
    name: 'Blow Bubbles!',
    instruction: 'Hold your jaw open to blow big bubbles!',
    targetAction: 'open',
    duration: 8000,
    targetCount: 3, // 3 bubbles
  },
  {
    type: 'mirror-mimic',
    name: 'Mirror Mimic!',
    instruction: 'Copy the mouth movements you see!',
    targetAction: 'alternate',
    duration: 12000,
    targetCount: 4, // 4 movements
  },
  {
    type: 'chewy-snack',
    name: 'Chewy Snack!',
    instruction: 'Chew the snack by opening and closing your jaw!',
    targetAction: 'alternate',
    duration: 15000,
    targetCount: 10, // 10 chewing cycles
  },
  {
    type: 'star-collection',
    name: 'Star Collection!',
    instruction: 'Hold your jaw open at each star for 1 second!',
    targetAction: 'timed-open',
    duration: 20000,
    targetCount: 6, // 6 stars
  },
  {
    type: 'final-challenge',
    name: 'Final Challenge!',
    instruction: 'Complete all challenges: catch stars, blow bubbles, and collect items!',
    targetAction: 'open',
    duration: 25000,
    targetCount: 10, // Combined target
  },
];

export const JawStrengthBuilderGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredRounds = TOTAL_ROUNDS,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const isTablet = SCREEN_WIDTH >= 768;
  const isMobile = SCREEN_WIDTH < 600;
  
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    successfulHolds: number;
    totalHoldTime: number;
    averageHoldTime: number;
    attentionScore: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [canPlay, setCanPlay] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [currentRoundType, setCurrentRoundType] = useState<RoundType | null>(null);
  const [targetHold, setTargetHold] = useState<HoldTarget>('open');
  const [isHolding, setIsHolding] = useState(false);
  const [holdStartTime, setHoldStartTime] = useState<number | null>(null);
  const [currentHoldTime, setCurrentHoldTime] = useState(0);
  const [score, setScore] = useState(0);
  const [roundProgress, setRoundProgress] = useState(0); // Progress for current round (0-1)
  const [strengthMeterValue, setStrengthMeterValue] = useState(0);
  
  // Scoring
  const [successfulHolds, setSuccessfulHolds] = useState(0);
  const [totalHoldTime, setTotalHoldTime] = useState(0);
  const [holdTimes, setHoldTimes] = useState<number[]>([]);
  
  // Jaw detection
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : canPlay);
  const { 
    isOpen, 
    isDetecting, 
    hasCamera, 
    error: jawError,
    previewContainerId 
  } = jawDetection;
  
  // Refs
  const canPlayRef = useRef<boolean>(false);
  const currentIsOpenRef = useRef<boolean>(false);
  const gameStartedRef = useRef(false);
  const holdCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const roundTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gameStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewRef = useRef<View>(null);
  const roundCompleteRef = useRef<boolean>(false);
  const roundStartTimeRef = useRef<number>(0);
  
  // Round-specific state
  interface FallingStar {
    id: number;
    x: Animated.Value;
    y: Animated.Value;
    size: Animated.Value;
    caught: boolean;
    speed: number;
  }
  
  const [fallingStars, setFallingStars] = useState<FallingStar[]>([]);
  const starsCaughtRef = useRef(0);
  const starSpawnIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Bubble Blowing Round State
  interface Bubble {
    id: number;
    size: Animated.Value;
    opacity: Animated.Value;
    popped: boolean;
    startTime: number;
  }
  
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const bubblesBlownRef = useRef(0);
  const currentBubbleRef = useRef<Bubble | null>(null);
  
  // Chewy Snack Round State
  const chewingCyclesRef = useRef(0);
  const lastJawStateRef = useRef<'open' | 'close' | null>(null);
  const cycleStartTimeRef = useRef<number | null>(null);
  
  // Animations
  const buildingProgress = useRef(new Animated.Value(0)).current;
  const buildingScale = useRef(new Animated.Value(0.5)).current;
  const strengthMeter = useRef(new Animated.Value(0)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;
  const holdTimerOpacity = useRef(new Animated.Value(0)).current;

  // Sync refs
  useEffect(() => {
    canPlayRef.current = canPlay;
  }, [canPlay]);
  
  useEffect(() => {
    currentIsOpenRef.current = isOpen;
  }, [isOpen]);

  // Track strength meter value with listener
  useEffect(() => {
    const listener = strengthMeter.addListener(({ value }) => {
      setStrengthMeterValue(value);
    });
    return () => {
      strengthMeter.removeListener(listener);
    };
  }, [strengthMeter]);

  // Check hold status
  useEffect(() => {
    if (!canPlay) return;
    
    const checkHold = () => {
      const shouldBeHolding = targetHold === 'open' ? isOpen : !isOpen;
      
      if (shouldBeHolding && !isHolding) {
        // Start holding
        setIsHolding(true);
        const startTime = Date.now();
        setHoldStartTime(startTime);
        setCurrentHoldTime(0);
        
        Animated.timing(holdTimerOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      } else if (!shouldBeHolding && isHolding) {
        // Stop holding
        if (holdStartTime) {
          const holdDuration = Date.now() - holdStartTime;
          if (holdDuration >= MIN_HOLD_TIME) {
            setSuccessfulHolds(prev => prev + 1);
            setTotalHoldTime(prev => prev + holdDuration);
            setHoldTimes(prev => [...prev, holdDuration]);
            
            // Update building progress
            const progress = Math.min(1, (successfulHolds + 1) / requiredRounds);
            Animated.parallel([
              Animated.timing(buildingProgress, {
                toValue: progress,
                duration: 500,
                easing: Easing.out(Easing.ease),
                useNativeDriver: false,
              }),
              Animated.spring(buildingScale, {
                toValue: 0.5 + progress * 0.5,
                tension: 50,
                friction: 7,
                useNativeDriver: true,
              }),
            ]).start();
            
            setScore(prev => prev + Math.round(holdDuration / 100));
            
            // Celebration
            Animated.sequence([
              Animated.timing(celebrationOpacity, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
              }),
              Animated.timing(celebrationOpacity, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
              }),
            ]).start();
            
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } catch {}
            
            speak('Great hold!');
            
            // Check if round should advance based on round type
            const roundConfig = ROUND_CONFIGS[currentRound - 1];
            if (roundConfig) {
              let shouldAdvance = false;
              
              if (roundConfig.type === 'falling-stars' || 
                  roundConfig.type === 'bubble-blowing' ||
                  roundConfig.type === 'final-challenge') {
                // These rounds advance after each successful hold
                shouldAdvance = (successfulHolds + 1) >= (roundConfig.targetCount || 1);
              } else if (roundConfig.type === 'chewy-snack') {
                // Chewy snack advances after cycles (handled separately)
                shouldAdvance = false; // Handled in cycle counter
              } else if (roundConfig.type === 'star-collection') {
                // Star collection advances after all stars collected
                shouldAdvance = false; // Handled in star collection logic
              } else if (roundConfig.type === 'mirror-mimic') {
                // Mirror mimic advances after all movements copied
                shouldAdvance = false; // Handled in mimic logic
              }
              
              if (shouldAdvance && currentRound < requiredRounds && !roundCompleteRef.current) {
                roundCompleteRef.current = true;
                setTimeout(() => {
                  startRound();
                }, 2000);
              }
            }
          }
        }
        
        setIsHolding(false);
        setHoldStartTime(null);
        setCurrentHoldTime(0);
        
        Animated.timing(holdTimerOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      } else if (isHolding && holdStartTime) {
        // Update hold time
        const elapsed = Date.now() - holdStartTime;
        setCurrentHoldTime(elapsed);
        
        // Update strength meter
        const strength = Math.min(1, elapsed / HOLD_DURATION_MS);
        Animated.timing(strengthMeter, {
          toValue: strength,
          duration: 100,
          useNativeDriver: false,
        }).start();
      }
    };
    
    const interval = setInterval(checkHold, 100);
    holdCheckIntervalRef.current = interval as unknown as NodeJS.Timeout;
    
    return () => {
      if (holdCheckIntervalRef.current) {
        clearInterval(holdCheckIntervalRef.current);
        holdCheckIntervalRef.current = null;
      }
    };
  }, [canPlay, isOpen, targetHold, isHolding, holdStartTime, successfulHolds, requiredRounds, buildingProgress, buildingScale, strengthMeter]);

  const finishGame = useCallback(async () => {
    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
      roundTimeoutRef.current = null;
    }
    if (holdCheckIntervalRef.current) {
      clearInterval(holdCheckIntervalRef.current);
      holdCheckIntervalRef.current = null;
    }
    if (gameStartTimeoutRef.current) {
      clearTimeout(gameStartTimeoutRef.current);
      gameStartTimeoutRef.current = null;
    }
    
    setGameFinished(true);
    clearScheduledSpeech();

    const totalRounds = currentRound > 0 ? currentRound : 1;
    const averageHoldTime = holdTimes.length > 0
      ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
      : 0;
    const attentionScore = Math.min(100, Math.round((successfulHolds / totalRounds) * 100));
    const xp = successfulHolds * 60 + Math.round(totalHoldTime / 100);

    setFinalStats({
      totalRounds,
      successfulHolds,
      totalHoldTime,
      averageHoldTime,
      attentionScore,
      xpAwarded: xp,
    });

    try {
      await logGameAndAward({
        type: 'jaw-strength-builder',
        correct: successfulHolds,
        total: totalRounds,
        accuracy: attentionScore,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['jaw-awareness', 'jaw-strength', 'sustained-hold', 'oral-motor-control'],
        incorrectAttempts: totalRounds - successfulHolds,
        meta: {
          totalHoldTime,
          averageHoldTime,
          attentionScore,
        },
      });
      onComplete?.();
    } catch (e) {
      console.warn('Failed to save game log:', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [successfulHolds, currentRound, totalHoldTime, holdTimes, onComplete]);

  const startRound = useCallback(() => {
    // Clear previous round completion flag
    roundCompleteRef.current = false;
    
    setCurrentRound(prev => {
      const nextRound = prev + 1;
      if (nextRound > requiredRounds) {
        finishGame();
        return prev;
      }
      
      // Get round config
      const roundConfig = ROUND_CONFIGS[nextRound - 1];
      if (roundConfig) {
        setCurrentRoundType(roundConfig.type);
        setRoundProgress(0);
        roundStartTimeRef.current = Date.now();
        
        // Set target based on round type
        if (roundConfig.targetAction === 'open') {
          setTargetHold('open');
        } else if (roundConfig.targetAction === 'close') {
          setTargetHold('close');
        } else {
          // For alternate/timed, start with open
          setTargetHold('open');
        }
        
        speak(roundConfig.instruction);
      }
      
      // Update progress bar
      Animated.timing(progressBarWidth, {
        toValue: (nextRound / requiredRounds) * 100,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
      
      return nextRound;
    });
    
    // End round after timeout - always advance if time expires
    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
    }
    
    const roundConfig = ROUND_CONFIGS[currentRound]; // Use currentRound before increment
    const roundDuration = roundConfig?.duration || HOLD_DURATION_MS * 2;
    
    roundTimeoutRef.current = (setTimeout(() => {
      // Time expired - advance to next round if not already completed
      if (!roundCompleteRef.current && currentRound < requiredRounds) {
        roundCompleteRef.current = true;
        setTimeout(() => {
          startRound();
        }, 2000);
      } else if (currentRound >= requiredRounds) {
        finishGame();
      }
    }, roundDuration)) as unknown as NodeJS.Timeout;
  }, [requiredRounds, finishGame, currentRound, progressBarWidth]);

  const startGame = useCallback(() => {
    if (gameStartedRef.current) return;
    
    if (!hasCamera) {
      if (Platform.OS === 'web') {
        const checkCamera = (attempts = 0) => {
          if (hasCamera) {
            gameStartedRef.current = true;
            setCanPlay(true);
            speak('Hold your jaw open or closed to build strength!');
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
    speak('Hold your jaw open or closed to build strength!');
    
    gameStartTimeoutRef.current = (setTimeout(() => {
      startRound();
    }, 2000)) as unknown as NodeJS.Timeout;
  }, [hasCamera, jawError, startRound]);

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

  // Falling Stars Round Logic
  useEffect(() => {
    if (currentRoundType !== 'falling-stars' || !canPlay) {
      // Cleanup when not in falling stars round
      if (starSpawnIntervalRef.current) {
        clearInterval(starSpawnIntervalRef.current);
        starSpawnIntervalRef.current = null;
      }
      setFallingStars([]);
      starsCaughtRef.current = 0;
      return;
    }
    
    const roundConfig = ROUND_CONFIGS[currentRound - 1];
    if (!roundConfig) return;
    
    // Spawn stars periodically
    const spawnStar = () => {
      const starX = 100 + (SCREEN_WIDTH - 200) * Math.random();
      const starSize = 30 + Math.random() * 20;
      const starSpeed = 1.5 + Math.random() * 1.5;
      
      const newStar: FallingStar = {
        id: Date.now() + Math.random(),
        x: new Animated.Value(starX),
        y: new Animated.Value(-50),
        size: new Animated.Value(starSize),
        caught: false,
        speed: starSpeed,
      };
      
      // Animate falling
      Animated.timing(newStar.y, {
        toValue: SCREEN_HEIGHT + 50,
        duration: (SCREEN_HEIGHT + 100) / starSpeed * 20, // Convert speed to duration
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished && !newStar.caught) {
          // Star reached bottom, remove it
          setFallingStars(prev => prev.filter(s => s.id !== newStar.id));
        }
      });
      
      setFallingStars(prev => [...prev, newStar]);
    };
    
    // Spawn first star immediately, then every 1.5-2.5 seconds
    spawnStar();
    starSpawnIntervalRef.current = setInterval(() => {
      if (starsCaughtRef.current < (roundConfig.targetCount || 5)) {
        spawnStar();
      }
    }, 1500 + Math.random() * 1000) as unknown as NodeJS.Timeout;
    
    return () => {
      if (starSpawnIntervalRef.current) {
        clearInterval(starSpawnIntervalRef.current);
        starSpawnIntervalRef.current = null;
      }
    };
  }, [currentRoundType, canPlay, currentRound, SCREEN_WIDTH, SCREEN_HEIGHT]);
  
  // Check for star catches when jaw opens - use interval to check positions
  useEffect(() => {
    if (currentRoundType !== 'falling-stars' || !canPlay) return;
    
    const catchZoneTop = SCREEN_HEIGHT * 0.3;
    const catchZoneBottom = SCREEN_HEIGHT * 0.7;
    const catchZoneLeft = SCREEN_WIDTH * 0.2;
    const catchZoneRight = SCREEN_WIDTH * 0.8;
    
    const checkCatches = () => {
      if (!isOpen) return;
      
      setFallingStars(prevStars => {
        const updatedStars = [...prevStars];
        let caughtAny = false;
        
        updatedStars.forEach(star => {
          if (!star.caught) {
            const starY = (star.y as any)._value;
            const starX = (star.x as any)._value;
            
            // Check if star is in catch zone
            if (starY >= catchZoneTop && 
                starY <= catchZoneBottom &&
                starX >= catchZoneLeft &&
                starX <= catchZoneRight) {
              // Star caught!
              star.caught = true;
              starsCaughtRef.current++;
              caughtAny = true;
              
              // Animate catch
              Animated.parallel([
                Animated.timing(star.y, {
                  toValue: SCREEN_HEIGHT * 0.5,
                  duration: 200,
                  easing: Easing.out(Easing.ease),
                  useNativeDriver: false,
                }),
                Animated.timing(star.size, {
                  toValue: 0,
                  duration: 300,
                  easing: Easing.in(Easing.ease),
                  useNativeDriver: false,
                }),
              ]).start(() => {
                setFallingStars(prev => prev.filter(s => s.id !== star.id));
              });
              
              // Update score and progress
              setScore(prev => prev + 20);
              const roundConfig = ROUND_CONFIGS[currentRound - 1];
              if (roundConfig) {
                const progress = starsCaughtRef.current / (roundConfig.targetCount || 5);
                setRoundProgress(progress);
                
                // Check if round complete
                if (starsCaughtRef.current >= (roundConfig.targetCount || 5) && !roundCompleteRef.current) {
                  roundCompleteRef.current = true;
                  setShowRoundSuccess(true);
                  setTimeout(() => {
                    setShowRoundSuccess(false);
                    startRound();
                  }, 2500);
                }
              }
              
              // Celebration
              Animated.sequence([
                Animated.timing(celebrationOpacity, {
                  toValue: 1,
                  duration: 150,
                  useNativeDriver: true,
                }),
                Animated.timing(celebrationOpacity, {
                  toValue: 0,
                  duration: 200,
                  useNativeDriver: true,
                }),
              ]).start();
              
              try {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              } catch {}
            }
          }
        });
        
        return caughtAny ? updatedStars : prevStars;
      });
    };
    
    const catchCheckInterval = setInterval(checkCatches, 100);
    
    return () => {
      clearInterval(catchCheckInterval);
    };
  }, [isOpen, currentRoundType, canPlay, SCREEN_WIDTH, SCREEN_HEIGHT, currentRound, startRound, celebrationOpacity]);
  
  // Bubble Blowing Round Logic
  useEffect(() => {
    if (currentRoundType !== 'bubble-blowing' || !canPlay) {
      setBubbles([]);
      bubblesBlownRef.current = 0;
      currentBubbleRef.current = null;
      return;
    }
    
    const roundConfig = ROUND_CONFIGS[currentRound - 1];
    if (!roundConfig) return;
    
    // Create new bubble when jaw opens
    if (isOpen && !currentBubbleRef.current) {
      const newBubble: Bubble = {
        id: Date.now(),
        size: new Animated.Value(20),
        opacity: new Animated.Value(0.8),
        popped: false,
        startTime: Date.now(),
      };
      
      currentBubbleRef.current = newBubble;
      setBubbles(prev => [...prev, newBubble]);
      
      // Grow bubble while jaw is open
      Animated.loop(
        Animated.sequence([
          Animated.timing(newBubble.size, {
            toValue: 150,
            duration: 3000,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      ).start();
    }
    
    // Pop bubble when jaw closes or reaches max size
    if (!isOpen && currentBubbleRef.current) {
      const bubble = currentBubbleRef.current;
      const holdDuration = Date.now() - bubble.startTime;
      
      if (holdDuration >= MIN_HOLD_TIME) {
        bubble.popped = true;
        bubblesBlownRef.current++;
        
        // Animate pop
        const currentBubbleSize = (bubble.size as any)._value || 50;
        Animated.parallel([
          Animated.timing(bubble.size, {
            toValue: currentBubbleSize * 1.5,
            duration: 200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(bubble.opacity, {
            toValue: 0,
            duration: 200,
            easing: Easing.in(Easing.ease),
            useNativeDriver: false,
          }),
        ]).start(() => {
          setBubbles(prev => prev.filter(b => b.id !== bubble.id));
        });
        
        // Score based on bubble size
        const bubbleSize = Math.min(currentBubbleSize, 150);
        const points = Math.round(bubbleSize / 5);
        setScore(prev => prev + points);
        
        // Update progress
        const progress = bubblesBlownRef.current / (roundConfig.targetCount || 3);
        setRoundProgress(progress);
        
        // Check if round complete
        if (bubblesBlownRef.current >= (roundConfig.targetCount || 3) && !roundCompleteRef.current) {
          roundCompleteRef.current = true;
          speak('Amazing! All bubbles blown!');
          setTimeout(() => {
            startRound();
          }, 2000);
        }
        
        // Celebration
        Animated.sequence([
          Animated.timing(celebrationOpacity, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(celebrationOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();
        
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
      } else {
        // Bubble too small, just remove it
        setBubbles(prev => prev.filter(b => b.id !== bubble.id));
      }
      
      currentBubbleRef.current = null;
    }
  }, [isOpen, currentRoundType, canPlay, currentRound, celebrationOpacity, startRound]);
  
  // Chewy Snack Round Logic - Track open/close cycles
  useEffect(() => {
    if (currentRoundType !== 'chewy-snack' || !canPlay) {
      chewingCyclesRef.current = 0;
      lastJawStateRef.current = null;
      cycleStartTimeRef.current = null;
      return;
    }
    
    const roundConfig = ROUND_CONFIGS[currentRound - 1];
    if (!roundConfig) return;
    
    const currentState: 'open' | 'close' = isOpen ? 'open' : 'close';
    const lastState = lastJawStateRef.current;
    
    // Detect state change (cycle)
    if (lastState !== null && lastState !== currentState) {
      // State changed - this is a cycle
      if (cycleStartTimeRef.current) {
        const cycleDuration = Date.now() - cycleStartTimeRef.current;
        
        // Valid cycle if it took reasonable time (not too fast, not too slow)
        if (cycleDuration >= 300 && cycleDuration <= 2000) {
          chewingCyclesRef.current++;
          
          // Update score
          setScore(prev => prev + 10);
          
          // Update progress
          const progress = chewingCyclesRef.current / (roundConfig.targetCount || 10);
          setRoundProgress(progress);
          
          // Celebration for each cycle
          Animated.sequence([
            Animated.timing(celebrationOpacity, {
              toValue: 0.7,
              duration: 100,
              useNativeDriver: true,
            }),
            Animated.timing(celebrationOpacity, {
              toValue: 0,
              duration: 150,
              useNativeDriver: true,
            }),
          ]).start();
          
          try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {}
          
          // Check if round complete
          if (chewingCyclesRef.current >= (roundConfig.targetCount || 10) && !roundCompleteRef.current) {
            roundCompleteRef.current = true;
            setShowRoundSuccess(true);
            setTimeout(() => {
              setShowRoundSuccess(false);
              startRound();
            }, 2500);
          }
        }
      }
      
      cycleStartTimeRef.current = Date.now();
    } else if (lastState === null) {
      // First state - start tracking
      cycleStartTimeRef.current = Date.now();
    }
    
    lastJawStateRef.current = currentState;
  }, [isOpen, currentRoundType, canPlay, currentRound, celebrationOpacity, startRound]);
  
  // Mirror Mimic Round Logic (Round 3) - Simple version: copy open/close pattern
  const mimicActionsRef = useRef<('open' | 'close')[]>([]);
  const mimicIndexRef = useRef(0);
  const mimicCompletedRef = useRef(0);
  
  useEffect(() => {
    if (currentRoundType !== 'mirror-mimic' || !canPlay) {
      mimicActionsRef.current = [];
      mimicIndexRef.current = 0;
      mimicCompletedRef.current = 0;
      return;
    }
    
    // Generate pattern on round start
    if (mimicActionsRef.current.length === 0) {
      const pattern: ('open' | 'close')[] = [];
      for (let i = 0; i < 4; i++) {
        pattern.push(i % 2 === 0 ? 'open' : 'close');
      }
      mimicActionsRef.current = pattern;
      mimicIndexRef.current = 0;
    }
    
    const roundConfig = ROUND_CONFIGS[currentRound - 1];
    if (!roundConfig) return;
    
    const expectedAction = mimicActionsRef.current[mimicIndexRef.current];
    const currentAction: 'open' | 'close' = isOpen ? 'open' : 'close';
    
    // Check if child matches expected action
    if (expectedAction === currentAction) {
      // Correct! Move to next action
      mimicIndexRef.current++;
      mimicCompletedRef.current++;
      
      if (mimicIndexRef.current >= mimicActionsRef.current.length) {
        // Pattern complete, start new pattern
        mimicIndexRef.current = 0;
        const newPattern: ('open' | 'close')[] = [];
        for (let i = 0; i < 4; i++) {
          newPattern.push(i % 2 === 0 ? 'open' : 'close');
        }
        mimicActionsRef.current = newPattern;
      }
      
      setScore(prev => prev + 15);
      const progress = mimicCompletedRef.current / (roundConfig.targetCount || 4);
      setRoundProgress(progress);
      
      if (mimicCompletedRef.current >= (roundConfig.targetCount || 4) && !roundCompleteRef.current) {
        roundCompleteRef.current = true;
        setShowRoundSuccess(true);
        setTimeout(() => {
          setShowRoundSuccess(false);
          startRound();
        }, 2500);
      }
    }
  }, [isOpen, currentRoundType, canPlay, currentRound, startRound]);
  
  // Star Collection Round Logic (Round 5) - Hold open at different positions
  const starCollectionRef = useRef(0);
  const starHoldStartRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (currentRoundType !== 'star-collection' || !canPlay) {
      starCollectionRef.current = 0;
      starHoldStartRef.current = null;
      return;
    }
    
    const roundConfig = ROUND_CONFIGS[currentRound - 1];
    if (!roundConfig) return;
    
    if (isOpen && !starHoldStartRef.current) {
      starHoldStartRef.current = Date.now();
    } else if (!isOpen && starHoldStartRef.current) {
      const holdDuration = Date.now() - starHoldStartRef.current;
      
      if (holdDuration >= 1000) {
        // Valid hold
        starCollectionRef.current++;
        starHoldStartRef.current = null;
        
        setScore(prev => prev + 25);
        const progress = starCollectionRef.current / (roundConfig.targetCount || 6);
        setRoundProgress(progress);
        
        if (starCollectionRef.current >= (roundConfig.targetCount || 6) && !roundCompleteRef.current) {
          roundCompleteRef.current = true;
          setShowRoundSuccess(true);
          setTimeout(() => {
            setShowRoundSuccess(false);
            startRound();
          }, 2500);
        }
      } else {
        starHoldStartRef.current = null;
      }
    }
  }, [isOpen, currentRoundType, canPlay, currentRound, startRound]);
  
  // Final Challenge Round Logic (Round 6) - Combination
  const finalChallengeProgressRef = useRef(0);
  
  useEffect(() => {
    if (currentRoundType !== 'final-challenge' || !canPlay) {
      finalChallengeProgressRef.current = 0;
      return;
    }
    
    const roundConfig = ROUND_CONFIGS[currentRound - 1];
    if (!roundConfig) return;
    
    // Track any successful holds/actions
    if (isHolding && holdStartTime) {
      const holdDuration = Date.now() - holdStartTime;
      if (holdDuration >= MIN_HOLD_TIME && finalChallengeProgressRef.current < (roundConfig.targetCount || 10)) {
        finalChallengeProgressRef.current++;
        const progress = finalChallengeProgressRef.current / (roundConfig.targetCount || 10);
        setRoundProgress(progress);
        
        if (finalChallengeProgressRef.current >= (roundConfig.targetCount || 10) && !roundCompleteRef.current) {
          roundCompleteRef.current = true;
          setShowRoundSuccess(true);
          setTimeout(() => {
            setShowRoundSuccess(false);
            finishGame();
          }, 2500);
        }
      }
    }
  }, [isHolding, holdStartTime, currentRoundType, canPlay, currentRound, finishGame]);
  
  useEffect(() => {
    return () => {
      clearScheduledSpeech();
      if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);
      if (holdCheckIntervalRef.current) clearInterval(holdCheckIntervalRef.current);
      if (gameStartTimeoutRef.current) clearTimeout(gameStartTimeoutRef.current);
      if (starSpawnIntervalRef.current) clearInterval(starSpawnIntervalRef.current);
    };
  }, []);

  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.successfulHolds}
        total={finalStats.totalRounds}
        accuracy={finalStats.attentionScore}
        xpAwarded={finalStats.xpAwarded}
        onContinue={() => {
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  const buildingSize = getResponsiveSize(150, isTablet, isMobile);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FCD34D', '#F59E0B']}
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
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Jaw Strength Builder</Text>
            <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
              {canPlay && currentRoundType ? (
                ROUND_CONFIGS[currentRound - 1]?.name || `Round ${currentRound}`
              ) : canPlay ? (
                `Hold your jaw ${targetHold === 'open' ? 'open' : 'closed'}!`
              ) : (
                'Get ready...'
              )}
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

          {/* Error Message */}
          {jawError && (
            <View style={[styles.errorBanner, isMobile && styles.errorBannerMobile]}>
              <Ionicons name="alert-circle" size={24} color="#EF4444" />
              <Text style={styles.errorText}>{jawError}</Text>
            </View>
          )}

          {/* Strength Meter */}
          {canPlay && (
            <View style={[styles.meterContainer, isMobile && styles.meterContainerMobile]}>
              <Text style={[styles.meterLabel, isMobile && styles.meterLabelMobile]}>Strength</Text>
              <View style={styles.meterBackground}>
                <Animated.View
                  style={[
                    styles.meterFill,
                    {
                      width: strengthMeter.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
              <Text style={[styles.meterValue, isMobile && styles.meterValueMobile]}>
                {Math.round(strengthMeterValue * 100)}%
              </Text>
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

          {/* Round-specific overlays - Must be siblings of camera container, not children of gameArea */}
          {/* Falling Stars - Round 1 */}
          {currentRoundType === 'falling-stars' && (
            <View style={[StyleSheet.absoluteFill, styles.roundOverlay, { zIndex: 10 }]} pointerEvents="none">
                {fallingStars.map(star => (
                  <Animated.View
                    key={star.id}
                    style={[
                      styles.fallingStar,
                      {
                        left: star.x,
                        top: star.y,
                        width: star.size,
                        height: star.size,
                        zIndex: 11,
                      },
                    ]}
                  >
                    <Text style={styles.starEmoji}>⭐</Text>
                  </Animated.View>
                ))}
                {/* Catch Zone Indicator */}
                <View
                  style={[
                    styles.catchZone,
                    {
                      top: SCREEN_HEIGHT * 0.3,
                      left: SCREEN_WIDTH * 0.2,
                      width: SCREEN_WIDTH * 0.6,
                      height: SCREEN_HEIGHT * 0.4,
                      zIndex: 12,
                    },
                  ]}
                >
                  <Text style={styles.catchZoneText}>
                    {isOpen ? 'Catch Zone! ✨' : 'Open your jaw to catch stars!'}
                  </Text>
                </View>
            </View>
          )}
          
          {/* Bubble Blowing - Round 2 */}
          {currentRoundType === 'bubble-blowing' && (
            <View style={[StyleSheet.absoluteFill, styles.roundOverlay, { zIndex: 10 }]} pointerEvents="none">
                {bubbles.map(bubble => (
                  <Animated.View
                    key={bubble.id}
                    style={[
                      styles.bubble,
                      {
                        width: bubble.size,
                        height: bubble.size,
                        borderRadius: 9999, // Circular - large value ensures circle
                        opacity: bubble.opacity,
                        borderWidth: 3,
                        borderColor: 'rgba(255, 255, 255, 0.6)',
                        backgroundColor: 'rgba(173, 216, 230, 0.3)',
                        alignSelf: 'center',
                        marginTop: SCREEN_HEIGHT * 0.4,
                        zIndex: 11,
                      },
                    ]}
                  />
                ))}
                {isOpen && currentBubbleRef.current && (
                  <View style={[styles.bubbleInstruction, { zIndex: 12 }]}>
                    <Text style={styles.bubbleInstructionText}>
                      Keep your jaw open to grow the bubble! 💨
                    </Text>
                  </View>
                )}
            </View>
          )}
          
          {/* Chewy Snack - Round 4 */}
          {currentRoundType === 'chewy-snack' && (
            <View style={[StyleSheet.absoluteFill, styles.roundOverlay, { zIndex: 10 }]} pointerEvents="none">
                <View style={[styles.chewySnackContainer, { zIndex: 11 }]}>
                  <Text style={[styles.chewySnackEmoji, { fontSize: getResponsiveSize(100, isTablet, isMobile) }]}>
                    🍎
                  </Text>
                  <Text style={styles.chewySnackText}>
                    Chew by opening and closing your jaw!
                  </Text>
                  <Text style={styles.chewySnackProgress}>
                    Cycles: {chewingCyclesRef.current} / {ROUND_CONFIGS[currentRound - 1]?.targetCount || 10}
                  </Text>
                </View>
            </View>
          )}

          {/* Game Area */}
          <View style={[styles.gameArea, { zIndex: 5 }]}>
            {/* Building */}
            {currentRoundType !== 'falling-stars' && 
             currentRoundType !== 'bubble-blowing' && 
             currentRoundType !== 'chewy-snack' && (
              <View style={styles.buildingContainer}>
              <Animated.View
                style={[
                  styles.building,
                  {
                    width: buildingSize,
                    height: buildingSize,
                    transform: [{ scale: buildingScale }],
                  },
                ]}
              >
                <Text style={[styles.buildingEmoji, { fontSize: buildingSize * 0.6 }]}>🏗️</Text>
                <Animated.View
                  style={[
                    styles.buildingProgress,
                    {
                      height: buildingProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </Animated.View>
            </View>
            )}

            {/* Hold Timer */}
            <Animated.View
              style={[
                styles.holdTimer,
                {
                  opacity: holdTimerOpacity,
                },
              ]}
            >
              <Text style={[styles.holdTimerText, isMobile && styles.holdTimerTextMobile]}>
                {Math.round(currentHoldTime / 1000)}s
              </Text>
              <Text style={[styles.holdTimerLabel, isMobile && styles.holdTimerLabelMobile]}>
                Hold Time
              </Text>
            </Animated.View>

            {/* Target Indicator */}
            {canPlay && (
              <View style={styles.targetIndicator}>
                <Text style={[styles.targetText, isMobile && styles.targetTextMobile]}>
                  {currentRoundType === 'falling-stars' ? (
                    `⭐ Catch Stars: ${starsCaughtRef.current} / ${ROUND_CONFIGS[currentRound - 1]?.targetCount || 5}`
                  ) : currentRoundType === 'bubble-blowing' ? (
                    `🫧 Blow Bubbles: ${bubblesBlownRef.current} / ${ROUND_CONFIGS[currentRound - 1]?.targetCount || 3}`
                  ) : currentRoundType === 'chewy-snack' ? (
                    `🍎 Chew Cycles: ${chewingCyclesRef.current} / ${ROUND_CONFIGS[currentRound - 1]?.targetCount || 10}`
                  ) : (
                    targetHold === 'open' ? '😮 Hold OPEN' : '😐 Hold CLOSED'
                  )}
                </Text>
              </View>
            )}

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
              <Text style={styles.celebrationText}>💪 Strong! 💪</Text>
            </Animated.View>
          </View>

          {/* Stats */}
          <View style={[styles.statsContainer, isMobile && styles.statsContainerMobile]}>
            <Text style={[styles.statsText, isMobile && styles.statsTextMobile]}>
              Score: {score} • Successful Holds: {successfulHolds}
            </Text>
            <Text style={[styles.statsSubtext, isMobile && styles.statsSubtextMobile]}>
              Total Hold Time: {Math.round(totalHoldTime / 1000)}s • Round {currentRound} / {requiredRounds}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={[styles.skillsContainer, isMobile && styles.skillsContainerMobile]}>
          <View style={styles.skillItem}>
            <Ionicons name="medical" size={isMobile ? 18 : 20} color="#0F172A" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Jaw Strength</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="fitness" size={isMobile ? 18 : 20} color="#0F172A" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Sustained Hold</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="game-controller" size={isMobile ? 18 : 20} color="#0F172A" />
            <Text style={[styles.skillText, isMobile && styles.skillTextMobile]}>Endurance</Text>
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
    backgroundColor: 'rgba(254, 243, 199, 0.95)', // Semi-transparent background for visibility over camera
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
    alignSelf: 'center',
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
  meterContainer: {
    position: 'absolute',
    top: 20,
    left: 20,
    width: 200,
    zIndex: 5,
  },
  meterContainerMobile: {
    top: 60,
    left: 10,
    width: 150,
  },
  meterLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 4,
  },
  meterLabelMobile: {
    fontSize: 12,
  },
  meterBackground: {
    width: '100%',
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 4,
  },
  meterFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
    borderRadius: 10,
  },
  meterValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  meterValueMobile: {
    fontSize: 10,
  },
  progressBarContainer: {
    position: 'absolute',
    top: 20,
    width: '85%',
    alignItems: 'center',
    zIndex: 5,
    alignSelf: 'center',
  },
  progressBarContainerMobile: {
    top: 100,
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
  gameArea: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  roundOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  buildingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  building: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  buildingEmoji: {
    textAlign: 'center',
    zIndex: 2,
  },
  buildingProgress: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#22C55E',
    opacity: 0.6,
    zIndex: 1,
  },
  holdTimer: {
    position: 'absolute',
    top: 100,
    alignItems: 'center',
  },
  holdTimerText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  holdTimerTextMobile: {
    fontSize: 40,
  },
  holdTimerLabel: {
    fontSize: 16,
    color: '#475569',
    marginTop: 4,
  },
  holdTimerLabelMobile: {
    fontSize: 14,
  },
  targetIndicator: {
    position: 'absolute',
    bottom: 150,
    alignItems: 'center',
  },
  targetText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  targetTextMobile: {
    fontSize: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
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
  fallingStar: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  starEmoji: {
    textAlign: 'center',
  },
  catchZone: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#FFD700',
    borderStyle: 'dashed',
    borderRadius: 20,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  catchZoneText: {
    color: '#FFD700',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  bubble: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  bubbleInstruction: {
    position: 'absolute',
    top: '20%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 15,
  },
  bubbleInstructionText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  chewySnackContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingTop: 100,
  },
  chewySnackEmoji: {
    textAlign: 'center',
    marginBottom: 20,
  },
  chewySnackText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    marginBottom: 15,
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 3,
  },
  chewySnackProgress: {
    color: '#FFD700',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 15,
  },
});

