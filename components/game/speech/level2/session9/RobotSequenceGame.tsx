/**
 * Robot Sequence Game
 * Patterns with timing: open (1s) - close (1s) - open (2s) - child copies both sequence and timing
 */

import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
import { logGameAndAward } from '@/utils/api';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

// Conditional import for VisionCamera
let Camera: any = null;
if (Platform.OS !== 'web') {
  try {
    Camera = require('react-native-vision-camera').Camera;
  } catch (e) {
    console.warn('VisionCamera not available:', e);
  }
}

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

type StepState = 'open' | 'closed';

interface PatternStep {
  state: StepState;
  duration: number; // milliseconds
}

interface RoundResult {
  round: number;
  stars: number;
  correctPatterns: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const TIMING_TOLERANCE_MS = 300; // ±300ms tolerance for timing
const STABILITY_MS = 300;
const DEFAULT_TTS_RATE = 0.75;

// Pattern templates
const PATTERNS: PatternStep[][] = [
  [{ state: 'open', duration: 1000 }, { state: 'closed', duration: 1000 }, { state: 'open', duration: 2000 }],
  [{ state: 'closed', duration: 1000 }, { state: 'open', duration: 1500 }, { state: 'closed', duration: 1000 }, { state: 'open', duration: 1500 }],
  [{ state: 'open', duration: 800 }, { state: 'closed', duration: 1200 }, { state: 'open', duration: 1000 }, { state: 'closed', duration: 1000 }],
  [{ state: 'closed', duration: 1000 }, { state: 'open', duration: 2000 }, { state: 'closed', duration: 1500 }],
  [{ state: 'open', duration: 1200 }, { state: 'closed', duration: 800 }, { state: 'open', duration: 1500 }, { state: 'closed', duration: 1000 }, { state: 'open', duration: 1000 }],
];

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];

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

export function RobotSequenceGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
  const { width: screenWidth = 0, height: screenHeight = 0 } = useWindowDimensions();
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : true);

  const {
    isOpen,
    ratio,
    isDetecting,
    hasCamera,
    error: jawError,
  } = jawDetection;

  // Web-only properties
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const previewRef = useRef<View>(null);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'demonstrating' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [currentPattern, setCurrentPattern] = useState<PatternStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [childStepIndex, setChildStepIndex] = useState(0);
  const [isDemonstrating, setIsDemonstrating] = useState(false);
  const [correctPatterns, setCorrectPatterns] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalCorrectPatterns: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const patternTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const robotScale = useRef(new Animated.Value(1)).current;
  const stableJawStateRef = useRef<{ state: boolean; since: number } | null>(null);
  const patternStartTimeRef = useRef<number | null>(null);
  const childStepStartTimeRef = useRef<number | null>(null);
  const lastPatternTimeRef = useRef(0);
  const patternCooldown = 2000; // 2 seconds between patterns

  // Demonstrate pattern
  const demonstratePattern = useCallback((pattern: PatternStep[]) => {
    setIsDemonstrating(true);
    setCurrentStep(0);
    let stepIndex = 0;
    
    const showStep = () => {
      if (stepIndex >= pattern.length) {
        setIsDemonstrating(false);
        setGameState('playing');
        patternStartTimeRef.current = Date.now();
        setChildStepIndex(0);
        childStepStartTimeRef.current = null;
        speak('Your turn! Copy the pattern!');
        return;
      }
      
      const step = pattern[stepIndex];
      setCurrentStep(stepIndex);
      
      // Animate robot
      Animated.sequence([
        Animated.timing(robotScale, {
          toValue: 1.2,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(robotScale, {
          toValue: 1,
          duration: 200,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
      
      speak(step.state === 'open' ? 'Open' : 'Close');
      
      stepIndex++;
      patternTimerRef.current = setTimeout(showStep, step.duration);
    };
    
    speak('Watch the robot!');
    setTimeout(showStep, 500);
  }, [robotScale]);

  // Update jaw detection and check pattern matching
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting || !patternStartTimeRef.current || currentPattern.length === 0) return;

    const now = Date.now();
    const expectedStep = currentPattern[childStepIndex];
    
    if (!expectedStep) return;

    // Stability check
    if (stableJawStateRef.current?.state === isOpen) {
      if (now - stableJawStateRef.current.since >= STABILITY_MS) {
        const expectedState = expectedStep.state === 'open';
        
        // Check if child is in correct state
        if (isOpen === expectedState) {
          // Start tracking this step
          if (childStepStartTimeRef.current === null) {
            childStepStartTimeRef.current = now;
          } else {
            const stepDuration = now - childStepStartTimeRef.current;
            
            // Check if held for correct duration (within tolerance)
            const durationDiff = Math.abs(stepDuration - expectedStep.duration);
            
            if (durationDiff <= TIMING_TOLERANCE_MS) {
              // Step completed correctly - move to next
              setChildStepIndex(prev => prev + 1);
              childStepStartTimeRef.current = null;
              
              // Check if pattern complete
              if (childStepIndex + 1 >= currentPattern.length) {
                // Pattern completed!
                if (now - lastPatternTimeRef.current > patternCooldown) {
                  lastPatternTimeRef.current = now;
                  setCorrectPatterns(prev => prev + 1);
                  
                  try {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  } catch {}
                  speak('Perfect!');
                  
                  // Reset for next pattern
                  patternStartTimeRef.current = null;
                  setChildStepIndex(0);
                }
              }
            }
          }
        } else {
          // Wrong state - reset step
          childStepStartTimeRef.current = null;
        }
      }
    } else {
      stableJawStateRef.current = { state: isOpen, since: now };
    }
  }, [isOpen, isDetecting, gameState, currentPattern, childStepIndex]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentPattern([]);
    setCurrentStep(0);
    setChildStepIndex(0);
    setIsDemonstrating(false);
    setCorrectPatterns(0);
    setTimeElapsed(0);
    patternStartTimeRef.current = null;
    childStepStartTimeRef.current = null;
    lastPatternTimeRef.current = 0;
    stableJawStateRef.current = null;
    robotScale.setValue(1);

    if (currentRound === 1) {
      speak(
        'Welcome to Robot Sequence! Watch the robot, then copy its pattern and timing. ' +
        'Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, robotScale]);

  // Start countdown
  const startCountdown = useCallback(() => {
    setGameState('countdown');
    setCountdown(3);
    speak('Get ready!');

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          startRound();
          return 0;
        }
        speak(prev - 1 === 0 ? 'Go!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('demonstrating');
    const patternIndex = (currentRound - 1) % PATTERNS.length;
    const pattern = PATTERNS[patternIndex];
    setCurrentPattern(pattern);
    setChildStepIndex(0);
    setCorrectPatterns(0);
    setTimeElapsed(0);
    patternStartTimeRef.current = null;
    childStepStartTimeRef.current = null;
    lastPatternTimeRef.current = 0;
    stableJawStateRef.current = null;
    robotScale.setValue(1);
    
    demonstratePattern(pattern);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [currentRound, robotScale, demonstratePattern]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (patternTimerRef.current) {
      clearTimeout(patternTimerRef.current);
      patternTimerRef.current = null;
    }

    let stars = 0;
    if (correctPatterns >= 4) {
      stars = 3;
    } else if (correctPatterns >= 3) {
      stars = 2;
    } else if (correctPatterns >= 2) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      correctPatterns,
      timeElapsed,
    };

    setRoundResults(prev => [...prev, result]);
    setTotalStars(prev => prev + stars);

    setShowRoundSuccess(true);
    setGameState('roundComplete');

    setTimeout(() => {
      setShowRoundSuccess(false);
      if (currentRound < requiredRounds) {
        setCurrentRound(prev => prev + 1);
        startCalibration();
      } else {
        finishGame();
      }
    }, 2500);
  }, [currentRound, correctPatterns, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalCorrectPatterns = roundResults.reduce((sum, r) => sum + r.correctPatterns, 0);
    const accuracy = Math.round((totalCorrectPatterns / (requiredRounds * 4)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalCorrectPatterns,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You copied ${totalCorrectPatterns} patterns correctly!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'robot-sequence',
        correct: totalCorrectPatterns,
        total: requiredRounds * 4,
        accuracy,
        xpAwarded,
        skillTags: ['oral-sequences', 'motor-sequencing', 'pattern-copying', 'timing'],
        meta: {
          totalRounds: requiredRounds,
          totalCorrectPatterns,
          totalStars,
          roundResults,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [roundResults, totalStars, requiredRounds]);

  // Auto-start calibration when camera is ready
  useEffect(() => {
    if (hasCamera && isDetecting && gameState === 'calibration' && currentRound === 1) {
      const timer = setTimeout(() => {
        startCountdown();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [hasCamera, isDetecting, gameState, currentRound, startCountdown]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearScheduledSpeech();
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (patternTimerRef.current) clearTimeout(patternTimerRef.current);
    };
  }, []);

  // Ensure container has data-native-id attribute for hook to find it (web only)
  useEffect(() => {
    if (Platform.OS !== 'web' || !previewContainerId) return;
    
    const setAttribute = () => {
      try {
        let element = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
        if (!element) {
          element = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
        }
        if (!element && previewRef.current) {
          try {
            const refElement = (previewRef.current as any)?.current || 
                              (previewRef.current as any)?.base || 
                              previewRef.current;
            if (refElement && refElement.nodeType === 1) {
              element = refElement;
            }
          } catch (e) {}
        }
        if (element && !element.getAttribute('data-native-id')) {
          element.setAttribute('data-native-id', previewContainerId);
        }
      } catch (e) {}
    };
    
    setAttribute();
    const timeouts = [100, 500, 1000, 2000].map(delay => 
      setTimeout(setAttribute, delay)
    );
    
    return () => timeouts.forEach(clearTimeout);
  }, [previewContainerId]);

  // Ensure video is in the correct full-screen container and remove duplicates (web only)
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const moveVideoToContainer = () => {
      let container = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
      if (!container) {
        container = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
      }
      if (!container && previewRef.current) {
        try {
          const refElement = (previewRef.current as any)?.current || 
                            (previewRef.current as any)?.base || 
                            previewRef.current;
          if (refElement && refElement.nodeType === 1) {
            container = refElement;
          }
        } catch (e) {}
      }

      if (!container) return;

      const rect = container.getBoundingClientRect();
      const isFullScreen = rect.width > window.innerWidth * 0.7 && 
                           rect.height > window.innerHeight * 0.7;
      
      if (!isFullScreen) return;

      const allVideos = document.querySelectorAll('video[data-jaw-preview-video]');
      if (allVideos.length === 0) return;

      allVideos.forEach((video, index) => {
        const vid = video as HTMLVideoElement;
        if (index === 0) {
          container.appendChild(vid);
          vid.style.position = 'absolute';
          vid.style.top = '0';
          vid.style.left = '0';
          vid.style.width = '100%';
          vid.style.height = '100%';
          vid.style.objectFit = 'cover';
          vid.style.zIndex = '1';
        } else {
          vid.remove();
        }
      });
    };

    moveVideoToContainer();
    const interval = setInterval(moveVideoToContainer, 500);
    const timeouts = [100, 500, 1000, 2000].map(delay => 
      setTimeout(moveVideoToContainer, delay)
    );

    return () => {
      clearInterval(interval);
      timeouts.forEach(clearTimeout);
    };
  }, [previewContainerId]);

  // Show completion screen
  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.totalCorrectPatterns}
        total={requiredRounds * 4}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.totalStars * 50}
        onContinue={() => {
          clearScheduledSpeech();
          Speech.stop();
          onComplete?.();
        }}
        onHome={() => {
          clearScheduledSpeech();
          Speech.stop();
          onBack();
        }}
      />
    );
  }

  const currentStepState = currentPattern[currentStep]?.state || 'closed';
  const robotMouthState = isDemonstrating ? currentStepState : (isOpen ? 'open' : 'closed');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.playArea}>
        {/* Full Screen Camera Preview */}
        {hasCamera && (
          <View style={styles.fullScreenCamera}>
            {Platform.OS === 'web' ? (
              <View
                ref={previewRef}
                style={[
                  StyleSheet.absoluteFill, 
                  { 
                    backgroundColor: '#000000',
                  }
                ]}
                nativeID={previewContainerId}
                collapsable={false}
              >
                {!isDetecting && (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 16 }}>Loading camera...</Text>
                  </View>
                )}
              </View>
            ) : (
              jawDetection.device && Camera && (
                <Camera
                  style={StyleSheet.absoluteFill}
                  device={jawDetection.device}
                  isActive={gameState === 'playing' || gameState === 'calibration' || gameState === 'demonstrating'}
                  frameProcessor={jawDetection.frameProcessor}
                  frameProcessorFps={30}
                />
              )
            )}
          </View>
        )}

        {/* Overlay UI Elements */}
        <View style={styles.overlayContainer}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.headerText}>Round {currentRound} / {requiredRounds}</Text>
        <View style={styles.starsContainer}>
          {[1, 2, 3].map(i => (
            <Ionicons
              key={i}
              name="star"
              size={20}
              color={i <= totalStars ? '#FFD700' : '#666'}
            />
          ))}
        </View>
      </View>

      {/* Game content */}
      {gameState === 'calibration' && (
        <View style={styles.centerContent}>
          <Text style={styles.instructionText}>
            {jawError || !hasCamera
              ? 'Waiting for camera...'
              : isDetecting
              ? 'Great! Now get ready to copy!'
              : 'Show your face to the camera'}
          </Text>
          {jawError && (
            <Text style={styles.errorText}>{jawError}</Text>
          )}
        </View>
      )}

      {gameState === 'countdown' && (
        <View style={styles.centerContent}>
          <Text style={styles.countdownText}>{countdown || 'Go!'}</Text>
        </View>
      )}

      {(gameState === 'demonstrating' || gameState === 'playing') && (
        <View style={styles.gameArea}>
          {/* Robot */}
          <Animated.View
            style={[
              styles.robotContainer,
              {
                top: screenHeight * 0.2,
                left: screenWidth / 2 - 80,
                transform: [{ scale: robotScale }],
              },
            ]}
          >
            <Text style={styles.robotEmoji}>🤖</Text>
            <View style={styles.robotMouth}>
              <Text style={styles.robotMouthEmoji}>
                {robotMouthState === 'open' ? '😮' : '😐'}
              </Text>
            </View>
            <Text style={styles.robotLabel}>
              {isDemonstrating ? 'Watch!' : 'Your turn!'}
            </Text>
          </Animated.View>

          {/* Pattern steps indicator */}
          <View style={styles.patternContainer}>
            {currentPattern.map((step, index) => (
              <View
                key={index}
                style={[
                  styles.patternStep,
                  {
                      backgroundColor: index === currentStep && isDemonstrating
                      ? '#FFD700'
                      : index < childStepIndex && gameState === 'playing'
                      ? '#4CAF50'
                      : '#666',
                  },
                ]}
              >
                <Text style={styles.patternStepText}>
                  {step.state === 'open' ? 'O' : 'C'}
                </Text>
                <Text style={styles.patternStepDuration}>
                  {step.duration / 1000}s
                </Text>
              </View>
            ))}
          </View>

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>Patterns: {correctPatterns}</Text>
          </View>

          {/* Time remaining */}
          <View style={styles.timeContainer}>
            <Text style={styles.timeText}>
              {Math.max(0, Math.ceil(ROUND_TIME_MS / 1000 - timeElapsed))}s
            </Text>
          </View>
        </View>
      )}

      {showRoundSuccess && (
        <RoundSuccessAnimation
          stars={roundResults[roundResults.length - 1]?.stars || 0}
          onAnimationComplete={() => {}}
        />
      )}

      {/* Round complete overlay */}
      {gameState === 'roundComplete' && !showRoundSuccess && (
        <View style={styles.overlay}>
          <Text style={styles.roundCompleteText}>
            Round {currentRound} Complete!
          </Text>
        </View>
      )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  playArea: {
    flex: 1,
    position: 'relative',
  },
  fullScreenCamera: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: '#000',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    pointerEvents: 'box-none',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    zIndex: 10,
  },
  backButton: {
    padding: 8,
  },
  headerText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  instructionText: {
    fontSize: 20,
    textAlign: 'center',
    color: '#FFF',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 16,
    color: '#FF6B6B',
    marginTop: 10,
    textAlign: 'center',
  },
  countdownText: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#FFF',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
  },
  robotContainer: {
    position: 'absolute',
    width: 160,
    height: 200,
    alignItems: 'center',
    zIndex: 5,
  },
  robotEmoji: {
    fontSize: 100,
  },
  robotMouth: {
    marginTop: -20,
  },
  robotMouthEmoji: {
    fontSize: 40,
  },
  robotLabel: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
  },
  patternContainer: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    zIndex: 6,
  },
  patternStep: {
    width: 60,
    height: 80,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  patternStepText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
  },
  patternStepDuration: {
    fontSize: 12,
    color: '#FFF',
    marginTop: 4,
  },
  statsContainer: {
    position: 'absolute',
    top: 100,
    right: 20,
    alignItems: 'center',
    zIndex: 6,
  },
  statsText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  timeContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  timeText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFF',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  roundCompleteText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFF',
  },
});

