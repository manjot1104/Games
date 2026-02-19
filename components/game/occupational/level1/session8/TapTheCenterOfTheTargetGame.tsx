import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    LayoutChangeEvent,
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
const TOTAL_ROUNDS = 12;
const TARGET_SIZE = 200; // Medium-sized circle
const CENTER_SIZE = 50; // Small inner dot (center area)
const CENTER_RADIUS = CENTER_SIZE / 2;
const TARGET_RADIUS = TARGET_SIZE / 2;
const EDGE_ZONE = TARGET_RADIUS - CENTER_RADIUS; // Area between center and edge

type TapResult = 'center' | 'edge' | 'miss';

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

const TapTheCenterOfTheTargetGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [centerTaps, setCenterTaps] = useState(0);
  const [edgeTaps, setEdgeTaps] = useState(0);
  const [misses, setMisses] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [targetPosition, setTargetPosition] = useState<{ x: number; y: number } | null>(null);
  const [lastResult, setLastResult] = useState<TapResult | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const targetScale = useRef(new Animated.Value(1)).current;
  const centerGlow = useRef(new Animated.Value(0)).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;

  const targetRef = useRef<View>(null);
  const [targetLayout, setTargetLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const centerTapsRef = useRef(0);
  const roundRef = useRef(1);
  const roundActiveRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    centerTapsRef.current = centerTaps;
  }, [centerTaps]);

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    roundActiveRef.current = roundActive;
  }, [roundActive]);

  // End game function
  const endGame = useCallback(
    async (finalCenterTaps: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalCenterTaps * 15 + edgeTaps * 5; // 15 XP for center, 5 for edge
      const accuracy = (finalCenterTaps / total) * 100;

      setFinalStats({ correct: finalCenterTaps, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'tapTheCenterOfTheTarget' as any,
          correct: finalCenterTaps,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['spatial-precision', 'proprioceptive-feedback', 'accuracy-grading'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap the center of the target game:', e);
      }

      speakTTS('Great precision!', 0.78 );
    },
    [router, edgeTaps],
  );

  // Generate random target position
  const generateTargetPosition = useCallback((): { x: number; y: number } => {
    const margin = 15; // percentage margin from edges
    const x = margin + Math.random() * (100 - margin * 2);
    const y = margin + Math.random() * (100 - margin * 2);
    return { x, y };
  }, []);

  // Start a new round
  const startRound = useCallback(() => {
    const position = generateTargetPosition();
    setTargetPosition(position);
    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    feedbackOpacity.setValue(0);

    // Animate target appearance
    targetScale.setValue(0);
    Animated.sequence([
      Animated.timing(targetScale, {
        toValue: 1.1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(targetScale, {
        toValue: 1,
        duration: 200,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse center dot
    centerGlow.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(centerGlow, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(centerGlow, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [generateTargetPosition, targetScale, centerGlow, feedbackOpacity]);

  // Calculate tap result based on distance from center
  const calculateTapResult = useCallback(
    (tapX: number, tapY: number, centerX: number, centerY: number): TapResult => {
      const dx = tapX - centerX;
      const dy = tapY - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Very forgiving thresholds - make it easy to tap center
      // Center dot is 50px, so we'll accept taps within 80px of center (very generous)
      const centerThreshold = 80; // Very forgiving - much larger than center dot
      const edgeThreshold = TARGET_RADIUS + 20; // 100 + 20 = 120px

      if (distance <= centerThreshold) {
        return 'center';
      } else if (distance <= edgeThreshold) {
        return 'edge';
      } else {
        return 'miss';
      }
    },
    [],
  );

  // Handle center dot tap (guaranteed center tap)
  const handleCenterTap = useCallback(
    async () => {
      if (!roundActiveRef.current || done || !targetLayout) return;
      
      setLastResult('center');
      setShowFeedback(true);
      setRoundActive(false);
      roundActiveRef.current = false;
      setCenterTaps((c) => c + 1);
      
      // Stop center glow
      centerGlow.stopAnimation();
      
      // Success animation
      Animated.sequence([
        Animated.timing(targetScale, {
          toValue: 1.2,
          duration: 150,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(targetScale, {
          toValue: 1,
          duration: 150,
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
        speakTTS('Perfect center!', 0.78 );
      } catch {}

      // Next round or finish
      if (roundRef.current >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(centerTapsRef.current + 1);
        }, 1500);
      } else {
        setTimeout(() => {
          setShowFeedback(false);
          feedbackOpacity.setValue(0);
          setRound((r) => r + 1);
          setTimeout(() => {
            startRound();
          }, 300);
        }, 1500);
      }
    },
    [done, targetLayout, endGame, playSuccess, targetScale, feedbackOpacity, centerGlow, startRound],
  );

  // Handle target tap
  const handleTargetTap = useCallback(
    async (event: any) => {
      if (!roundActiveRef.current || done || !targetLayout) return;

      const { locationX, locationY } = event.nativeEvent;
      const centerX = targetLayout.width / 2;
      const centerY = targetLayout.height / 2;

      const result = calculateTapResult(locationX, locationY, centerX, centerY);
      setLastResult(result);
      setShowFeedback(true);
      setRoundActive(false);
      roundActiveRef.current = false;

      // Stop center glow animation
      centerGlow.stopAnimation();

      if (result === 'center') {
        // Center tap - perfect!
        setCenterTaps((c) => c + 1);
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 1.2,
            duration: 150,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(targetScale, {
            toValue: 1,
            duration: 150,
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
          speakTTS('Perfect center!', 0.78 );
        } catch {}
      } else if (result === 'edge') {
        // Edge tap - close but not center
        setEdgeTaps((e) => e + 1);
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 0.95,
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
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          speakTTS('Close! Try the center.', 0.78 );
        } catch {}
      } else {
        // Miss - outside target
        setMisses((m) => m + 1);
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 0.9,
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
          speakTTS('Try again!', 0.78 );
        } catch {}
      }

      // Next round or finish
      if (roundRef.current >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(result === 'center' ? centerTapsRef.current + 1 : centerTapsRef.current);
        }, 1500);
      } else {
        setTimeout(() => {
          setShowFeedback(false);
          feedbackOpacity.setValue(0);
          setRound((r) => r + 1);
          setTimeout(() => {
            startRound();
          }, 300);
        }, 1500);
      }
    },
    [done, targetLayout, startRound, endGame, playSuccess, playError, targetScale, centerGlow, feedbackOpacity, calculateTapResult],
  );

  // Handle target layout
  const handleTargetLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setTargetLayout({ x, y, width, height });
  }, []);

  // Start first round
  useEffect(() => {
    if (!done) {
      startRound();
    }
  }, []);

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Tap the center of the target!', 0.78 );
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
    onBack?.();
  }, [onBack]);

  // Result screen
  if (done && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View style={styles.resultCard}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🎯</Text>
            <Text style={styles.resultTitle}>Precision master!</Text>
            <Text style={styles.resultSubtitle}>
              Center taps: {finalStats.correct} • Edge taps: {edgeTaps} • Misses: {misses}
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setCenterTaps(0);
                setEdgeTaps(0);
                setMisses(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                startRound();
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const centerGlowOpacity = centerGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Tap The Center Of The Target</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Center: {centerTaps} • Edge: {edgeTaps} • Miss: {misses}
        </Text>
        <Text style={styles.helper}>
          Tap the center dot, not the outer ring!
        </Text>
      </View>

      <View style={styles.playArea}>
        {targetPosition && (
          <Animated.View
            style={[
              styles.targetContainer,
              {
                left: `${targetPosition.x}%`,
                top: `${targetPosition.y}%`,
                transform: [{ scale: targetScale }],
              },
            ]}
          >
            <View
              ref={targetRef}
              onLayout={handleTargetLayout}
              style={styles.targetWrapper}
            >
              <View style={styles.target}>
                {/* Outer ring - always miss if clicked (center dot handles center taps) */}
                <Pressable
                  onPress={async (e) => {
                    if (!roundActiveRef.current || done || !targetLayout) return;
                    
                    // Check if tap is in center area
                    const { locationX, locationY } = e.nativeEvent;
                    const centerX = targetLayout.width / 2;
                    const centerY = targetLayout.height / 2;
                    const dx = locationX - centerX;
                    const dy = locationY - centerY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Center dot hit area is 110px (55px radius)
                    // If tap is in center area, don't handle here (let center dot handle it)
                    if (distance <= 55) {
                      return; // Center dot will handle this
                    }
                    
                    // Otherwise, always show miss
                    setLastResult('miss');
                    setShowFeedback(true);
                    setRoundActive(false);
                    roundActiveRef.current = false;
                    setMisses((m) => m + 1);
                    
                    // Stop center glow
                    centerGlow.stopAnimation();
                    
                    // Miss animation
                    Animated.sequence([
                      Animated.timing(targetScale, {
                        toValue: 0.9,
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
                      speakTTS('Try the center dot!', 0.78 );
                    } catch {}

                    // Next round or finish
                    if (roundRef.current >= TOTAL_ROUNDS) {
                      setTimeout(() => {
                        endGame(centerTapsRef.current);
                      }, 1500);
                    } else {
                      setTimeout(() => {
                        setShowFeedback(false);
                        feedbackOpacity.setValue(0);
                        setRound((r) => r + 1);
                        setTimeout(() => {
                          startRound();
                        }, 300);
                      }, 1500);
                    }
                  }}
                  style={styles.outerRingPressable}
                  disabled={!roundActive || done}
                >
                  <View style={styles.outerRing} />
                </Pressable>
                
                {/* Center dot - separate tapable area */}
                <Pressable
                  onPress={handleCenterTap}
                  style={styles.centerDotPressable}
                  disabled={!roundActive || done}
                >
                  <Animated.View
                    style={[
                      styles.centerDot,
                      {
                        opacity: centerGlowOpacity,
                      },
                    ]}
                  />
                </Pressable>
              </View>
            </View>
          </Animated.View>
        )}

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
                  backgroundColor:
                    lastResult === 'center'
                      ? '#22C55E'
                      : lastResult === 'edge'
                      ? '#F59E0B'
                      : '#EF4444',
                },
              ]}
            >
              <Text style={styles.feedbackText}>
                {lastResult === 'center'
                  ? '✔ Center tap!'
                  : lastResult === 'edge'
                  ? '⚠ Edge tap'
                  : '✗ Miss'}
              </Text>
            </View>
          </Animated.View>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: spatial precision • proprioceptive feedback • accuracy grading
        </Text>
        <Text style={styles.footerSub}>
          Tap the center dot for perfect score! Edge taps count less, misses don't count.
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
  },
  targetContainer: {
    position: 'absolute',
    transform: [{ translateX: -TARGET_SIZE / 2 }, { translateY: -TARGET_SIZE / 2 }],
  },
  targetWrapper: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
  },
  target: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  outerRingPressable: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
  },
  outerRing: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_RADIUS,
    borderWidth: 4,
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  centerDotPressable: {
    position: 'absolute',
    width: CENTER_SIZE + 60, // Large hit area (50 + 60 = 110px) - very forgiving
    height: CENTER_SIZE + 60,
    justifyContent: 'center',
    alignItems: 'center',
    left: '50%',
    top: '50%',
    transform: [{ translateX: -(CENTER_SIZE + 60) / 2 }, { translateY: -(CENTER_SIZE + 60) / 2 }],
    zIndex: 10, // Above outer ring
  },
  centerDot: {
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    borderRadius: CENTER_RADIUS,
    backgroundColor: '#EF4444',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
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

export default TapTheCenterOfTheTargetGame;

