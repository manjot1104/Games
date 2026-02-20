/**
 * Move the Feather Game
 * Blow to push a feather across the screen
 */

import BlowMeter from '@/components/game/BlowMeter';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
import { logGameAndAward } from '@/utils/api';
import { BlowDetector } from '@/utils/blowDetection';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
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
import Svg, { Path } from 'react-native-svg';

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
  distanceTraveled: number; // Percentage
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 30000; // 30 seconds per round
let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    stopTTS();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('speak error', e);
  }
}

export function MoveTheFeatherGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const isMobile = screenWidth < 600;
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : true);

  const {
    isOpen,
    ratio,
    isDetecting,
    hasCamera,
    error: jawError,
  } = jawDetection;

  // Web-only properties (type assertion needed)
  const protrusion = (jawDetection as any).protrusion as number | undefined;
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const previewRef = useRef<View>(null);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [featherX, setFeatherX] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    averageDistance: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const blowDetector = useRef(new BlowDetector(800, 0.4));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const featherXAnim = useRef(new Animated.Value(0)).current;
  const featherRotation = useRef(new Animated.Value(0)).current;

  // Update feather position based on blow
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting) return;

    const protrusionValue = (protrusion as number) || 0;
    const blowState = blowDetector.current.update(isOpen || false, protrusionValue, ratio || 0);

    if (blowState.isSustained) {
      // Move feather right based on blow intensity
      const moveSpeed = blowState.intensity * 8; // pixels per frame
      setFeatherX(prev => {
        const newX = Math.min(screenWidth - 100, prev + moveSpeed);
        if (newX >= screenWidth - 100) {
          // Reached end
          endRound();
        }
        return newX;
      });
    }
  }, [isOpen, protrusion, ratio, isDetecting, gameState, screenWidth]);

  // Animate feather position
  useEffect(() => {
    Animated.timing(featherXAnim, {
      toValue: featherX,
      duration: 100,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [featherX]);

  // Animate feather rotation (floating effect)
  useEffect(() => {
    if (gameState === 'playing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(featherRotation, {
            toValue: 1,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(featherRotation, {
            toValue: -1,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [gameState]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    blowDetector.current.reset();
    setFeatherX(0);
    setTimeElapsed(0);
    featherXAnim.setValue(0);

    if (currentRound === 1) {
      speak(
        'Welcome to Move the Feather! Blow into your device to push the feather across the screen. ' +
        'Reach the finish line to complete each round! Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound]);

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
        speak(prev - 1 === 0 ? 'Go! Blow the feather!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setFeatherX(0);
    setTimeElapsed(0);
    featherXAnim.setValue(0);
    blowDetector.current.reset();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      // Timeout after 30 seconds
      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, []);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const distancePercent = (featherX / (screenWidth - 100)) * 100;
    let stars = 0;

    if (distancePercent >= 100 && timeElapsed < 15) {
      stars = 3;
    } else if (distancePercent >= 100 && timeElapsed < 30) {
      stars = 2;
    } else if (distancePercent >= 60) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      distanceTraveled: distancePercent,
      timeElapsed,
    };

    setRoundResults(prev => [...prev, result]);
    setTotalStars(prev => prev + stars);

    // Show success animation instead of TTS
    setShowRoundSuccess(true);
    setGameState('roundComplete');

    // Wait for animation to complete before moving to next round
    setTimeout(() => {
      setShowRoundSuccess(false);
      if (currentRound < requiredRounds) {
        setCurrentRound(prev => prev + 1);
        // Add a small delay before starting calibration to prevent immediate auto-start
        setTimeout(() => {
          startCalibration();
        }, 500);
      } else {
        finishGame();
      }
    }, 2500);
  }, [currentRound, featherX, screenWidth, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const averageDistance = roundResults.reduce((sum, r) => sum + r.distanceTraveled, 0) / roundResults.length;
    const accuracy = Math.round(averageDistance);

    const stats = {
      totalRounds: requiredRounds,
      averageDistance,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);
    setShowCongratulations(true);

    speak(`Amazing! You completed all ${requiredRounds} rounds with ${totalStars} total stars!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'move-the-feather',
        correct: totalStars,
        total: requiredRounds * 3,
        accuracy,
        xpAwarded,
        skillTags: ['airflow', 'oral-motor', 'breath-control', 'coordination'],
        meta: {
          totalRounds: requiredRounds,
          averageDistance,
          totalStars,
          roundResults,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [roundResults, totalStars, onComplete, requiredRounds]);

  // Check for face detection to start countdown
  // Use a ref to track if we've already triggered countdown for this calibration phase
  const calibrationStartedRef = useRef(false);
  
  useEffect(() => {
    if (gameState === 'calibration') {
      // Reset the flag when entering calibration
      calibrationStartedRef.current = false;
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState === 'calibration' && isDetecting && hasCamera && !calibrationStartedRef.current) {
      calibrationStartedRef.current = true;
      // Add a longer delay (2 seconds) to give user time to see the calibration screen
      const timeoutId = setTimeout(() => {
        // Use a ref check to ensure we're still in calibration state
        // This prevents starting countdown if state changed during the delay
        if (calibrationStartedRef.current) {
          startCountdown();
        }
      }, 2000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [gameState, isDetecting, hasCamera, startCountdown]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      clearScheduledSpeech();
    };
  }, []);

  // Initialize
  useEffect(() => {
    startCalibration();
  }, [startCalibration]);

  // Ensure container has data-native-id attribute for hook to find it (web only)
  useEffect(() => {
    if (Platform.OS !== 'web' || !previewContainerId) return;
    
    const setAttribute = () => {
      try {
        // Try to find container by nativeID first
        let element = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
        
        // If not found, try data-native-id
        if (!element) {
          element = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
        }
        
        // If still not found, try via ref
        if (!element && previewRef.current) {
          try {
            const refElement = (previewRef.current as any)?.current || 
                              (previewRef.current as any)?.base || 
                              previewRef.current;
            if (refElement && refElement.nodeType === 1) {
              element = refElement;
            }
          } catch (e) {
            // Ignore
          }
        }
        
        // Set data-native-id attribute if element found and doesn't have it
        if (element && !element.getAttribute('data-native-id')) {
          element.setAttribute('data-native-id', previewContainerId);
        }
      } catch (e) {
        // Silently fail - hook will try other methods
      }
    };
    
    // Try immediately and with delays to catch element when mounted
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
      // Find our full-screen container
      let container = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
      
      // Also try by nativeID attribute
      if (!container) {
        container = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
      }
      
      // Also try to find it via the ref
      if (!container && previewRef.current) {
        try {
          const refElement = (previewRef.current as any)?.current || 
                            (previewRef.current as any)?.base || 
                            previewRef.current;
          if (refElement && refElement.nodeType === 1) {
            container = refElement;
          }
        } catch (e) {
          // Ignore
        }
      }

      if (!container) return;

      // Validate container is full-screen (must be >70% of screen size)
      const rect = container.getBoundingClientRect();
      const isFullScreen = rect.width > window.innerWidth * 0.7 && 
                           rect.height > window.innerHeight * 0.7;
      
      if (!isFullScreen) {
        // Not the right container, keep looking
        return;
      }

      // Find all video elements with the preview attribute
      const allVideos = document.querySelectorAll('video[data-jaw-preview-video]');
      
      let videoInContainer: HTMLVideoElement | null = null;
      const videosToRemove: HTMLVideoElement[] = [];
      
      allVideos.forEach((video) => {
        const videoElement = video as HTMLVideoElement;
        if (container.contains(videoElement)) {
          videoInContainer = videoElement;
        } else {
          // Video is in wrong container - mark for removal
          videosToRemove.push(videoElement);
        }
      });

      // If no video in our container, move the first one we find
      if (!videoInContainer && allVideos.length > 0) {
        const videoToMove = allVideos[0] as HTMLVideoElement;
        // Remove from current parent (check if it's actually a child first)
        if (videoToMove.parentElement && videoToMove.parentElement.contains(videoToMove)) {
          videoToMove.parentElement.removeChild(videoToMove);
        }
        // Add to our container
        container.appendChild(videoToMove);
        videoInContainer = videoToMove;
      }

      // Remove duplicate videos (check if they're actually children first)
      videosToRemove.forEach(video => {
        if (video.parentElement && video.parentElement.contains(video)) {
          video.parentElement.removeChild(video);
        }
      });

      // Ensure video in our container is properly styled
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

      // Ensure container is full screen and visible
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

    // Run immediately and periodically (increased frequency to 200ms)
    moveVideoToContainer();
    const interval = setInterval(moveVideoToContainer, 200);

    return () => clearInterval(interval);
  }, [previewContainerId, hasCamera, previewRef]);

  const blowState = blowDetector.current.update(
    isOpen || false,
    (protrusion as number) || 0,
    ratio || 0
  );

  // Show congratulations screen with stats
  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Fantastic Flying!"
        showButtons={true}
        correct={finalStats.totalStars}
        total={requiredRounds * 3}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.totalStars * 50}
        onContinue={() => {
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  // Feather SVG path
  const featherPath = "M 20 10 L 15 30 L 25 35 L 30 50 L 35 35 L 45 30 L 40 10 L 30 5 Z";

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
          <View style={styles.headerInfo}>
            <Text style={styles.roundText}>Round {currentRound} of {requiredRounds}</Text>
            <View style={styles.starsContainer}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={20}
                  color={i < Math.floor(totalStars / currentRound) ? '#FFD700' : '#FFF'}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Blow Meter */}
        {gameState === 'playing' && (
          <View style={styles.meterContainer}>
            <BlowMeter intensity={blowState.intensity} isBlowing={blowState.isBlowing} />
          </View>
        )}

        {/* Calibration */}
        {gameState === 'calibration' && (
          <View style={styles.calibrationContainer}>
            <View style={styles.calibrationBox}>
              <Ionicons name="camera" size={48} color="#FFF" />
              <Text style={styles.calibrationText}>
                {isDetecting ? 'Face detected! Starting soon...' : 'Show your face to the camera'}
              </Text>
            </View>
          </View>
        )}

        {/* Countdown */}
        {gameState === 'countdown' && (
          <View style={styles.countdownContainer}>
            <Animated.Text
              style={[
                styles.countdownText,
                {
                  transform: [{ scale: countdown > 0 ? 1.5 : 1 }],
                },
              ]}
            >
              {countdown > 0 ? countdown : 'GO!'}
            </Animated.Text>
          </View>
        )}

        {/* Game */}
        {gameState === 'playing' && (
          <View style={styles.gameContainer}>
            {/* Start Line */}
            <View style={[styles.line, { left: 20 }]}>
              <Text style={styles.lineText}>START</Text>
            </View>

            {/* Finish Line */}
            <View style={[styles.line, { right: 20 }]}>
              <Text style={styles.lineText}>FINISH</Text>
            </View>

            {/* Feather */}
            <Animated.View
              style={[
                styles.featherContainer,
                {
                  left: featherXAnim,
                  transform: [
                    {
                      rotate: featherRotation.interpolate({
                        inputRange: [-1, 1],
                        outputRange: ['-15deg', '15deg'],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Svg width={60} height={60} viewBox="0 0 60 60">
                <Path
                  d={featherPath}
                  fill="#F5F5DC"
                  stroke="#D4AF37"
                  strokeWidth="1"
                />
              </Svg>
            </Animated.View>

            <Text style={styles.instructionText}>
              Blow to push the feather to the finish line!
            </Text>
            <Text style={styles.progressText}>
              {Math.round((featherX / (screenWidth - 100)) * 100)}% Complete
            </Text>
          </View>
        )}

        {/* Round Success Animation */}
        <RoundSuccessAnimation
          visible={showRoundSuccess}
          stars={roundResults[roundResults.length - 1]?.stars}
        />

        {/* Round Complete - Keep for UI state but animation is shown above */}
        {gameState === 'roundComplete' && !showRoundSuccess && (
          <View style={styles.roundCompleteContainer}>
            <Text style={styles.roundCompleteText}>
              Round {currentRound} Complete!
            </Text>
            <View style={styles.starsDisplay}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={40}
                  color={i < roundResults[roundResults.length - 1]?.stars ? '#FFD700' : '#CCC'}
                />
              ))}
            </View>
          </View>
        )}

        {/* Error */}
        {jawError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{jawError}</Text>
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
    padding: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 8,
  },
  backButton: {
    padding: 8,
  },
  headerInfo: {
    flex: 1,
    alignItems: 'center',
  },
  roundText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  meterContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  calibrationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calibrationBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 32,
    borderRadius: 20,
    alignItems: 'center',
  },
  calibrationText: {
    fontSize: 18,
    color: '#FFF',
    marginTop: 16,
    textAlign: 'center',
  },
  countdownContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 120,
    fontWeight: '900',
    color: '#FFF',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
  gameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  line: {
    position: 'absolute',
    top: '40%',
    width: 4,
    height: 100,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lineText: {
    position: 'absolute',
    top: -30,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  featherContainer: {
    position: 'absolute',
    top: '40%',
    width: 60,
    height: 60,
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginTop: 32,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  progressText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
    marginTop: 16,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  roundCompleteContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roundCompleteText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 24,
  },
  starsDisplay: {
    flexDirection: 'row',
    gap: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    color: '#FFF',
    textAlign: 'center',
  },
});

