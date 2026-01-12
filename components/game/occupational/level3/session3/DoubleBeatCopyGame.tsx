import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 8;
const BEAT_INTERVAL = 600; // 600ms between two beats
const SOUND_DURATION = 400;
const TAP_WINDOW = 1200; // 1.2 seconds to complete 2 taps

const DoubleBeatCopyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [canTap, setCanTap] = useState(false);
  const [beatCount, setBeatCount] = useState(0);
  const [userTaps, setUserTaps] = useState<number[]>([]);
  const [phase, setPhase] = useState<'listen' | 'tap'>('listen');

  const drumScale = useRef(new Animated.Value(1)).current;
  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tapWindowRef = useRef<NodeJS.Timeout | null>(null);

  const playBeats = useCallback(() => {
    if (done) return;
    
    setPhase('listen');
    setBeatCount(0);
    setUserTaps([]);
    setCanTap(false);
    setIsPlaying(true);

    // Play first beat
    setIsPlaying(true);
    playSound('drum', 0.8, 1.0);
    Animated.sequence([
      Animated.timing(drumScale, {
        toValue: 1.2,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(drumScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    setBeatCount(1);

    // Play second beat after interval
    beatTimeoutRef.current = setTimeout(() => {
      playSound('drum', 0.8, 1.0);
      Animated.sequence([
        Animated.timing(drumScale, {
          toValue: 1.2,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(drumScale, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();

      setBeatCount(2);

      // After both beats, allow tapping
      setTimeout(() => {
        setPhase('tap');
        setCanTap(true);
        setIsPlaying(false);

        // Close tap window
        tapWindowRef.current = setTimeout(() => {
          setCanTap(false);
          checkResult();
        }, TAP_WINDOW) as unknown as NodeJS.Timeout;
      }, 300);
    }, BEAT_INTERVAL) as unknown as NodeJS.Timeout;
  }, [done, drumScale]);

  const handleTap = useCallback(() => {
    if (!canTap || done) return;

    const now = Date.now();
    setUserTaps((prev) => {
      const newTaps = [...prev, now];
      
      if (newTaps.length === 2) {
        setCanTap(false);
        if (tapWindowRef.current) {
          clearTimeout(tapWindowRef.current);
          tapWindowRef.current = null;
        }
        checkResult(newTaps);
      }
      
      return newTaps;
    });

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [canTap, done]);

  const checkResult = useCallback((taps?: number[]) => {
    const tapsToCheck = taps || userTaps;
    
    if (tapsToCheck.length === 2) {
      const interval = tapsToCheck[1] - tapsToCheck[0];
      const expectedInterval = BEAT_INTERVAL;
      const tolerance = BEAT_INTERVAL * 0.5; // 50% tolerance
      
      if (Math.abs(interval - expectedInterval) <= tolerance) {
        // Correct!
        setScore((s) => s + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } else {
      // Not enough taps
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }

    // Move to next round
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setUserTaps([]);
        setBeatCount(0);
      } else {
        endGame();
      }
    }, 1000);
  }, [userTaps, round]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      playBeats();
    }, 500);
  }, [done, playBeats]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 12;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsPlaying(false);
    setCanTap(false);

    if (beatTimeoutRef.current) {
      clearTimeout(beatTimeoutRef.current);
      beatTimeoutRef.current = null;
    }
    if (tapWindowRef.current) {
      clearTimeout(tapWindowRef.current);
      tapWindowRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'double-beat-copy',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['rhythm-understanding', 'hand-coordination'],
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
        Speech.stop();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (beatTimeoutRef.current) {
        clearTimeout(beatTimeoutRef.current);
      }
      if (tapWindowRef.current) {
        clearTimeout(tapWindowRef.current);
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Double Beat Copy"
        emoji="🥁🥁"
        description="Drum beats twice, child needs to tap twice"
        skills={['Rhythm understanding', 'Hand coordination']}
        suitableFor="Children who want to understand rhythm and improve hand coordination"
        onStart={() => {
          setShowInfo(false);
          if (Platform.OS === 'web') {
            setTimeout(() => {
              Speech.speak('Listen to two drum beats, then tap twice to copy!', { rate: 0.8 });
            }, 300);
          } else {
            Speech.speak('Listen to two drum beats, then tap twice to copy!', { rate: 0.8 });
          }
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
            setUserTaps([]);
            setBeatCount(0);
            setIsPlaying(false);
            setCanTap(false);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
        style={StyleSheet.absoluteFillObject}
      />
      
      <TouchableOpacity
        onPress={() => {
          try {
            Speech.stop();
          } catch (e) {
            // Ignore errors
          }
          stopAllSpeech();
          cleanupSounds();
          if (onBack) onBack();
        }}
        style={styles.backButton}
      >
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>🥁🥁 Double Beat Copy</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {phase === 'listen'
              ? isPlaying
                ? `👂 Listen... Beat ${beatCount}/2`
                : '⏳ Wait...'
              : canTap
              ? `👆 Tap twice! (${userTaps.length}/2)`
              : '✅ Done!'}
          </Text>

          <TouchableOpacity
            style={styles.drumContainer}
            onPress={handleTap}
            activeOpacity={0.8}
            disabled={!canTap}
          >
            <Animated.View
              style={[
                styles.drum,
                (isPlaying || canTap) && styles.drumActive,
                { transform: [{ scale: drumScale }] },
              ]}
            >
              <Text style={styles.drumEmoji}>🥁</Text>
              {canTap && (
                <View style={styles.drumGlow}>
                  <Text style={styles.drumGlowText}>✨</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>

          {canTap && (
            <Text style={styles.tapHint}>
              Tap {2 - userTaps.length} more time{2 - userTaps.length === 1 ? '' : 's'}! 👆
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  backText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  header: {
    paddingTop: 100,
    paddingHorizontal: 24,
    paddingBottom: 20,
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
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#92400E',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  gameArea: {
    width: '100%',
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#78350F',
    marginBottom: 40,
    textAlign: 'center',
  },
  drumContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  drum: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
    borderWidth: 4,
    borderColor: '#EA580C',
  },
  drumActive: {
    backgroundColor: '#DC2626',
    borderColor: '#B91C1C',
    shadowColor: '#DC2626',
  },
  drumEmoji: {
    fontSize: 80,
  },
  drumGlow: {
    position: 'absolute',
    top: -20,
    right: -20,
  },
  drumGlowText: {
    fontSize: 40,
  },
  tapHint: {
    marginTop: 30,
    fontSize: 20,
    fontWeight: '700',
    color: '#22C55E',
    textAlign: 'center',
  },
});

export default DoubleBeatCopyGame;

