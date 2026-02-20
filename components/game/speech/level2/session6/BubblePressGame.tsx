/**
 * Bubble Press Game
 * Child presses lips together to form bubble
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
  bubbles: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const CLOSE_THRESHOLD = 0.028; // Lip closure threshold
const CLOSURE_HOLD_MS = 400; // Must hold closure for 400ms
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

export function BubblePressGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const [currentRatio, setCurrentRatio] = useState(0);
  const [bubbles, setBubbles] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalBubbles: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [bubbleSize, setBubbleSize] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bubbleScale = useRef(new Animated.Value(0)).current;
  const stableRatioStateRef = useRef<{ value: number; since: number } | null>(null);
  const closureStartTimeRef = useRef<number | null>(null);
  const lastBubbleTimeRef = useRef(0);
  const bubbleCooldown = 1000; // 1 second between bubbles

  // Update ratio tracking and detect lip closure
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting) return;

    const ratioValue = ratio || 0;
    const now = Date.now();

    // Stability check
    if (stableRatioStateRef.current?.value === ratioValue) {
      if (now - stableRatioStateRef.current.since >= STABILITY_MS) {
        setCurrentRatio(ratioValue);

        // Check for lip closure
        const isClosed = ratioValue < CLOSE_THRESHOLD;

        if (isClosed) {
          // Start tracking closure
          if (closureStartTimeRef.current === null) {
            closureStartTimeRef.current = now;
          } else {
            const holdDuration = now - closureStartTimeRef.current;
            
            // Show bubble when held long enough
            if (holdDuration >= CLOSURE_HOLD_MS && !bubbleVisible) {
              setBubbleVisible(true);
              setBubbleSize(0.3);
              
              // Animate bubble growth
              Animated.timing(bubbleScale, {
                toValue: 0.8,
                duration: 500,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }).start();
            } else if (holdDuration >= CLOSURE_HOLD_MS) {
              // Continue growing bubble
              const growth = Math.min(1, 0.3 + (holdDuration - CLOSURE_HOLD_MS) / 1000);
              setBubbleSize(growth);
              bubbleScale.setValue(growth);
            }
          }
        } else {
          // Lips opened
          if (bubbleVisible && closureStartTimeRef.current) {
            const holdDuration = now - closureStartTimeRef.current;
            
            // Count bubble if held long enough
            if (holdDuration >= CLOSURE_HOLD_MS && now - lastBubbleTimeRef.current > bubbleCooldown) {
              lastBubbleTimeRef.current = now;
              setBubbles(prev => prev + 1);
              
              try {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              } catch {}
              speak('Bubble formed!');
            }
            
            // Reset bubble
            setBubbleVisible(false);
            setBubbleSize(0);
            Animated.timing(bubbleScale, {
              toValue: 0,
              duration: 200,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }).start();
          }
          
          closureStartTimeRef.current = null;
        }
      }
    } else {
      stableRatioStateRef.current = { value: ratioValue, since: now };
    }
  }, [ratio, isDetecting, gameState, bubbleVisible, bubbleScale]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentRatio(0);
    setBubbles(0);
    setBubbleVisible(false);
    setBubbleSize(0);
    setTimeElapsed(0);
    stableRatioStateRef.current = null;
    closureStartTimeRef.current = null;
    lastBubbleTimeRef.current = 0;
    bubbleScale.setValue(0);

    if (currentRound === 1) {
      speak(
        'Welcome to Bubble Press! Press your lips together to form bubbles. ' +
        'Hold your lips closed to make the bubble grow! Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, bubbleScale]);

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
        speak(prev - 1 === 0 ? 'Go! Press your lips!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setCurrentRatio(0);
    setBubbles(0);
    setBubbleVisible(false);
    setBubbleSize(0);
    setTimeElapsed(0);
    stableRatioStateRef.current = null;
    closureStartTimeRef.current = null;
    lastBubbleTimeRef.current = 0;
    bubbleScale.setValue(0);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [bubbleScale]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    let stars = 0;
    if (bubbles >= 4) {
      stars = 3;
    } else if (bubbles >= 2) {
      stars = 2;
    } else if (bubbles >= 1) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      bubbles,
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
  }, [currentRound, bubbles, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalBubbles = roundResults.reduce((sum, r) => sum + r.bubbles, 0);
    const accuracy = Math.round((totalBubbles / (requiredRounds * 4)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalBubbles,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You formed ${totalBubbles} bubbles across all rounds!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'bubble-press',
        correct: totalBubbles,
        total: requiredRounds * 4,
        accuracy,
        xpAwarded,
        skillTags: ['bilabial-strength', 'lip-closure', 'oral-motor', 'b-sound'],
        meta: {
          totalRounds: requiredRounds,
          totalBubbles,
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
        correct={finalStats.totalBubbles}
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

  const bubbleBaseSize = Math.min(screenWidth, screenHeight) * 0.25;

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
          <Ionicons name="arrow-back" size={24} color="#333" />
        </Pressable>
        <Text style={styles.headerText}>Round {currentRound} / {requiredRounds}</Text>
        <View style={styles.starsContainer}>
          {[1, 2, 3].map(i => (
            <Ionicons
              key={i}
              name="star"
              size={20}
              color={i <= totalStars ? '#FFD700' : '#CCC'}
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
              ? 'Great! Now get ready to press!'
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
          {/* Bubble */}
          {bubbleVisible && (
            <Animated.View
              style={[
                styles.bubbleContainer,
                {
                  top: screenHeight * 0.25,
                  left: screenWidth / 2 - (bubbleBaseSize * bubbleSize) / 2,
                  width: bubbleBaseSize * bubbleSize,
                  height: bubbleBaseSize * bubbleSize,
                  transform: [{ scale: bubbleScale }],
                },
              ]}
            >
              <Text style={[styles.bubbleEmoji, { fontSize: bubbleBaseSize * bubbleSize * 0.8 }]}>
                💧
              </Text>
            </Animated.View>
          )}

          {/* Lip state indicator */}
          <View style={styles.indicatorContainer}>
            <Text style={styles.indicatorLabel}>
              {currentRatio < CLOSE_THRESHOLD ? 'Lips Closed ✓' : 'Lips Open'}
            </Text>
            <View style={styles.ratioBar}>
              <View
                style={[
                  styles.ratioFill,
                  {
                    width: `${Math.min(100, (1 - currentRatio / CLOSE_THRESHOLD) * 100)}%`,
                    backgroundColor: currentRatio < CLOSE_THRESHOLD ? '#4CAF50' : '#FFC107',
                  },
                ]}
              />
            </View>
          </View>

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>Bubbles: {bubbles}</Text>
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
    color: '#333',
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
    color: '#333',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 16,
    color: '#FF0000',
    marginTop: 10,
    textAlign: 'center',
  },
  countdownText: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#333',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
  },
  bubbleContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 1000,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderWidth: 3,
    borderColor: '#4DD0E1',
    zIndex: 5,
  },
  bubbleEmoji: {
    textAlign: 'center',
  },
  indicatorContainer: {
    position: 'absolute',
    top: 100,
    right: 20,
    width: 150,
    alignItems: 'center',
    zIndex: 6,
  },
  indicatorLabel: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
    fontWeight: '600',
  },
  ratioBar: {
    width: '100%',
    height: 20,
    backgroundColor: '#E0E0E0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  ratioFill: {
    height: '100%',
    borderRadius: 10,
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
    color: '#333',
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
    color: '#333',
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

