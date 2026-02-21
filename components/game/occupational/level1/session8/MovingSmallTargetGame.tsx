import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 10;
const TARGET_SIZE = 40; // Tiny shape
const ZONE_WIDTH = 120; // Target zone width
const MOVE_SPEED = 0.8; // Pixels per frame (slow movement)

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

const MovingSmallTargetGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [roundActive, setRoundActive] = useState(false);
  const [targetX, setTargetX] = useState(0);
  const [zoneCenter, setZoneCenter] = useState(0);
  const zoneCenterRef = useRef(0);
  const [showZone, setShowZone] = useState(false);
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const targetPosition = useRef(new Animated.Value(0)).current;
  const targetScale = useRef(new Animated.Value(1)).current;
  const zoneOpacity = useRef(new Animated.Value(0)).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;

  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const targetXRef = useRef(0);
  const roundActiveRef = useRef(false);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const [playAreaLayout, setPlayAreaLayout] = useState<{ width: number; height: number; x: number; y: number } | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  // End game function
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20;
      const accuracy = (finalScore / total) * 100;

      // Set all states together FIRST (like CatchTheBouncingStar)
      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);
      roundActiveRef.current = false;
      setShowCongratulations(true);

      // Stop any running animations
      if (animationRef.current) {
        animationRef.current.stop();
      }
      
      speakTTS('Amazing work! You completed the game!', 0.78);

      // Log game in background (don't wait for it)
      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'movingSmallTarget' as any,
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['dynamic-accuracy', 'hand-eye-coordination', 'timing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log moving small target game:', e);
      }
    },
    [router],
  );

  // Check if target is in zone (more forgiving)
  const isTargetInZone = useCallback((x: number, zoneCenterX: number): boolean => {
    const zoneLeft = zoneCenterX - ZONE_WIDTH / 2 - 20; // Add buffer
    const zoneRight = zoneCenterX + ZONE_WIDTH / 2 + 20; // Add buffer
    const targetLeft = x - TARGET_SIZE / 2;
    const targetRight = x + TARGET_SIZE / 2;
    
    // Check if target overlaps with zone (more forgiving)
    return targetRight >= zoneLeft && targetLeft <= zoneRight;
  }, []);

  // Start a new round
  const startRound = useCallback(() => {
    if (!playAreaLayout) return; // Wait for layout
    
    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    feedbackOpacity.setValue(0);

    // Random zone position (center area of play area)
    const playAreaWidth = playAreaLayout.width;
    const zoneX = playAreaWidth * 0.3 + Math.random() * (playAreaWidth * 0.4);
    setZoneCenter(zoneX);
    zoneCenterRef.current = zoneX;

    // Start target from left side
    const startX = -TARGET_SIZE;
    targetXRef.current = startX;
    targetPosition.setValue(startX);
    setTargetX(startX);

    // Show zone briefly
    setShowZone(true);
    zoneOpacity.setValue(0.3);
    Animated.sequence([
      Animated.timing(zoneOpacity, {
        toValue: 0.5,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(zoneOpacity, {
        toValue: 0.2,
        duration: 500,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Animate target moving across play area
    // playAreaWidth already declared above, just use it
    const endX = playAreaWidth + TARGET_SIZE;
    const distance = endX - startX;
    const duration = (distance / MOVE_SPEED) * 16; // Approximate duration in ms

    animationRef.current = Animated.timing(targetPosition, {
      toValue: endX,
      duration,
      easing: Easing.linear,
      useNativeDriver: true,
    });

    // Track position using timer (since useNativeDriver prevents direct value reading)
    const startTime = Date.now();
    const updatePosition = () => {
      if (!roundActiveRef.current) return;
      
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const currentX = startX + (endX - startX) * progress;
      targetXRef.current = currentX;
      setTargetX(currentX);

      if (progress < 1 && roundActiveRef.current) {
        requestAnimationFrame(updatePosition);
      }
    };
    updatePosition();

    animationRef.current.start(({ finished }) => {
      if (finished && roundActiveRef.current) {
        // Target passed without being tapped - miss
        setLastResult('miss');
        setShowFeedback(true);
        setRoundActive(false);
        roundActiveRef.current = false;
        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();

        playError();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});

        // Next round or finish
        if (roundRef.current >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(scoreRef.current);
          }, 1500);
        } else {
          setTimeout(() => {
            setShowZone(false);
            setShowFeedback(false);
            feedbackOpacity.setValue(0);
            setRound((r) => r + 1);
            setTimeout(() => {
              startRound();
            }, 500);
          }, 1500);
        }
      }
    });
  }, [endGame, playError, targetPosition, zoneOpacity, feedbackOpacity, playAreaLayout]);

  // Handle target tap (direct tap on red dot)
  const handleTargetTap = useCallback(
    async () => {
      if (!roundActiveRef.current || done || !playAreaLayout) return;
      
      const currentX = targetXRef.current;
      const currentZoneCenter = zoneCenterRef.current;
      const inZone = isTargetInZone(currentX, currentZoneCenter);
      
      console.log('Target tap:', {
        currentX,
        currentZoneCenter,
        inZone,
        roundActive: roundActiveRef.current,
      });
      
      if (inZone) {
        // Hit! Target is in zone
        setLastResult('hit');
        setShowFeedback(true);
        setRoundActive(false);
        roundActiveRef.current = false;
        setScore((s) => s + 1);

        // Stop animation
        if (animationRef.current) {
          animationRef.current.stop();
        }

        // Success animation
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 1.5,
            duration: 150,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(targetScale, {
            toValue: 0,
            duration: 200,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();

        try {
          await playSuccess();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speakTTS('Perfect timing!', 0.78 );
        } catch {}

        // Next round or finish
        if (roundRef.current >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(scoreRef.current + 1);
          }, 1500);
        } else {
          setTimeout(() => {
            setShowZone(false);
            setShowFeedback(false);
            feedbackOpacity.setValue(0);
            targetScale.setValue(1);
            setRound((r) => r + 1);
            setTimeout(() => {
              startRound();
            }, 500);
          }, 1500);
        }
      } else {
        // Tap on target but not in zone - miss
        setLastResult('miss');
        setShowFeedback(true);
        setRoundActive(false);
        roundActiveRef.current = false;

        if (animationRef.current) {
          animationRef.current.stop();
        }

        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 0.8,
            duration: 100,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(targetScale, {
            toValue: 1,
            duration: 100,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();

        try {
          await playError();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          speakTTS('Wait for the zone!', 0.78 );
        } catch {}

        // Next round or finish
        if (roundRef.current >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(scoreRef.current);
          }, 1500);
        } else {
          setTimeout(() => {
            setShowZone(false);
            setShowFeedback(false);
            feedbackOpacity.setValue(0);
            setRound((r) => r + 1);
            setTimeout(() => {
              startRound();
            }, 500);
          }, 1500);
        }
      }
    },
    [done, playAreaLayout, zoneCenter, endGame, playSuccess, playError, targetScale, feedbackOpacity, isTargetInZone, startRound],
  );

  // Handle screen tap
  const handleScreenTap = useCallback(
    async (event: any) => {
      if (!roundActiveRef.current || done || !playAreaLayout) return;

      const { locationX } = event.nativeEvent;
      const currentX = targetXRef.current;

      // locationX is relative to Pressable (0 to playAreaLayout.width)
      // currentX is the absolute pixel position of target center
      // Target moves from -TARGET_SIZE to playAreaWidth + TARGET_SIZE
      // We only want to detect taps when target is visible (currentX >= 0 && currentX <= playAreaWidth)
      
      // Check if target is visible on screen
      if (currentX < 0 || currentX > playAreaLayout.width) {
        return; // Target is off-screen, ignore tap
      }
      
      // Check if tap is near target (within target size + buffer)
      const tapDistance = Math.abs(locationX - currentX);
      const inZone = isTargetInZone(currentX, zoneCenter);
      
      // Very forgiving tap detection - accept taps within 3x target size (120px)
      const tapThreshold = TARGET_SIZE * 3; // 40 * 3 = 120px - extremely forgiving
      
      // Also check if tap is directly in the zone area (even if not exactly on target)
      const zoneLeft = zoneCenter - ZONE_WIDTH / 2 - 30; // Add buffer
      const zoneRight = zoneCenter + ZONE_WIDTH / 2 + 30; // Add buffer
      const tapInZone = locationX >= zoneLeft && locationX <= zoneRight;

      console.log('Game 3 Tap detection:', {
        locationX,
        currentX,
        tapDistance,
        tapThreshold,
        inZone,
        tapInZone,
        zoneCenter,
        zoneLeft,
        zoneRight,
        playAreaWidth: playAreaLayout.width,
        willHit: (tapDistance <= tapThreshold && inZone) || (tapInZone && tapDistance <= tapThreshold * 1.5),
      });

      // Hit if: (tap near target AND target in zone) OR (tap in zone area AND near target)
      if ((tapDistance <= tapThreshold && inZone) || (tapInZone && tapDistance <= tapThreshold * 1.5)) {
        // Hit! Target is in zone
        setLastResult('hit');
        setShowFeedback(true);
        setRoundActive(false);
        roundActiveRef.current = false;
        setScore((s) => s + 1);

        // Stop animation
        if (animationRef.current) {
          animationRef.current.stop();
        }

        // Success animation
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 1.5,
            duration: 150,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(targetScale, {
            toValue: 0,
            duration: 200,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();

        try {
          await playSuccess();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speakTTS('Perfect timing!', 0.78 );
        } catch {}

        // Next round or finish
        if (roundRef.current >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(scoreRef.current + 1);
          }, 1500);
        } else {
          setTimeout(() => {
            setShowZone(false);
            setShowFeedback(false);
            feedbackOpacity.setValue(0);
            targetScale.setValue(1);
            setRound((r) => r + 1);
            setTimeout(() => {
              startRound();
            }, 500);
          }, 1500);
        }
      } else if (tapDistance <= tapThreshold && !inZone) {
        // Tap on target but not in zone - miss
        setLastResult('miss');
        setShowFeedback(true);
        setRoundActive(false);
        roundActiveRef.current = false;

        if (animationRef.current) {
          animationRef.current.stop();
        }

        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 0.8,
            duration: 100,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(targetScale, {
            toValue: 1,
            duration: 100,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();

        try {
          await playError();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          speakTTS('Wait for the zone!', 0.78 );
        } catch {}

        // Next round or finish
        if (roundRef.current >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(scoreRef.current);
          }, 1500);
        } else {
          setTimeout(() => {
            setShowZone(false);
            setShowFeedback(false);
            feedbackOpacity.setValue(0);
            setRound((r) => r + 1);
            setTimeout(() => {
              startRound();
            }, 500);
          }, 1500);
        }
      }
    },
    [done, zoneCenter, playAreaLayout, endGame, playSuccess, playError, targetScale, feedbackOpacity, isTargetInZone, startRound],
  );

  // Handle play area layout
  const handlePlayAreaLayout = useCallback((event: any) => {
    const { width, height, x, y } = event.nativeEvent.layout;
    setPlayAreaLayout({ width, height, x, y });
  }, []);

  // Start first round after layout is ready
  useEffect(() => {
    if (!done && playAreaLayout) {
      setTimeout(() => {
        startRound();
      }, 500);
    }

    return () => {
      if (animationRef.current) {
        animationRef.current.stop();
      }
    };
  }, [done, playAreaLayout]);

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Tap the moving small target!', 0.78 );
      } catch {}
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    if (animationRef.current) {
      animationRef.current.stop();
    }
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Tracking Master!"
        showButtons={true}
        onContinue={() => {
          // Continue - go back to games (no ResultCard screen needed)
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
        onHome={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  // Prevent any rendering when game is done but congratulations hasn't shown yet
  if (done && finalStats && !showCongratulations) {
    return null; // Wait for showCongratulations to be set
  }

  const zoneOpacityValue = zoneOpacity.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.5],
  });

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Moving Small Target</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.helper}>
          Tap the tiny shape when it passes through the green zone!
        </Text>
      </View>

      <Pressable
        onPress={handleScreenTap}
        onLayout={handlePlayAreaLayout}
        style={[styles.playArea, { zIndex: 1 }]}
        disabled={!roundActive || done}
        pointerEvents={roundActive && !done ? 'box-none' : 'none'}
      >
        {/* Target zone */}
        {showZone && (
          <Animated.View
            style={[
              styles.zone,
              {
                left: zoneCenter - ZONE_WIDTH / 2,
                opacity: zoneOpacityValue,
              },
            ]}
          />
        )}

        {/* Moving target - separate Pressable for direct tap */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: '50%',
              left: targetPosition,
              width: TARGET_SIZE + 60, // Larger hit area (80px total)
              height: TARGET_SIZE + 60,
              transform: [
                { translateY: -(TARGET_SIZE + 60) / 2 },
                { translateX: -(TARGET_SIZE + 60) / 2 },
              ],
              zIndex: 100, // Above everything
              pointerEvents: roundActive && !done ? 'auto' : 'none',
            },
          ]}
        >
          <Pressable
            onPress={handleTargetTap}
            style={{
              width: '100%',
              height: '100%',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent',
            }}
            disabled={!roundActive || done}
          >
            <Animated.View
              style={[
                styles.target,
                {
                  transform: [{ scale: targetScale }],
                },
              ]}
            />
          </Pressable>
        </Animated.View>

        {/* Feedback indicator */}
        {showFeedback && lastResult && (
          <Animated.View
            style={[
              styles.feedbackContainer,
              {
                opacity: feedbackOpacity,
              },
            ]}
          >
            <View
              style={[
                styles.feedbackBox,
                {
                  backgroundColor: lastResult === 'hit' ? '#22C55E' : '#EF4444',
                },
              ]}
            >
              <Text style={styles.feedbackText}>
                {lastResult === 'hit' ? '✔ Perfect timing!' : '✗ Miss'}
              </Text>
            </View>
          </Animated.View>
        )}
      </Pressable>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: dynamic accuracy • hand–eye coordination • timing
        </Text>
        <Text style={styles.footerSub}>
          Watch the tiny shape move and tap when it's in the green zone!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    position: 'relative',
    marginBottom: 16,
    backgroundColor: '#E0F2FE',
    borderRadius: 16,
    overflow: 'hidden',
  },
  zone: {
    position: 'absolute',
    top: '50%',
    width: ZONE_WIDTH,
    height: 200,
    backgroundColor: '#22C55E',
    borderRadius: 12,
    transform: [{ translateY: -100 }],
    borderWidth: 3,
    borderColor: '#16A34A',
    borderStyle: 'dashed',
  },
  target: {
    position: 'absolute',
    top: '50%',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: '#EF4444',
    transform: [{ translateY: -TARGET_SIZE / 2 }],
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
    borderWidth: 2,
    borderColor: '#DC2626',
  },
  feedbackContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -80 }, { translateY: -25 }],
  },
  feedbackBox: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  feedbackText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  savedText: {
    marginTop: 16,
    fontSize: 14,
    color: '#22C55E',
    fontWeight: '600',
  },
});

export default MovingSmallTargetGame;

