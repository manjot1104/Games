import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const LOCK_SIZE = 80;
const CHEST_SIZE = 200;
const PINCH_THRESHOLD = 0.3; // Scale threshold to trigger unlock (30% reduction)

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

const PinchToOpenTreasureBoxGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [sparkleKey, setSparkleKey] = useState(0);
  const [sparkleX, setSparkleX] = useState(0);
  const [sparkleY, setSparkleY] = useState(0);
  const [isLock1Unlocked, setIsLock1Unlocked] = useState(false);
  const [isLock2Unlocked, setIsLock2Unlocked] = useState(false);
  const [isChestOpen, setIsChestOpen] = useState(false);

  // Animation values
  const lock1X = useSharedValue(40); // Left lock (%)
  const lock1Y = useSharedValue(50); // Center vertically (%)
  const lock1Scale = useSharedValue(1);
  const lock1Opacity = useSharedValue(1);
  const lock2X = useSharedValue(60); // Right lock (%)
  const lock2Y = useSharedValue(50); // Center vertically (%)
  const lock2Scale = useSharedValue(1);
  const lock2Opacity = useSharedValue(1);
  const chestX = useSharedValue(50); // Center horizontally (%)
  const chestY = useSharedValue(50); // Center vertically (%)
  const chestScale = useSharedValue(1);
  const chestRotation = useSharedValue(0);
  const feedbackOpacity = useSharedValue(0);
  const lock1Glow = useSharedValue(0);
  const lock2Glow = useSharedValue(0);
  const chestGlow = useSharedValue(0);
  const progressWidth = useSharedValue(0);
  const treasureParticles = useSharedValue(0);

  const roundActiveRef = useRef(false);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const isLock1UnlockedRef = useRef(false);
  const isLock2UnlockedRef = useRef(false);
  const isChestOpenRef = useRef(false);
  const lock1PinchActiveRef = useRef(false);
  const lock2PinchActiveRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    roundRef.current = round;
    scoreRef.current = score;
  }, [round, score]);

  // End game function
  const endGame = useCallback(async () => {
    if (done) return;
    setDone(true);
    setRoundActive(false);
    roundActiveRef.current = false;

    const finalScore = scoreRef.current;
    const totalRounds = TOTAL_ROUNDS;
    const xp = Math.floor((finalScore / totalRounds) * 50);

    try {
      const timestamp = await recordGame({
        type: 'pinchToOpenTreasureBox',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
      });

      await logGameAndAward({
        gameType: 'pinchToOpenTreasureBox',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
        xp,
      });

      setFinalStats({
        correct: finalScore,
        total: totalRounds,
        xp,
      });
      setLogTimestamp(timestamp);
    } catch (error) {
      console.error('Failed to save game result:', error);
    }
  }, [done]);

  // Check if both locks are unlocked
  const checkIfBothUnlocked = useCallback(() => {
    if (isLock1UnlockedRef.current && isLock2UnlockedRef.current && !isChestOpenRef.current) {
      isChestOpenRef.current = true;
      runOnJS(handleSuccess)();
    }
  }, []);

  // Handle lock unlock
  const handleLockUnlock = useCallback((lockNumber: 1 | 2) => {
    if (!roundActiveRef.current || done || isChestOpenRef.current) return;

    if (lockNumber === 1 && !isLock1UnlockedRef.current) {
      isLock1UnlockedRef.current = true;
      setIsLock1Unlocked(true);
      lock1Scale.value = withSequence(
        withSpring(1.2, { damping: 10, stiffness: 200 }),
        withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) })
      );
      lock1Opacity.value = withTiming(0, { duration: 200 });
      checkIfBothUnlocked();
    } else if (lockNumber === 2 && !isLock2UnlockedRef.current) {
      isLock2UnlockedRef.current = true;
      setIsLock2Unlocked(true);
      lock2Scale.value = withSequence(
        withSpring(1.2, { damping: 10, stiffness: 200 }),
        withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) })
      );
      lock2Opacity.value = withTiming(0, { duration: 200 });
      checkIfBothUnlocked();
    }
  }, [done, lock1Scale, lock1Opacity, lock2Scale, lock2Opacity, checkIfBothUnlocked]);

  // Handle wrong gesture (single tap)
  const handleWrongGesture = useCallback(async () => {
    if (!roundActiveRef.current || done || isChestOpenRef.current) return;

    setLastResult('miss');
    setShowFeedback(true);
    feedbackOpacity.value = withTiming(1, { duration: 200 });

    // Shake chest
    chestRotation.value = withSequence(
      withTiming(-5, { duration: 100, easing: Easing.out(Easing.ease) }),
      withTiming(5, { duration: 100, easing: Easing.inOut(Easing.ease) }),
      withTiming(-5, { duration: 100, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: 100, easing: Easing.in(Easing.ease) })
    );

    try {
      await playError();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speakTTS('Pinch both locks!', 0.78 );
    } catch {}

    setTimeout(() => {
      setShowFeedback(false);
      feedbackOpacity.value = 0;
    }, 2000);
  }, [done, chestRotation, feedbackOpacity, playError]);

  // Handle successful chest open
  const handleSuccess = useCallback(async () => {
    if (!roundActiveRef.current || done) return;

    setLastResult('hit');
    setShowFeedback(true);
    setRoundActive(false);
    roundActiveRef.current = false;
    setScore((s) => s + 1);

    // Open chest animation
    chestRotation.value = withSpring(-15, { damping: 10, stiffness: 200 });
    chestScale.value = withSpring(1.1, { damping: 10, stiffness: 200 });
    feedbackOpacity.value = withTiming(1, { duration: 200 });

    setSparkleX(chestX.value);
    setSparkleY(chestY.value);
    setSparkleKey((k) => k + 1);

    try {
      await playSuccess();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speakTTS('Treasure!', 0.78 );
    } catch {}

    if (roundRef.current >= TOTAL_ROUNDS) {
      setTimeout(() => {
        endGame();
      }, 1500);
    } else {
      setTimeout(() => {
        setShowFeedback(false);
        feedbackOpacity.value = 0;
        setRound((r) => r + 1);
        setTimeout(() => {
          startRound();
        }, 500);
      }, 1500);
    }
  }, [done, chestRotation, chestScale, chestX, chestY, feedbackOpacity, playSuccess, endGame]);

  // Start a new round
  const startRound = useCallback(() => {
    if (done) return;

    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    setIsLock1Unlocked(false);
    setIsLock2Unlocked(false);
    setIsChestOpen(false);
    isLock1UnlockedRef.current = false;
    isLock2UnlockedRef.current = false;
    isChestOpenRef.current = false;
    lock1PinchActiveRef.current = false;
    lock2PinchActiveRef.current = false;
    feedbackOpacity.value = 0;

    // Reset locks
    lock1Scale.value = 1;
    lock1Opacity.value = 1;
    lock2Scale.value = 1;
    lock2Opacity.value = 1;

    // Reset chest
    chestScale.value = 1;
    chestRotation.value = 0;
  }, [done, lock1Scale, lock1Opacity, lock2Scale, lock2Opacity, chestScale, chestRotation, feedbackOpacity]);

  // Pinch gesture for lock 1
  const lock1PinchGesture = Gesture.Pinch()
    .onStart(() => {
      if (!roundActiveRef.current || done || isChestOpenRef.current) return;
      lock1PinchActiveRef.current = true;
    })
    .onUpdate((e) => {
      if (!roundActiveRef.current || done || isChestOpenRef.current || isLock1UnlockedRef.current) return;
      
      // Scale down as user pinches
      const currentScale = 1 - (1 - e.scale) * 0.5;
      lock1Scale.value = Math.max(0.3, currentScale);

      // If pinched enough, unlock
      if (e.scale < (1 - PINCH_THRESHOLD)) {
        runOnJS(handleLockUnlock)(1);
      }
    })
    .onEnd(() => {
      lock1PinchActiveRef.current = false;
      if (!roundActiveRef.current || done || isChestOpenRef.current || isLock1UnlockedRef.current) return;
      // Spring back if not unlocked
      if (!isLock1UnlockedRef.current) {
        lock1Scale.value = withSpring(1, { damping: 10, stiffness: 200 });
      }
    });

  // Pinch gesture for lock 2
  const lock2PinchGesture = Gesture.Pinch()
    .onStart(() => {
      if (!roundActiveRef.current || done || isChestOpenRef.current) return;
      lock2PinchActiveRef.current = true;
    })
    .onUpdate((e) => {
      if (!roundActiveRef.current || done || isChestOpenRef.current || isLock2UnlockedRef.current) return;
      
      // Scale down as user pinches
      const currentScale = 1 - (1 - e.scale) * 0.5;
      lock2Scale.value = Math.max(0.3, currentScale);

      // If pinched enough, unlock
      if (e.scale < (1 - PINCH_THRESHOLD)) {
        runOnJS(handleLockUnlock)(2);
      }
    })
    .onEnd(() => {
      lock2PinchActiveRef.current = false;
      if (!roundActiveRef.current || done || isChestOpenRef.current || isLock2UnlockedRef.current) return;
      // Spring back if not unlocked
      if (!isLock2UnlockedRef.current) {
        lock2Scale.value = withSpring(1, { damping: 10, stiffness: 200 });
      }
    });

  // Single tap gesture (for wrong gesture detection)
  const tapGesture = Gesture.Tap()
    .onEnd(() => {
      if (!roundActiveRef.current || done || isChestOpenRef.current) return;
      runOnJS(handleWrongGesture)();
    });

  // Combine gestures
  const combinedGesture = Gesture.Simultaneous(
    Gesture.Race(lock1PinchGesture, tapGesture),
    lock2PinchGesture
  );

  // Start first round
  useEffect(() => {
    startRound();
  }, []);

  // Glow animations for locks
  useEffect(() => {
    if (roundActive && !isLock1UnlockedRef.current) {
      lock1Glow.value = withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      );
      const interval = setInterval(() => {
        if (roundActiveRef.current && !isLock1UnlockedRef.current) {
          lock1Glow.value = withSequence(
            withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
            withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) })
          );
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [roundActive, lock1Glow, isLock1UnlockedRef]);

  useEffect(() => {
    if (roundActive && !isLock2UnlockedRef.current) {
      lock2Glow.value = withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      );
      const interval = setInterval(() => {
        if (roundActiveRef.current && !isLock2UnlockedRef.current) {
          lock2Glow.value = withSequence(
            withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
            withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) })
          );
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [roundActive, lock2Glow, isLock2UnlockedRef]);

  // Chest glow when both unlocked
  useEffect(() => {
    if (isLock1Unlocked && isLock2Unlocked && !isChestOpenRef.current) {
      chestGlow.value = withSequence(
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 500, easing: Easing.inOut(Easing.ease) })
      );
      const interval = setInterval(() => {
        if (isChestOpenRef.current) {
          clearInterval(interval);
          return;
        }
        chestGlow.value = withSequence(
          withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.5, { duration: 500, easing: Easing.inOut(Easing.ease) })
        );
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isLock1Unlocked, isLock2Unlocked, chestGlow]);

  // Progress animation
  useEffect(() => {
    progressWidth.value = withTiming((score / TOTAL_ROUNDS) * 100, { duration: 300 });
  }, [score, progressWidth]);

  // Animated styles
  const lock1AnimatedStyle = useAnimatedStyle(() => {
    return {
      width: LOCK_SIZE,
      height: LOCK_SIZE,
      left: `${lock1X.value}%`,
      top: `${lock1Y.value}%`,
      transform: [
        { translateX: -LOCK_SIZE / 2 },
        { translateY: -LOCK_SIZE / 2 },
        { scale: lock1Scale.value },
      ],
      opacity: lock1Opacity.value,
    };
  });

  const lock2AnimatedStyle = useAnimatedStyle(() => {
    return {
      width: LOCK_SIZE,
      height: LOCK_SIZE,
      left: `${lock2X.value}%`,
      top: `${lock2Y.value}%`,
      transform: [
        { translateX: -LOCK_SIZE / 2 },
        { translateY: -LOCK_SIZE / 2 },
        { scale: lock2Scale.value },
      ],
      opacity: lock2Opacity.value,
    };
  });

  const chestAnimatedStyle = useAnimatedStyle(() => {
    return {
      width: CHEST_SIZE,
      height: CHEST_SIZE,
      left: `${chestX.value}%`,
      top: `${chestY.value}%`,
      transform: [
        { translateX: -CHEST_SIZE / 2 },
        { translateY: -CHEST_SIZE / 2 },
        { scale: chestScale.value },
        { rotate: `${chestRotation.value}deg` },
      ],
    };
  });

  const feedbackStyle = useAnimatedStyle(() => {
    return {
      opacity: feedbackOpacity.value,
    };
  });

  const lock1GlowStyle = useAnimatedStyle(() => {
    return {
      opacity: lock1Glow.value * 0.6,
      transform: [{ scale: 1 + lock1Glow.value * 0.2 }],
    };
  });

  const lock2GlowStyle = useAnimatedStyle(() => {
    return {
      opacity: lock2Glow.value * 0.6,
      transform: [{ scale: 1 + lock2Glow.value * 0.2 }],
    };
  });

  const chestGlowStyle = useAnimatedStyle(() => {
    return {
      opacity: chestGlow.value * 0.4,
      transform: [{ scale: 1 + chestGlow.value * 0.1 }],
    };
  });

  const progressStyle = useAnimatedStyle(() => {
    return {
      width: `${progressWidth.value}%`,
    };
  });

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Pinch to open the treasure box!', 0.78 );
      } catch {}
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  }, [onBack, router]);

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ResultCard
            correct={finalStats.correct}
            total={finalStats.total}
            xp={finalStats.xp}
            onPlayAgain={() => {
              setDone(false);
              setRound(1);
              setScore(0);
              setFinalStats(null);
              setLogTimestamp(null);
              startRound();
            }}
            onBack={handleBack}
            timestamp={logTimestamp || undefined}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          style={styles.backChipGradient}
        >
          <Text style={styles.backChipText}>← Back</Text>
        </LinearGradient>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>📦 Pinch to Open Treasure 📦</Text>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <Animated.View style={[styles.progressFill, progressStyle]} />
          </View>
          <Text style={styles.progressText}>{score}/{TOTAL_ROUNDS}</Text>
        </View>
        <Text style={styles.helper}>
          Pinch both locks at the same time!
        </Text>
      </View>

      {/* Play area */}
      <GestureDetector gesture={combinedGesture}>
        <View style={styles.playArea}>
          <LinearGradient
            colors={['#FFFBEB', '#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          
          {/* Chest */}
          <Animated.View style={[styles.chest, chestAnimatedStyle]}>
            <Animated.View style={[styles.glowRing, chestGlowStyle]} />
            <LinearGradient
              colors={['#92400E', '#78350F', '#5C2E0A']}
              style={styles.chestGradient}
            >
              <Text style={styles.chestEmoji}>📦</Text>
            </LinearGradient>
          </Animated.View>

          {/* Lock 1 */}
          <Animated.View style={[styles.lock, lock1AnimatedStyle]}>
            <Animated.View style={[styles.glowRing, lock1GlowStyle]} />
            <LinearGradient
              colors={['#6B7280', '#4B5563', '#374151']}
              style={styles.lockGradient}
            >
              <Text style={styles.lockEmoji}>🔒</Text>
            </LinearGradient>
          </Animated.View>

          {/* Lock 2 */}
          <Animated.View style={[styles.lock, lock2AnimatedStyle]}>
            <Animated.View style={[styles.glowRing, lock2GlowStyle]} />
            <LinearGradient
              colors={['#6B7280', '#4B5563', '#374151']}
              style={styles.lockGradient}
            >
              <Text style={styles.lockEmoji}>🔒</Text>
            </LinearGradient>
          </Animated.View>

          {/* Feedback */}
          {showFeedback && lastResult && (
            <Animated.View style={[styles.feedbackContainer, feedbackStyle]}>
              <LinearGradient
                colors={lastResult === 'hit' 
                  ? ['#FCD34D', '#F59E0B'] 
                  : ['#EF4444', '#DC2626']}
                style={styles.feedbackGradient}
              >
                <Text style={styles.feedbackText}>
                  {lastResult === 'hit' ? '✨ Treasure! ✨' : '👆 Pinch both locks!'}
                </Text>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Sparkle effect */}
          {sparkleKey > 0 && (
            <SparkleBurst
              key={sparkleKey}
              x={sparkleX}
              y={sparkleY}
            />
          )}
        </View>
      </GestureDetector>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backChip: {
    alignSelf: 'flex-start',
    margin: 16,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  backChipGradient: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  backChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  headerBlock: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#78350F',
    marginBottom: 16,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  progressBar: {
    width: 200,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22C55E',
    borderRadius: 6,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#78350F',
  },
  helper: {
    fontSize: 15,
    color: '#92400E',
    textAlign: 'center',
    fontWeight: '600',
  },
  playArea: {
    flex: 1,
    position: 'relative',
    margin: 20,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FCD34D',
  },
  chest: {
    position: 'absolute',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#92400E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
    zIndex: 5,
  },
  chestGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    borderWidth: 4,
    borderColor: '#78350F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chestEmoji: {
    fontSize: 100,
  },
  lock: {
    position: 'absolute',
    borderRadius: 1000,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#6B7280',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  lockGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 1000,
    borderWidth: 3,
    borderColor: '#4B5563',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: LOCK_SIZE * 1.5,
    height: LOCK_SIZE * 1.5,
    borderRadius: LOCK_SIZE * 0.75,
    backgroundColor: '#FCD34D',
  },
  lockEmoji: {
    fontSize: 40,
  },
  feedbackContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -100 }, { translateY: -20 }],
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 20,
  },
  feedbackGradient: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  feedbackText: {
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    color: '#FFFFFF',
  },
  feedbackSuccess: {
    color: '#22C55E',
  },
  feedbackError: {
    color: '#EF4444',
  },
  scrollContent: {
    padding: 20,
  },
});

export default PinchToOpenTreasureBoxGame;

