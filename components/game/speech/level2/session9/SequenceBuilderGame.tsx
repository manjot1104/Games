/**
 * Sequence Builder Game
 * Show partial sequence - child chooses correct step from options (open/close buttons) to complete (6-8 sequences per round)
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

interface Sequence {
  steps: (StepState | '?')[];
  correctAnswer: StepState;
}

interface RoundResult {
  round: number;
  stars: number;
  correctSequences: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const STABILITY_MS = 300;
const DEFAULT_TTS_RATE = 0.75;

// Sequence templates
const SEQUENCES: Sequence[] = [
  { steps: ['open', '?', 'closed', 'open'], correctAnswer: 'closed' },
  { steps: ['closed', 'open', '?', 'closed'], correctAnswer: 'open' },
  { steps: ['open', 'closed', '?', 'open'], correctAnswer: 'closed' },
  { steps: ['closed', '?', 'open', 'closed'], correctAnswer: 'open' },
  { steps: ['open', 'open', '?', 'closed'], correctAnswer: 'closed' },
  { steps: ['closed', 'closed', '?', 'open'], correctAnswer: 'open' },
  { steps: ['open', '?', 'open', 'closed'], correctAnswer: 'closed' },
  { steps: ['closed', 'open', 'open', '?'], correctAnswer: 'closed' },
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

export function SequenceBuilderGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [currentSequence, setCurrentSequence] = useState<Sequence | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<StepState | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStep, setVerificationStep] = useState(0);
  const [correctSequences, setCorrectSequences] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalCorrectSequences: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableJawStateRef = useRef<{ state: boolean; since: number } | null>(null);
  const verificationStartTimeRef = useRef<number | null>(null);
  const lastSequenceTimeRef = useRef(0);
  const sequenceCooldown = 1500; // 1.5 seconds between sequences

  // Generate new sequence
  const generateSequence = useCallback(() => {
    const sequenceIndex = Math.floor(Math.random() * SEQUENCES.length);
    const sequence = SEQUENCES[sequenceIndex];
    setCurrentSequence(sequence);
    setSelectedAnswer(null);
    setIsVerifying(false);
    setVerificationStep(0);
    verificationStartTimeRef.current = null;
  }, []);

  // Handle answer selection
  const handleAnswerSelect = useCallback((answer: StepState) => {
    if (isVerifying || !currentSequence) return;
    
    setSelectedAnswer(answer);
    setIsVerifying(true);
    setVerificationStep(0);
    verificationStartTimeRef.current = Date.now();
    speak('Now perform the sequence!');
  }, [currentSequence, isVerifying]);

  // Verify sequence by performing it
  useEffect(() => {
    if (!isVerifying || gameState !== 'playing' || !isDetecting || !currentSequence || !selectedAnswer || !verificationStartTimeRef.current) return;

    const now = Date.now();
    const completeSequence = currentSequence.steps.map(step => step === '?' ? selectedAnswer : step) as StepState[];
    const expectedStep = completeSequence[verificationStep];
    
    if (!expectedStep) {
      // Sequence verification complete
      const isCorrect = selectedAnswer === currentSequence.correctAnswer;
      
      if (isCorrect && now - lastSequenceTimeRef.current > sequenceCooldown) {
        lastSequenceTimeRef.current = now;
        setCorrectSequences(prev => prev + 1);
        
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
        speak('Correct!');
        
        // Generate new sequence
        setTimeout(() => {
          generateSequence();
        }, 1000);
      } else {
        speak('Try again!');
        generateSequence();
      }
      
      setIsVerifying(false);
      setVerificationStep(0);
      verificationStartTimeRef.current = null;
      return;
    }

    // Stability check
    if (stableJawStateRef.current?.state === isOpen) {
      if (now - stableJawStateRef.current.since >= STABILITY_MS) {
        const expectedState = expectedStep === 'open';
        
        if (isOpen === expectedState) {
          // Correct state - move to next step
          if (verificationStartTimeRef.current === null) {
            verificationStartTimeRef.current = now;
          } else {
            // Hold for at least 500ms before moving to next step
            if (now - verificationStartTimeRef.current >= 500) {
              setVerificationStep(prev => prev + 1);
              verificationStartTimeRef.current = now;
            }
          }
        }
      }
    } else {
      stableJawStateRef.current = { state: isOpen, since: now };
    }
  }, [isOpen, isDetecting, gameState, isVerifying, currentSequence, selectedAnswer, verificationStep, generateSequence]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    generateSequence();
    setCorrectSequences(0);
    setTimeElapsed(0);
    stableJawStateRef.current = null;
    setVerificationStep(0);
    verificationStartTimeRef.current = null;
    lastSequenceTimeRef.current = 0;

    if (currentRound === 1) {
      speak(
        'Welcome to Sequence Builder! Choose the missing step, then perform the sequence! ' +
        'Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, generateSequence]);

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
    setGameState('playing');
    generateSequence();
    setCorrectSequences(0);
    setTimeElapsed(0);
    stableJawStateRef.current = null;
    setVerificationStep(0);
    verificationStartTimeRef.current = null;
    lastSequenceTimeRef.current = 0;

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [generateSequence]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    let stars = 0;
    if (correctSequences >= 7) {
      stars = 3;
    } else if (correctSequences >= 5) {
      stars = 2;
    } else if (correctSequences >= 3) {
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

    const totalCorrectSequences = roundResults.reduce((sum, r) => sum + r.correctSequences, 0);
    const accuracy = Math.round((totalCorrectSequences / (requiredRounds * 7)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalCorrectSequences,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You completed ${totalCorrectSequences} sequences!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'sequence-builder',
        correct: totalCorrectSequences,
        total: requiredRounds * 7,
        accuracy,
        xpAwarded,
        skillTags: ['oral-sequences', 'sequence-completion', 'pattern-recognition', 'motor-sequencing'],
        meta: {
          totalRounds: requiredRounds,
          totalCorrectSequences,
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
        correct={finalStats.totalCorrectSequences}
        total={requiredRounds * 7}
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

  const completeSequence = currentSequence
    ? currentSequence.steps.map(step => step === '?' ? selectedAnswer || '?' : step)
    : [];

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
              ? 'Great! Now get ready to build sequences!'
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
          {/* Sequence display */}
          <View style={styles.sequenceContainer}>
            <Text style={styles.sequenceLabel}>
              {isVerifying ? 'Perform the sequence:' : 'Complete the sequence:'}
            </Text>
            <View style={styles.sequenceRow}>
              {completeSequence.map((step, index) => {
                const isMissing = currentSequence.steps[index] === '?';
                const isCurrentStep = isVerifying && index === verificationStep;
                
                return (
                  <View
                    key={index}
                    style={[
                      styles.sequenceStep,
                      {
                        backgroundColor: isCurrentStep
                          ? '#FFD700'
                          : isMissing && selectedAnswer
                          ? selectedAnswer === 'open' ? '#4CAF50' : '#F44336'
                          : step === 'open'
                          ? '#4CAF50'
                          : step === 'closed'
                          ? '#F44336'
                          : '#999',
                      },
                    ]}
                  >
                    <Text style={styles.sequenceStepText}>
                      {step === '?' ? '?' : step === 'open' ? 'O' : 'C'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Answer buttons */}
          {!isVerifying && (
            <View style={styles.buttonContainer}>
              <Pressable
                style={[
                  styles.answerButton,
                  {
                    backgroundColor: selectedAnswer === 'open' ? '#4CAF50' : '#81C784',
                  },
                ]}
                onPress={() => handleAnswerSelect('open')}
              >
                <Text style={styles.buttonText}>OPEN</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.answerButton,
                  {
                    backgroundColor: selectedAnswer === 'closed' ? '#F44336' : '#E57373',
                  },
                ]}
                onPress={() => handleAnswerSelect('closed')}
              >
                <Text style={styles.buttonText}>CLOSE</Text>
              </Pressable>
            </View>
          )}

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>Correct: {correctSequences}</Text>
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
  sequenceContainer: {
    position: 'absolute',
    top: 150,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  sequenceLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 15,
  },
  sequenceRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  sequenceStep: {
    width: 70,
    height: 70,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFF',
  },
  sequenceStepText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFF',
  },
  buttonContainer: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 30,
    zIndex: 6,
  },
  answerButton: {
    width: 140,
    height: 70,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFF',
  },
  buttonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
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

