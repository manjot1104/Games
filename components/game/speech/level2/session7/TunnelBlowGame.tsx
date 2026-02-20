/**
 * Tunnel Blow Game
 * Rounded lips control airflow through tunnel
 */

import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
import { BlowDetector } from '@/utils/blowDetection';
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

interface RoundResult {
  round: number;
  stars: number;
  successfulBlows: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const ROUNDNESS_THRESHOLD = 0.7; // Minimum roundness for O-shape
const OPEN_THRESHOLD = 0.03; // Mouth must be open
const BLOW_DURATION_MS = 2000; // Must maintain rounded blow for 2 seconds
const STABILITY_MS = 300;
const DEFAULT_TTS_RATE = 0.75;

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

// Helper function to calculate roundness from landmarks
function calculateRoundness(landmarks: any): number {
  if (!landmarks || !landmarks.mouthLeft || !landmarks.mouthRight) return 0;
  
  const upperLip = meanPoint(landmarks.upperLip || []);
  const lowerLip = meanPoint(landmarks.lowerLip || []);
  const mouthWidth = dist(landmarks.mouthLeft, landmarks.mouthRight);
  const mouthHeight = dist(upperLip, lowerLip);
  
  return mouthHeight / Math.max(1, mouthWidth);
}

function meanPoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (let i = 0; i < points.length; i++) {
    sx += points[i].x;
    sy += points[i].y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function TunnelBlowGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const protrusion = (jawDetection as any).protrusion as number | undefined;
  const landmarks = (jawDetection as any).landmarks as any;
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const previewRef = useRef<View>(null);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [currentRoundness, setCurrentRoundness] = useState(0);
  const [successfulBlows, setSuccessfulBlows] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalSuccessfulBlows: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [objectX, setObjectX] = useState(0); // Object position in tunnel

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const objectXAnim = useRef(new Animated.Value(0)).current;
  const blowDetector = useRef(new BlowDetector(800, 0.4)).current;
  const stableRoundnessStateRef = useRef<{ value: number; since: number } | null>(null);
  const roundedBlowStartTimeRef = useRef<number | null>(null);
  const lastBlowTimeRef = useRef(0);
  const blowCooldown = 2000; // 2 seconds between successful blows
  const emaRoundness = useRef(0);

  // Update roundness and blow detection
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting || !landmarks) return;

    const roundnessValue = calculateRoundness(landmarks);
    const now = Date.now();

    // Apply EMA smoothing
    const smoothed = emaRoundness.current === 0
      ? roundnessValue
      : 0.25 * roundnessValue + 0.75 * emaRoundness.current;
    emaRoundness.current = smoothed;

    // Stability check
    if (stableRoundnessStateRef.current?.value === smoothed) {
      if (now - stableRoundnessStateRef.current.since >= STABILITY_MS) {
        setCurrentRoundness(smoothed);

        // Check for rounded lips
        const isRounded = smoothed >= ROUNDNESS_THRESHOLD;
        const isOpen = (ratio || 0) > OPEN_THRESHOLD;
        const hasRoundedLips = isRounded && isOpen;

        // Check for active blowing
        const blowState = blowDetector.current.update(
          isOpen || false,
          (protrusion as number) || 0,
          ratio || 0
        );

        // Both conditions: rounded lips + sustained blowing
        if (hasRoundedLips && blowState.isSustained) {
          // Start tracking rounded blow
          if (roundedBlowStartTimeRef.current === null) {
            roundedBlowStartTimeRef.current = now;
          } else {
            const holdDuration = now - roundedBlowStartTimeRef.current;
            
            // Move object through tunnel based on blow intensity
            const moveSpeed = blowState.intensity * 5;
            setObjectX(prev => Math.min(screenWidth * 0.8, prev + moveSpeed));
            
            // Animate object position
            Animated.timing(objectXAnim, {
              toValue: objectX,
              duration: 100,
              easing: Easing.out(Easing.quad),
              useNativeDriver: false,
            }).start();
            
            // Check if held long enough for successful blow
            if (holdDuration >= BLOW_DURATION_MS && now - lastBlowTimeRef.current > blowCooldown) {
              lastBlowTimeRef.current = now;
              setSuccessfulBlows(prev => prev + 1);
              
              try {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              } catch {}
              speak('Great blow!');
              
              // Reset for next blow
              roundedBlowStartTimeRef.current = null;
              setObjectX(0);
              objectXAnim.setValue(0);
            }
          }
        } else {
          // Conditions not met
          if (roundedBlowStartTimeRef.current !== null) {
            roundedBlowStartTimeRef.current = null;
            // Object returns to start if blow stops
            if (!blowState.isSustained) {
              Animated.timing(objectXAnim, {
                toValue: 0,
                duration: 300,
                easing: Easing.in(Easing.quad),
                useNativeDriver: false,
              }).start(() => {
                setObjectX(0);
              });
            }
          }
        }
      }
    } else {
      stableRoundnessStateRef.current = { value: smoothed, since: now };
    }
  }, [landmarks, ratio, protrusion, isOpen, isDetecting, gameState, screenWidth, objectX, objectXAnim]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentRoundness(0);
    setSuccessfulBlows(0);
    setObjectX(0);
    setTimeElapsed(0);
    stableRoundnessStateRef.current = null;
    roundedBlowStartTimeRef.current = null;
    lastBlowTimeRef.current = 0;
    emaRoundness.current = 0;
    blowDetector.current.reset();
    objectXAnim.setValue(0);

    if (currentRound === 1) {
      speak(
        'Welcome to Tunnel Blow! Round your lips like "O" and blow to move objects through the tunnel. ' +
        'Keep your lips rounded while you blow! Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, objectXAnim, blowDetector]);

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
        speak(prev - 1 === 0 ? 'Go! Round and blow!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setCurrentRoundness(0);
    setSuccessfulBlows(0);
    setObjectX(0);
    setTimeElapsed(0);
    stableRoundnessStateRef.current = null;
    roundedBlowStartTimeRef.current = null;
    lastBlowTimeRef.current = 0;
    emaRoundness.current = 0;
    blowDetector.current.reset();
    objectXAnim.setValue(0);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [objectXAnim, blowDetector]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    let stars = 0;
    if (successfulBlows >= 3) {
      stars = 3;
    } else if (successfulBlows >= 2) {
      stars = 2;
    } else if (successfulBlows >= 1) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      successfulBlows,
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
  }, [currentRound, successfulBlows, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalSuccessfulBlows = roundResults.reduce((sum, r) => sum + r.successfulBlows, 0);
    const accuracy = Math.round((totalSuccessfulBlows / (requiredRounds * 3)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalSuccessfulBlows,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You completed ${totalSuccessfulBlows} rounded blows across all rounds!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'tunnel-blow',
        correct: totalSuccessfulBlows,
        total: requiredRounds * 3,
        accuracy,
        xpAwarded,
        skillTags: ['lip-rounding', 'airflow', 'oral-motor', 'o-sound', 'breath-control'],
        meta: {
          totalRounds: requiredRounds,
          totalSuccessfulBlows,
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
    const timeouts = [100, 500, 1000, 2000].map(delay => setTimeout(setAttribute, delay));
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
      let videoInContainer: HTMLVideoElement | null = null;
      const videosToRemove: HTMLVideoElement[] = [];
      allVideos.forEach((video) => {
        const videoElement = video as HTMLVideoElement;
        if (container.contains(videoElement)) {
          videoInContainer = videoElement;
        } else {
          videosToRemove.push(videoElement);
        }
      });
      if (!videoInContainer && allVideos.length > 0) {
        const videoToMove = allVideos[0] as HTMLVideoElement;
        if (videoToMove.parentElement && videoToMove.parentElement.contains(videoToMove)) {
          videoToMove.parentElement.removeChild(videoToMove);
        }
        container.appendChild(videoToMove);
        videoInContainer = videoToMove;
      }
      videosToRemove.forEach(video => {
        if (video.parentElement && video.parentElement.contains(video)) {
          video.parentElement.removeChild(video);
        }
      });
      if (videoInContainer) {
        videoInContainer.style.display = 'block';
        videoInContainer.style.position = 'absolute';
        videoInContainer.style.opacity = '1';
        videoInContainer.style.width = '100%';
        videoInContainer.style.height = '100%';
        videoInContainer.style.objectFit = 'cover';
        videoInContainer.style.top = '0';
        videoInContainer.style.left = '0';
        videoInContainer.style.right = '0';
        videoInContainer.style.bottom = '0';
        videoInContainer.style.zIndex = '1';
        videoInContainer.style.borderRadius = '0';
      }
      (container as any).style.position = 'absolute';
      (container as any).style.top = '0';
      (container as any).style.left = '0';
      (container as any).style.right = '0';
      (container as any).style.bottom = '0';
      (container as any).style.width = '100%';
      (container as any).style.height = '100%';
      (container as any).style.zIndex = '1';
      (container as any).style.display = 'block';
      (container as any).style.visibility = 'visible';
      (container as any).style.opacity = '1';
    };
    moveVideoToContainer();
    const interval = setInterval(moveVideoToContainer, 200);
    return () => clearInterval(interval);
  }, [previewContainerId, hasCamera, previewRef]);

  // Show completion screen
  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.totalSuccessfulBlows}
        total={requiredRounds * 3}
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
              ? 'Great! Now get ready to blow!'
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
          {/* Tunnel */}
          <View style={[styles.tunnel, {
            top: screenHeight * 0.3,
            left: screenWidth * 0.1,
            width: screenWidth * 0.8,
            height: screenHeight * 0.2,
          }]} />

          {/* Object moving through tunnel */}
          <Animated.View
            style={[
              styles.object,
              {
                top: screenHeight * 0.35,
                left: objectXAnim,
              },
            ]}
          >
            <Text style={styles.objectEmoji}>⚪</Text>
          </Animated.View>

          {/* Roundness and blow indicators */}
          <View style={styles.indicatorsContainer}>
            <View style={styles.indicator}>
              <Text style={styles.indicatorLabel}>
                Roundness: {Math.round(currentRoundness * 100)}%
              </Text>
              <View style={styles.indicatorBar}>
                <View
                  style={[
                    styles.indicatorFill,
                    {
                      width: `${Math.min(100, currentRoundness * 100)}%`,
                      backgroundColor: currentRoundness >= ROUNDNESS_THRESHOLD ? '#4CAF50' : '#FFC107',
                    },
                  ]}
                />
              </View>
            </View>
          </View>

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>Blows: {successfulBlows}</Text>
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
    backgroundColor: '#000000',
  },
  playArea: {
    flex: 1,
    position: 'relative',
  },
  fullScreenCamera: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: '#000000',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    pointerEvents: 'box-none', // Allow touches to pass through to camera
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
  tunnel: {
    position: 'absolute',
    borderWidth: 4,
    borderColor: '#4A90E2',
    borderRadius: 20,
    backgroundColor: 'rgba(74, 144, 226, 0.1)',
    zIndex: 3,
  },
  object: {
    position: 'absolute',
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  objectEmoji: {
    fontSize: 40,
  },
  indicatorsContainer: {
    position: 'absolute',
    top: 100,
    right: 20,
    width: 150,
    zIndex: 6,
  },
  indicator: {
    marginBottom: 10,
  },
  indicatorLabel: {
    fontSize: 12,
    color: '#FFF',
    marginBottom: 4,
    fontWeight: '600',
  },
  indicatorBar: {
    width: '100%',
    height: 15,
    backgroundColor: '#333',
    borderRadius: 8,
    overflow: 'hidden',
  },
  indicatorFill: {
    height: '100%',
    borderRadius: 8,
  },
  statsContainer: {
    position: 'absolute',
    top: 100,
    left: 20,
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

