/**
 * Copy the Beat Game
 * Complex rhythm: open-open-close, open-close-close (child follows pattern and timing, 3-4 cycles per round)
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

type BeatAction = 'open' | 'closed';

interface Beat {
  action: BeatAction;
  timing: number; // milliseconds from start
}

interface RoundResult {
  round: number;
  stars: number;
  correctCycles: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const BEAT_INTERVAL_MS = 600; // 600ms between beats
const TIMING_TOLERANCE_MS = 400; // ±400ms tolerance
const STABILITY_MS = 300;
const DEFAULT_TTS_RATE = 0.75;

// Rhythm patterns
const RHYTHMS: Beat[][] = [
  [{ action: 'open', timing: 0 }, { action: 'open', timing: 600 }, { action: 'closed', timing: 1200 }],
  [{ action: 'open', timing: 0 }, { action: 'closed', timing: 600 }, { action: 'closed', timing: 1200 }],
  [{ action: 'closed', timing: 0 }, { action: 'open', timing: 600 }, { action: 'open', timing: 1200 }, { action: 'closed', timing: 1800 }],
  [{ action: 'open', timing: 0 }, { action: 'open', timing: 600 }, { action: 'open', timing: 1200 }, { action: 'closed', timing: 1800 }],
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

export function CopyTheBeatGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
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
  const [currentRhythm, setCurrentRhythm] = useState<Beat[]>([]);
  const [currentBeatIndex, setCurrentBeatIndex] = useState(0);
  const [childBeatIndex, setChildBeatIndex] = useState(0);
  const [correctCycles, setCorrectCycles] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalCorrectCycles: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rhythmTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatScale = useRef(new Animated.Value(1)).current;
  const stableJawStateRef = useRef<{ state: boolean; since: number } | null>(null);
  const cycleStartTimeRef = useRef<number | null>(null);
  const lastCycleTimeRef = useRef(0);
  const cycleCooldown = 2000; // 2 seconds between cycles

  // Start rhythm cycle
  const startRhythmCycle = useCallback(() => {
    if (currentRhythm.length === 0) return;
    
    setCurrentBeatIndex(0);
    setChildBeatIndex(0);
    cycleStartTimeRef.current = Date.now();
    
    // Play rhythm beats
    currentRhythm.forEach((beat, index) => {
      setTimeout(() => {
        setCurrentBeatIndex(index);
        
        // Animate beat indicator
        Animated.sequence([
          Animated.timing(beatScale, {
            toValue: 1.3,
            duration: 150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(beatScale, {
            toValue: 1,
            duration: 150,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start();
        
        speak(beat.action === 'open' ? 'Open' : 'Close');
      }, beat.timing);
    });
  }, [currentRhythm, beatScale]);

  // Update jaw detection and check beat matching
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting || !cycleStartTimeRef.current || currentRhythm.length === 0) return;

    const now = Date.now();
    const cycleTime = now - cycleStartTimeRef.current;
    const expectedBeat = currentRhythm[childBeatIndex];
    
    if (!expectedBeat) {
      // Cycle complete - check if all beats matched
      if (childBeatIndex >= currentRhythm.length) {
        if (now - lastCycleTimeRef.current > cycleCooldown) {
          lastCycleTimeRef.current = now;
          setCorrectCycles(prev => prev + 1);
          
          try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          } catch {}
          speak('Great rhythm!');
          
          // Start next cycle
          setTimeout(() => {
            startRhythmCycle();
          }, 1000);
        }
      }
      return;
    }

    // Check if we're at the right time for this beat
    const timeDiff = Math.abs(cycleTime - expectedBeat.timing);
    
    if (timeDiff <= TIMING_TOLERANCE_MS) {
      // Stability check
      if (stableJawStateRef.current?.state === isOpen) {
        if (now - stableJawStateRef.current.since >= STABILITY_MS) {
          const expectedState = expectedBeat.action === 'open';
          
          if (isOpen === expectedState) {
            // Correct beat - move to next
            setChildBeatIndex(prev => prev + 1);
          }
        }
      } else {
        stableJawStateRef.current = { state: isOpen, since: now };
      }
    }
  }, [isOpen, isDetecting, gameState, currentRhythm, childBeatIndex, startRhythmCycle]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    setCurrentRhythm([]);
    setCurrentBeatIndex(0);
    setChildBeatIndex(0);
    setCorrectCycles(0);
    setTimeElapsed(0);
    cycleStartTimeRef.current = null;
    lastCycleTimeRef.current = 0;
    stableJawStateRef.current = null;
    beatScale.setValue(1);

    if (currentRound === 1) {
      speak(
        'Welcome to Copy the Beat! Follow the rhythm pattern with your jaw. ' +
        'Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, beatScale]);

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
        speak(prev - 1 === 0 ? 'Go! Follow the beat!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    const rhythmIndex = (currentRound - 1) % RHYTHMS.length;
    const rhythm = RHYTHMS[rhythmIndex];
    setCurrentRhythm(rhythm);
    setCurrentBeatIndex(0);
    setChildBeatIndex(0);
    setCorrectCycles(0);
    setTimeElapsed(0);
    cycleStartTimeRef.current = null;
    lastCycleTimeRef.current = 0;
    stableJawStateRef.current = null;
    beatScale.setValue(1);
    
    // Start first cycle
    setTimeout(() => {
      startRhythmCycle();
    }, 500);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [currentRound, beatScale, startRhythmCycle]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    let stars = 0;
    if (correctCycles >= 4) {
      stars = 3;
    } else if (correctCycles >= 3) {
      stars = 2;
    } else if (correctCycles >= 2) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      correctCycles,
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
  }, [currentRound, correctCycles, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalCorrectCycles = roundResults.reduce((sum, r) => sum + r.correctCycles, 0);
    const accuracy = Math.round((totalCorrectCycles / (requiredRounds * 3)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalCorrectCycles,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You followed ${totalCorrectCycles} rhythm cycles!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'copy-the-beat',
        correct: totalCorrectCycles,
        total: requiredRounds * 3,
        accuracy,
        xpAwarded,
        skillTags: ['oral-sequences', 'rhythm', 'timing', 'motor-sequencing'],
        meta: {
          totalRounds: requiredRounds,
          totalCorrectCycles,
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
      if (rhythmTimerRef.current) clearInterval(rhythmTimerRef.current);
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
        correct={finalStats.totalCorrectCycles}
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

  const currentBeat = currentRhythm[currentBeatIndex];

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
              ? 'Great! Now get ready to follow the beat!'
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
          {/* Beat indicator */}
          <Animated.View
            style={[
              styles.beatContainer,
              {
                top: screenHeight * 0.3,
                left: screenWidth / 2 - 100,
                transform: [{ scale: beatScale }],
              },
            ]}
          >
            <Text style={styles.beatEmoji}>
              {currentBeat?.action === 'open' ? '😮' : '😐'}
            </Text>
            <Text style={styles.beatText}>
              {currentBeat?.action === 'open' ? 'OPEN' : 'CLOSE'}
            </Text>
          </Animated.View>

          {/* Rhythm pattern display */}
          <View style={styles.rhythmContainer}>
            {currentRhythm.map((beat, index) => (
              <View
                key={index}
                style={[
                  styles.rhythmBeat,
                  {
                    backgroundColor: index === currentBeatIndex
                      ? '#FFD700'
                      : index < childBeatIndex
                      ? '#4CAF50'
                      : '#666',
                  },
                ]}
              >
                <Text style={styles.rhythmBeatText}>
                  {beat.action === 'open' ? 'O' : 'C'}
                </Text>
              </View>
            ))}
          </View>

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>Cycles: {correctCycles}</Text>
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
  beatContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  beatEmoji: {
    fontSize: 100,
  },
  beatText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 10,
  },
  rhythmContainer: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 15,
    zIndex: 6,
  },
  rhythmBeat: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  rhythmBeatText: {
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

