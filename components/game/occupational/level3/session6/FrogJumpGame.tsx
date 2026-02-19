import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAX_TAP_DELAY = 600; // Maximum time between 2 taps (ms)
const FROG_START_Y = SCREEN_HEIGHT * 0.7;
const FROG_JUMP_Y = SCREEN_HEIGHT * 0.4;

const FrogJumpGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showFrog, setShowFrog] = useState(false);
  const [hasJumped, setHasJumped] = useState(false);
  const [tapCount, setTapCount] = useState(0);

  const frogY = useRef(new Animated.Value(FROG_START_Y)).current;
  const frogScale = useRef(new Animated.Value(1)).current;
  const firstTapTime = useRef<number | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleTap = useCallback(() => {
    if (done || !showFrog || hasJumped) return;

    const now = Date.now();

    if (firstTapTime.current === null) {
      // First tap
      firstTapTime.current = now;
      setTapCount(1);
      
      // Set timeout - if second tap doesn't come in time, reset
      tapTimeoutRef.current = setTimeout(() => {
        setTapCount(0);
        firstTapTime.current = null;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        speakTTS('Tap twice!', 0.8, 'en-US' );
      }, MAX_TAP_DELAY) as unknown as NodeJS.Timeout;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else {
      // Second tap
      const timeDiff = now - firstTapTime.current;

      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
      }

      if (timeDiff <= MAX_TAP_DELAY) {
        // Success! 2 taps detected within time limit
        setTapCount(2);
        handleSuccess();
      } else {
        // Too slow, reset
        setTapCount(0);
        firstTapTime.current = null;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Tap twice quickly!', 0.8, 'en-US' );
      }
    }
  }, [done, showFrog, hasJumped]);

  const handleSuccess = useCallback(() => {
    setHasJumped(true);
    setScore((s) => s + 1);
    firstTapTime.current = null;
    setTapCount(0);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Frog jump kiya!', 0.9 );
    
    // Jump animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(frogY, {
          toValue: FROG_JUMP_Y,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.sequence([
          Animated.timing(frogScale, {
            toValue: 1.3,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(frogScale, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.timing(frogY, {
        toValue: FROG_START_Y,
        duration: 300,
        useNativeDriver: false,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowFrog(false);
        setHasJumped(false);
        frogY.setValue(FROG_START_Y);
        frogScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, frogY, frogScale]);

  const showFrogObject = useCallback(() => {
    setShowFrog(true);
    setHasJumped(false);
    setTapCount(0);
    firstTapTime.current = null;
    frogY.setValue(FROG_START_Y);
    frogScale.setValue(1);
    
    Animated.spring(frogScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS('Tap twice to make the frog jump!', 0.8, 'en-US' );
      }, 300);
    } else {
      speakTTS('Do baar tap karo frog ko jump karane ke liye!', 0.8 );
    }
  }, [frogScale, frogY]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showFrogObject();
    }, 500);
  }, [done, showFrogObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowFrog(false);

    try {
      await logGameAndAward({
        type: 'frog-jump',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['sequencing', 'timing', 'double-tap'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      startRound();
    }
  }, [showInfo, round, done, startRound]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Frog Jump"
        emoji="🐸"
        description="2 taps = jump! Do baar tap karo frog ko jump karane ke liye!"
        skills={['Sequencing', 'Timing']}
        suitableFor="Children learning double tap gestures and sequencing"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  // Result screen
  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
          onHome={() => {
            stopAllSpeech();
            cleanupSounds();
            onBack?.();
          }}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            setShowFrog(false);
            setHasJumped(false);
            setTapCount(0);
            frogY.setValue(FROG_START_Y);
            frogScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Frog Jump</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🐸 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap twice to make the frog jump!
        </Text>
        {tapCount > 0 && (
          <Text style={styles.tapIndicator}>
            Tap: {tapCount}/2
          </Text>
        )}
      </View>

      <View style={styles.gameArea}>
        {showFrog && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleTap}
            style={styles.tapArea}
          >
            <Animated.View
              style={[
                styles.frogContainer,
                {
                  top: frogY,
                  transform: [{ scale: frogScale }],
                },
              ]}
            >
              <Text style={styles.frogEmoji}>🐸</Text>
              <Text style={styles.frogLabel}>2 TAPS</Text>
            </Animated.View>
          </TouchableOpacity>
        )}

        {!showFrog && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Sequencing • Timing
        </Text>
        <Text style={styles.footerSubtext}>
          Two taps make the frog jump! Practice sequencing and timing.
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 16,
    color: '#22C55E',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  tapIndicator: {
    fontSize: 20,
    color: '#3B82F6',
    fontWeight: '800',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  frogContainer: {
    position: 'absolute',
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -75,
  },
  frogEmoji: {
    fontSize: 120,
    marginBottom: 8,
  },
  frogLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#22C55E',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  waitingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 20,
    color: '#64748B',
    fontWeight: '600',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default FrogJumpGame;


