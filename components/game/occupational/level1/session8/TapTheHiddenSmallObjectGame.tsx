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
const OBJECT_SIZE = 24; // Smaller hidden object
const PATTERN_DOT_SIZE = 8;
const PATTERN_DOT_SPACING = 40;

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

const TapTheHiddenSmallObjectGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [objectPosition, setObjectPosition] = useState<{ x: number; y: number } | null>(null);
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [hintShown, setHintShown] = useState(false);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [playAreaLayout, setPlayAreaLayout] = useState<{ width: number; height: number; x: number; y: number } | null>(null);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const objectScale = useRef(new Animated.Value(0)).current;
  const objectOpacity = useRef(new Animated.Value(0.4)).current; // Partially hidden
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const hintPulse = useRef(new Animated.Value(1)).current;
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const roundActiveRef = useRef(false);
  const hintShownRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    roundActiveRef.current = roundActive;
  }, [roundActive]);

  useEffect(() => {
    hintShownRef.current = hintShown;
  }, [hintShown]);

  // End game function
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);
      roundActiveRef.current = false;

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'tapTheHiddenSmallObject' as any,
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-scanning', 'figure-ground-perception', 'precise-tap-execution'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap the hidden small object game:', e);
      }

      speakTTS('Great scanning!', 0.78 );
    },
    [router],
  );

  // Generate random position for hidden object - between pattern dots
  const generateObjectPosition = useCallback((patternDots: Array<{ x: number; y: number }>): { x: number; y: number } => {
    // Find a position between pattern dots (not overlapping)
    let attempts = 0;
    let position: { x: number; y: number } | null = null;
    
    while (!position && attempts < 50) {
      const x = 10 + Math.random() * 80; // 10% to 90%
      const y = 10 + Math.random() * 80; // 10% to 90%
      
      // Check if this position is far enough from pattern dots
      const minDistance = 6; // Minimum distance from pattern dots (percentage)
      let tooClose = false;
      
      for (const dot of patternDots) {
        const dx = x - dot.x;
        const dy = y - dot.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < minDistance) {
          tooClose = true;
          break;
        }
      }
      
      if (!tooClose) {
        position = { x, y };
      }
      attempts++;
    }
    
    // Fallback if no good position found
    if (!position) {
      position = {
        x: 15 + Math.random() * 70,
        y: 15 + Math.random() * 70,
      };
    }
    
    return position;
  }, []);

  // Generate pattern dots positions (as percentages) - more dense to hide object
  const generatePatternDots = useCallback((): Array<{ x: number; y: number }> => {
    const dots: Array<{ x: number; y: number }> = [];
    const rows = 8; // More rows
    const cols = 7; // More columns - denser pattern

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Calculate percentage positions with some randomness
        const baseX = 8 + (col * 13) + (Math.random() * 3 - 1.5);
        const baseY = 8 + (row * 11) + (Math.random() * 3 - 1.5);
        dots.push({ x: baseX, y: baseY });
      }
    }

    return dots;
  }, []);

  const [patternDots] = useState<Array<{ x: number; y: number }>>(() => generatePatternDots());

  // Start a new round
  const startRound = useCallback(() => {
    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    setHintShown(false);
    hintShownRef.current = false;
    feedbackOpacity.setValue(0);
    hintPulse.setValue(1);

    // Generate new object position - between pattern dots
    const position = generateObjectPosition(patternDots);
    setObjectPosition(position);

    // Animate object appearing (partially hidden - much more hidden)
    objectScale.setValue(0);
    objectOpacity.setValue(0.2); // Very hidden - blend with pattern
    Animated.parallel([
      Animated.timing(objectScale, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }),
      Animated.timing(objectOpacity, {
        toValue: 0.25, // Very hidden - hard to see, blends with pattern
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();

    // Show hint after 3 seconds if not found
    setTimeout(() => {
      if (roundActiveRef.current && !hintShownRef.current) {
        setHintShown(true);
        hintShownRef.current = true;
        // Pulse animation for hint
        Animated.loop(
          Animated.sequence([
            Animated.timing(hintPulse, {
              toValue: 1.3,
              duration: 500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(hintPulse, {
              toValue: 1,
              duration: 500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ).start();
      }
    }, 3000);
  }, [generateObjectPosition, patternDots, objectScale, objectOpacity, feedbackOpacity, hintPulse]);

  // Handle object tap (direct tap on hidden object)
  const handleObjectTap = useCallback(
    async () => {
      if (!roundActiveRef.current || done) return;
      
      // Direct tap on object - always hit!
      setLastResult('hit');
      setShowFeedback(true);
      setRoundActive(false);
      roundActiveRef.current = false;
      setScore((s) => s + 1);

      // Stop hint pulse
      hintPulse.stopAnimation();
      hintPulse.setValue(1);

      // Success animation - reveal and pop
      Animated.sequence([
        Animated.parallel([
          Animated.timing(objectOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(objectScale, {
            toValue: 1.5,
            duration: 200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(objectScale, {
          toValue: 0,
          duration: 300,
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
        speakTTS('Perfect! Found it!', 0.78 );
      } catch {}

      // Next round or finish
      if (roundRef.current >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(scoreRef.current + 1);
        }, 1500);
      } else {
        setTimeout(() => {
          setShowFeedback(false);
          feedbackOpacity.setValue(0);
          hintPulse.stopAnimation();
          hintPulse.setValue(1);
          setRound((r) => r + 1);
          setTimeout(() => {
            startRound();
          }, 500);
        }, 1500);
      }
    },
    [done, endGame, playSuccess, objectScale, objectOpacity, feedbackOpacity, hintPulse, startRound],
  );

  // Handle screen tap
  const handleScreenTap = useCallback(
    async (event: any) => {
      if (!roundActiveRef.current || done || !objectPosition || !playAreaLayout) return;

      const { locationX, locationY } = event.nativeEvent;
      
      // Convert tap coordinates to percentage based on actual play area dimensions
      const tapXPercent = (locationX / playAreaLayout.width) * 100;
      const tapYPercent = (locationY / playAreaLayout.height) * 100;
      
      const dx = tapXPercent - objectPosition.x;
      const dy = tapYPercent - objectPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Very forgiving threshold - 20% of screen (very large hit area)
      const threshold = 20; // percentage distance threshold (extremely forgiving)

      // Always hit if very close (within 20%)
      if (distance <= threshold) {
        // Hit! Found the hidden object
        setLastResult('hit');
        setShowFeedback(true);
        setRoundActive(false);
        setScore((s) => s + 1);

        // Stop hint pulse
        hintPulse.stopAnimation();
        hintPulse.setValue(1);

        // Success animation - reveal and pop
        Animated.sequence([
          Animated.parallel([
            Animated.timing(objectOpacity, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(objectScale, {
              toValue: 1.5,
              duration: 200,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(objectScale, {
            toValue: 0,
            duration: 300,
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
          speakTTS('Found it!', 0.78 );
        } catch {}

        // Next round or finish
        if (roundRef.current >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(scoreRef.current + 1);
          }, 1500);
        } else {
          setTimeout(() => {
            setShowFeedback(false);
            feedbackOpacity.setValue(0);
            hintPulse.stopAnimation();
            hintPulse.setValue(1);
            setRound((r) => r + 1);
            setTimeout(() => {
              startRound();
            }, 500);
          }, 1500);
        }
      } else {
        // Miss - wrong location (only if not tapping on object Pressable)
        // The object Pressable will handle its own taps, so this is for background taps
        setLastResult('miss');
        setShowFeedback(true);

        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();

        try {
          await playError();
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Keep looking!', 0.78 );
        } catch {}

        // Hide feedback after a moment
        setTimeout(() => {
          setShowFeedback(false);
          feedbackOpacity.setValue(0);
        }, 1000);
      }
    },
    [done, objectPosition, playAreaLayout, endGame, playSuccess, playError, feedbackOpacity, hintPulse, startRound],
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
  }, [done, playAreaLayout]);

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Find and tap the hidden small object!', 0.78 );
      } catch {}
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    hintPulse.stopAnimation();
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack, hintPulse]);

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Scanning Master!"
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

  const hintScale = hintPulse.interpolate({
    inputRange: [1, 1.3],
    outputRange: [1, 1.3],
  });

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Tap The Hidden Small Object</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.helper}>
          Scan the pattern and find the tiny hidden object!
        </Text>
      </View>

      <Pressable
        onPress={handleScreenTap}
        onLayout={handlePlayAreaLayout}
        style={styles.playArea}
        disabled={!roundActive || done}
      >
        {/* Pattern background */}
        <View style={styles.patternContainer}>
          {patternDots.map((dot, index) => (
            <View
              key={index}
              style={[
                styles.patternDot,
                {
                  left: `${dot.x}%`,
                  top: `${dot.y}%`,
                },
              ]}
            />
          ))}
        </View>

        {/* Hidden object - separate Pressable for direct tap detection */}
        {objectPosition && (
          <Pressable
            onPress={handleObjectTap}
            style={[
              styles.objectContainer,
              {
                left: `${objectPosition.x}%`,
                top: `${objectPosition.y}%`,
                transform: [
                  { translateX: -(OBJECT_SIZE + 40) / 2 },
                  { translateY: -(OBJECT_SIZE + 40) / 2 },
                ],
              },
            ]}
            disabled={!roundActive || done}
          >
            <Animated.View
              style={[
                styles.hiddenObject,
                {
                  transform: [
                    { scale: hintShown ? hintScale : objectScale },
                  ],
                  opacity: objectOpacity,
                },
              ]}
            />
          </Pressable>
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
                  backgroundColor: lastResult === 'hit' ? '#22C55E' : '#EF4444',
                },
              ]}
            >
              <Text style={styles.feedbackText}>
                {lastResult === 'hit' ? '✔ Perfect!' : '✗ Keep looking!'}
              </Text>
            </View>
          </Animated.View>
        )}
      </Pressable>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: visual scanning • figure–ground perception • precise tap execution
        </Text>
        <Text style={styles.footerSub}>
          Look carefully through the pattern to find the tiny hidden object!
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
  patternContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  patternDot: {
    position: 'absolute',
    width: PATTERN_DOT_SIZE,
    height: PATTERN_DOT_SIZE,
    borderRadius: PATTERN_DOT_SIZE / 2,
    backgroundColor: '#94A3B8',
    opacity: 0.7, // Slightly more visible to blend with hidden object
  },
  objectContainer: {
    position: 'absolute',
    width: OBJECT_SIZE + 40, // Larger hit area (30 + 40 = 70px)
    height: OBJECT_SIZE + 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5, // Above pattern dots
  },
  hiddenObject: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    backgroundColor: '#94A3B8', // Same color as pattern dots to blend in
    borderWidth: 1,
    borderColor: '#64748B', // Subtle border
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
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

export default TapTheHiddenSmallObjectGame;

