/**
 * Two-Step Imitation Game
 * Combine jaw + lips movements in sequence
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

type StepMovement = 'open' | 'close' | 'smile' | 'pucker';

interface TwoStepSequence {
  step1: StepMovement;
  step2: StepMovement;
}

interface RoundResult {
  round: number;
  stars: number;
  correctSequences: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 30000; // 30 seconds per round
const STEP_DURATION_MS = 3000; // 3 seconds per step
const TRANSITION_TIME_MS = 1000;
const STABILITY_MS = 500;
const MATCH_WINDOW_MS = 3000;
const DEFAULT_TTS_RATE = 0.75;

const SEQUENCES: TwoStepSequence[] = [
  { step1: 'open', step2: 'smile' },
  { step1: 'close', step2: 'pucker' },
  { step1: 'open', step2: 'pucker' },
  { step1: 'smile', step2: 'close' },
  { step1: 'pucker', step2: 'open' },
  { step1: 'close', step2: 'open' },
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

export function TwoStepImitationGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
  const { width: screenWidth = 0, height: screenHeight = 0 } = useWindowDimensions();
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : true);

  const {
    isOpen,
    ratio,
    isDetecting,
    hasCamera,
    error: jawError,
    smileAmount,
  } = jawDetection;

  // Web-only properties
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const protrusion = (jawDetection as any).protrusion as number | undefined;
  const previewRef = useRef<View>(null);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [currentSequence, setCurrentSequence] = useState<TwoStepSequence | null>(null);
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [sequenceComplete, setSequenceComplete] = useState(false);
  const [correctSequences, setCorrectSequences] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalSequences: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoScale = useRef(new Animated.Value(1)).current;
  const stableStepRef = useRef<{ step: StepMovement | null; since: number } | null>(null);
  const childStepRef = useRef<1 | 2>(1);
  const lastSequenceTimeRef = useRef(0);
  const sequenceStartTimeRef = useRef<number | null>(null);
  const sequenceCooldown = 3000;

  // Demonstrate sequence
  const demonstrateSequence = useCallback((sequence: TwoStepSequence) => {
    setCurrentSequence(sequence);
    setCurrentStep(1);
    setSequenceComplete(false);
    childStepRef.current = 1;
    sequenceStartTimeRef.current = Date.now();

    // Step 1
    const step1Name = sequence.step1 === 'open' ? 'Open' : sequence.step1 === 'close' ? 'Close' : sequence.step1 === 'smile' ? 'Smile' : 'Pucker';
    speak(`Step 1: ${step1Name}`);

    Animated.sequence([
      Animated.timing(demoScale, {
        toValue: 1.3,
        duration: STEP_DURATION_MS / 2,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(demoScale, {
        toValue: 1,
        duration: STEP_DURATION_MS / 2,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Step 2
      setTimeout(() => {
        setCurrentStep(2);
        const step2Name = sequence.step2 === 'open' ? 'Open' : sequence.step2 === 'close' ? 'Close' : sequence.step2 === 'smile' ? 'Smile' : 'Pucker';
        speak(`Step 2: ${step2Name}`);

        Animated.sequence([
          Animated.timing(demoScale, {
            toValue: 1.3,
            duration: STEP_DURATION_MS / 2,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(demoScale, {
            toValue: 1,
            duration: STEP_DURATION_MS / 2,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start(() => {
          setSequenceComplete(true);
          speak('Now you try both steps!');
        });
      }, TRANSITION_TIME_MS);
    });
  }, [demoScale]);

  // Show next sequence
  const showNextSequence = useCallback(() => {
    const sequenceIndex = Math.floor(Math.random() * SEQUENCES.length);
    const sequence = SEQUENCES[sequenceIndex];
    demonstrateSequence(sequence);

    sequenceTimerRef.current = setTimeout(() => {
      showNextSequence();
    }, STEP_DURATION_MS * 2 + TRANSITION_TIME_MS + 2000);
  }, [demonstrateSequence]);

  // Check if child imitates the sequence
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting || !currentSequence || !sequenceComplete || !sequenceStartTimeRef.current) return;

    const now = Date.now();
    const timeSinceStart = now - sequenceStartTimeRef.current;
    const expectedTime = childStepRef.current === 1 ? STEP_DURATION_MS : STEP_DURATION_MS * 2 + TRANSITION_TIME_MS;

    if (timeSinceStart < expectedTime || timeSinceStart > expectedTime + MATCH_WINDOW_MS) return;

    const expectedStep = childStepRef.current === 1 ? currentSequence.step1 : currentSequence.step2;
    let childState: StepMovement | null = null;

    if (expectedStep === 'open' && isOpen) {
      childState = 'open';
    } else if (expectedStep === 'close' && !isOpen && ratio < 0.03) {
      childState = 'close';
    } else if (expectedStep === 'smile' && smileAmount && smileAmount > 0.3) {
      childState = 'smile';
    } else if (expectedStep === 'pucker' && protrusion && protrusion > 0.4) {
      childState = 'pucker';
    }

    if (childState === expectedStep) {
      if (stableStepRef.current?.step === expectedStep) {
        if (now - stableStepRef.current.since >= STABILITY_MS) {
          if (childStepRef.current === 1) {
            // Move to step 2
            childStepRef.current = 2;
            stableStepRef.current = null;
          } else {
            // Sequence complete
            if (now - lastSequenceTimeRef.current > sequenceCooldown) {
              lastSequenceTimeRef.current = now;
              setCorrectSequences(prev => prev + 1);

              try {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              } catch {}
              speak('Excellent! Both steps!');

              childStepRef.current = 1;
              stableStepRef.current = null;
            }
          }
        }
      } else {
        stableStepRef.current = { step: expectedStep, since: now };
      }
    }
  }, [isOpen, ratio, smileAmount, protrusion, isDetecting, gameState, currentSequence, sequenceComplete]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentSequence(null);
    setCurrentStep(1);
    setSequenceComplete(false);
    setCorrectSequences(0);
    setTimeElapsed(0);
    stableStepRef.current = null;
    childStepRef.current = 1;
    lastSequenceTimeRef.current = 0;
    sequenceStartTimeRef.current = null;
    demoScale.setValue(1);

    if (currentRound === 1) {
      speak(
        'Welcome to Two-Step Imitation! Watch both steps, then copy them in order. ' +
        'Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, demoScale]);

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
        speak(prev - 1 === 0 ? 'Go! Copy both steps!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setCorrectSequences(0);
    setTimeElapsed(0);
    stableStepRef.current = null;
    childStepRef.current = 1;
    lastSequenceTimeRef.current = 0;
    demoScale.setValue(1);

    showNextSequence();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [demoScale, showNextSequence]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (sequenceTimerRef.current) {
      clearTimeout(sequenceTimerRef.current);
      sequenceTimerRef.current = null;
    }

    let stars = 0;
    if (correctSequences >= 4) {
      stars = 3;
    } else if (correctSequences >= 2) {
      stars = 2;
    } else if (correctSequences >= 1) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      correctSequences,
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
  }, [currentRound, correctSequences, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalSequences = roundResults.reduce((sum, r) => sum + r.correctSequences, 0);
    const accuracy = Math.round((totalSequences / (requiredRounds * 5)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalSequences,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You copied ${totalSequences} two-step sequences!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'two-step-imitation',
        correct: totalSequences,
        total: requiredRounds * 5,
        accuracy,
        xpAwarded,
        skillTags: ['foundational-imitation', 'two-step', 'sequence', 'oral-motor'],
        meta: {
          totalRounds: requiredRounds,
          totalSequences,
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
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
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
        correct={finalStats.totalSequences}
        total={requiredRounds * 5}
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

  const getMovementEmoji = (movement: StepMovement) => {
    if (movement === 'open') return '😮';
    if (movement === 'smile') return '😊';
    if (movement === 'pucker') return '😗';
    return '😐';
  };

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
                  isActive={gameState === 'playing' || gameState === 'calibration'}
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
              ? 'Great! Now watch and copy both steps!'
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

      {gameState === 'playing' && currentSequence && (
        <View style={styles.gameArea}>
          {/* Demonstration */}
          <Animated.View
            style={[
              styles.demoContainer,
              {
                top: screenHeight * 0.2,
                left: screenWidth / 2 - 100,
                transform: [{ scale: demoScale }],
              },
            ]}
          >
            <Text style={styles.stepLabel}>Step {currentStep}</Text>
            <Text style={styles.demoEmoji}>
              {getMovementEmoji(currentStep === 1 ? currentSequence.step1 : currentSequence.step2)}
            </Text>
            <Text style={styles.demoLabel}>
              {currentStep === 1
                ? currentSequence.step1 === 'open'
                  ? 'Open'
                  : currentSequence.step1 === 'close'
                  ? 'Close'
                  : currentSequence.step1 === 'smile'
                  ? 'Smile'
                  : 'Pucker'
                : currentSequence.step2 === 'open'
                ? 'Open'
                : currentSequence.step2 === 'close'
                ? 'Close'
                : currentSequence.step2 === 'smile'
                ? 'Smile'
                : 'Pucker'}
            </Text>
            {sequenceComplete && (
              <Text style={styles.instructionLabel}>Now you try!</Text>
            )}
          </Animated.View>

          {/* Sequence indicator */}
          <View style={[styles.sequenceIndicator, { top: screenHeight * 0.45 }]}>
            <Text style={styles.sequenceText}>
              {getMovementEmoji(currentSequence.step1)} → {getMovementEmoji(currentSequence.step2)}
            </Text>
          </View>

          {/* Stats */}
          <View style={[styles.statsContainer, { left: screenWidth / 2 - 80 }]}>
            <Text style={styles.statsText}>Copied: {correctSequences}</Text>
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
  demoContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  stepLabel: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 10,
  },
  demoEmoji: {
    fontSize: 100,
  },
  demoLabel: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 10,
  },
  instructionLabel: {
    fontSize: 18,
    color: '#FFF',
    marginTop: 5,
    fontStyle: 'italic',
  },
  sequenceIndicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  sequenceText: {
    fontSize: 40,
  },
  statsContainer: {
    position: 'absolute',
    top: 100,
    width: 160,
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

