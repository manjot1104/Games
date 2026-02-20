/**
 * Mirror Match Game
 * Avatar shows tongue direction, child copies it
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

type TongueDirection = 'left' | 'center' | 'right';

interface RoundResult {
  round: number;
  stars: number;
  matches: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const LEFT_THRESHOLD = 0.4; // Tongue x < 0.4 = left
const RIGHT_THRESHOLD = 0.6; // Tongue x > 0.6 = right
const STABILITY_MS = 300;
const DIRECTION_CHANGE_INTERVAL = 3000; // Change direction every 3 seconds
const MATCH_HOLD_TIME = 1000; // Must hold match for 1 second
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

export function MirrorMatchGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const [avatarDirection, setAvatarDirection] = useState<TongueDirection>('center');
  const [matches, setMatches] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalMatches: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const directionChangeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableTongueStateRef = useRef<{ x: number; since: number } | null>(null);
  const matchStartTimeRef = useRef<number | null>(null);
  const avatarScale = useRef(new Animated.Value(1)).current;

  // Get current tongue direction
  const getTongueDirection = useCallback((tongueX: number): TongueDirection => {
    if (tongueX < LEFT_THRESHOLD) return 'left';
    if (tongueX > RIGHT_THRESHOLD) return 'right';
    return 'center';
  }, []);

  // Change avatar direction periodically
  useEffect(() => {
    if (gameState !== 'playing') return;

    const directions: TongueDirection[] = ['left', 'center', 'right', 'left', 'right', 'center'];
    let directionIndex = 0;

    directionChangeTimerRef.current = setInterval(() => {
      directionIndex = (directionIndex + 1) % directions.length;
      const newDirection = directions[directionIndex];
      setAvatarDirection(newDirection);
      
      // Animate avatar
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

      speak(`Copy ${newDirection}!`);
    }, DIRECTION_CHANGE_INTERVAL);

    // Set initial direction
    setAvatarDirection(directions[0]);
    speak(`Copy ${directions[0]}!`);

    return () => {
      if (directionChangeTimerRef.current) {
        clearInterval(directionChangeTimerRef.current);
        directionChangeTimerRef.current = null;
      }
    };
  }, [gameState, avatarScale]);

  // Update tongue position tracking and check for matches
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
          const tongueDirection = getTongueDirection(tongueX);

          // Check if tongue matches avatar direction
          if (tongueDirection === avatarDirection) {
            // Match detected
            if (matchStartTimeRef.current === null) {
              matchStartTimeRef.current = now;
            } else if (now - matchStartTimeRef.current >= MATCH_HOLD_TIME) {
              // Held match long enough
              setMatches(prev => prev + 1);
              matchStartTimeRef.current = null;
              try {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              } catch {}
              speak('Perfect match!');
            }
          } else {
            // Not matching, reset match timer
            matchStartTimeRef.current = null;
          }
        }
      } else {
        stableTongueStateRef.current = { x: tongueX, since: now };
        matchStartTimeRef.current = null;
      }
    }
  }, [tonguePosition, isTongueVisible, isOpen, isDetecting, gameState, avatarDirection, getTongueDirection]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentTongueX(0.5);
    setAvatarDirection('center');
    setMatches(0);
    setTimeElapsed(0);
    stableTongueStateRef.current = null;
    matchStartTimeRef.current = null;
    avatarScale.setValue(1);

    if (currentRound === 1) {
      speak(
        'Welcome to Mirror Match! Copy the avatar\'s tongue direction. ' +
        'Open your mouth and move your tongue to match! Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, avatarScale]);

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
        speak(prev - 1 === 0 ? 'Go! Match the avatar!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setCurrentTongueX(0.5);
    setAvatarDirection('center');
    setMatches(0);
    setTimeElapsed(0);
    stableTongueStateRef.current = null;
    matchStartTimeRef.current = null;
    avatarScale.setValue(1);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [avatarScale]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (directionChangeTimerRef.current) {
      clearInterval(directionChangeTimerRef.current);
      directionChangeTimerRef.current = null;
    }

    let stars = 0;
    if (matches >= 5) {
      stars = 3;
    } else if (matches >= 3) {
      stars = 2;
    } else if (matches >= 2) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      matches,
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
  }, [currentRound, matches, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalMatches = roundResults.reduce((sum, r) => sum + r.matches, 0);
    const accuracy = Math.round((totalMatches / (requiredRounds * 6)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalMatches,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You matched the avatar ${totalMatches} times across all rounds!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'mirror-match',
        correct: totalMatches,
        total: requiredRounds * 6,
        accuracy,
        xpAwarded,
        skillTags: ['tongue-lateralization', 'oral-motor', 'tongue-control', 'imitation'],
        meta: {
          totalRounds: requiredRounds,
          totalMatches,
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
      if (directionChangeTimerRef.current) clearInterval(directionChangeTimerRef.current);
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
        correct={finalStats.totalMatches}
        total={requiredRounds * 6}
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

  const avatarSize = 150;
  const tongueIndicatorX = screenWidth * 0.1 + (currentTongueX * screenWidth * 0.8);

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
              ? 'Great! Now get ready to match!'
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
                left: screenWidth / 2 - avatarSize / 2,
                transform: [{ scale: avatarScale }],
              },
            ]}
          >
            <View style={styles.avatarFace}>
              <Text style={styles.avatarEmoji}>😊</Text>
            </View>
            {/* Avatar tongue indicator */}
            <View
              style={[
                styles.avatarTongue,
                {
                  left: avatarDirection === 'left' 
                    ? avatarSize * 0.2 
                    : avatarDirection === 'right'
                    ? avatarSize * 0.7
                    : avatarSize * 0.45,
                },
              ]}
            >
              <Text style={styles.avatarTongueEmoji}>👅</Text>
            </View>
            <Text style={styles.avatarDirectionText}>
              {avatarDirection.toUpperCase()}
            </Text>
          </Animated.View>

          {/* Child's tongue indicator */}
          <View
            style={[
              styles.tongueIndicator,
              {
                left: tongueIndicatorX - 30,
                top: screenHeight * 0.6,
                opacity: isTongueVisible && isOpen ? 1 : 0.3,
              },
            ]}
          >
            <Text style={styles.tongueEmoji}>👅</Text>
          </View>

          {/* Match indicator */}
          {getTongueDirection(currentTongueX) === avatarDirection && isTongueVisible && isOpen && (
            <View style={[styles.matchIndicator, { top: screenHeight * 0.5 }]}>
              <Text style={styles.matchText}>✓ MATCHING</Text>
            </View>
          )}

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>Matches: {matches}</Text>
            <Text style={styles.statsSubtext}>
              Your tongue: {getTongueDirection(currentTongueX).toUpperCase()}
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
    width: 150,
    height: 200,
    alignItems: 'center',
    zIndex: 5,
  },
  avatarFace: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#FFDBAC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  avatarEmoji: {
    fontSize: 80,
  },
  avatarTongue: {
    position: 'absolute',
    top: 100,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTongueEmoji: {
    fontSize: 30,
  },
  avatarDirectionText: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  tongueIndicator: {
    position: 'absolute',
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  tongueEmoji: {
    fontSize: 40,
  },
  matchIndicator: {
    position: 'absolute',
    left: '50%',
    marginLeft: -80,
    width: 160,
    padding: 10,
    backgroundColor: '#22C55E',
    borderRadius: 20,
    alignItems: 'center',
    zIndex: 6,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
  },
  matchText: {
    fontSize: 18,
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
    marginBottom: 4,
  },
  statsSubtext: {
    fontSize: 14,
    color: '#CCC',
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

