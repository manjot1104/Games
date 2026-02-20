/**
 * Cookie Sweep Game
 * Child moves tongue side to side to "sweep" crumbs
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

interface Crumb {
  id: number;
  x: number; // 0-1 normalized position
  side: 'left' | 'right';
  collected: boolean;
}

interface RoundResult {
  round: number;
  stars: number;
  crumbsCollected: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const LEFT_THRESHOLD = 0.4; // Tongue x < 0.4 = left
const RIGHT_THRESHOLD = 0.6; // Tongue x > 0.6 = right
const STABILITY_MS = 300;
const CRUMB_COLLECTION_DISTANCE = 0.1; // How close tongue needs to be to collect crumb
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

export function CookieSweepGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const tonguePosition = (jawDetection as any).tonguePosition as { x: number; y: number } | undefined;
  const isTongueVisible = (jawDetection as any).isTongueVisible as boolean | undefined;
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const previewRef = useRef<View>(null);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [currentTongueX, setCurrentTongueX] = useState(0.5);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [crumbsCollected, setCrumbsCollected] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalCrumbsCollected: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableTongueStateRef = useRef<{ x: number; since: number } | null>(null);
  const crumbIdCounter = useRef(0);

  // Generate crumbs
  const generateCrumbs = useCallback(() => {
    const newCrumbs: Crumb[] = [];
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? 'left' : 'right';
      const x = side === 'left' 
        ? 0.1 + Math.random() * 0.25 // Left side: 0.1-0.35
        : 0.65 + Math.random() * 0.25; // Right side: 0.65-0.9
      newCrumbs.push({
        id: crumbIdCounter.current++,
        x,
        side,
        collected: false,
      });
    }
    setCrumbs(newCrumbs);
    setCrumbsCollected(0);
  }, []);

  // Update tongue position tracking
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting) return;

    const tongueX = tonguePosition?.x ?? 0.5;
    const visible = (isTongueVisible as boolean) || false;
    const mouthOpen = isOpen;

    if (visible && mouthOpen && tongueX >= 0 && tongueX <= 1) {
      const now = Date.now();

      // Stability check
      if (stableTongueStateRef.current?.x === tongueX) {
        if (now - stableTongueStateRef.current.since >= STABILITY_MS) {
          setCurrentTongueX(tongueX);

          // Check for crumb collection
          setCrumbs(prev => {
            let collectedAny = false;
            const updated = prev.map(crumb => {
              if (crumb.collected) return crumb;
              
              const distance = Math.abs(crumb.x - tongueX);
              if (distance < CRUMB_COLLECTION_DISTANCE) {
                collectedAny = true;
                return { ...crumb, collected: true };
              }
              return crumb;
            });

            if (collectedAny) {
              setCrumbsCollected(prev => prev + 1);
              try {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              } catch {}
            }

            return updated;
          });
        }
      } else {
        stableTongueStateRef.current = { x: tongueX, since: now };
      }
    }
  }, [tonguePosition, isTongueVisible, isOpen, isDetecting, gameState]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentTongueX(0.5);
    setCrumbsCollected(0);
    setTimeElapsed(0);
    stableTongueStateRef.current = null;
    generateCrumbs();

    if (currentRound === 1) {
      speak(
        'Welcome to Cookie Sweep! Move your tongue side to side to collect the cookie crumbs. ' +
        'Open your mouth and sweep your tongue left and right! Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, generateCrumbs]);

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
        speak(prev - 1 === 0 ? 'Go! Sweep the crumbs!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setCurrentTongueX(0.5);
    setCrumbsCollected(0);
    setTimeElapsed(0);
    stableTongueStateRef.current = null;
    generateCrumbs();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [generateCrumbs]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    let stars = 0;
    if (crumbsCollected >= 7) {
      stars = 3;
    } else if (crumbsCollected >= 5) {
      stars = 2;
    } else if (crumbsCollected >= 3) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      crumbsCollected,
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
  }, [currentRound, crumbsCollected, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalCrumbsCollected = roundResults.reduce((sum, r) => sum + r.crumbsCollected, 0);
    const accuracy = Math.round((totalCrumbsCollected / (requiredRounds * 8)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalCrumbsCollected,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You collected ${totalCrumbsCollected} crumbs across all rounds!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'cookie-sweep',
        correct: totalCrumbsCollected,
        total: requiredRounds * 8,
        accuracy,
        xpAwarded,
        skillTags: ['tongue-lateralization', 'oral-motor', 'tongue-control', 'side-to-side'],
        meta: {
          totalRounds: requiredRounds,
          totalCrumbsCollected,
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
        correct={finalStats.totalCrumbsCollected}
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
              ? 'Great! Now get ready to sweep!'
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
          {/* Cookie */}
          <View style={[styles.cookie, {
            left: screenWidth / 2 - 60,
            top: screenHeight * 0.15,
          }]}>
            <Text style={styles.cookieEmoji}>🍪</Text>
          </View>

          {/* Crumbs */}
          {crumbs.map(crumb => (
            <View
              key={crumb.id}
              style={[
                styles.crumb,
                {
                  left: screenWidth * 0.1 + (crumb.x * screenWidth * 0.8) - 15,
                  top: screenHeight * 0.35 + (crumb.side === 'left' ? 0 : 40),
                  opacity: crumb.collected ? 0 : 1,
                  transform: [{ scale: crumb.collected ? 0 : 1 }],
                },
              ]}
            >
              <Text style={styles.crumbEmoji}>🍪</Text>
            </View>
          ))}

          {/* Tongue indicator */}
          <View
            style={[
              styles.tongueIndicator,
              {
                left: screenWidth * 0.1 + (currentTongueX * screenWidth * 0.8) - 30,
                top: screenHeight * 0.5,
                opacity: isTongueVisible && isOpen ? 1 : 0.3,
              },
            ]}
          >
            <Text style={styles.tongueEmoji}>👅</Text>
          </View>

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>Collected: {crumbsCollected} / {crumbs.length}</Text>
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
  cookie: {
    position: 'absolute',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  cookieEmoji: {
    fontSize: 100,
  },
  crumb: {
    position: 'absolute',
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  crumbEmoji: {
    fontSize: 25,
  },
  tongueIndicator: {
    position: 'absolute',
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  tongueEmoji: {
    fontSize: 40,
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

