/**
 * Breath Meter Game
 * Visual bar fills with airflow - keep meter filled above 70% for as long as possible
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
  timeAboveThreshold: number; // seconds
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const METER_THRESHOLD = 0.7; // 70% threshold
const TARGET_TIME_MS = 12000; // Target: 8-12 seconds above threshold per round
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

export function BreathMeterGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const previewRef = useRef<View>(null);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [meterLevel, setMeterLevel] = useState(0); // 0-1
  const [isAboveThreshold, setIsAboveThreshold] = useState(false);
  const [timeAboveThreshold, setTimeAboveThreshold] = useState(0); // milliseconds
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalTimeAboveThreshold: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thresholdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blowDetector = useRef(new BlowDetector(500, 0.4)).current;
  const thresholdStartTimeRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef(0);

  // Update blow detection and meter
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting) return;

    const blowState = blowDetector.current.update(
      isOpen || false,
      (protrusion as number) || 0,
      ratio || 0
    );

    const now = Date.now();
    const intensity = blowState.intensity;

    // Update meter level based on intensity
    setMeterLevel(intensity);

    // Check if above threshold
    const aboveThreshold = intensity >= METER_THRESHOLD;

    if (aboveThreshold && !isAboveThreshold) {
      // Just crossed threshold
      setIsAboveThreshold(true);
      thresholdStartTimeRef.current = now;
      lastUpdateTimeRef.current = now;
    } else if (aboveThreshold && isAboveThreshold) {
      // Still above threshold - track time
      const elapsed = now - lastUpdateTimeRef.current;
      setTimeAboveThreshold(prev => prev + elapsed);
      lastUpdateTimeRef.current = now;
    } else if (!aboveThreshold && isAboveThreshold) {
      // Just dropped below threshold
      setIsAboveThreshold(false);
      if (thresholdStartTimeRef.current !== null) {
        const finalElapsed = now - lastUpdateTimeRef.current;
        setTimeAboveThreshold(prev => prev + finalElapsed);
        thresholdStartTimeRef.current = null;
      }
      lastUpdateTimeRef.current = 0;
    }
  }, [isOpen, ratio, protrusion, isDetecting, gameState, isAboveThreshold]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setMeterLevel(0);
    setIsAboveThreshold(false);
    setTimeAboveThreshold(0);
    setTimeElapsed(0);
    thresholdStartTimeRef.current = null;
    lastUpdateTimeRef.current = 0;
    blowDetector.current.reset();

    if (currentRound === 1) {
      speak(
        'Welcome to Breath Meter! Keep the meter filled above the green line. ' +
        'Blow steadily to keep it high! Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, blowDetector]);

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
        speak(prev - 1 === 0 ? 'Go! Fill the meter!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setMeterLevel(0);
    setIsAboveThreshold(false);
    setTimeAboveThreshold(0);
    setTimeElapsed(0);
    thresholdStartTimeRef.current = null;
    lastUpdateTimeRef.current = 0;
    blowDetector.current.reset();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [blowDetector]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Final time calculation
    if (isAboveThreshold && thresholdStartTimeRef.current !== null) {
      const finalElapsed = Date.now() - lastUpdateTimeRef.current;
      setTimeAboveThreshold(prev => prev + finalElapsed);
    }

    const timeAboveSeconds = timeAboveThreshold / 1000;
    
    let stars = 0;
    if (timeAboveSeconds >= 12) {
      stars = 3;
    } else if (timeAboveSeconds >= 8) {
      stars = 2;
    } else if (timeAboveSeconds >= 5) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      timeAboveThreshold: timeAboveSeconds,
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
  }, [currentRound, timeAboveThreshold, timeElapsed, isAboveThreshold, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalTimeAboveThreshold = roundResults.reduce((sum, r) => sum + r.timeAboveThreshold, 0);
    const targetTotalTime = (requiredRounds * TARGET_TIME_MS) / 1000;
    const accuracy = Math.round((totalTimeAboveThreshold / targetTotalTime) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalTimeAboveThreshold,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You kept the meter filled for ${Math.round(totalTimeAboveThreshold)} seconds!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'breath-meter',
        correct: Math.round(totalTimeAboveThreshold),
        total: Math.round(targetTotalTime),
        accuracy,
        xpAwarded,
        skillTags: ['breath-control', 'sustained-breathing', 'airflow-control', 'oral-motor'],
        meta: {
          totalRounds: requiredRounds,
          totalTimeAboveThreshold,
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
      if (thresholdTimerRef.current) clearInterval(thresholdTimerRef.current);
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
        correct={Math.round(finalStats.totalTimeAboveThreshold)}
        total={Math.round((requiredRounds * TARGET_TIME_MS) / 1000)}
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

  const meterHeight = screenHeight * 0.4;
  const thresholdY = meterHeight * (1 - METER_THRESHOLD);

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
              ? 'Great! Now get ready to fill the meter!'
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
          {/* Breath Meter */}
          <View style={[styles.meterContainer, {
            left: screenWidth / 2 - 40,
            top: screenHeight * 0.2,
            height: meterHeight,
          }]}>
            {/* Meter fill */}
            <View
              style={[
                styles.meterFill,
                {
                  height: `${meterLevel * 100}%`,
                  backgroundColor: isAboveThreshold ? '#4CAF50' : '#FFC107',
                },
              ]}
            />
            
            {/* Threshold line */}
            <View
              style={[
                styles.thresholdLine,
                {
                  bottom: `${METER_THRESHOLD * 100}%`,
                },
              ]}
            />
            
            {/* Threshold label */}
            <Text style={styles.thresholdLabel}>70%</Text>
          </View>

          {/* Meter value */}
          <View style={styles.meterValueContainer}>
            <Text style={styles.meterValue}>
              {Math.round(meterLevel * 100)}%
            </Text>
            {isAboveThreshold && (
              <Text style={styles.thresholdStatus}>✓ Above Threshold!</Text>
            )}
          </View>

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>
              Time: {Math.round(timeAboveThreshold / 1000)}s
            </Text>
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
  meterContainer: {
    position: 'absolute',
    width: 80,
    borderWidth: 4,
    borderColor: '#333',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#E0E0E0',
    zIndex: 5,
  },
  meterFill: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    borderRadius: 6,
  },
  thresholdLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#4CAF50',
    zIndex: 6,
  },
  thresholdLabel: {
    position: 'absolute',
    right: -30,
    fontSize: 12,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  meterValueContainer: {
    position: 'absolute',
    top: '65%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  meterValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
  },
  thresholdStatus: {
    fontSize: 14,
    color: '#4CAF50',
    marginTop: 4,
    fontWeight: 'bold',
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

