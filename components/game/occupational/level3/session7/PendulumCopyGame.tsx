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
    PanResponder,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PENDULUM_CENTER_X_PCT = 50; // % of screen width
const PENDULUM_CENTER_Y_PCT = 40; // % of screen height
const SWING_DISTANCE_PCT = 30; // % swing distance
const MIN_SWINGS = 2; // Minimum swings required

const PendulumCopyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showPendulum, setShowPendulum] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const [phase, setPhase] = useState<'watch' | 'copy'>('watch');

  const demoPendulumX = useRef(new Animated.Value(PENDULUM_CENTER_X_PCT)).current;
  const userPendulumX = useRef(new Animated.Value(PENDULUM_CENTER_X_PCT)).current;
  const demoScale = useRef(new Animated.Value(1)).current;
  const userScale = useRef(new Animated.Value(1)).current;
  const swingCount = useRef(0);
  const lastDirection = useRef<'left' | 'right' | null>(null);
  const swingStartX = useRef(0);
  const userSwings = useRef(0);
  const userLastDirection = useRef<'left' | 'right' | null>(null);
  const userSwingStartX = useRef(0);

  // Animate demo pendulum
  const animateDemo = useCallback(() => {
    if (done) return;

    const swingLeft = Animated.sequence([
      Animated.timing(demoPendulumX, {
        toValue: PENDULUM_CENTER_X_PCT - SWING_DISTANCE_PCT,
        duration: 600,
        useNativeDriver: false,
      }),
      Animated.timing(demoPendulumX, {
        toValue: PENDULUM_CENTER_X_PCT,
        duration: 600,
        useNativeDriver: false,
      }),
    ]);

    const swingRight = Animated.sequence([
      Animated.timing(demoPendulumX, {
        toValue: PENDULUM_CENTER_X_PCT + SWING_DISTANCE_PCT,
        duration: 600,
        useNativeDriver: false,
      }),
      Animated.timing(demoPendulumX, {
        toValue: PENDULUM_CENTER_X_PCT,
        duration: 600,
        useNativeDriver: false,
      }),
    ]);

    // Do 3 swings total (left-right-left or right-left-right)
    const swings = Animated.sequence([
      swingLeft,
      swingRight,
      swingLeft,
    ]);

    swings.start(() => {
      setPhase('copy');
      Speech.speak('Ab tum side-to-side swing karo!', { rate: 0.8 });
    });
  }, [done, demoPendulumX]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => phase === 'copy' && !hasCopied,
      onMoveShouldSetPanResponder: () => phase === 'copy' && !hasCopied,
      onPanResponderGrant: (evt) => {
        if (phase !== 'copy' || hasCopied) return;
        userSwingStartX.current = evt.nativeEvent.pageX;
        userLastDirection.current = null;
      },
      onPanResponderMove: (evt) => {
        if (phase !== 'copy' || hasCopied) return;
        const currentX = evt.nativeEvent.pageX;
        const deltaX = currentX - userSwingStartX.current;

        // Update user pendulum position (convert to percentage)
        const newXPct = (currentX / SCREEN_WIDTH) * 100;
        const clampedXPct = Math.max(
          PENDULUM_CENTER_X_PCT - SWING_DISTANCE_PCT,
          Math.min(PENDULUM_CENTER_X_PCT + SWING_DISTANCE_PCT, newXPct)
        );
        userPendulumX.setValue(clampedXPct);

        // Detect swing direction
        if (Math.abs(deltaX) > 50) {
          const direction: 'left' | 'right' = deltaX < 0 ? 'left' : 'right';
          
          if (userLastDirection.current && userLastDirection.current !== direction) {
            // Direction changed - completed a swing
            userSwings.current++;
            userLastDirection.current = direction;
            userSwingStartX.current = currentX;
            
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            
            if (userSwings.current >= MIN_SWINGS * 2) {
              // Completed required swings
              handleSuccess();
            }
          } else if (!userLastDirection.current) {
            userLastDirection.current = direction;
          }
        }
      },
      onPanResponderRelease: () => {
        // Spring back to center
        Animated.spring(userPendulumX, {
          toValue: PENDULUM_CENTER_X_PCT,
          damping: 10,
          stiffness: 100,
          useNativeDriver: false,
        }).start();
      },
    })
  ).current;

  const handleSuccess = useCallback(() => {
    setHasCopied(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Speech.speak('Perfect swing copy!', { rate: 0.9 });
    
    Animated.parallel([
      Animated.sequence([
        Animated.timing(userScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(userScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowPendulum(false);
        setHasCopied(false);
        setPhase('watch');
        userSwings.current = 0;
        userLastDirection.current = null;
        demoPendulumX.setValue(PENDULUM_CENTER_X_PCT);
        userPendulumX.setValue(PENDULUM_CENTER_X_PCT);
        demoScale.setValue(1);
        userScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, userScale, demoPendulumX, userPendulumX, demoScale]);

  const showPendulumObject = useCallback(() => {
    setShowPendulum(true);
    setHasCopied(false);
    setPhase('watch');
    userSwings.current = 0;
    userLastDirection.current = null;
    demoPendulumX.setValue(PENDULUM_CENTER_X);
    userPendulumX.setValue(PENDULUM_CENTER_X);
    demoScale.setValue(1);
    userScale.setValue(1);
    
    // Start demo animation
    setTimeout(() => {
      animateDemo();
    }, 500);
  }, [demoPendulumX, userPendulumX, demoScale, userScale, animateDemo]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showPendulumObject();
    }, 500);
  }, [done, showPendulumObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowPendulum(false);

    try {
      await logGameAndAward({
        type: 'pendulum-copy',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['flowing-movement-control', 'imitation'],
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
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Pendulum Copy"
        emoji="🔄"
        description="Side-to-side swing copy! Demo dekh kar same swing karo!"
        skills={['Flowing movement control', 'Imitation']}
        suitableFor="Children learning flowing movement control and imitation"
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
            setShowPendulum(false);
            setHasCopied(false);
            setPhase('watch');
            userSwings.current = 0;
            demoPendulumX.setValue(PENDULUM_CENTER_X_PCT);
            userPendulumX.setValue(PENDULUM_CENTER_X_PCT);
            demoScale.setValue(1);
            userScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} {...panResponder.panHandlers}>
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
        <Text style={styles.title}>Pendulum Copy</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔄 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {phase === 'watch' ? 'Demo dekh rahe hain...' : 'Ab tum side-to-side swing karo!'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showPendulum && (
          <>
            {/* Demo Pendulum */}
            {phase === 'watch' && (
              <View style={styles.demoSection}>
                <Text style={styles.label}>DEMO</Text>
                <Animated.View
                  style={[
                    styles.pendulumContainer,
                    {
                      left: demoPendulumX.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0%', '100%'],
                      }),
                      top: `${PENDULUM_CENTER_Y_PCT}%`,
                      transform: [{ scale: demoScale }, { translateX: -40 }],
                    },
                  ]}
                >
                  <View style={styles.pendulumRope} />
                  <Text style={styles.pendulumEmoji}>⚖️</Text>
                </Animated.View>
              </View>
            )}

            {/* User Pendulum */}
            {phase === 'copy' && (
              <View style={styles.userSection}>
                <Text style={styles.label}>TUM</Text>
                <Animated.View
                  style={[
                    styles.pendulumContainer,
                    {
                      left: userPendulumX.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0%', '100%'],
                      }),
                      top: `${PENDULUM_CENTER_Y_PCT}%`,
                      transform: [{ scale: userScale }, { translateX: -40 }],
                    },
                  ]}
                >
                  <View style={styles.pendulumRope} />
                  <Text style={styles.pendulumEmoji}>⚖️</Text>
                </Animated.View>
                {userSwings.current > 0 && (
                  <Text style={styles.swingCount}>
                    Swings: {Math.floor(userSwings.current / 2)}/{MIN_SWINGS}
                  </Text>
                )}
              </View>
            )}
          </>
        )}

        {!showPendulum && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Flowing movement control • Imitation
        </Text>
        <Text style={styles.footerSubtext}>
          Watch the demo and copy the side-to-side swinging movement!
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
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  demoSection: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userSection: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: 24,
    fontWeight: '800',
    color: '#3B82F6',
    marginBottom: 20,
  },
  pendulumContainer: {
    position: 'absolute',
    width: 80,
    height: 80,
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginLeft: -40,
    marginTop: -40,
  },
  pendulumRope: {
    width: 4,
    height: 100,
    backgroundColor: '#94A3B8',
    marginBottom: 10,
  },
  pendulumEmoji: {
    fontSize: 60,
  },
  swingCount: {
    position: 'absolute',
    top: '60%',
    fontSize: 20,
    fontWeight: '800',
    color: '#22C55E',
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

export default PendulumCopyGame;

