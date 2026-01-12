import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

const TARGET_SIZE = 160;
const DEFAULT_TTS_RATE = 0.75;
const GLOW_DURATION_MS = 2000;
const SOUND_INTERVAL_MS = 1500;
const TAP_TIMEOUT_MS = 8000;

let scheduledSpeechTimers: ReturnType<typeof setTimeout>[] = [];

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

const TARGETS = [
  { emoji: '⭐', name: 'star', color: ['#FCD34D', '#FBBF24'] },
  { emoji: '⚽', name: 'ball', color: ['#3B82F6', '#2563EB'] },
  { emoji: '🎈', name: 'balloon', color: ['#EC4899', '#DB2777'] },
  { emoji: '🍎', name: 'apple', color: ['#EF4444', '#DC2626'] },
];

const DISTRACTION_SOUNDS = ['bell', 'drum', 'clap', 'beep'] as const;

export const SoundDistractionChallengeGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredRounds = 6,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [rounds, setRounds] = useState(0);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    correctTaps: number;
    earlyTaps: number;
    missedTaps: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [target, setTarget] = useState<typeof TARGETS[0] | null>(null);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGlowing, setIsGlowing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [earlyTaps, setEarlyTaps] = useState(0);
  const [missedTaps, setMissedTaps] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const targetScale = useRef(new Animated.Value(0)).current;
  const targetOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const soundWaveScale = useRef(new Animated.Value(0.5)).current;
  const soundWaveOpacity = useRef(new Animated.Value(0)).current;
  const soundWave2Scale = useRef(new Animated.Value(0.5)).current;
  const soundWave2Opacity = useRef(new Animated.Value(0)).current;
  const soundWave3Scale = useRef(new Animated.Value(0.5)).current;
  const soundWave3Opacity = useRef(new Animated.Value(0)).current;
  const celebrationScale = useRef(new Animated.Value(1)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  const warningScale = useRef(new Animated.Value(1)).current;
  const warningOpacity = useRef(new Animated.Value(0)).current;
  const waitIndicatorOpacity = useRef(new Animated.Value(1)).current;
  
  // Track warningOpacity value to avoid _value access
  const warningOpacityCurrentRef = useRef(0);
  
  useEffect(() => {
    const listener = warningOpacity.addListener(({ value }) => {
      warningOpacityCurrentRef.current = value;
    });
    return () => {
      warningOpacity.removeListener(listener);
    };
  }, [warningOpacity]);
  
  // Timeouts
  const soundIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const glowTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const glowAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);

  const finishGame = useCallback(async () => {
    if (soundIntervalRef.current) {
      clearInterval(soundIntervalRef.current);
      soundIntervalRef.current = null;
    }
    if (glowTimeoutRef.current) {
      clearTimeout(glowTimeoutRef.current);
      glowTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (glowAnimationRef.current) {
      glowAnimationRef.current.stop();
      glowAnimationRef.current = null;
    }
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + earlyTaps + missedTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 38;

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      earlyTaps,
      missedTaps,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'sound-distraction-challenge',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['auditory-filtering', 'sensory-load', 'focus-under-distraction', 'speech-therapy-readiness'],
        incorrectAttempts: earlyTaps + missedTaps,
        meta: {
          correctTaps,
          earlyTaps,
          missedTaps,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [correctTaps, earlyTaps, missedTaps, requiredRounds, onComplete]);

  const advanceToNextRound = useCallback((nextRound: number) => {
    if (nextRound >= requiredRounds) {
      return;
    }
    setTimeout(() => {
      startRoundRef.current?.();
    }, 1200);
  }, [requiredRounds]);

  const startRound = useCallback(() => {
    // Clear timeouts and animations
    if (soundIntervalRef.current) {
      clearInterval(soundIntervalRef.current);
      soundIntervalRef.current = null;
    }
    if (glowTimeoutRef.current) {
      clearTimeout(glowTimeoutRef.current);
      glowTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (glowAnimationRef.current) {
      glowAnimationRef.current.stop();
      glowAnimationRef.current = null;
    }

    if (rounds >= requiredRounds) {
      return;
    }

    // Reset state
    setIsProcessing(false);
    setCanTap(false);
    setIsGlowing(false);
    
    // Select random target
    const randomTarget = TARGETS[Math.floor(Math.random() * TARGETS.length)];
    setTarget(randomTarget);

    // Reset animations
    targetScale.setValue(0);
    targetOpacity.setValue(0);
    glowScale.setValue(1);
    glowOpacity.setValue(0);
    soundWaveScale.setValue(0.5);
    soundWaveOpacity.setValue(0);
    soundWave2Scale.setValue(0.5);
    soundWave2Opacity.setValue(0);
    soundWave3Scale.setValue(0.5);
    soundWave3Opacity.setValue(0);
    celebrationScale.setValue(1);
    celebrationOpacity.setValue(0);
    warningScale.setValue(1);
    warningOpacity.setValue(0);
    waitIndicatorOpacity.setValue(1);

    // Show target
    Animated.parallel([
      Animated.spring(targetScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(targetOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    speak('Wait for the glow...');

    // Animate wait indicator
    Animated.loop(
      Animated.sequence([
        Animated.timing(waitIndicatorOpacity, {
          toValue: 0.3,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(waitIndicatorOpacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Play distraction sounds at intervals
    let soundCount = 0;
    soundIntervalRef.current = (setInterval(() => {
      const randomSound = DISTRACTION_SOUNDS[Math.floor(Math.random() * DISTRACTION_SOUNDS.length)];
      
      // Multiple concentric sound waves for better visual effect
      const waveAnimations = [
        { scale: soundWaveScale, opacity: soundWaveOpacity, delay: 0 },
        { scale: soundWave2Scale, opacity: soundWave2Opacity, delay: 100 },
        { scale: soundWave3Scale, opacity: soundWave3Opacity, delay: 200 },
      ];

      waveAnimations.forEach((wave, idx) => {
        setTimeout(() => {
          Animated.parallel([
            Animated.timing(wave.opacity, {
              toValue: 0.5,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(wave.scale, {
              toValue: 2.0,
              duration: 800,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]).start();

          // Fade out
          setTimeout(() => {
            Animated.parallel([
              Animated.timing(wave.opacity, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
              }),
              Animated.timing(wave.scale, {
                toValue: 0.5,
                duration: 300,
                useNativeDriver: true,
              }),
            ]).start();
          }, 1000);
        }, wave.delay);
      });

      // Play sound
      playSound(randomSound, 0.7, 1.0).catch(() => {
        // Fallback to TTS
        speak(randomSound);
      });

      soundCount++;
      if (soundCount >= 3) {
        if (soundIntervalRef.current) {
          clearInterval(soundIntervalRef.current);
          soundIntervalRef.current = null;
        }
        // Hide wait indicator
        Animated.timing(waitIndicatorOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }
    }, SOUND_INTERVAL_MS)) as unknown as NodeJS.Timeout;

    // Make target glow after delay
    glowTimeoutRef.current = (setTimeout(() => {
      setIsGlowing(true);
      setCanTap(true);
      
      // Glow animation
      glowAnimationRef.current = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(glowScale, {
              toValue: 1.3,
              duration: GLOW_DURATION_MS / 2,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(glowOpacity, {
              toValue: 0.7,
              duration: GLOW_DURATION_MS / 2,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(glowScale, {
              toValue: 1,
              duration: GLOW_DURATION_MS / 2,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(glowOpacity, {
              toValue: 0,
              duration: GLOW_DURATION_MS / 2,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
      glowAnimationRef.current.start();

      speak('Tap now!');

      // Timeout for missed tap
      tapTimeoutRef.current = (setTimeout(() => {
        setMissedTaps(prev => prev + 1);
        speak('Try again!');
        
        // Hide and advance
        Animated.parallel([
          Animated.timing(targetOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(targetScale, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
        
        setTimeout(() => {
          setRounds(prev => {
            const nextRound = prev + 1;
            advanceToNextRoundRef.current?.(nextRound);
            return nextRound;
          });
        }, 400);
        
        tapTimeoutRef.current = null;
      }, TAP_TIMEOUT_MS)) as unknown as NodeJS.Timeout;
    }, 5000)) as unknown as NodeJS.Timeout;
  }, [rounds, requiredRounds]);

  const handleTargetTap = useCallback(() => {
    if (isProcessing) return;

    setIsProcessing(true);

    // Clear timeouts
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (glowAnimationRef.current) {
      glowAnimationRef.current.stop();
      glowAnimationRef.current = null;
    }

    if (isGlowing && canTap) {
      // Correct tap
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Celebration animation
      Animated.parallel([
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 1.4,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(targetScale, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.spring(celebrationScale, {
            toValue: 1.2,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(celebrationOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);

      // Hide and advance
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(targetOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(celebrationOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
        
        setTimeout(() => {
          setRounds(prev => {
            const nextRound = prev + 1;
            advanceToNextRoundRef.current?.(nextRound);
            return nextRound;
          });
        }, 400);
      }, 1500);
    } else {
      // Early tap
      setEarlyTaps(prev => prev + 1);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      // Warning animation
      Animated.parallel([
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 0.9,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(targetScale, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.spring(warningScale, {
            toValue: 1.1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(warningOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      speak('Wait for the glow!');

      // Hide warning
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(warningOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(warningScale, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      }, 2000);

      setIsProcessing(false);
    }
  }, [isProcessing, isGlowing, canTap, targetScale]);

  useLayoutEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  useLayoutEffect(() => {
    advanceToNextRoundRef.current = advanceToNextRound;
  }, [advanceToNextRound]);

  useEffect(() => {
    if (rounds >= requiredRounds && !gameFinished) {
      finishGame();
    }
  }, [rounds, requiredRounds, gameFinished, finishGame]);

  useEffect(() => {
    try {
      speak('Tap the target, ignore the distracting sounds!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
      }
      if (glowTimeoutRef.current) {
        clearTimeout(glowTimeoutRef.current);
      }
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
      if (glowAnimationRef.current) {
        glowAnimationRef.current.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.correctTaps}
        total={finalStats.totalRounds}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.xpAwarded}
        onContinue={() => {
          clearScheduledSpeech();
          stopAllSpeech();
          cleanupSounds();
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  if (!target) return null;

  const glowScaleValue = Animated.multiply(glowScale, targetScale);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#EFF6FF', '#DBEAFE']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              onBack();
            }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Sound Distraction Challenge</Text>
            <Text style={styles.subtitle}>
              {isGlowing ? 'Tap when it glows!' : 'Wait for the glow...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Wait Indicator */}
          <Animated.View
            style={[
              styles.waitIndicator,
              {
                opacity: waitIndicatorOpacity,
              },
            ]}
          >
            <LinearGradient
              colors={['#F59E0B', '#D97706']}
              style={styles.waitIndicatorGradient}
            >
              <Ionicons name="hourglass-outline" size={28} color="#FFFFFF" />
              <Text style={styles.waitIndicatorText}>Wait for glow...</Text>
            </LinearGradient>
          </Animated.View>

          {/* Sound Wave Animations */}
          <Animated.View
            style={[
              styles.soundWave,
              {
                transform: [{ scale: soundWaveScale }],
                opacity: soundWaveOpacity,
              },
            ]}
          >
            <View style={styles.soundWaveInner} />
          </Animated.View>
          <Animated.View
            style={[
              styles.soundWave,
              {
                transform: [{ scale: soundWave2Scale }],
                opacity: soundWave2Opacity,
              },
            ]}
          >
            <View style={styles.soundWaveInner} />
          </Animated.View>
          <Animated.View
            style={[
              styles.soundWave,
              {
                transform: [{ scale: soundWave3Scale }],
                opacity: soundWave3Opacity,
              },
            ]}
          >
            <View style={styles.soundWaveInner} />
          </Animated.View>

          {/* Warning Message */}
          {warningOpacityCurrentRef.current > 0 && (
            <Animated.View
              style={[
                styles.warningBanner,
                {
                  transform: [{ scale: warningScale }],
                  opacity: warningOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={['#F59E0B', '#D97706']}
                style={styles.warningGradient}
              >
                <Ionicons name="time" size={24} color="#FFFFFF" />
                <Text style={styles.warningText}>Wait for the glow!</Text>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Target */}
          <Pressable
            onPress={handleTargetTap}
            disabled={isProcessing}
            style={[
              styles.targetContainer,
              {
                left: SCREEN_WIDTH / 2 - TARGET_SIZE / 2,
                top: SCREEN_HEIGHT / 2 - TARGET_SIZE / 2,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.target,
                {
                  transform: [{ scale: targetScale }],
                  opacity: targetOpacity,
                },
              ]}
            >
              {/* Glow effect */}
              {isGlowing && (
                <Animated.View
                  style={[
                    styles.glow,
                    {
                      transform: [{ scale: glowScaleValue }],
                      opacity: glowOpacity,
                    },
                  ]}
                />
              )}
              <LinearGradient
                colors={target.color as [string, string, ...string[]]}
                style={styles.targetGradient}
              >
                <Text style={styles.targetEmoji}>{target.emoji}</Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>

          {/* Celebration */}
          <Animated.View
            style={[
              styles.celebration,
              {
                transform: [{ scale: celebrationScale }],
                opacity: celebrationOpacity,
              },
            ]}
          >
            <Text style={styles.celebrationText}>🎵 Excellent! 🎵</Text>
          </Animated.View>

          {/* Progress Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsSubtext}>
              ✓ Correct: {correctTaps} • ⏱ Early: {earlyTaps} • ✗ Missed: {missedTaps}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="ear" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Auditory Filtering</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="volume-high" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Sensory Load</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="mic" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Speech Readiness</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Round Success Animation */}
      <RoundSuccessAnimation
        visible={showRoundSuccess}
        stars={3}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginRight: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginLeft: 4,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginTop: 2,
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    position: 'relative',
  },
  waitIndicator: {
    position: 'absolute',
    top: 50,
    width: '85%',
    zIndex: 5,
  },
  waitIndicatorGradient: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  waitIndicatorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 10,
  },
  soundWave: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
    left: '50%',
    top: '50%',
    marginLeft: -125,
    marginTop: -125,
  },
  soundWaveInner: {
    width: '100%',
    height: '100%',
    borderRadius: 125,
    backgroundColor: '#3B82F6',
    opacity: 0.25,
  },
  warningBanner: {
    position: 'absolute',
    top: 40,
    width: '90%',
    zIndex: 15,
  },
  warningGradient: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  warningText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginLeft: 12,
  },
  targetContainer: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    zIndex: 10,
  },
  target: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    width: TARGET_SIZE + 80,
    height: TARGET_SIZE + 80,
    borderRadius: (TARGET_SIZE + 80) / 2,
    backgroundColor: '#FCD34D',
    top: -40,
    left: -40,
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 40,
    elevation: 40,
  },
  targetGradient: {
    width: '100%',
    height: '100%',
    borderRadius: TARGET_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  targetEmoji: {
    fontSize: 80,
  },
  celebration: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
  },
  celebrationText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#3B82F6',
  },
  statsContainer: {
    position: 'absolute',
    bottom: 100,
    alignItems: 'center',
  },
  statsText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 4,
  },
  statsSubtext: {
    fontSize: 14,
    color: '#475569',
  },
  skillsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 12,
  },
  skillItem: {
    alignItems: 'center',
    flex: 1,
  },
  skillText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
    textAlign: 'center',
  },
});

