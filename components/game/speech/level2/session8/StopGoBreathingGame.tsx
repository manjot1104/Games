/**
 * Stop-Go Breathing Game
 * Cue-based: Game shows "BLOW" or "STOP" cues, child follows (5-6 cycles per round)
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

type CueType = 'BLOW' | 'STOP';

interface RoundResult {
  round: number;
  stars: number;
  correctResponses: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const CUE_DURATION_MS = 3000; // Cue changes every 2-3 seconds
const STOP_DETECTION_WINDOW_MS = 500; // Must stop blowing within 500ms of STOP cue
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

export function StopGoBreathingGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const [currentCue, setCurrentCue] = useState<CueType>('BLOW');
  const [correctResponses, setCorrectResponses] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalCorrectResponses: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cueTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cueScale = useRef(new Animated.Value(1)).current;
  const followIndicator = useRef(new Animated.Value(0)).current;
  const blowDetector = useRef(new BlowDetector(800, 0.4)).current;
  const cueStartTimeRef = useRef<number | null>(null);
  const lastResponseTimeRef = useRef(0);
  const responseCooldown = 1000; // 1 second between responses

  // Change cue periodically
  useEffect(() => {
    if (gameState !== 'playing') return;

    let cueIndex = 0;
    const cues: CueType[] = ['BLOW', 'STOP', 'BLOW', 'STOP', 'BLOW', 'STOP', 'BLOW'];

    cueTimerRef.current = setInterval(() => {
      cueIndex = (cueIndex + 1) % cues.length;
      const newCue = cues[cueIndex];
      setCurrentCue(newCue);
      cueStartTimeRef.current = Date.now();
      
      // Animate cue change
      Animated.sequence([
        Animated.timing(cueScale, {
          toValue: 1.2,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cueScale, {
          toValue: 1,
          duration: 200,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
      
      speak(newCue === 'BLOW' ? 'Blow!' : 'Stop!');
    }, CUE_DURATION_MS);

    // Set initial cue
    setCurrentCue(cues[0]);
    cueStartTimeRef.current = Date.now();
    speak('Blow!');

    return () => {
      if (cueTimerRef.current) {
        clearInterval(cueTimerRef.current);
        cueTimerRef.current = null;
      }
    };
  }, [gameState, cueScale]);

  // Update blow detection and check if following cues
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting || !cueStartTimeRef.current) return;

    const blowState = blowDetector.current.update(
      isOpen || false,
      (protrusion as number) || 0,
      ratio || 0
    );

    const now = Date.now();
    const timeSinceCue = now - cueStartTimeRef.current;

    if (currentCue === 'BLOW') {
      // Should be blowing
      if (blowState.isSustained && timeSinceCue < CUE_DURATION_MS) {
        // Correctly following BLOW cue
        if (!isFollowing) {
          setIsFollowing(true);
          Animated.timing(followIndicator, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start();
        }
      } else {
        setIsFollowing(false);
        Animated.timing(followIndicator, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }).start();
      }
    } else if (currentCue === 'STOP') {
      // Should NOT be blowing
      const hasStopped = !blowState.isSustained || (blowState.duration < 200);
      
      if (hasStopped && timeSinceCue < STOP_DETECTION_WINDOW_MS) {
        // Correctly following STOP cue
        if (!isFollowing) {
          setIsFollowing(true);
          Animated.timing(followIndicator, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start();
        }
      } else {
        setIsFollowing(false);
        Animated.timing(followIndicator, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }).start();
      }
    }

    // Check for correct response
    if (isFollowing && now - lastResponseTimeRef.current > responseCooldown) {
      // Hold correct response for 500ms to count
      setTimeout(() => {
        if (isFollowing && now - lastResponseTimeRef.current > responseCooldown) {
          lastResponseTimeRef.current = now;
          setCorrectResponses(prev => prev + 1);
          
          try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          } catch {}
          speak('Good!');
        }
      }, 500);
    }
  }, [isOpen, ratio, protrusion, isDetecting, gameState, currentCue, isFollowing, followIndicator]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentCue('BLOW');
    setCorrectResponses(0);
    setTimeElapsed(0);
    setIsFollowing(false);
    cueStartTimeRef.current = null;
    lastResponseTimeRef.current = 0;
    blowDetector.current.reset();
    cueScale.setValue(1);
    followIndicator.setValue(0);

    if (currentRound === 1) {
      speak(
        'Welcome to Stop-Go Breathing! Follow the cues - blow when you see "BLOW", stop when you see "STOP". ' +
        'Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, cueScale, followIndicator, blowDetector]);

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
        speak(prev - 1 === 0 ? 'Go! Follow the cues!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setCurrentCue('BLOW');
    setCorrectResponses(0);
    setTimeElapsed(0);
    setIsFollowing(false);
    cueStartTimeRef.current = Date.now();
    lastResponseTimeRef.current = 0;
    blowDetector.current.reset();
    cueScale.setValue(1);
    followIndicator.setValue(0);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [cueScale, followIndicator, blowDetector]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (cueTimerRef.current) {
      clearInterval(cueTimerRef.current);
      cueTimerRef.current = null;
    }

    let stars = 0;
    if (correctResponses >= 6) {
      stars = 3;
    } else if (correctResponses >= 4) {
      stars = 2;
    } else if (correctResponses >= 2) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      correctResponses,
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
  }, [currentRound, correctResponses, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalCorrectResponses = roundResults.reduce((sum, r) => sum + r.correctResponses, 0);
    const accuracy = Math.round((totalCorrectResponses / (requiredRounds * 6)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalCorrectResponses,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You followed ${totalCorrectResponses} cues correctly!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'stop-go-breathing',
        correct: totalCorrectResponses,
        total: requiredRounds * 6,
        accuracy,
        xpAwarded,
        skillTags: ['breath-control', 'stop-go-breathing', 'cue-following', 'oral-motor'],
        meta: {
          totalRounds: requiredRounds,
          totalCorrectResponses,
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
      if (cueTimerRef.current) clearInterval(cueTimerRef.current);
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
        correct={finalStats.totalCorrectResponses}
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
              ? 'Great! Now get ready to follow cues!'
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
          {/* Cue indicator */}
          <Animated.View
            style={[
              styles.cueContainer,
              {
                top: screenHeight * 0.25,
                left: screenWidth / 2 - 150,
                transform: [{ scale: cueScale }],
              },
            ]}
          >
            <Text style={[
              styles.cueText,
              { color: currentCue === 'BLOW' ? '#4CAF50' : '#FF5722' },
            ]}>
              {currentCue}
            </Text>
          </Animated.View>

          {/* Follow indicator */}
          <Animated.View
            style={[
              styles.followIndicator,
              {
                top: screenHeight * 0.5,
                left: screenWidth / 2 - 100,
                opacity: followIndicator,
                transform: [{ scale: followIndicator }],
              },
            ]}
          >
            <Text style={styles.followText}>✓ Following!</Text>
          </Animated.View>

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>Correct: {correctResponses}</Text>
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
  cueContainer: {
    position: 'absolute',
    width: 300,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  cueText: {
    fontSize: 72,
    fontWeight: 'bold',
  },
  followIndicator: {
    position: 'absolute',
    width: 200,
    padding: 15,
    backgroundColor: '#4CAF50',
    borderRadius: 20,
    alignItems: 'center',
    zIndex: 6,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
  },
  followText: {
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

