/**
 * Highlight Zones Game
 * Lips/jaw/tongue glow feedback for visual guidance
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

type ZoneType = 'lips' | 'jaw' | 'tongue';

interface RoundResult {
  round: number;
  stars: number;
  correctZones: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 25000; // 25 seconds per round
const ZONE_DURATION_MS = 3500; // 3.5 seconds per zone
const STABILITY_MS = 400;
const MATCH_WINDOW_MS = 2500;
const DEFAULT_TTS_RATE = 0.75;

const ZONES: ZoneType[] = ['lips', 'jaw', 'tongue'];

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

export function HighlightZonesGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
  const { width: screenWidth = 0, height: screenHeight = 0 } = useWindowDimensions();
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : true);

  const {
    isOpen,
    ratio,
    isDetecting,
    hasCamera,
    error: jawError,
    tongueElevation,
    isTongueVisible,
  } = jawDetection;

  // Web-only properties
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const previewRef = useRef<View>(null);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [currentZone, setCurrentZone] = useState<ZoneType | null>(null);
  const [zoneGlow, setZoneGlow] = useState(new Animated.Value(0));
  const [correctZones, setCorrectZones] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalZones: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const zoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableStateRef = useRef<{ zone: ZoneType | null; since: number } | null>(null);
  const lastZoneTimeRef = useRef(0);
  const zoneStartTimeRef = useRef<number | null>(null);
  const zoneCooldown = 2000;

  // Animate zone glow
  const animateZoneGlow = useCallback((zone: ZoneType) => {
    setCurrentZone(zone);
    zoneStartTimeRef.current = Date.now();

    // Pulsing glow animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(zoneGlow, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(zoneGlow, {
          toValue: 0.3,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    const zoneName = zone === 'lips' ? 'Lips' : zone === 'jaw' ? 'Jaw' : 'Tongue';
    speak(`Focus on your ${zoneName}`);

    // Schedule next zone
    zoneTimerRef.current = setTimeout(() => {
      zoneGlow.stopAnimation();
      showNextZone();
    }, ZONE_DURATION_MS);
  }, [zoneGlow]);

  // Show next zone
  const showNextZone = useCallback(() => {
    const zoneIndex = Math.floor(Math.random() * ZONES.length);
    const zone = ZONES[zoneIndex];
    animateZoneGlow(zone);
  }, [animateZoneGlow]);

  // Check if child is using the highlighted zone
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting || !currentZone || !zoneStartTimeRef.current) return;

    const now = Date.now();
    const timeSinceZone = now - zoneStartTimeRef.current;

    if (timeSinceZone < 0 || timeSinceZone > MATCH_WINDOW_MS) return;

    let isUsingZone = false;

    if (currentZone === 'lips') {
      // Check for lip movement (open/close or protrusion)
      const isMovingLips = isOpen || (ratio > 0.03 && ratio < 0.035);
      isUsingZone = isMovingLips;
    } else if (currentZone === 'jaw') {
      // Check for jaw movement (open/close)
      isUsingZone = isOpen || ratio < 0.028;
    } else if (currentZone === 'tongue') {
      // Check for tongue visibility/elevation
      isUsingZone = isTongueVisible || (tongueElevation && tongueElevation > 0.3);
    }

    if (isUsingZone) {
      if (stableStateRef.current?.zone === currentZone) {
        if (now - stableStateRef.current.since >= STABILITY_MS) {
          if (now - lastZoneTimeRef.current > zoneCooldown) {
            lastZoneTimeRef.current = now;
            setCorrectZones(prev => prev + 1);

            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            } catch {}
            speak('Good!');
          }
        }
      } else {
        stableStateRef.current = { zone: currentZone, since: now };
      }
    } else {
      stableStateRef.current = null;
    }
  }, [isOpen, ratio, tongueElevation, isTongueVisible, isDetecting, gameState, currentZone]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentZone(null);
    setCorrectZones(0);
    setTimeElapsed(0);
    stableStateRef.current = null;
    lastZoneTimeRef.current = 0;
    zoneStartTimeRef.current = null;
    zoneGlow.setValue(0);

    if (currentRound === 1) {
      speak(
        'Welcome to Highlight Zones! Watch the glowing areas and use those parts of your face. ' +
        'Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, zoneGlow]);

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
        speak(prev - 1 === 0 ? 'Go! Follow the glow!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setCorrectZones(0);
    setTimeElapsed(0);
    stableStateRef.current = null;
    lastZoneTimeRef.current = 0;
    zoneGlow.setValue(0);

    showNextZone();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [zoneGlow, showNextZone]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (zoneTimerRef.current) {
      clearTimeout(zoneTimerRef.current);
      zoneTimerRef.current = null;
    }
    zoneGlow.stopAnimation();

    let stars = 0;
    if (correctZones >= 5) {
      stars = 3;
    } else if (correctZones >= 3) {
      stars = 2;
    } else if (correctZones >= 2) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      correctZones,
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
  }, [currentRound, correctZones, timeElapsed, requiredRounds, startCalibration, zoneGlow]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalZones = roundResults.reduce((sum, r) => sum + r.correctZones, 0);
    const accuracy = Math.round((totalZones / (requiredRounds * 6)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalZones,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You used ${totalZones} highlighted zones!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'highlight-zones',
        correct: totalZones,
        total: requiredRounds * 6,
        accuracy,
        xpAwarded,
        skillTags: ['foundational-imitation', 'visual-guidance', 'oral-motor', 'attention'],
        meta: {
          totalRounds: requiredRounds,
          totalZones,
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
      if (zoneTimerRef.current) clearTimeout(zoneTimerRef.current);
      zoneGlow.stopAnimation();
    };
  }, [zoneGlow]);

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
        correct={finalStats.totalZones}
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

  const glowColor = currentZone === 'lips' ? '#FF6B9D' : currentZone === 'jaw' ? '#4CAF50' : '#FFD700';
  const glowOpacity = zoneGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.9],
  });

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
              ? 'Great! Now watch for the glowing zones!'
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

      {gameState === 'playing' && currentZone && (
        <View style={styles.gameArea}>
          {/* Highlight zone overlay */}
          <Animated.View
            style={[
              styles.zoneOverlay,
              {
                backgroundColor: glowColor,
                opacity: glowOpacity,
                ...(currentZone === 'lips' && {
                  top: screenHeight * 0.5,
                  left: screenWidth * 0.35,
                  width: screenWidth * 0.3,
                  height: screenHeight * 0.1,
                  borderRadius: 50,
                }),
                ...(currentZone === 'jaw' && {
                  top: screenHeight * 0.45,
                  left: screenWidth * 0.3,
                  width: screenWidth * 0.4,
                  height: screenHeight * 0.15,
                  borderRadius: 100,
                }),
                ...(currentZone === 'tongue' && {
                  top: screenHeight * 0.52,
                  left: screenWidth * 0.38,
                  width: screenWidth * 0.24,
                  height: screenHeight * 0.08,
                  borderRadius: 40,
                }),
              },
            ]}
          />

          {/* Zone label */}
          <View style={[styles.zoneLabel, { top: screenHeight * 0.25 }]}>
            <Text style={styles.zoneLabelText}>
              {currentZone === 'lips' ? '👄 LIPS' : currentZone === 'jaw' ? '🦷 JAW' : '👅 TONGUE'}
            </Text>
          </View>

          {/* Stats */}
          <View style={[styles.statsContainer, { left: screenWidth / 2 - 80 }]}>
            <Text style={styles.statsText}>Zones: {correctZones}</Text>
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
  zoneOverlay: {
    position: 'absolute',
    zIndex: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },
  zoneLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  zoneLabelText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFF',
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
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

