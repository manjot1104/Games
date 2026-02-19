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
    PanResponder,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ROPE_CENTER_X_PCT = 50;
const ROPE_START_Y_PCT = 20;
const ROPE_END_Y_PCT = 80;
const SWING_DURATION = 2000; // ms for one full swing
const TIMING_WINDOW = 400; // ms window for correct timing
const SWIPE_THRESHOLD = 100; // Minimum swipe distance

const RopeSwingTimingGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showRope, setShowRope] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [swingPhase, setSwingPhase] = useState<'forward' | 'backward'>('forward');
  const [currentAngle, setCurrentAngle] = useState(0); // Track angle for timing check
  const angleListenerId = useRef<string | null>(null);

  const ropeAngle = useRef(new Animated.Value(-30)).current; // -30 to 30 degrees
  const ropeScale = useRef(new Animated.Value(1)).current;
  const swingAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const lastSwingTime = useRef(0);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeDistance = useRef(0);

  // Animate rope swinging
  const startSwingAnimation = useCallback(() => {
    if (done || !showRope || hasSwiped) return;

    const forwardSwing = Animated.sequence([
      Animated.timing(ropeAngle, {
        toValue: 30,
        duration: SWING_DURATION / 2,
        useNativeDriver: true,
      }),
      Animated.timing(ropeAngle, {
        toValue: -30,
        duration: SWING_DURATION / 2,
        useNativeDriver: true,
      }),
    ]);

    // Track angle changes
    if (angleListenerId.current === null) {
      angleListenerId.current = ropeAngle.addListener(({ value }) => {
        setCurrentAngle(value);
        // Peak is near 0 degrees
        if (Math.abs(value) < 5) {
          lastSwingTime.current = Date.now();
          setSwingPhase('forward');
        } else if (Math.abs(value) > 25) {
          setSwingPhase('backward');
        }
      }) as unknown as string;
    }

    const loop = Animated.loop(forwardSwing);
    swingAnimationRef.current = loop;
    loop.start();
  }, [done, showRope, hasSwiped, ropeAngle]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (done || !showRope || hasSwiped) return;
        swipeStartX.current = evt.nativeEvent.pageX;
        swipeStartY.current = evt.nativeEvent.pageY;
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt) => {
        if (done || !showRope || hasSwiped) return;
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        swipeDistance.current = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      },
      onPanResponderRelease: (evt) => {
        if (done || !showRope || hasSwiped) return;
        
        const distance = swipeDistance.current;
        const now = Date.now();
        const timeSinceSwing = now - lastSwingTime.current;
        
        if (distance >= SWIPE_THRESHOLD) {
          // Check timing - should swipe when rope is at peak (0ms or near SWING_DURATION/2)
          const timingDiff = Math.min(
            timeSinceSwing % SWING_DURATION,
            SWING_DURATION - (timeSinceSwing % SWING_DURATION)
          );
          
          if (timingDiff <= TIMING_WINDOW / 2) {
            // Perfect timing!
            handleSuccess();
          } else {
            // Wrong timing
            handleMiss();
          }
        } else {
          // Not enough swipe
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS('Zada swipe karo!', 0.8 );
        }
      },
    })
  ).current;

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    if (swingAnimationRef.current) {
      swingAnimationRef.current.stop();
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect timing!', 0.9 );
    
    // Success animation
    Animated.parallel([
      Animated.sequence([
        Animated.timing(ropeScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(ropeScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(ropeAngle, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowRope(false);
        setHasSwiped(false);
        ropeAngle.setValue(-30);
        ropeScale.setValue(1);
        lastSwingTime.current = 0;
      } else {
        endGame();
      }
    }, 1000);
  }, [round, ropeAngle, ropeScale]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speakTTS('Sahi timing pe swipe karo! Rope peak pe ho tab swipe karo!', 0.8 );
    
    // Shake animation
    const current = currentAngle;
    Animated.sequence([
      Animated.timing(ropeAngle, {
        toValue: current - 5,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(ropeAngle, {
        toValue: current + 10,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(ropeAngle, {
        toValue: current,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [ropeAngle, currentAngle]);

  const showRopeObject = useCallback(() => {
    setShowRope(true);
    setHasSwiped(false);
    setSwingPhase('forward');
    ropeAngle.setValue(-30);
    ropeScale.setValue(1);
    lastSwingTime.current = Date.now();
    setCurrentAngle(-30);
    
    // Add listener if not already added
    if (angleListenerId.current === null) {
      angleListenerId.current = ropeAngle.addListener(({ value }) => {
        setCurrentAngle(value);
        // Peak is near 0 degrees
        if (Math.abs(value) < 5) {
          lastSwingTime.current = Date.now();
          setSwingPhase('forward');
        } else if (Math.abs(value) > 25) {
          setSwingPhase('backward');
        }
      }) as unknown as string;
    }
    
    Animated.spring(ropeScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    // Start swinging
    setTimeout(() => {
      startSwingAnimation();
      speakTTS('Rope swing ho rahi hai! Peak pe aane pe swipe karo!', 0.8 );
    }, 500);
  }, [ropeScale, ropeAngle, startSwingAnimation]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showRopeObject();
    }, 500);
  }, [done, showRopeObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowRope(false);

    if (swingAnimationRef.current) {
      swingAnimationRef.current.stop();
    }

    try {
      await logGameAndAward({
        type: 'rope-swing-timing',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['anticipation', 'timing', 'swinging-motion'],
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
      if (swingAnimationRef.current) {
        swingAnimationRef.current.stop();
      }
      // Cleanup angle listener if any
      if (angleListenerId.current !== null) {
        ropeAngle.removeListener(angleListenerId.current);
        angleListenerId.current = null;
      }
    };
  }, [ropeAngle]);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Rope Swing Timing"
        emoji="🪢"
        description="Right moment pe swipe! Rope peak pe ho tab swipe karo!"
        skills={['Anticipation', 'Timing']}
        suitableFor="Children learning anticipation and timing skills"
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
            setShowRope(false);
            setHasSwiped(false);
            ropeAngle.setValue(-30);
            ropeScale.setValue(1);
            lastSwingTime.current = 0;
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
        <Text style={styles.title}>Rope Swing Timing</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🪢 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Rope peak pe aane pe swipe karo! Right moment pe swipe!
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showRope && (
          <View style={styles.ropeContainer}>
            {/* Rope anchor */}
            <View style={[
              styles.anchor,
              {
                left: `${ROPE_CENTER_X_PCT}%`,
                top: `${ROPE_START_Y_PCT}%`,
                transform: [{ translateX: -15 }],
              },
            ]} />

            {/* Rope line */}
            <Animated.View
              style={[
                styles.ropeLine,
                {
                  left: `${ROPE_CENTER_X_PCT}%`,
                  top: `${ROPE_START_Y_PCT}%`,
                  transform: [
                    { translateX: -2 },
                    { rotate: ropeAngle.interpolate({
                      inputRange: [-30, 30],
                      outputRange: ['-30deg', '30deg'],
                    }) },
                    { translateY: 100 },
                  ],
                },
              ]}
            />

            {/* Rope end with swing indicator */}
            <Animated.View
              style={[
                styles.ropeEnd,
                {
                  left: `${ROPE_CENTER_X_PCT}%`,
                  top: `${ROPE_END_Y_PCT}%`,
                  transform: [
                    { translateX: -30 },
                    { translateY: -30 },
                    { rotate: ropeAngle.interpolate({
                      inputRange: [-30, 30],
                      outputRange: ['-30deg', '30deg'],
                    }) },
                    { scale: ropeScale },
                  ],
                },
              ]}
            >
              <Text style={styles.ropeEmoji}>🪢</Text>
              {Math.abs(currentAngle) < 5 && (
                <View style={styles.timingIndicator}>
                  <Text style={styles.timingText}>NOW!</Text>
                </View>
              )}
            </Animated.View>
          </View>
        )}

        {!showRope && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Anticipation • Timing
        </Text>
        <Text style={styles.footerSubtext}>
          Swipe at the right moment when the rope reaches its peak!
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
    color: '#EF4444',
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
  ropeContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  anchor: {
    position: 'absolute',
    width: 30,
    height: 30,
    backgroundColor: '#78716C',
    borderRadius: 15,
    zIndex: 2,
  },
  ropeLine: {
    position: 'absolute',
    width: 4,
    height: '40%',
    backgroundColor: '#78716C',
    transformOrigin: 'top center',
    zIndex: 1,
  },
  ropeEnd: {
    position: 'absolute',
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  ropeEmoji: {
    fontSize: 50,
  },
  timingIndicator: {
    position: 'absolute',
    top: -40,
    backgroundColor: 'rgba(34, 197, 94, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  timingText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
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

export default RopeSwingTimingGame;

