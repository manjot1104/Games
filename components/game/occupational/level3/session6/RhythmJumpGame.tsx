import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BEAT_INTERVAL = 600; // Time between two beats (ms)
const TAP_TOLERANCE = 300; // Acceptable deviation from beat interval (ms)
const FROG_START_Y = SCREEN_HEIGHT * 0.7;
const FROG_JUMP_Y = SCREEN_HEIGHT * 0.4;

const RhythmJumpGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showFrog, setShowFrog] = useState(false);
  const [hasJumped, setHasJumped] = useState(false);
  const [phase, setPhase] = useState<'listen' | 'tap'>('listen');
  const [beatCount, setBeatCount] = useState(0);
  const [userTaps, setUserTaps] = useState<number[]>([]);
  const [canTap, setCanTap] = useState(false);

  const frogY = useRef(new Animated.Value(FROG_START_Y)).current;
  const frogScale = useRef(new Animated.Value(1)).current;
  const beatScale = useRef(new Animated.Value(1)).current;
  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tapWindowRef = useRef<NodeJS.Timeout | null>(null);

  const playBeats = useCallback(() => {
    if (done) return;
    
    setPhase('listen');
    setBeatCount(0);
    setUserTaps([]);
    setCanTap(false);

    // Play first beat
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Animated.sequence([
      Animated.timing(beatScale, {
        toValue: 1.5,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(beatScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    setBeatCount(1);

    // Play second beat after interval
    beatTimeoutRef.current = setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      Animated.sequence([
        Animated.timing(beatScale, {
          toValue: 1.5,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(beatScale, {
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

        Speech.speak('Ab tum tap-tap rhythm mein tap karo!', { rate: 0.8 });

        // Close tap window
        tapWindowRef.current = setTimeout(() => {
          setCanTap(false);
          if (userTaps.length === 2) {
            checkResult();
          } else {
            // Not enough taps
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            Speech.speak('Do baar tap karna tha!', { rate: 0.8 });
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
          }
        }, BEAT_INTERVAL * 3) as unknown as NodeJS.Timeout;
      }, 300);
    }, BEAT_INTERVAL) as unknown as NodeJS.Timeout;
  }, [done, beatScale, round, frogY, frogScale, userTaps]);

  const handleTap = useCallback(() => {
    if (!canTap || done || !showFrog || hasJumped) return;

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
  }, [canTap, done, showFrog, hasJumped]);

  const checkResult = useCallback((taps?: number[]) => {
    const tapsToCheck = taps || userTaps;
    
    if (tapsToCheck.length === 2) {
      const interval = tapsToCheck[1] - tapsToCheck[0];
      const expectedInterval = BEAT_INTERVAL;
      
      if (Math.abs(interval - expectedInterval) <= TAP_TOLERANCE) {
        // Correct rhythm!
        handleSuccess();
      } else {
        // Wrong rhythm
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        Speech.speak('Rhythm match nahi hua! Dobara try karo!', { rate: 0.8 });
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
        }, 1500);
      }
    }
  }, [userTaps, round, frogY, frogScale]);

  const handleSuccess = useCallback(() => {
    setHasJumped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Speech.speak('Perfect rhythm!', { rate: 0.9 });
    
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
        setUserTaps([]);
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
    setPhase('listen');
    setBeatCount(0);
    setUserTaps([]);
    setCanTap(false);
    frogY.setValue(FROG_START_Y);
    frogScale.setValue(1);
    beatScale.setValue(1);
    
    // Start playing beats
    setTimeout(() => {
      playBeats();
    }, 500);
  }, [frogScale, frogY, beatScale, playBeats]);

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

    if (beatTimeoutRef.current) {
      clearTimeout(beatTimeoutRef.current);
    }
    if (tapWindowRef.current) {
      clearTimeout(tapWindowRef.current);
    }

    try {
      await logGameAndAward({
        type: 'rhythm-jump',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['beat-coordination', 'rhythm', 'timing'],
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
        title="Rhythm Jump"
        emoji="🎵"
        description="Tap-tap rhythm se jump! Beat ko suno aur same rhythm mein tap karo!"
        skills={['Beat coordination', 'Rhythm', 'Timing']}
        suitableFor="Children learning beat coordination and rhythm timing"
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
            setUserTaps([]);
            frogY.setValue(FROG_START_Y);
            frogScale.setValue(1);
            beatScale.setValue(1);
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
        <Text style={styles.title}>Rhythm Jump</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎵 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {phase === 'listen' ? 'Beat suno...' : 'Ab same rhythm mein tap-tap karo!'}
        </Text>
        {phase === 'listen' && beatCount > 0 && (
          <Text style={styles.beatIndicator}>
            Beat: {beatCount}/2
          </Text>
        )}
      </View>

      <View style={styles.gameArea}>
        {showFrog && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleTap}
            style={styles.tapArea}
            disabled={!canTap}
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
              {phase === 'tap' && (
                <Text style={styles.rhythmLabel}>TAP-TAP RHYTHM</Text>
              )}
            </Animated.View>

            {phase === 'listen' && (
              <Animated.View
                style={[
                  styles.beatIndicator,
                  {
                    transform: [{ scale: beatScale }],
                  },
                ]}
              >
                <Text style={styles.beatText}>♪ {beatCount === 0 ? 'Ready...' : beatCount === 1 ? 'Tap!' : 'Tap-Tap!'} ♪</Text>
              </Animated.View>
            )}
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
          Skills: Beat coordination • Rhythm • Timing
        </Text>
        <Text style={styles.footerSubtext}>
          Listen to the rhythm and tap in the same beat pattern!
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
    color: '#8B5CF6',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  beatIndicator: {
    fontSize: 20,
    color: '#8B5CF6',
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
  rhythmLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  beatIndicator: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beatText: {
    fontSize: 48,
    fontWeight: '900',
    color: '#8B5CF6',
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

export default RhythmJumpGame;


