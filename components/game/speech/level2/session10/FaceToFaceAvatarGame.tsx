/**
 * Face-to-Face Avatar Game
 * Slow exaggerated oral movements with avatar demonstration
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

type MovementType = 'open' | 'close' | 'smile' | 'pucker';

interface RoundResult {
  round: number;
  stars: number;
  correctImitations: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 30000; // 30 seconds per round
const MOVEMENT_DURATION_MS = 4000; // 4 seconds for slow exaggerated movements
const STABILITY_MS = 500;
const MATCH_WINDOW_MS = 2000; // 2 second window to match
const DEFAULT_TTS_RATE = 0.75;

const MOVEMENTS: MovementType[] = ['open', 'close', 'smile', 'pucker'];

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

export function FaceToFaceAvatarGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const [currentMovement, setCurrentMovement] = useState<MovementType | null>(null);
  const [avatarMouthState, setAvatarMouthState] = useState<'open' | 'closed' | 'smile' | 'pucker'>('closed');
  const [correctImitations, setCorrectImitations] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalImitations: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const movementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarScale = useRef(new Animated.Value(1)).current;
  const mouthScale = useRef(new Animated.Value(1)).current;
  const stableStateRef = useRef<{ state: string; since: number } | null>(null);
  const lastMovementTimeRef = useRef(0);
  const movementStartTimeRef = useRef<number | null>(null);
  const imitationCooldown = 2000; // 2 seconds between successful imitations

  // Animate avatar mouth based on movement type
  const animateAvatarMouth = useCallback((movement: MovementType) => {
    setAvatarMouthState(movement === 'open' ? 'open' : movement === 'smile' ? 'smile' : movement === 'pucker' ? 'pucker' : 'closed');

    // Slow exaggerated animation
    Animated.sequence([
      Animated.timing(mouthScale, {
        toValue: movement === 'open' ? 1.3 : movement === 'pucker' ? 1.2 : 1.1,
        duration: MOVEMENT_DURATION_MS / 2,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(mouthScale, {
        toValue: 1,
        duration: MOVEMENT_DURATION_MS / 2,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [mouthScale]);

  // Show next movement
  const showNextMovement = useCallback(() => {
    const movementIndex = Math.floor(Math.random() * MOVEMENTS.length);
    const movement = MOVEMENTS[movementIndex];
    setCurrentMovement(movement);
    movementStartTimeRef.current = Date.now();
    animateAvatarMouth(movement);

    const movementName = movement === 'open' ? 'Open' : movement === 'close' ? 'Close' : movement === 'smile' ? 'Smile' : 'Pucker';
    speak(`Watch: ${movementName}`);

    // Schedule next movement
    movementTimerRef.current = setTimeout(() => {
      showNextMovement();
    }, MOVEMENT_DURATION_MS + 1000);
  }, [animateAvatarMouth]);

  // Check if child imitates the movement
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting || !currentMovement || !movementStartTimeRef.current) return;

    const now = Date.now();
    const timeSinceMovement = now - movementStartTimeRef.current;

    // Only check within match window
    if (timeSinceMovement < 0 || timeSinceMovement > MATCH_WINDOW_MS) return;

    let childState = 'unknown';
    
    if (currentMovement === 'open' && isOpen) {
      childState = 'open';
    } else if (currentMovement === 'close' && !isOpen && ratio < 0.03) {
      childState = 'closed';
    } else if (currentMovement === 'smile' && smileAmount && smileAmount > 0.3) {
      childState = 'smile';
    } else if (currentMovement === 'pucker' && protrusion && protrusion > 0.4) {
      childState = 'pucker';
    }

    // Stability check
    if (childState !== 'unknown') {
      if (stableStateRef.current?.state === childState) {
        if (now - stableStateRef.current.since >= STABILITY_MS) {
          // Check if matches current movement
          if (childState === currentMovement && now - lastMovementTimeRef.current > imitationCooldown) {
            lastMovementTimeRef.current = now;
            setCorrectImitations(prev => prev + 1);

            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } catch {}
            speak('Great!');

            // Animate avatar on success
            Animated.sequence([
              Animated.timing(avatarScale, {
                toValue: 1.2,
                duration: 200,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(avatarScale, {
                toValue: 1,
                duration: 200,
                easing: Easing.in(Easing.quad),
                useNativeDriver: true,
              }),
            ]).start();
          }
        }
      } else {
        stableStateRef.current = { state: childState, since: now };
      }
    }
  }, [isOpen, ratio, smileAmount, protrusion, isDetecting, gameState, currentMovement, avatarScale]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentMovement(null);
    setCorrectImitations(0);
    setTimeElapsed(0);
    stableStateRef.current = null;
    lastMovementTimeRef.current = 0;
    movementStartTimeRef.current = null;
    avatarScale.setValue(1);
    mouthScale.setValue(1);

    if (currentRound === 1) {
      speak(
        'Welcome to Face-to-Face Avatar! Watch the avatar and copy its movements. ' +
        'Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, avatarScale, mouthScale]);

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
        speak(prev - 1 === 0 ? 'Go! Copy the avatar!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setCorrectImitations(0);
    setTimeElapsed(0);
    stableStateRef.current = null;
    lastMovementTimeRef.current = 0;
    avatarScale.setValue(1);
    mouthScale.setValue(1);

    // Start showing movements
    showNextMovement();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [avatarScale, mouthScale, showNextMovement]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (movementTimerRef.current) {
      clearTimeout(movementTimerRef.current);
      movementTimerRef.current = null;
    }

    let stars = 0;
    if (correctImitations >= 6) {
      stars = 3;
    } else if (correctImitations >= 4) {
      stars = 2;
    } else if (correctImitations >= 2) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      correctImitations,
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
  }, [currentRound, correctImitations, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalImitations = roundResults.reduce((sum, r) => sum + r.correctImitations, 0);
    const accuracy = Math.round((totalImitations / (requiredRounds * 8)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalImitations,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You imitated ${totalImitations} movements!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'face-to-face-avatar',
        correct: totalImitations,
        total: requiredRounds * 8,
        accuracy,
        xpAwarded,
        skillTags: ['foundational-imitation', 'visual-imitation', 'oral-motor', 'attention'],
        meta: {
          totalRounds: requiredRounds,
          totalImitations,
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
      if (movementTimerRef.current) clearTimeout(movementTimerRef.current);
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
        correct={finalStats.totalImitations}
        total={requiredRounds * 8}
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

  const getMouthEmoji = () => {
    if (avatarMouthState === 'open') return '😮';
    if (avatarMouthState === 'smile') return '😊';
    if (avatarMouthState === 'pucker') return '😗';
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

      {gameState === 'playing' && (
        <View style={styles.gameArea}>
          {/* Avatar */}
          <Animated.View
            style={[
              styles.avatarContainer,
              {
                top: screenHeight * 0.15,
                left: screenWidth / 2 - 100,
                transform: [{ scale: avatarScale }],
              },
            ]}
          >
            <Text style={styles.avatarEmoji}>👤</Text>
            <Animated.View style={{ transform: [{ scale: mouthScale }] }}>
              <Text style={styles.mouthEmoji}>{getMouthEmoji()}</Text>
            </Animated.View>
            {currentMovement && (
              <Text style={styles.movementLabel}>
                {currentMovement === 'open' ? 'Open' : currentMovement === 'close' ? 'Close' : currentMovement === 'smile' ? 'Smile' : 'Pucker'}
              </Text>
            )}
          </Animated.View>

          {/* Stats */}
          <View style={[styles.statsContainer, { left: screenWidth / 2 - 80 }]}>
            <Text style={styles.statsText}>Copied: {correctImitations}</Text>
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
  avatarContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  avatarEmoji: {
    fontSize: 100,
  },
  mouthEmoji: {
    fontSize: 80,
    marginTop: -20,
  },
  movementLabel: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 10,
    textAlign: 'center',
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

